
import json
import os
from datetime import datetime, timezone

HISTORY_DIR = "data/history"
OUTPUT_DIR = "data/analysis"

YEAR = 2026
PREVIOUS_WEEK = 44
CURRENT_WEEK = 45

INDICATOR_IDS = [
    "acute_respiratory_illnesses",
    "influenza_like_illnesses"
]


def load_report(year, week):

    filename = (
        f"kosice_district_data_{year}_week_{week}.json"
    )

    filepath = os.path.join(HISTORY_DIR, filename)

    if not os.path.exists(filepath):
        raise FileNotFoundError(
            f"Historical report not found: {filepath}"
        )

    with open(filepath, "r", encoding="utf-8") as file:
        return json.load(file)


def calculate_trend(previous_value, current_value):

    absolute_change = round(
        current_value - previous_value, 2
    )

    if previous_value == 0:

        percentage_change = None

        if current_value > 0:
            trend = "increased"
        elif current_value < 0:
            trend = "decreased"
        else:
            trend = "unchanged"

    else:

        percentage_change = round(
            (absolute_change / previous_value) * 100, 2
        )

        if current_value > previous_value:
            trend = "increased"
        elif current_value < previous_value:
            trend = "decreased"
        else:
            trend = "unchanged"

    trend_sk = {
        "increased": "nárast",
        "decreased": "pokles",
        "unchanged": "bez zmeny"
    }

    return {
        "previous_incidence": previous_value,
        "current_incidence": current_value,
        "absolute_change": absolute_change,
        "percentage_change": percentage_change,
        "trend": {
            "en": trend,
            "sk": trend_sk[trend]
        }
    }


def compare_reports(previous_data, current_data):

    previous_metadata = previous_data["metadata"]
    current_metadata = current_data["metadata"]

    previous_version = (
        previous_metadata["report_year"],
        previous_metadata["calendar_week"]
    )

    current_version = (
        current_metadata["report_year"],
        current_metadata["calendar_week"]
    )

    if previous_version >= current_version:
        raise ValueError(
            "The previous report must be older than the current report."
        )

    if previous_version[0] != current_version[0]:
        raise ValueError(
            "Cross-year comparison requires additional week validation."
        )

    if current_version[1] != previous_version[1] + 1:
        raise ValueError(
            "Reports are not consecutive calendar weeks."
        )

    analysis = {
        "metadata": {
            "source": "UVZ_SR",
            "geographic_area": "kosicky_kraj",
            "previous_report": {
                "year": previous_version[0],
                "week": previous_version[1]
            },
            "current_report": {
                "year": current_version[0],
                "week": current_version[1]
            },
            "generated_at": datetime.now(
                timezone.utc
            ).isoformat(),
            "comparison_method": (
                "Percentage change calculated from "
                "the two reported incidence rates."
            )
        },
        "indicators": {}
    }

    for indicator_id in INDICATOR_IDS:

        previous_indicator = previous_data[
            "indicators"
        ][indicator_id]

        current_indicator = current_data[
            "indicators"
        ][indicator_id]

        if previous_indicator["unit"] != current_indicator["unit"]:
            raise ValueError(
                f"Unit mismatch for {indicator_id}"
            )

        district_results = {}

        for district_id, current_district in (
            current_indicator["districts"].items()
        ):

            previous_district = (
                previous_indicator["districts"].get(
                    district_id
                )
            )

            if previous_district is None:
                raise ValueError(
                    f"Missing previous data for {district_id}"
                )

            previous_value = previous_district[
                "total_incidence"
            ]

            current_value = current_district[
                "total_incidence"
            ]

            result = calculate_trend(
                previous_value,
                current_value
            )

            result["name"] = current_district["name"]

            result["official_comparison_percent"] = (
                current_district.get("comparison_percent")
            )

            district_results[district_id] = result

        increases = sum(
            1 for item in district_results.values()
            if item["trend"]["en"] == "increased"
        )

        decreases = sum(
            1 for item in district_results.values()
            if item["trend"]["en"] == "decreased"
        )

        unchanged = sum(
            1 for item in district_results.values()
            if item["trend"]["en"] == "unchanged"
        )

        indicator_name = current_indicator["name"]

        analysis["indicators"][indicator_id] = {
            "source_code": current_indicator["source_code"],
            "name": indicator_name,
            "unit": current_indicator["unit"],
            "district_summary": {
                "total_districts": len(district_results),
                "increased": increases,
                "decreased": decreases,
                "unchanged": unchanged
            },
            "districts": district_results
        }

    return analysis


def main():

    print("=" * 60)
    print("HEALTHFINDER - KOSICE WEEKLY TREND ANALYSIS")
    print("=" * 60)

    previous_data = load_report(
        YEAR,
        PREVIOUS_WEEK
    )

    current_data = load_report(
        YEAR,
        CURRENT_WEEK
    )

    analysis = compare_reports(
        previous_data,
        current_data
    )

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    output_file = os.path.join(
        OUTPUT_DIR,
        f"kosice_trends_{YEAR}_week_{CURRENT_WEEK}.json"
    )

    with open(output_file, "w", encoding="utf-8") as file:

        json.dump(
            analysis,
            file,
            ensure_ascii=False,
            indent=4
        )

    for indicator_id, indicator in (
        analysis["indicators"].items()
    ):

        print("\nIndicator:", indicator["name"]["en"])

        for district_id, district in (
            indicator["districts"].items()
        ):

            change = district["percentage_change"]

            change_text = (
                "N/A" if change is None else f"{change:+.2f}%"
            )

            print(
                district["name"]["en"],
                "|",
                district["trend"]["en"],
                "|",
                change_text
            )

        print(
            "Summary:",
            indicator["district_summary"]
        )

    print("\n" + "=" * 60)
    print("TREND ANALYSIS COMPLETED")
    print("Output:", output_file)
    print("=" * 60)


if __name__ == "__main__":

    try:
        main()

    except Exception as error:
        print("\nANALYSIS FAILED:")
        print(error)
