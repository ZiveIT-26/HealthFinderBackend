# Healthcare coverage in Košice

This work continues the KSK data research started in PR #2 (`Add KSK healthcare data research and analysis`).

The main question was whether the KSK API provides enough information for HealthFinder to find healthcare facilities of different medical specialties within a reasonable distance of a user's location in Košice.

We also wanted to understand whether additional data sources would be needed, particularly for finding individual doctors.

## Data sources

| Source | Data used |
|---|---|
| KSK Geoportal | Healthcare facilities, coordinates, specialties and provider information |
| Košice municipal GIS | Administrative boundaries of the 22 city boroughs |
| JRC-ESTAT | Census population grid 2021, 100 m resolution, revision 07/2026 |
| ÚDZS | National healthcare provider register, dated 02/11/2026 |

The cleaned KSK dataset from the previous research was used as the starting point.

### Source links

- [KSK healthcare data](https://www.geoportalksk.sk/home/zdravotnictvo-kosickeho-kraja/). WFS endpoint: `https://www.geoportalksk.sk/geoserver/wfs`; collection: `ksk_evucsk:poskytovatelia_zs`.
- [Košice administrative boundaries](https://opendata.kosice.sk/datasets/3d46429c163244a4aaac4a654e692167/about). The borough polygons were downloaded from the [municipal ArcGIS service, layer 1](https://services-eu1.arcgis.com/qrtO0RIRViAdEN4F/ArcGIS/rest/services/Administrat%C3%ADvne_hranice/FeatureServer/1/query?where=1%3D1&outFields=NM4&outSR=4326&f=geojson) and saved as `kosice_boundary.geojson`.
- [JRC-ESTAT Census Population Grid 2021](https://data.jrc.ec.europa.eu/dataset/98336641-fd1c-4992-8c7b-c470dd5eb81e), July 2026 revision. Download the GeoTIFF archive from the dataset page. Source: Pigaiani, Freire and Batista (2024), European Commission, Joint Research Centre, DOI: [10.2905/98336641-fd1c-4992-8c7b-c470dd5eb81e](https://doi.org/10.2905/98336641-fd1c-4992-8c7b-c470dd5eb81e).
- [ÚDZS provider codes](https://www.udzs-sk.sk/urad/kody-poskytovatelov-zdravotnej-starostlivosti-a-zdravotnickych-pracovnikov/). The spreadsheet used here is the release dated 2 November 2026.
- [e-VÚC healthcare directory](https://www.e-vuc.sk/ksk.html?page_id=410). KSK draws on this directory, so e-VÚC can help with enrichment and synchronization checks but is not an independent completeness benchmark.

The calculations were run on 25 November 2026 using the source snapshots described above. Newer downloads may give different results.

## Coverage across the city

We generated a grid with points spaced 500 metres apart within the administrative boundary of Košice.

The resulting grid contains 967 points across an area of 243.57 km². Within this boundary, there are 2,591 registered healthcare facility records in the cleaned KSK dataset.

Coordinates were converted to EPSG:32634 so that distances could be calculated in metres. We used SciPy's `cKDTree` to find the nearest registered facility to each grid point.

The search was performed for three radii: 1, 2 and 3 km.

| Radius | Covered points | Coverage |
|---|---:|---:|
| 1 km | 300 / 967 | 31.02% |
| 2 km | 520 / 967 | 53.77% |
| 3 km | 700 / 967 | 72.39% |

At first, these results suggested relatively low coverage. However, a large part of the city's administrative area consists of forests, agricultural land and industrial areas. Treating every grid point equally does not give a good picture of healthcare accessibility for residents.

For this reason, we repeated the analysis using population data.

## Population coverage

The JRC-ESTAT population raster was clipped to the Košice boundary. It contains 4,570 inhabited cells of 100 × 100 metres, with a total estimated residential population of 229,675.

For each inhabited cell, we calculated the distance from its centre to the nearest registered healthcare facility and weighted the result by the population of that cell.

| Radius | Inhabited cell coverage | Estimated population covered | Population coverage |
|---|---:|---:|---:|
| 1 km | 79.28% | 219,694 | 95.65% |
| 2 km | 90.53% | 224,664 | 97.82% |
| 3 km | 96.08% | 227,078 | 98.87% |

The difference between geographical and population coverage is considerable. Most residents live relatively close to a registered healthcare facility, even though several parts of the city have limited geographical coverage.

The overall calculation includes all facility types present in the selected KSK records. It should therefore be read together with the specialty-specific results below.

## Coverage by medical specialty

We selected 11 common medical specialties and calculated their coverage separately. The classification uses exact values from the KSK `druh_zariadenia` field instead of partial keyword matching.

The following percentages are population-weighted.

| Specialty | Registered records | 1 km | 2 km | 3 km |
|---|---:|---:|---:|---:|
| General practice | 235 | 86.62% | 97.67% | 98.73% |
| Dentistry | 311 | 93.11% | 97.26% | 98.40% |
| Internal medicine | 110 | 75.30% | 92.56% | 97.21% |
| Gynaecology | 109 | 78.21% | 92.37% | 97.20% |
| Orthopaedics | 69 | 73.09% | 90.93% | 96.68% |
| Ophthalmology | 63 | 72.84% | 90.92% | 96.68% |
| Dermatology | 60 | 75.14% | 92.02% | 96.92% |
| Neurology | 60 | 74.24% | 91.58% | 96.74% |
| Cardiology | 54 | 68.58% | 81.70% | 87.30% |
| ENT | 50 | 68.56% | 82.34% | 88.03% |
| Urology | 41 | 76.52% | 91.16% | 96.47% |

For nine of the selected specialties, more than 96% of the estimated population lives within 3 km of a registered facility.

Cardiology and ENT have lower coverage. Based on these results, a fixed search radius of 3 km may not be suitable for every specialty in HealthFinder. Increasing the radius when no suitable facility is found would be a reasonable approach.

The number of registered records should not be confused with the number of individual doctors or physical locations. Several facilities can share the same address or coordinates.

General practice is used as defined in KSK, without separating adult and paediatric services.

## Facility status

During the analysis, we noticed that the KSK dataset still contains records for facilities with expired or ongoing absence periods.

We checked the `nepritomnost_od`, `nepritomnost_do` and `info` fields using 25 November 2026 as the reference date.

| Status | Records |
|---|---:|
| No identified inactivity | 2,568 |
| Expired absence | 21 |
| Ongoing absence | 1 |
| Explicit closure | 1 |

Two records were excluded from the filtered analysis:

- `68-36868728-A0001`: ENT clinic with a long-term absence and patient care transferred to another clinic.
- `68-36868728-A0002`: Clinical oncology clinic whose operating permit was cancelled in September 2020.

Removing these records left 2,589 facility records. The overall geographical and population coverage percentages did not change.

There is still no guarantee that the remaining facilities are operational. In most cases, we only know that KSK does not contain information indicating their inactivity.

## Comparison with the ÚDZS register

Good geographical coverage does not necessarily mean that KSK contains all registered healthcare facilities.

To investigate this, we compared the KSK dataset with the national healthcare provider register published by ÚDZS.

The comparison was made between `kpzs_kod` in KSK and `pzs_kod` in ÚDZS. The matching percentage measures code agreement, not the completeness of the physical clinic network. For ÚDZS, we selected records based on the municipality of the healthcare workplace (`Obec OU`), rather than the registered address of the provider.

| Description | Count |
|---|---:|
| KSK records in Košice | 2,591 |
| Unique KSK provider codes | 2,245 |
| KSK records without a provider code | 346 |
| ÚDZS records nationwide | 35,158 |
| ÚDZS workplace codes in Košice | 2,643 |
| Codes found in both datasets | 1,650 |
| Codes found only in KSK | 595 |
| Codes found only in ÚDZS | 993 |

Of the 2,643 ÚDZS codes in Košice, 62.43% were found in the KSK dataset.

We also found that 593 of the 595 unmatched KSK codes were absent from the nationwide ÚDZS spreadsheet.

These differences raised another question: are healthcare facilities actually missing from KSK, or do the differences come from the way the two registers describe healthcare providers and workplaces?

The code comparison was performed without filtering the ÚDZS records by their validity dates. The registers may also differ in scope and update frequency.

## Checking unmatched addresses

Comparing provider codes alone turned out to be insufficient, especially for hospitals where several departments operate at the same address.

We therefore compared the 993 unmatched ÚDZS records using provider IČO numbers, street names and building numbers.

Street names were normalized by removing accents, punctuation and unnecessary spaces. For building numbers written in the form `785/43`, the number after the slash was used for comparison.

| Matching result | Records |
|---|---:|
| Same provider and address | 557 |
| Same address only | 202 |
| Same provider only | 16 |
| Neither matched | 168 |
| Missing or unparseable address | 50 |

In total, 759 of the 993 unmatched ÚDZS records have an address that is already represented in KSK.

There were 184 records with identifiable addresses that could not be matched. These correspond to 153 distinct normalized addresses.

An address match does not establish that the same department or medical specialty is present in both datasets. Similarly, an unmatched address can result from differences in street spelling, abbreviations or building-number formats.

### Outpatient clinics

The 153 addresses include several types of healthcare workplaces that are outside the intended scope of HealthFinder's doctor search.

We used the professional activity and specialty codes contained in the ÚDZS identifiers to narrow down the candidates.

From the 184 records with unmatched addresses, 41 were classified as outpatient activities. Twelve of these were mobile sampling facilities (specialty code `647`) and were excluded.

This leaves:

- 29 candidate outpatient records.
- 19 distinct candidate addresses.
- 35 additional relevant outpatient records with missing or unparseable addresses.

The candidate records are available in `results/outpatient_candidate_gaps.csv`.

We have not individually verified these addresses. They should be considered possible gaps in the KSK dataset rather than confirmed missing clinics.

## Running the analysis

The scripts were tested locally on Windows using Python 3.13.17.

A separate virtual environment is useful because the analysis requires `rasterio`. On Windows, run the following from the working directory using CMD:

```cmd
py -3.13 -m venv coverage\.venv
coverage\.venv\Scripts\activate
python -m pip install -r coverage/requirements-lock.txt
```

Before running the scripts, place the source files in the directory immediately above `coverage/`. Obtain the cleaned KSK JSON using the earlier PR #2 research, and extract the population archive into the folder shown below. The current scripts expect these exact filenames and paths:

```text
working-directory/
├── healthcare_data_clean.json
├── kosice_boundary.geojson
├── VyberKpWeb_2.11.2026.xlsx
├── JRC-ESTAT_Census_Population_2021_100m (2)/
│   └── JRC-ESTAT_Census_Population_2021_100m_rev0726.tif
└── coverage/
    ├── scripts/
    ├── results/
    ├── .gitignore
    ├── requirements.txt
    ├── requirements-lock.txt
    └── README.md
```

Run the scripts from the working directory in this order:

```bash
python coverage/scripts/generate_kosice_grid.py
python coverage/scripts/analyse_geographical_coverage.py
python coverage/scripts/analyse_population_coverage.py
python coverage/scripts/analyse_specialty_coverage.py
python coverage/scripts/analyse_operational_status.py
python coverage/scripts/analyse_register_comparison.py
python coverage/scripts/analyse_address_reconciliation.py
python coverage/scripts/analyse_outpatient_candidates.py
```

Some scripts use the output of previous scripts, so the execution order matters.

The grid-generation script creates `kosice_grid_500m.geojson` and `kosice_grid_500m.csv` in the working directory. The seven subsequent analysis scripts generate 18 CSV and GeoJSON files in `coverage/results/`. All eight scripts were tested locally. The virtual environment and raw input datasets are not intended for the repository.

The main results are stored in:

| File | Contents |
|---|---|
| `geographical_coverage.csv` | Overall geographical coverage |
| `borough_coverage.csv` | Coverage by city borough |
| `population_coverage.csv` | Population-weighted coverage |
| `specialty_coverage.csv` | Coverage by medical specialty |
| `operational_status_audit.csv` | Records requiring status assessment |
| `operational_coverage_comparison.csv` | Coverage before and after status filtering |
| `register_comparison.csv` | KSK and ÚDZS code comparison |
| `address_reconciliation_details.csv` | Address and provider matching results |
| `outpatient_candidate_gaps.csv` | Potential outpatient location gaps |
| `outpatient_unresolved_addresses.csv` | Outpatient records with unresolved addresses |

The GeoJSON output files can also be opened in GIS software for visual inspection.

## Limitations

The calculated distances are straight-line distances. Actual travel distances may be longer due to the road network and physical barriers.

We excluded facilities outside the administrative boundary of Košice, even if they were close to residents living near the boundary.

The population data represents the estimated residential distribution in 2021 and may not reflect recent changes. The 100-metre counts are modelled from the census grid; they are not direct counts for each cell.

There are also some limitations related to the source data itself. As found in PR #2, staff names can appear in multiple facility records belonging to the same provider. We cannot assume that a doctor listed in a record necessarily works at that particular location.

Finally, neither geographical proximity nor the presence of a facility in a register tells us whether a doctor is currently available or accepting new patients.

## Is KSK enough for HealthFinder?

For the geographical part of HealthFinder, KSK looks like a suitable starting point. Nearly 99% of the estimated population of Košice lives within 3 km of a registered healthcare facility, and most of the selected specialties also have good coverage.

The situation is less clear when it comes to identifying individual doctors and establishing whether the dataset is complete. The comparison with ÚDZS found several discrepancies that could not be resolved through provider codes and addresses alone.

I would use KSK as the main source for location-based healthcare searches. ÚDZS can be used for additional provider validation, while e-VÚC may help provide information that is not available through the KSK API.

Before relying on KSK as the only source, we would need to investigate the remaining outpatient candidates and find a reliable way to associate individual doctors with their actual workplaces.
