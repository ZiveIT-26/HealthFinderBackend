
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
RESULTS = ROOT / "coverage" / "results"

df = pd.read_csv(
    RESULTS / "address_reconciliation_details.csv",
    dtype="string"
)

# Extract specialty and activity codes
df["specialty_code"] = df["pzs_kod"].str[6:9]
df["activity_code"] = df["pzs_kod"].str[9]

# Select outpatient activities
outpatient = df[
    df["activity_code"] == "2"
].copy()

# Exclude mobile sampling facilities
relevant = outpatient[
    outpatient["specialty_code"] != "647"
].copy()

candidates = relevant[
    relevant["match_category"].isin([
        "Same provider only",
        "Neither matched"
    ])
].copy()

unresolved = relevant[
    relevant["match_category"] ==
    "Missing or unparseable address"
].copy()

print("OUTPATIENT COVERAGE GAPS")
print("=" * 60)

print("Candidate outpatient records:", len(candidates))
print("Distinct candidate addresses:",
      candidates["address_normalized"].nunique())
print("Unresolved outpatient addresses:", len(unresolved))

print("\nCandidate specialty codes:")
print(candidates["specialty_code"].value_counts())

candidates.to_csv(
    RESULTS / "outpatient_candidate_gaps.csv",
    index=False,
    encoding="utf-8-sig"
)

unresolved.to_csv(
    RESULTS / "outpatient_unresolved_addresses.csv",
    index=False,
    encoding="utf-8-sig"
)

print("\nResults saved successfully.")
