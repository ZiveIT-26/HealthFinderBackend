# KSK Healthcare Data Research

This folder contains the Python scripts  that I used to find out  healthcare data published by the Košice Self-Governing Region (KSK).

The work started with the KSK Geoportal. I wanted to find out what information was available, how it could be downloaded, and whether it could be useful for the HealthFinder project or not.

## Data source

The data is from the KSK Geoportal:

https://www.geoportalksk.sk/home/zdravotnictvo-kosickeho-kraja/

I accessed it through the GeoServer WFS 2.0 service:

**WFS endpoint:**  
https://www.geoportalksk.sk/geoserver/wfs

**Dataset:** `ksk_evucsk:poskytovatelia_zs`

The service returns geographic data in GeoJSON format. The records contain information about healthcare facilities, including their names, addresses, coordinates, contact details, specialties, insurance providers and, in some cases, staff information.

## Scripts

The scripts are separate so that each part of the investigation can be run independently.

| File | What it does |
|---|---|
| `test_wfs.py` | Checks whether the KSK WFS service is reachable and returns data. |
| `download_all_healthcare.py` | Downloads the healthcare records in batches and saves them as JSON. |
| `analyse_identifiers.py` | Checks the available identifiers and looks for missing or repeated values. |
| `verify_clean_data.py` | Removes duplicate records using `identifikator`. Records without an identifier are kept. |
| `inspect_data.py` | Prints a few records so their fields and values can be examined. |
| `analyse_doctors.py` | Looks for doctor and staff entries in the `odborni_zastupcovia` field. |

## Running the scripts

Run them from this directory:

```bash
python test_wfs.py
python download_all_healthcare.py
python analyse_identifiers.py
python verify_clean_data.py
python inspect_data.py
python analyse_doctors.py
```

The download script creates `healthcare_data_all.json`.

The cleaning script reads that file and creates `healthcare_data_clean.json`. The inspection and doctor analysis scripts use the cleaned file.

Make sure the JSON files are available in the working directory before running the scripts that need them.

## What I found in the data

The initial download returned 4,500 records.

After checking the `identifikator` field and removing duplicate records, 4,483 records remained. Seventeen duplicates were removed. Records without an identifier were kept rather than discarded.

The data provides a useful starting point for finding healthcare facilities, but it is not complete in every field. Some records have missing contact details or identifiers.

One issue needs particular attention: the `odborni_zastupcovia` field can contain staff information belonging to a provider rather than to one specific facility. The same names may appear in several facility records. For that reason, a name appearing in this field should not automatically be treated as confirmation that the doctor works at that particular location.

## Possible use in HealthFinder

The KSK data could help us build a directory of healthcare facilities and support searches by location or medical specialty.

A possible database structure would separate providers, facilities, staff, specialties, addresses, opening hours and insurance information. This would avoid treating every facility record as a completely independent provider.

The structure is only a proposal at this stage. The data still needs validation before it can be used in the application.

## Current status

The scripts in this folder cover the initial data investigation, download, cleaning and analysis. They are research tools, not yet part of the running HealthFinder backend.

Further work will be needed to validate the records, resolve provider and facility relationships, and decide how the data should be stored and used by the application.
