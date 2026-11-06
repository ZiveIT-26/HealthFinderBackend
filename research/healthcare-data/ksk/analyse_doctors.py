import json
import re
from collections import Counter, defaultdict
from pathlib import Path


INPUT_FILE = "healthcare_data_clean.json"


def extract_doctors(text):
    """Extract staff names and professional titles from a text field."""
    if not text:
        return []

    doctors = []

    # Split entries while preserving the original text for inspection.
    entries = re.split(r"[,;\n]+", str(text))

    for entry in entries:
        entry = entry.strip()

        if not entry:
            continue

        if re.search(r"\bMUDr\.|\bMDDr\.|\bPhDr\.|\bdoc\.|\bprof\.", entry, re.I):
            doctors.append(entry)

    return doctors


def main():
    input_path = Path(INPUT_FILE)

    if not input_path.exists():
        raise FileNotFoundError(
            f"{INPUT_FILE} not found. Run the data download and cleaning scripts first."
        )

    with input_path.open("r", encoding="utf-8") as file:
        data = json.load(file)

    features = data.get("features", [])

    doctor_counts = Counter()
    doctor_facilities = defaultdict(set)

    for feature in features:
        properties = feature.get("properties", {})
        staff_text = properties.get("odborni_zastupcovia", "")

        facility_name = properties.get("nazov_zariadenia", "Unknown facility")

        for doctor in extract_doctors(staff_text):
            doctor_counts[doctor] += 1
            doctor_facilities[doctor].add(facility_name)

    print("Total healthcare records:", len(features))
    print("Unique extracted doctor entries:", len(doctor_counts))

    print("\nTop 20 doctor entries:")
    for doctor, count in doctor_counts.most_common(20):
        print(f"{doctor}: {count} record(s)")

    print("\nDoctor entries appearing in multiple facilities:")
    multiple = [
        (doctor, facilities)
        for doctor, facilities in doctor_facilities.items()
        if len(facilities) > 1
    ]

    for doctor, facilities in multiple[:20]:
        print(f"\n{doctor}")
        for facility in sorted(facilities):
            print("  -", facility)


if __name__ == "__main__":
    main()
