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
    ├── validate_health_alerts.py
    └── data/
        └── history/
            └── .gitkeep
```

Generated data directories and files are created locally when the scripts run. They are not included in this contribution.

## Dependencies

Install the required Python packages using:

```bash
pip install -r requirements.txt
```

The health-surveillance collector uses PyMuPDF (`pymupdf`) to extract information from PDF reports.

## Running the Scripts

### Air Quality Monitoring

Navigate to the `air_quality` directory and run:

```bash
python generate_air_quality_alerts.py
```

The script retrieves the latest available measurements and generates a JSON alert file under `data/alerts/`.

### Health Surveillance

Navigate to the `health_surveillance` directory.

**Step 1 – Collect health data**

```bash
python collect_kosice_health_data.py
```

This script searches for and downloads the latest available ÚVZ SR weekly report, extracts the district-level data and generates JSON files locally in:

- `data/latest/`
- `data/history/`

**Step 2 – Compare weekly reports**

```bash
python compare_kosice_weeks.py
```

This script compares two consecutive weekly reports stored in `data/history/` and generates a trend-analysis JSON file in `data/analysis/`.

Both weekly input files must exist before running this step.

**Step 3 – Generate health alerts**

```bash
python generate_health_alerts.py
```

This script processes the trend-analysis JSON file and generates bilingual health alerts in `data/alerts/`.

**Step 4 – Validate generated alerts**

```bash
python validate_health_alerts.py
```

This script checks the generated alert data for consistency and completeness.

### Important execution details

- The collector downloads the latest available report; it does not automatically download two consecutive reports.
- To perform a weekly comparison, the previous and current weekly JSON files must both be available in `data/history/`.
- The comparison, alert-generation and validation scripts currently contain reporting-week settings that must be updated when processing different reporting periods.
- Generated JSON files are local inputs and outputs. They are not committed to the repository.

## Important Notes

- Air-quality measurements are retrieved from the Open-Meteo API.
- Health-surveillance data is collected from publicly available weekly ÚVZ SR PDF reports.
- Health alert thresholds are provisional development rules for HealthFinder, not official public-health warning thresholds.
- The health-surveillance component is based on weekly reporting and is not a real-time outbreak detection system.
- PDF reports and generated JSON files are intentionally excluded from this contribution to avoid unnecessary repository size.
- The scripts retrieve or generate the required data when executed, subject to the input requirements described above.
