
import json
from pathlib import Path

import geopandas as gpd
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
RESULTS = ROOT / "coverage" / "results"
RESULTS.mkdir(parents=True, exist_ok=True)

CRS = "EPSG:32634"

# Load KSK dataset
with open(
    ROOT / "healthcare_data_clean.json",
    encoding="utf-8"
) as f:
    data = json.load(f)

ksk = pd.DataFrame([
    feature["properties"]
    for feature in data["features"]
])

# Select Kosice districts
ksk = ksk[ksk["county"].isin([
    "Košice I", "Košice II",
    "Košice III", "Košice IV"
])].copy()

for column in ["poloha_lat", "poloha_lon"]:
    ksk[column] = pd.to_numeric(
        ksk[column], errors="coerce"
    )

ksk = ksk.dropna(
    subset=["poloha_lat", "poloha_lon"]
)

ksk = ksk[
    ksk["poloha_lat"].between(-90, 90)
    & ksk["poloha_lon"].between(-180, 180)
]

# Apply the same geographical boundary
boroughs = gpd.read_file(
    ROOT / "kosice_boundary.geojson"
).to_crs(CRS)

city = boroughs.geometry.union_all()

ksk = gpd.GeoDataFrame(
    ksk,
    geometry=gpd.points_from_xy(
        ksk["poloha_lon"],
        ksk["poloha_lat"]
    ),
    crs="EPSG:4326"
).to_crs(CRS)

ksk = ksk[ksk.geometry.intersects(city)].copy()

# Load national UDZS register
udzs = pd.read_excel(
    ROOT / "VyberKpWeb_2.11.2026.xlsx",
    dtype={
        "ico": "string",
        "pzs_kod": "string",
        "PSC OU": "string"
    }
)

def normalize_code(series):
    return (
        series.astype("string")
        .str.strip()
        .str.upper()
        .str.replace(r"\s+", "", regex=True)
        .replace("", pd.NA)
    )

ksk["normalized_code"] = normalize_code(
    ksk["kpzs_kod"]
)

udzs["normalized_code"] = normalize_code(
    udzs["pzs_kod"]
)

# Select actual healthcare workplaces in Kosice
municipality = (
    udzs["Obec OU"]
    .astype("string")
    .str.strip()
)

city_mask = municipality.str.contains(
    r"^Košice(?:$|[\s–-])",
    case=False,
    regex=True,
    na=False
)

# Exclude Kosice-okolie
city_mask &= ~municipality.str.contains(
    r"okolie",
    case=False,
    na=False
)

udzs_kosice = udzs[city_mask].copy()

# Compare unique identifiers
ksk_codes = set(
    ksk["normalized_code"].dropna()
)

udzs_codes = set(
    udzs_kosice["normalized_code"].dropna()
)

national_codes = set(
    udzs["normalized_code"].dropna()
)

matched = ksk_codes & udzs_codes
only_ksk = ksk_codes - udzs_codes
only_udzs = udzs_codes - ksk_codes

ksk_absent_nationally = (
    ksk_codes - national_codes
)

match_rate = (
    100 * len(matched) / len(udzs_codes)
    if udzs_codes else 0
)

# Print results
print("KSK - UDZS REGISTER COMPARISON")
print("=" * 60)

print("\nKSK:")
print("Kosice records:", len(ksk))
print("Unique codes:", len(ksk_codes))
print("Missing codes:",
      ksk["normalized_code"].isna().sum())

print("\nUDZS:")
print("National records:", len(udzs))
print("Kosice workplace records:", len(udzs_kosice))
print("Unique Kosice codes:", len(udzs_codes))

print("\nWorkplace municipalities:")
print(
    udzs_kosice["Obec OU"]
    .value_counts()
    .to_string()
)

print("\nCOMPARISON:")
print("Matching codes:", len(matched))
print("Only in KSK:", len(only_ksk))
print("Only in UDZS:", len(only_udzs))
print("KSK codes absent nationally:",
      len(ksk_absent_nationally))

print(f"UDZS code matching rate: {match_rate:.2f}%")

# Save summary
summary = {
    "ksk_records": len(ksk),
    "ksk_unique_codes": len(ksk_codes),
    "ksk_missing_codes":
        int(ksk["normalized_code"].isna().sum()),
    "udzs_national_records": len(udzs),
    "udzs_kosice_records": len(udzs_kosice),
    "udzs_unique_kosice_codes": len(udzs_codes),
    "matching_codes": len(matched),
    "only_ksk": len(only_ksk),
    "only_udzs": len(only_udzs),
    "ksk_absent_nationally":
        len(ksk_absent_nationally),
    "udzs_code_matching_percent": match_rate
}

pd.DataFrame([summary]).to_csv(
    RESULTS / "register_comparison.csv",
    index=False
)

# Save unmatched UDZS records
udzs_unmatched = udzs_kosice[
    udzs_kosice["normalized_code"].isin(only_udzs)
]

udzs_unmatched.to_csv(
    RESULTS / "udzs_unmatched.csv",
    index=False,
    encoding="utf-8-sig"
)

# Save unmatched KSK records
ksk_unmatched = ksk[
    ksk["normalized_code"].isin(only_ksk)
]

ksk_unmatched.drop(columns="geometry").to_csv(
    RESULTS / "ksk_unmatched.csv",
    index=False,
    encoding="utf-8-sig"
)

# Save matching identifiers
pd.DataFrame({
    "provider_code": sorted(matched)
}).to_csv(
    RESULTS / "matching_provider_codes.csv",
    index=False
)

print("\nResults saved successfully.")
