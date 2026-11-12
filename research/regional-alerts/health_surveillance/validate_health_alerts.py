
import json
import os

YEAR = 2026
WEEK = 45

INPUT_FILE = os.path.join(
    "data",
    "alerts",
    f"kosice_health_alerts_{YEAR}_week_{WEEK}.json"
)

EXPECTED_ALERTS = 10

VALID_CLASSIFICATIONS = {
    "low",
    "moderate",
    "significant",
    "decreasing",
    "insufficient_baseline"
}


def validate_alerts(data):

    errors = []
    warnings = []

    metadata = data.get("metadata", {})
    alerts = data.get("alerts", [])

    # Check total number of alerts
    if len(alerts) != EXPECTED_ALERTS:
        errors.append(
            f"Expected {EXPECTED_ALERTS} alerts, found {len(alerts)}."
        )

    if metadata.get("alert_count") != len(alerts):
        errors.append("Metadata alert_count does not match alert list.")

    alert_ids = set()
    district_indicators = set()

    for index, alert in enumerate(alerts, start=1):

        prefix = f"Alert {index}"

        # Required top-level fields
        required_fields = [
            "alert_id",
            "geographic_area",
            "indicator",
            "classification",
            "measurements",
            "reporting_period",
            "explanation",
            "source",
            "status",
            "threshold_type"
        ]

        for field in required_fields:
            if field not in alert:
                errors.append(f"{prefix}: Missing field '{field}'.")

        if any(field not in alert for field in required_fields):
            continue

        # Check duplicate IDs
        alert_id = alert["alert_id"]

        if alert_id in alert_ids:
            errors.append(f"{prefix}: Duplicate alert ID: {alert_id}")
        else:
            alert_ids.add(alert_id)

        # Check district and indicator combination
        geographic_area = alert["geographic_area"]
        indicator = alert["indicator"]

        district_id = geographic_area.get("id")
        indicator_id = indicator.get("id")

        combination = (district_id, indicator_id)

        if combination in district_indicators:
            errors.append(
                f"{prefix}: Duplicate district/indicator combination."
            )
        else:
            district_indicators.add(combination)

        # Check bilingual names
        for section_name, section in [
            ("geographic_area", geographic_area),
            ("indicator", indicator),
            ("classification", alert["classification"])
        ]:

            name = section.get("name", {})

            if not name.get("en") or not name.get("sk"):
                errors.append(
                    f"{prefix}: Missing English or Slovak name in "
                    f"{section_name}."
                )

        # Check classification
        classification = alert["classification"].get("level")

        if classification not in VALID_CLASSIFICATIONS:
            errors.append(
                f"{prefix}: Invalid classification '{classification}'."
            )

        # Check measurements
        measurements = alert["measurements"]

        previous = measurements.get("previous_incidence")
        current = measurements.get("current_incidence")
        absolute = measurements.get("absolute_change")
        percentage = measurements.get("percentage_change")

        if not isinstance(previous, (int, float)) or previous < 0:
            errors.append(f"{prefix}: Invalid previous incidence.")

        if not isinstance(current, (int, float)) or current < 0:
            errors.append(f"{prefix}: Invalid current incidence.")

        if not isinstance(absolute, (int, float)):
            errors.append(f"{prefix}: Invalid absolute change.")

        if not isinstance(percentage, (int, float)) and percentage is not None:
            errors.append(f"{prefix}: Invalid percentage change.")

        if isinstance(previous, (int, float)) and isinstance(current, (int, float)):

            expected_absolute = round(current - previous, 2)

            if abs(absolute - expected_absolute) > 0.02:
                errors.append(f"{prefix}: Absolute change is incorrect.")

            if previous > 0 and percentage is not None:

                expected_percentage = round(
                    ((current - previous) / previous) * 100,
                    2
                )

                if abs(percentage - expected_percentage) > 0.02:
                    errors.append(
                        f"{prefix}: Percentage change is incorrect."
                    )

            elif previous == 0 and percentage is not None:
                errors.append(
                    f"{prefix}: Percentage should be null when baseline is zero."
                )

            # Check classification against percentage
            if percentage is not None:

                if percentage <= 0:
                    expected_class = "decreasing"
                elif percentage < 10:
                    expected_class = "low"
                elif percentage <= 25:
                    expected_class = "moderate"
                else:
                    expected_class = "significant"

                if classification != expected_class:
                    errors.append(
                        f"{prefix}: Classification does not match "
                        f"percentage change."
                    )

        # Check bilingual explanations
        explanation = alert["explanation"]

        if not explanation.get("en") or not explanation.get("sk"):
            errors.append(
                f"{prefix}: Missing English or Slovak explanation."
            )

        # Check reporting periods
        reporting_period = alert["reporting_period"]

        for period_name in ["previous_week", "current_week"]:

            period = reporting_period.get(period_name, {})

            if not isinstance(period.get("year"), int):
                errors.append(
                    f"{prefix}: Invalid year in {period_name}."
                )

            if not isinstance(period.get("week"), int):
                errors.append(
                    f"{prefix}: Invalid week in {period_name}."
                )

        # Informational status check
        if alert["status"] != "informational":
            warnings.append(
                f"{prefix}: Unexpected alert status."
            )

    return errors, warnings


def main():

    print("=" * 60)
    print("HEALTHFINDER - ALERT DATA VALIDATION")
    print("=" * 60)

    if not os.path.exists(INPUT_FILE):
        raise FileNotFoundError(
            f"Alert file not found: {INPUT_FILE}"
        )

    with open(INPUT_FILE, "r", encoding="utf-8") as file:
        data = json.load(file)

    errors, warnings = validate_alerts(data)

    print("\nTotal alerts:", len(data.get("alerts", [])))
    print("Unique alert IDs:", len({
        alert.get("alert_id")
        for alert in data.get("alerts", [])
    }))

    print("\nWarnings:", len(warnings))

    for warning in warnings:
        print("WARNING:", warning)

    print("\nErrors:", len(errors))

    for error in errors:
        print("ERROR:", error)

    print("\n" + "=" * 60)

    if errors:
        print("VALIDATION FAILED")
    else:
        print("VALIDATION PASSED")

    print("=" * 60)

    if errors:
        raise SystemExit(1)


if __name__ == "__main__":

    try:
        main()

    except Exception as error:
        print("\nVALIDATION ERROR:")
        print(error)
        raise SystemExit(1)
