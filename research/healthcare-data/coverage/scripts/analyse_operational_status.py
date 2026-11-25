
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
ANALYSIS_DATE = pd.Timestamp("2026-11-25")

# Load city boundary
boroughs = gpd.read_file(
    ROOT / "kosice_boundary.geojson"
).to_crs(CRS)

city = boroughs.geometry.union_all()

# Load geographical and population points
grid = gpd.read_file(
    ROOT / "kosice_grid_500m.geojson"
).to_crs(CRS)

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

# Load KSK records
with open(
    ROOT / "healthcare_data_clean.json",
    encoding="utf-8"
) as f:
    data = json.load(f)

df = pd.DataFrame([
    feature["properties"]
    for feature in data["features"]
])

df = df[df["county"].isin([
    "Košice I", "Košice II",
    "Košice III", "Košice IV"
])].copy()

for column in ["poloha_lat", "poloha_lon"]:
    df[column] = pd.to_numeric(
        df[column], errors="coerce"
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

# Parse absence dates
for column in ["nepritomnost_od", "nepritomnost_do"]:
    facilities[column + "_parsed"] = pd.to_datetime(
        facilities[column].astype("string").str.rstrip("Z"),
        errors="coerce"
    )

start = facilities["nepritomnost_od_parsed"]
end = facilities["nepritomnost_do_parsed"]

facilities["status"] = "No identified inactivity"

facilities.loc[
    end < ANALYSIS_DATE,
    "status"
] = "Expired absence"

facilities.loc[
    start > ANALYSIS_DATE,
    "status"
] = "Future absence"

facilities.loc[
    (start <= ANALYSIS_DATE)
    & (end >= ANALYSIS_DATE),
    "status"
] = "Ongoing absence"

# Flag incomplete or unparseable absence dates
has_dates = (
    facilities["nepritomnost_od"].notna()
    | facilities["nepritomnost_do"].notna()
)

facilities.loc[
    has_dates & (start.isna() | end.isna()),
    "status"
] = "Requires review"

# Explicit closure confirmed in the source text
info = facilities["info"].fillna("")

closed = (
    info.str.contains("ukončenie činnosti", case=False)
    & info.str.contains("zrušenie povolenia", case=False)
)

facilities.loc[closed, "status"] = "Explicit closure"

# Exclude confirmed closures and ongoing absences
filtered = facilities[
    ~facilities["status"].isin([
        "Ongoing absence",
        "Explicit closure"
    ])
].copy()

print("KOSICE OPERATIONAL STATUS ANALYSIS")
print("=" * 60)
print("Original records:", len(facilities))
print("Remaining records:", len(filtered))
print("\nStatus distribution:")
print(facilities["status"].value_counts().to_string())

# Save status audit
audit = facilities[
    facilities["status"] != "No identified inactivity"
]

audit[[
    "identifikator",
    "druh_zariadenia",
    "addressline",
    "nepritomnost_od",
    "nepritomnost_do",
    "info",
    "status"
]].to_csv(
    RESULTS / "operational_status_audit.csv",
    index=False,
    encoding="utf-8-sig"
)

# Recalculate coverage
def calculate_coverage(subset, radius):
    if subset.empty:
        return 0.0, 0.0

    xy = np.column_stack([
        subset.geometry.x,
        subset.geometry.y
    ])

    tree = cKDTree(xy)

    geo_distances, _ = tree.query(grid_xy)
    pop_distances, _ = tree.query(population_xy)

    geo_percent = 100 * (geo_distances <= radius).mean()

    pop_percent = (
        100 * weights[pop_distances <= radius].sum()
        / weights.sum()
    )

    return geo_percent, pop_percent

# Reuse verified specialty labels
specialties = pd.read_csv(
    RESULTS / "specialty_coverage.csv"
)[["specialty", "ksk_label"]].drop_duplicates()

categories = {
    "All facilities": None,
    **dict(zip(
        specialties["specialty"],
        specialties["ksk_label"]
    )),
    "Clinical oncology": "ambulancia klinickej onkológie"
}

results = []

for specialty, label in categories.items():

    before = facilities
    after = filtered

    if label is not None:
        before = before[before["druh_zariadenia"] == label]
        after = after[after["druh_zariadenia"] == label]

    for radius in RADII:
        geo_before, pop_before = calculate_coverage(
            before, radius
        )

        geo_after, pop_after = calculate_coverage(
            after, radius
        )

        results.append({
            "specialty": specialty,
            "radius_m": radius,
            "records_before": len(before),
            "records_after": len(after),
            "geographical_before_percent": geo_before,
            "geographical_after_percent": geo_after,
            "population_before_percent": pop_before,
            "population_after_percent": pop_after,
            "population_change_pp": pop_after - pop_before
        })

report = pd.DataFrame(results)

report.to_csv(
    RESULTS / "operational_coverage_comparison.csv",
    index=False,
    encoding="utf-8-sig"
)

print("\nOverall population coverage:")
print(report.loc[
    report["specialty"] == "All facilities",
    [
        "radius_m",
        "population_before_percent",
        "population_after_percent"
    ]
].to_string(index=False))

print("\nResults saved successfully.")
