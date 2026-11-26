
import json
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
from scipy.spatial import cKDTree

ROOT = Path(__file__).resolve().parents[2]
RESULTS = ROOT / "coverage" / "results"

CRS = "EPSG:32634"
RADII = [1000, 2000, 3000]

# Exact KSK facility-type labels
SPECIALTIES = {
    "General practice":
        "ambulancia všeobecnej ambulantnej zdravotnej starostlivosti",
    "Dentistry":
        "ambulancia zubného lekárstva",
    "Internal medicine":
        "ambulancia vnútorného lekárstva",
    "Gynaecology":
        "gynekologicko-pôrodnícka ambulancia",
    "Orthopaedics":
        "ortopedická ambulancia",
    "Ophthalmology":
        "oftalmologická ambulancia",
    "Dermatology":
        "dermatovenerologická ambulancia",
    "Neurology":
        "neurologická ambulancia",
    "Cardiology":
        "kardiologická ambulancia",
    "ENT":
        "otorinolaryngologická ambulancia",
    "Urology":
        "urologická ambulancia"
}

# Load boundaries
boroughs = gpd.read_file(
    ROOT / "kosice_boundary.geojson"
).to_crs(CRS)

city = boroughs.geometry.union_all()

# Load previously generated geographical grid
grid = gpd.read_file(
    ROOT / "kosice_grid_500m.geojson"
).to_crs(CRS)

# Load previously generated population cells
cells = gpd.read_file(
    RESULTS / "population_cells_coverage.geojson"
).to_crs(CRS)

grid_xy = np.column_stack([
    grid.geometry.x,
    grid.geometry.y
])

population_xy = np.column_stack([
    cells.geometry.x,
    cells.geometry.y
])

weights = cells["population"].to_numpy(dtype=float)
total_population = weights.sum()

# Load cleaned KSK records
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

results = []

print("KOSICE SPECIALTY COVERAGE")
print("=" * 70)
print("Facility records:", len(facilities))
print("Grid points:", len(grid))
print("Population cells:", len(cells))
print("Estimated population:", total_population)

for specialty, label in SPECIALTIES.items():

    subset = facilities[
        facilities["druh_zariadenia"] == label
    ]

    print(f"\n{specialty}")
    print("Registered records:", len(subset))

    if subset.empty:
        geo_distances = np.full(len(grid), np.inf)
        pop_distances = np.full(len(cells), np.inf)
        coordinate_count = 0
    else:
        coordinates = np.column_stack([
            subset.geometry.x,
            subset.geometry.y
        ])

        coordinates = np.unique(coordinates, axis=0)
        coordinate_count = len(coordinates)

        tree = cKDTree(coordinates)

        geo_distances, _ = tree.query(grid_xy)
        pop_distances, _ = tree.query(population_xy)

    for radius in RADII:

        geo_covered = geo_distances <= radius
        pop_covered = pop_distances <= radius

        geo_percent = 100 * geo_covered.mean()

        covered_population = weights[pop_covered].sum()

        pop_percent = (
            100 * covered_population / total_population
        )

        results.append({
            "specialty": specialty,
            "ksk_label": label,
            "registered_records": len(subset),
            "distinct_coordinates": coordinate_count,
            "radius_m": radius,
            "covered_grid_points": int(geo_covered.sum()),
            "total_grid_points": len(grid),
            "geographical_coverage_percent": geo_percent,
            "covered_population_cells": int(pop_covered.sum()),
            "total_population_cells": len(cells),
            "inhabited_cell_coverage_percent":
                100 * pop_covered.mean(),
            "covered_population": covered_population,
            "total_population": total_population,
            "population_coverage_percent": pop_percent
        })

        print(
            f"  {radius} m: "
            f"Geographical {geo_percent:.2f}% | "
            f"Population {pop_percent:.2f}%"
        )

pd.DataFrame(results).to_csv(
    RESULTS / "specialty_coverage.csv",
    index=False,
    encoding="utf-8-sig"
)

print("\nResults saved successfully.")
