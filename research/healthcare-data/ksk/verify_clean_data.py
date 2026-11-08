import argparse
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(
        description="Remove duplicate KSK healthcare records."
    )
    parser.add_argument(
        "--input",
        default="healthcare_data_all.json",
        help="Input JSON file downloaded from the KSK WFS service."
    )
    parser.add_argument(
        "--output",
        default="healthcare_data_clean.json",
        help="Output file for the cleaned dataset."
    )
    args = parser.parse_args()

    input_path = Path(args.input)
    output_path = Path(args.output)

    if not input_path.exists():
        raise FileNotFoundError(
            f"Input file not found: {input_path}. "
            "Run download_all_healthcare.py first."
        )

    with input_path.open("r", encoding="utf-8") as file:
        data = json.load(file)

    features = data.get("features", [])

    unique_records = {}
    records_without_id = []
    duplicate_count = 0

    for feature in features:
        properties = feature.get("properties", {})
        identifier = properties.get("identifikator")

        if identifier is None or str(identifier).strip() == "":
            records_without_id.append(feature)
        elif identifier in unique_records:
            duplicate_count += 1
        else:
            unique_records[identifier] = feature

    clean_records = list(unique_records.values()) + records_without_id

    cleaned_data = {
        "type": "FeatureCollection",
        "features": clean_records
    }

    with output_path.open("w", encoding="utf-8") as file:
        json.dump(cleaned_data, file, ensure_ascii=False, indent=2)

    print("Original records:", len(features))
    print("Records after deduplication:", len(clean_records))
    print("Removed duplicates:", duplicate_count)
    print("Unique identifiers:", len(unique_records))
    print("Records without identifier:", len(records_without_id))
    print("Cleaned dataset saved to:", output_path)


if __name__ == "__main__":
    main()
