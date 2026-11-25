
import json
import re
import unicodedata
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
RESULTS = ROOT / "coverage" / "results"


def normalize_text(value):
    if pd.isna(value):
        return ""

    text = unicodedata.normalize("NFKD", str(value))
    text = "".join(
        c for c in text
        if not unicodedata.combining(c)
    )

    text = text.lower().strip()
    text = re.sub(r"[^\w\s]", " ", text)

    return " ".join(text.split())


def normalize_ico(value):
    if pd.isna(value):
        return ""

    value = str(value).strip()
    value = re.sub(r"\.0$", "", value)

    return value.zfill(8) if value.isdigit() else ""


def normalize_number(value):
    if pd.isna(value):
        return ""

    value = str(value).strip().lower()
    value = re.sub(r"\.0$", "", value)

    # Keep orientation number after slash
    value = value.split("/")[-1].strip()

    if not re.fullmatch(r"\d+[a-z]?", value):
        return ""

    return value


def address_key(street, number):
    street = normalize_text(street)
    number = normalize_number(number)

    if not street or not number:
        return ""

    return f"{street}|{number}"


def parse_udzs_address(value):
    if pd.isna(value):
        return ""

    value = str(value).strip()

    match = re.match(
        r"^(.+?)\s+(\d+[a-zA-Z]?(?:\s*/\s*\d+[a-zA-Z]?)?)$",
        value
    )

    if not match:
        return ""

    return address_key(
        match.group(1),
        match.group(2)
    )


# Load KSK records
with open(
    ROOT / "healthcare_data_clean.json",
    encoding="utf-8"
) as f:
    data = json.load(f)

ksk = pd.DataFrame([
    feature["properties"]
    for feature in data["features"]
])

ksk = ksk[ksk["county"].isin([
    "Košice I", "Košice II",
    "Košice III", "Košice IV"
])].copy()

ksk["ico_normalized"] = (
    ksk["identifikator"]
    .astype("string")
    .str.extract(r"^\d{2}-(\d{8})-", expand=False)
    .map(normalize_ico)
)

ksk["address_normalized"] = [
    address_key(street, number)
    for street, number in zip(
        ksk["streetname"],
        ksk["buildingnumber"]
    )
]

# Load unmatched UDZS records
udzs = pd.read_csv(
    RESULTS / "udzs_unmatched.csv",
    dtype="string"
)

udzs["ico_normalized"] = udzs["ico"].map(
    normalize_ico
)

udzs["address_normalized"] = udzs[
    "Ulica cislo OU"
].map(parse_udzs_address)

# Build matching indexes
providers = set(
    ksk["ico_normalized"]
) - {""}

addresses = set(
    ksk["address_normalized"]
) - {""}

provider_addresses = {
    (ico, address)
    for ico, address in zip(
        ksk["ico_normalized"],
        ksk["address_normalized"]
    )
    if ico and address
}


def classify(row):
    ico = row["ico_normalized"]
    address = row["address_normalized"]

    if not address:
        return "Missing or unparseable address"

    if (ico, address) in provider_addresses:
        return "Same provider and address"

    if address in addresses:
        return "Same address only"

    if ico in providers:
        return "Same provider only"

    return "Neither matched"


udzs["match_category"] = udzs.apply(
    classify,
    axis=1
)

summary = (
    udzs["match_category"]
    .value_counts()
    .rename_axis("category")
    .reset_index(name="records")
)

summary["percentage"] = (
    100 * summary["records"] / len(udzs)
)

candidates = udzs[
    udzs["match_category"].isin([
        "Same provider only",
        "Neither matched"
    ])
].copy()

print("KSK - UDZS ADDRESS RECONCILIATION")
print("=" * 65)
print("KSK records:", len(ksk))
print("Unmatched UDZS records:", len(udzs))

print("\nMatching categories:")
print(summary.to_string(index=False))

print("\nCandidate location gaps:", len(candidates))

print(
    "Distinct candidate addresses:",
    candidates["address_normalized"].nunique()
)

# Save results
summary.to_csv(
    RESULTS / "address_reconciliation_summary.csv",
    index=False,
    encoding="utf-8-sig"
)

udzs.to_csv(
    RESULTS / "address_reconciliation_details.csv",
    index=False,
    encoding="utf-8-sig"
)

candidates.to_csv(
    RESULTS / "candidate_location_gaps.csv",
    index=False,
    encoding="utf-8-sig"
)

print("\nResults saved successfully.")
