
from pathlib import Path

import geopandas as gpd
import numpy as np
from shapely.geometry import Point

ROOT = Path(__file__).resolve().parents[2]

GRID_SIZE = 500
CRS = "EPSG:32634"

# Load official Košice borough boundaries
boroughs = gpd.read_file(ROOT / "kosice_boundary.geojson")

# Convert coordinates to a metric projection
boroughs = boroughs.to_crs(CRS)

# Combine boroughs into one city boundary
city = boroughs.geometry.union_all()

min_x, min_y, max_x, max_y = city.bounds

# Generate grid points inside the city boundary
points = []

for x in np.arange(min_x, max_x, GRID_SIZE):
    for y in np.arange(min_y, max_y, GRID_SIZE):
        point = Point(x, y)
        if city.covers(point):
            points.append(point)

grid = gpd.GeoDataFrame(
    {"grid_id": range(1, len(points) + 1)},
    geometry=points,
    crs=boroughs.crs
)

# Assign each point to its borough
grid = gpd.sjoin(
    grid,
    boroughs[["NM4", "geometry"]],
    how="left",
    predicate="within"
)

grid = grid.drop(columns=["index_right"])

# Convert back to GPS coordinates
grid = grid.to_crs("EPSG:4326")

grid["latitude"] = grid.geometry.y
grid["longitude"] = grid.geometry.x

# Save results
grid.to_file(
    ROOT / "kosice_grid_500m.geojson",
    driver="GeoJSON"
)

grid.drop(columns="geometry").to_csv(
    ROOT / "kosice_grid_500m.csv",
    index=False
)

print("KOSICE 500-METRE GRID")
print("=" * 50)
print("Total boroughs:", len(boroughs))
print("City area (km²):", round(city.area / 1_000_000, 2))
print("Total grid points:", len(grid))

print("\nGrid points per borough:")
print(grid["NM4"].value_counts().to_string())

print("\nGrid files generated successfully.")
