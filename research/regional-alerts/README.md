# Regional Health and Environmental Alerts

This research explores two data sources that could support regional health and environmental alerts in the HealthFinder project, focusing on Košice, Slovakia.

## 1. Air Quality Monitoring

**Data source:** [Open-Meteo Air Quality API](https://air-quality-api.open-meteo.com/)

The air-quality component retrieves measurements for Košice, including:

- European Air Quality Index (European AQI)
- PM2.5 and PM10
- Nitrogen dioxide (NO2)
- Ozone (O3)

The Python script processes the measurements and generates bilingual air-quality alerts in JSON format.

## 2. Contagious Disease Surveillance

**Data source:** [Public Health Authority of the Slovak Republic (ÚVZ SR)](https://www.uvzsr.sk/)

The health-surveillance component collects information from the authority's weekly ARO and CHPO reports.

The implementation:

- Automatically searches for and downloads the latest available weekly PDF report.
- Extracts respiratory illness incidence data for Košice I, II, III, IV and Košice-okolie.
- Stores the extracted data in JSON format.
- Compares consecutive reporting weeks to identify changes in disease incidence.
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

## Running the Scripts

### Air Quality Monitoring

Navigate to the `air_quality` directory and run:

```bash
python generate_air_quality_alerts.py
```

The script retrieves the latest available measurements and generates a JSON alert under `data/alerts/`.

### Health Surveillance

Navigate to the `health_surveillance` directory.

**Step 1 – Collect health data**

```bash
python collect_kosice_health_data.py
```

This downloads the latest available ÚVZ SR weekly report, extracts the district-level data and generates JSON files in the `data/latest/` and `data/history/` directories.

**Step 2 – Compare weekly reports**

```bash
python compare_kosice_weeks.py
```

This compares two consecutive weekly reports stored in `data/history/` and generates a trend-analysis JSON file in `data/analysis/`.

**Step 3 – Generate health alerts**

```bash
python generate_health_alerts.py
```

This processes the trend-analysis data and generates bilingual health alerts in `data/alerts/`.

**Step 4 – Validate generated alerts**

```bash
python validate_health_alerts.py
```

This checks the generated alert data for consistency and completeness.

The comparison, alert-generation and validation scripts require their respective input JSON files to have been generated first.

## Important Notes

- Air-quality measurements are retrieved from the Open-Meteo API.
- Health-surveillance data is collected from publicly available weekly ÚVZ SR PDF reports.
- Health alert thresholds are provisional development rules for HealthFinder, not official public-health warning thresholds.
- The health-surveillance component is based on weekly reporting and is not a real-time outbreak detection system.
- PDF reports and generated JSON files are not included in this repository. They are downloaded or generated locally when the scripts are executed.
- Generated data directories are kept in Git using `.gitkeep` files where necessary.
