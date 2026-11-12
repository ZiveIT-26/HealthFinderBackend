
# Regional Health and Environmental Alerts

This research explores two data sources that could support regional health and environmental alerts in the HealthFinder project, focusing on Košice, Slovakia.

## 1. Air Quality Monitoring

**Data source:** [Open-Meteo Air Quality API](https://air-quality-api.open-meteo.com/)

The air-quality component retrieves measurements for Košice, including:

- European Air Quality Index (European AQI)
- PM2.5 and PM10
- Nitrogen dioxide (NO2)
- Ozone (O3)

The Python script processes the measurements and generates air-quality alerts.

## 2. Contagious Disease Surveillance

**Data source:** [Public Health Authority of the Slovak Republic (ÚVZ SR)](https://www.uvzsr.sk/)

The health-surveillance component collects information from the authority's weekly ARO and CHPO reports.

The implementation:

- Downloads the latest available weekly PDF report.
- Extracts respiratory illness incidence data for Košice I, II, III, IV and Košice-okolie.
- Compares consecutive reporting weeks.
- Generates bilingual Slovak and English health alerts.
- Validates the generated alert data.

The source currently provides weekly district-level statistics rather than real-time city-level disease notifications.

## Repository Structure

```text
regional-alerts/
├── README.md
├── requirements.txt
├── air_quality/
│   └── generate_air_quality_alerts.py
└── health_surveillance/
    ├── collect_kosice_health_data.py
    ├── compare_kosice_weeks.py
    ├── generate_health_alerts.py
    └── validate_health_alerts.py
```

## Dependencies

Install the required Python packages using:

```bash
pip install -r requirements.txt
```

## Important Notes

- Air-quality measurements are retrieved from the Open-Meteo API.
- Health-surveillance data is collected from publicly available weekly ÚVZ SR PDF reports.
- Health alert thresholds are provisional development rules for HealthFinder, not official public-health warning thresholds.
- The health-surveillance component is based on weekly reporting and is not a real-time outbreak detection system.
- PDF reports and generated JSON files have not been included in this contribution to avoid unnecessarily increasing the repository size. The scripts generate or retrieve the required data when executed.
- The wildlife-alert investigation is outside the scope of this contribution.
