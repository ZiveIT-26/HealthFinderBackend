import argparse
import json
import time
import xml.etree.ElementTree as ET

import requests


WFS_URL = "https://www.geoportalksk.sk/geoserver/wfs"

BASE_PARAMS = {
    "service": "WFS",
    "version": "2.0.0",
    "request": "GetFeature",
    "typeNames": "ksk_evucsk:poskytovatelia_zs",
    "outputFormat": "application/json",
    "sortBy": "id A",
}

PAGE_SIZE = 500
REQUEST_DELAY = 0.5


def get_total_records(session):
    params = BASE_PARAMS.copy()
    params.pop("outputFormat")
    params.pop("sortBy")
    params["resultType"] = "hits"

    response = session.get(
        WFS_URL,
        params=params,
        timeout=60,
    )
    response.raise_for_status()

    root = ET.fromstring(response.content)
    total = root.attrib.get("numberMatched")

    if total is None or total == "unknown":
        raise ValueError("The server did not provide a valid record count.")

    return int(total)


def get_page(session, start_index, count):
    params = BASE_PARAMS.copy()
    params["startIndex"] = start_index
    params["count"] = count

    response = session.get(
        WFS_URL,
        params=params,
        timeout=120,
    )
    response.raise_for_status()

    data = response.json()

    if "features" not in data:
        raise ValueError("Invalid GeoJSON response.")

    return data["features"]


def main():
    parser = argparse.ArgumentParser(
        description="Download healthcare facilities from the KSK WFS API."
    )
    parser.add_argument(
        "--output",
        default="healthcare_data_all.json",
        help="Output JSON filename.",
    )
    args = parser.parse_args()

    with requests.Session() as session:
        print("Checking KSK WFS API...")

        total = get_total_records(session)
        print("Records reported by server:", total)

        if total == 0:
            print("No records available.")
            return

        print("\nTesting pagination...")
        test_features = get_page(session, 0, min(10, total))

        if not test_features:
            raise ValueError("Pagination test returned no records.")

        print("Test records received:", len(test_features))

        all_features = []

        print("\nStarting full download...")

        for start_index in range(0, total, PAGE_SIZE):
            expected = min(PAGE_SIZE, total - start_index)

            print(
                f"Downloading records "
                f"{start_index + 1} to {start_index + expected}..."
            )

            features = get_page(
                session,
                start_index,
                expected,
            )

            if not features:
                print("WARNING: Empty page received. Stopping.")
                break

            all_features.extend(features)

            print("Downloaded so far:", len(all_features))

            if len(features) < expected:
                print("WARNING: Fewer records received than expected.")
                break

            time.sleep(REQUEST_DELAY)

    feature_ids = [
        feature.get("id")
        for feature in all_features
        if feature.get("id") is not None
    ]

    unique_ids = set(feature_ids)
    duplicate_count = len(feature_ids) - len(unique_ids)

    complete = len(all_features) == total

    output = {
        "type": "FeatureCollection",
        "total_reported_by_server": total,
        "fetched_records": len(all_features),
        "download_complete": complete,
        "duplicate_feature_ids": duplicate_count,
        "features": all_features,
    }

    with open(args.output, "w", encoding="utf-8") as file:
        json.dump(output, file, ensure_ascii=False, indent=2)

    print("\n========== DOWNLOAD REPORT ==========")
    print("Records reported:", total)
    print("Records downloaded:", len(all_features))
    print("Unique feature IDs:", len(unique_ids))
    print("Duplicate feature IDs:", duplicate_count)
    print("Download complete:", complete)
    print("Saved file:", args.output)

    if not complete:
        raise RuntimeError(
            "Download incomplete. Check the saved file and server response."
        )


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print("\nERROR:", error)
        raise SystemExit(1)
