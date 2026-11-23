
import requests
import json
from datetime import datetime, timezone
from pathlib import Path

# --------------------------------------------------
# Configuration
# --------------------------------------------------

LATITUDE = 48.7164
LONGITUDE = 21.2611
LOCATION = "Košice"

API_URL = "https://air-quality-api.open-meteo.com/v1/air-quality"

PARAMETERS = {
    "latitude": LATITUDE,
    "longitude": LONGITUDE,
    "current": (
        "european_aqi,pm2_5,pm10,"
        "nitrogen_dioxide,ozone"
    ),
    "timezone": "Europe/Bratislava"
}

OUTPUT_DIR = Path("data/alerts")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# --------------------------------------------------
# AQI classification
# Provisional HealthFinder development thresholds
# --------------------------------------------------

def classify_aqi(aqi):

    if aqi <= 20:
        return "good", "dobrá"

    elif aqi <= 40:
        return "fair", "uspokojivá"

    elif aqi <= 60:
        return "moderate", "mierna"

    elif aqi <= 80:
        return "poor", "zlá"

    elif aqi <= 100:
        return "very_poor", "veľmi zlá"

    else:
        return "extremely_poor", "mimoriadne zlá"


# --------------------------------------------------
# Generate bilingual explanation
# --------------------------------------------------

def generate_explanation(aqi, classification, slovak_classification):

    if classification == "good":
        english = "Air quality is good. No air-quality alert is required."
        slovak = "Kvalita ovzdušia je dobrá. Upozornenie nie je potrebné."

    elif classification == "fair":
        english = "Air quality is fair. Sensitive individuals should monitor conditions."
        slovak = "Kvalita ovzdušia je uspokojivá. Citlivé osoby by mali sledovať situáciu."

    elif classification == "moderate":
        english = "Air quality is moderate. Sensitive individuals should consider reducing prolonged outdoor exertion."
        slovak = "Kvalita ovzdušia je mierna. Citlivé osoby by mali zvážiť obmedzenie dlhšej fyzickej námahy vonku."

    elif classification == "poor":
        english = "Air quality is poor. People with respiratory conditions should limit prolonged outdoor exertion."
        slovak = "Kvalita ovzdušia je zlá. Ľudia s ochoreniami dýchacích ciest by mali obmedziť dlhšiu fyzickú námahu vonku."

    elif classification == "very_poor":
        english = "Air quality is very poor. Sensitive individuals should avoid strenuous outdoor activity."
        slovak = "Kvalita ovzdušia je veľmi zlá. Citlivé osoby by sa mali vyhýbať namáhavej fyzickej aktivite vonku."

    else:
        english = "Air quality is extremely poor. Avoid outdoor physical activity and follow official public-health advice."
        slovak = "Kvalita ovzdušia je mimoriadne zlá. Vyhýbajte sa fyzickej aktivite vonku a riaďte sa oficiálnymi odporúčaniami."

    return {
        "en": english,
        "sk": slovak
    }


# --------------------------------------------------
# Retrieve air-quality data
# --------------------------------------------------

def fetch_air_quality():

    print("Fetching air-quality data for Košice...")

    response = requests.get(
        API_URL,
        params=PARAMETERS,
        timeout=30
    )

    response.raise_for_status()

    data = response.json()

    if "current" not in data:
        raise ValueError("Current air-quality data is missing.")

    return data


# --------------------------------------------------
# Generate alert
# --------------------------------------------------

def generate_alert(data):

    current = data["current"]

    aqi = current.get("european_aqi")

    if aqi is None:
        raise ValueError("European AQI value is unavailable.")

    classification, slovak_classification = classify_aqi(aqi)

    explanation = generate_explanation(
        aqi,
        classification,
        slovak_classification
    )

    alert = {
        "alert_id": "KOSICE_AIR_QUALITY_CURRENT",
        "source": "Open-Meteo Air Quality API",
        "location": LOCATION,
        "coordinates": {
            "latitude": LATITUDE,
            "longitude": LONGITUDE
        },
        "measurement_time": current.get("time"),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "indicator": "European Air Quality Index",
        "european_aqi": aqi,
        "classification": classification,
        "pollutants": {
            "pm2_5": current.get("pm2_5"),
            "pm10": current.get("pm10"),
            "nitrogen_dioxide": current.get("nitrogen_dioxide"),
            "ozone": current.get("ozone")
        },
        "explanation": explanation,
        "status": "informational",
        "threshold_type": "provisional_healthfinder_rule"
    }

    return alert


# --------------------------------------------------
# Save JSON
# --------------------------------------------------

def save_alert(alert):

    output_file = OUTPUT_DIR / "kosice_air_quality_alert_latest.json"

    with open(output_file, "w", encoding="utf-8") as file:
        json.dump(
            alert,
            file,
            indent=4,
            ensure_ascii=False
        )

    print(f"\nAlert saved to: {output_file}")


# --------------------------------------------------
# Main
# --------------------------------------------------

def main():

    try:
        data = fetch_air_quality()
        alert = generate_alert(data)

        print("\n" + "=" * 55)
        print("HEALTHFINDER - AIR QUALITY ALERT")
        print("=" * 55)

        print(f"Location: {alert['location']}")
        print(f"European AQI: {alert['european_aqi']}")
        print(f"Classification: {alert['classification']}")
        print(f"PM2.5: {alert['pollutants']['pm2_5']} µg/m³")
        print(f"PM10: {alert['pollutants']['pm10']} µg/m³")
        print(f"NO2: {alert['pollutants']['nitrogen_dioxide']} µg/m³")
        print(f"Ozone: {alert['pollutants']['ozone']} µg/m³")

        print("\nEnglish explanation:")
        print(alert["explanation"]["en"])

        print("\nSlovak explanation:")
        print(alert["explanation"]["sk"])

        save_alert(alert)

        print("\nAir-quality alert generated successfully.")

    except Exception as error:
        print(f"\nERROR: {error}")


if __name__ == "__main__":
    main()
