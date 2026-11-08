import argparse
import json
from collections import Counter
from pathlib import Path


FIELDS = [
    "id",
    "identifikator",
    "kpzs_kod",
    "poskytovatel_id",
]


def analyse_identifiers(input_file):
    with open(input_file, "r", encoding="utf-8") as file:
        data = json.load(file)

    features = data.get("features", [])

    if not isinstance(features, list):
        raise ValueError("Invalid dataset: features must be a list.")

    print("=" * 55)
    print("KSK HEALTHCARE IDENTIFIER ANALYSIS")
    print("=" * 55)
    print("Input file:", input_file)
    print("Total records:", len(features))

    for field in FIELDS:
        values = [
            feature.get("properties", {}).get(field)
            for feature in features
        ]

        present = [
            value for value in values
            if value is not None and value != ""
        ]

        missing = len(values) - len(present)
        counts = Counter(present)

        duplicates = {
            value: count
            for value, count in counts.items()
            if count > 1
        }

        duplicate_records = sum(duplicates.values())
        extra_occurrences = sum(
            count - 1 for count in duplicates.values()
        )

        print(f"\n========== {field} ==========")
        print("Present:", len(present))
        print("Missing:", missing)
        print("Unique:", len(counts))
        print("Duplicate groups:", len(duplicates))
        print("Records in duplicate groups:", duplicate_records)
        print("Extra duplicate occurrences:", extra_occurrences)

        if duplicates:
            print("Examples:", list(duplicates.items())[:10])


def main():
    parser = argparse.ArgumentParser(
        description="Analyse KSK healthcare facility identifiers."
    )

    parser.add_argument(
        "--input",
        default="healthcare_data_all.json",
        help="Path to the downloaded healthcare JSON file.",
    )

    args = parser.parse_args()

    input_file = Path(args.input)

    if not input_file.is_file():
        raise FileNotFoundError(
            f"Dataset not found: {input_file}"
        )

    analyse_identifiers(input_file)


if __name__ == "__main__":
    main()
