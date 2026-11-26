
import json
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import rasterio

from rasterio.mask import mask
from pyproj import Transformer
from scipy.spatial import cKDTree

ROOT = Path(__file__).resolve().parents[2]
RESULTS = ROOT / "coverage" / "results"

RESULTS.mkdir(parents=True, exist_ok=True)

RADII = [1000, 2000, 3000]
CRS = "EPSG:32634"

RASTER = (
    ROOT
    / "JRC-ESTAT_Census_Population_2021_100m (2)"
    / "JRC-ESTAT_Census_Population_2021_100m_rev0726.tif"
)

# Load official city boundaries
boroughs = gpd.read_file(ROOT / "kosice_boundary.geojson")
city = boroughs.to_crs(CRS).geometry.union_all()

# Extract population cells inside Kosice
with rasterio.open(RASTER) as src:
    boundary = boroughs.to_crs(src.crs)
    geometry = boundary.geometry.union_all()

    raster, transform = mask(
        src,
        [geometry],
        crop=True,
        filled=False
    )

    population = raster[0].astype("float64").filled(0)

    valid = np.isfinite(population) & (population > 0)
    rows, cols = np.where(valid)
    weights = population[rows, cols]

    x, y = rasterio.transform.xy(transform, rows, cols)

    transformer = Transformer.from_crs(
        src.crs, CRS, always_xy=True
    )

    x, y = transformer.transform(x, y)

population_xy = np.column_stack([x, y])

# Load cleaned KSK dataset
with open(
    ROOT / "healthcare_data_clean.json",
    encoding="utf-8"
) as f:
    data = json.load(f)

df = pd.DataFrame([
    feature["properties"]
    for feature in data["features"]
])

districts = [
    "Košice I", "Košice II",
    "Košice III", "Košice IV"
]

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
        df["poloha_lon"],
        df["poloha_lat"]
    ),
    crs="EPSG:4326"
).to_crs(CRS)

facilities = facilities[
    facilities.geometry.intersects(city)
].copy()

facility_xy = np.column_stack([
    facilities.geometry.x,
    facilities.geometry.y
])

# Calculate nearest facility distances
tree = cKDTree(facility_xy)
distances, _ = tree.query(population_xy)

total_population = weights.sum()

print("KOSICE POPULATION COVERAGE")
print("=" * 60)
print("Facility records:", len(facilities))
print("Inhabited cells:", len(weights))
print(f"Estimated population: {total_population:,.2f}")

results = []

for radius in RADII:
    covered = distances <= radius

    covered_population = weights[covered].sum()
    population_percent = (
        100 * covered_population / total_population
    )

    cell_percent = 100 * covered.mean()

    results.append({
        "radius_m": radius,
        "covered_cells": int(covered.sum()),
        "total_cells": len(weights),
        "inhabited_cell_coverage_percent": cell_percent,
        "covered_population": covered_population,
        "total_population": total_population,
        "population_coverage_percent": population_percent
    })

    print(f"\nRadius: {radius} m")
    print(f"Inhabited cell coverage: {cell_percent:.2f}%")
    print(f"Covered population: {covered_population:,.2f}")
    print(f"Population coverage: {population_percent:.2f}%")

pd.DataFrame(results).to_csv(
    RESULTS / "population_coverage.csv",
    index=False
)

# Save individual population cells
cells = gpd.GeoDataFrame(
    {
        "population": weights,
        "nearest_facility_m": distances
    },
    geometry=gpd.points_from_xy(x, y),
    crs=CRS
)

for radius in RADII:
    cells[f"covered_{radius}m"] = distances <= radius

cells.to_crs("EPSG:4326").to_file(
    RESULTS / "population_cells_coverage.geojson",
    driver="GeoJSON"
)

print("\nResults saved successfully.")
