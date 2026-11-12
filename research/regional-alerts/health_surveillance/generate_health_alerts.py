
import json
import os
from datetime import datetime, timezone

INPUT_DIR = "data/analysis"
OUTPUT_DIR = "data/alerts"

YEAR = 2026
CURRENT_WEEK = 45

INPUT_FILE = os.path.join(
    INPUT_DIR,
    f"kosice_trends_{YEAR}_week_{CURRENT_WEEK}.json"
)

OUTPUT_FILE = os.path.join(
    OUTPUT_DIR,
    f"kosice_health_alerts_{YEAR}_week_{CURRENT_WEEK}.json"
)

# Provisional HealthFinder thresholds.
# These are not official public-health alert levels.
THRESHOLDS = {
    "low": 10.0,
    "moderate": 25.0
}


def classify_trend(percentage_change):

    if percentage_change is None:

        return {
            "level": "insufficient_baseline",
            "name": {
                "en": "Insufficient baseline",
                "sk": "Nedostatočná základná hodnota"
            }
        }

    if percentage_change <= 0:

        return {
            "level": "decreasing",
            "name": {
                "en": "Decreasing trend",
                "sk": "Klesajúci trend"
            }
        }

    if percentage_change < THRESHOLDS["low"]:

        return {
            "level": "low",
            "name": {
                "en": "Low increase",
                "sk": "Mierny nárast"
            }
        }

    if percentage_change <= THRESHOLDS["moderate"]:

        return {
            "level": "moderate",
            "name": {
                "en": "Moderate increase",
                "sk": "Stredný nárast"
            }
        }

    return {
        "level": "significant",
        "name": {
            "en": "Significant increase",
            "sk": "Výrazný nárast"
        }
    }


def generate_explanation(
    indicator_name,
    district_name,
    classification,
    previous_value,
    current_value,
    percentage_change
):

    # Correct Slovak indicator names
    if indicator_name["en"] == "Acute respiratory illnesses":

        subject_sk = "akútne respiračné ochorenia"

    else:

        subject_sk = "chrípku a chrípke podobné ochorenia"

    # Remove duplicated "Okres" from the district name
    district_sk = district_name["sk"]

    if district_sk.startswith("Okres "):

        district_sk = district_sk[len("Okres "):]

    # Handle missing percentage baseline
    if percentage_change is None:

        return {
            "en": (
                f"The incidence of {indicator_name['en']} in "
                f"{district_name['en']} increased, but a percentage "
                f"comparison cannot be calculated because the "
                f"previous value was zero."
            ),
            "sk": (
                f"Chorobnosť na {subject_sk} v okrese "
                f"{district_sk} vzrástla, ale percentuálnu "
                f"zmenu nemožno vypočítať, pretože "
                f"predchádzajúca hodnota bola nulová."
            )
        }

    # Handle decreasing incidence
    if classification["level"] == "decreasing":

        return {
            "en": (
                f"The incidence of {indicator_name['en']} in "
                f"{district_name['en']} decreased by "
                f"{abs(percentage_change):.2f}% compared with "
                f"the previous reporting week."
            ),
            "sk": (
                f"Chorobnosť na {subject_sk} v okrese "
                f"{district_sk} klesla o "
                f"{abs(percentage_change):.2f} % v porovnaní "
                f"s predchádzajúcim týždňom."
            )
        }

    # Handle increasing incidence
    return {
        "en": (
            f"The incidence of {indicator_name['en']} in "
            f"{district_name['en']} increased by "
            f"{percentage_change:.2f}%, from "
            f"{previous_value} to {current_value} cases "
            f"per 100,000 reporting population."
        ),
        "sk": (
            f"Chorobnosť na {subject_sk} v okrese "
            f"{district_sk} vzrástla o "
            f"{percentage_change:.2f} %, z hodnoty "
            f"{previous_value} na {current_value} "
            f"prípadov na 100 000 osôb v sledovanej populácii."
        )
    }


def generate_alerts(trend_data):

    alerts = []

    metadata = trend_data["metadata"]

    for indicator_id, indicator in trend_data["indicators"].items():

        for district_id, district in indicator["districts"].items():

            percentage_change = district["percentage_change"]

            classification = classify_trend(
                percentage_change
            )

            previous_value = district["previous_incidence"]
            current_value = district["current_incidence"]

            explanation = generate_explanation(
                indicator["name"],
                district["name"],
                classification,
                previous_value,
                current_value,
                percentage_change
            )

            alert = {
                "alert_id": (
                    f"{indicator_id}_{district_id}_"
                    f"{metadata['current_report']['year']}_"
                    f"{metadata['current_report']['week']}"
                ),

                "geographic_area": {
                    "id": district_id,
                    "name": district["name"]
                },

                "indicator": {
                    "id": indicator_id,
                    "name": indicator["name"]
                },

                "classification": classification,

                "measurements": {
                    "previous_incidence": previous_value,
                    "current_incidence": current_value,
                    "absolute_change": district["absolute_change"],
                    "percentage_change": percentage_change,
                    "unit": indicator["unit"]
                },

                "reporting_period": {
                    "previous_week": metadata["previous_report"],
                    "current_week": metadata["current_report"]
                },

                "explanation": explanation,

                "source": "UVZ_SR",

                "status": "informational",

                "threshold_type": "provisional_healthfinder_rule"
            }

            alerts.append(alert)

    return {
        "metadata": {
            "source": "HealthFinder",

            "geographic_area": "kosicky_kraj",

            "generated_at": datetime.now(
                timezone.utc
            ).isoformat(),

            "alert_count": len(alerts),

            "thresholds": {
                "low_increase_below_percent": THRESHOLDS["low"],

                "moderate_increase_up_to_percent": (
                    THRESHOLDS["moderate"]
                ),

                "significant_increase_above_percent": (
                    THRESHOLDS["moderate"]
                ),

                "description": {
                    "en": (
                        "Provisional HealthFinder development "
                        "thresholds, not official public-health levels."
                    ),

                    "sk": (
                        "Predbežné vývojové prahové hodnoty "
                        "HealthFinder, nie oficiálne úrovne "
                        "verejného zdravotníctva."
                    )
                }
            }
        },

        "alerts": alerts
    }


def main():

    print("=" * 60)
    print("HEALTHFINDER - HEALTH ALERT GENERATOR")
    print("=" * 60)

    if not os.path.exists(INPUT_FILE):

        raise FileNotFoundError(
            f"Trend analysis file not found: {INPUT_FILE}"
        )

    with open(INPUT_FILE, "r", encoding="utf-8") as file:

        trend_data = json.load(file)

    result = generate_alerts(trend_data)

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    with open(OUTPUT_FILE, "w", encoding="utf-8") as file:

        json.dump(
            result,
            file,
            ensure_ascii=False,
            indent=4
        )

    print("\nGenerated alerts:")

    for alert in result["alerts"]:

        print(
            alert["indicator"]["name"]["en"],
            "|",
            alert["geographic_area"]["name"]["en"],
            "|",
            alert["classification"]["name"]["en"]
        )

    print(
        "\nTotal alerts:",
        result["metadata"]["alert_count"]
    )

    print("Output:", OUTPUT_FILE)

    print("\n" + "=" * 60)
    print("ALERT GENERATION COMPLETED")
    print("=" * 60)


if __name__ == "__main__":

    try:
        main()

    except Exception as error:

        print("\nALERT GENERATION FAILED:")
        print(error)
