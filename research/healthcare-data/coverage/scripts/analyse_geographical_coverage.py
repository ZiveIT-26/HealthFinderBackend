
import json
from pathlib import Path

import geopandas as gpd
import pandas as pd
import numpy as np
from scipy.spatial import cKDTree

ROOT = Path(__file__).resolve().parents[2]
RESULTS = ROOT / "coverage" / "results"
RESULTS.mkdir(parents=True, exist_ok=True)

RADII = [1000, 2000, 3000]
CRS = "EPSG:32634"

# Load city boundary and grid
boroughs = gpd.read_file(ROOT / "kosice_boundary.geojson")
boroughs = boroughs.to_crs(CRS)
city = boroughs.geometry.union_all()

grid = gpd.read_file(ROOT / "kosice_grid_500m.geojson")
grid = grid.to_crs(CRS)

# Load cleaned KSK dataset
with open(ROOT / "healthcare_data_clean.json",
          encoding="utf-8") as f:
    data = json.load(f)

df = pd.DataFrame([
    feature["properties"]
    for feature in data["features"]
])

# Select Kosice administrative districts
districts = ["Košice I", "Košice II",
             "Košice III", "Košice IV"]

df = df[df["county"].isin(districts)].copy()

df["poloha_lat"] = pd.to_numeric(
    df["poloha_lat"], errors="coerce"
)
df["poloha_lon"] = pd.to_numeric(
    df["poloha_lon"], errors="coerce"
)

df = df.dropna(subset=["poloha_lat", "poloha_lon"])

df = df[
    df["poloha_lat"].between(-90, 90)
    & df["poloha_lon"].between(-180, 180)
]

facilities = gpd.GeoDataFrame(
    df,
    geometry=gpd.points_from_xy(
        df["poloha_lon"], df["poloha_lat"]
    ),
    crs="EPSG:4326"
).to_crs(CRS)

# Keep facilities inside the city boundary
facilities = facilities[
    facilities.geometry.intersects(city)
].copy()

# Calculate distance to nearest registered facility
facility_xy = np.column_stack([
    facilities.geometry.x,
    facilities.geometry.y
])

grid_xy = np.column_stack([
    grid.geometry.x,
    grid.geometry.y
])

tree = cKDTree(facility_xy)
distances, _ = tree.query(grid_xy)

grid["nearest_facility_m"] = distances

print("KOSICE GEOGRAPHICAL COVERAGE")
print("=" * 60)
print("Facility records:", len(facilities))
print("Grid points:", len(grid))

results = []

for radius in RADII:
    column = f"covered_{radius}m"
    grid[column] = distances <= radius

    covered = int(grid[column].sum())
    coverage = 100 * covered / len(grid)

    results.append({
        "radius_m": radius,
        "covered_points": covered,
        "total_points": len(grid),
        "coverage_percent": coverage
    })

    print(f"{radius} m: {covered}/{len(grid)} "
          f"({coverage:.2f}%)")

# Save overall results
pd.DataFrame(results).to_csv(
    RESULTS / "geographical_coverage.csv",
    index=False
)

# Save grid-level results
grid.to_crs("EPSG:4326").to_file(
    RESULTS / "grid_coverage.geojson",
    driver="GeoJSON"
)

# Save coverage by borough
borough_coverage = grid.groupby("NM4")[
    [f"covered_{r}m" for r in RADII]
].mean() * 100

borough_coverage.to_csv(
    RESULTS / "borough_coverage.csv"
)

# Save original facility-type distribution
facilities["druh_zariadenia"].value_counts().to_csv(
    RESULTS / "facility_types.csv",
    header=["record_count"],
    encoding="utf-8-sig"
)

print("\nResults saved successfully.")
