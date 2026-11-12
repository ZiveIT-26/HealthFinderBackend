
import requests
import pymupdf
import re
import json
import os
from datetime import date

BASE_URL = "https://www.uvzsr.sk/documents/d/uvz/"

LATEST_DIR = "data/latest"
HISTORY_DIR = "data/history"

DISTRICTS = {
    "kosice_1": {
        "sk": "Okres Košice I",
        "en": "Košice I District"
    },
    "kosice_2": {
        "sk": "Okres Košice II",
        "en": "Košice II District"
    },
    "kosice_3": {
        "sk": "Okres Košice III",
        "en": "Košice III District"
    },
    "kosice_4": {
        "sk": "Okres Košice IV",
        "en": "Košice IV District"
    },
    "kosice_okolie": {
        "sk": "Okres Košice - okolie",
        "en": "Košice Surrounding District"
    }
}

INDICATORS = {
    "ARO": {
        "id": "acute_respiratory_illnesses",
        "name": {
            "sk": "Akútne respiračné ochorenia",
            "en": "Acute respiratory illnesses"
        },
        "heading": (
            "Chorobnosť na akútne respiračné ochorenia "
            "podľa okresov, krajov a vekových skupín"
        )
    },
    "CHPO": {
        "id": "influenza_like_illnesses",
        "name": {
            "sk": "Chrípka a chrípke podobné ochorenia",
            "en": "Influenza and influenza-like illnesses"
        },
        "heading": (
            "Chorobnosť na chrípku a chrípke podobné ochorenia "
            "podľa okresov, krajov a vekových skupín"
        )
    }
}


def download_latest_report():

    today = date.today()
    current_year = today.isocalendar().year
    current_week = today.isocalendar().week

    session = requests.Session()
    session.headers.update({
        "User-Agent": "HealthFinder/1.0"
    })

    for year in range(current_year, current_year - 2, -1):

        start_week = current_week if year == current_year else 53

        for week in range(start_week, 0, -1):

            filename = f"aro-chpo-{week}-{year}-pdf"
            url = BASE_URL + filename

            print(f"Checking report: {year}, week {week}")

            try:
                response = session.get(url, timeout=20)

                if (
                    response.status_code == 200
                    and response.content.startswith(b"%PDF")
                ):

                    pdf_file = (
                        f"kosice_report_{year}_week_{week}.pdf"
                    )

                    with open(pdf_file, "wb") as file:
                        file.write(response.content)

                    print("\nReport downloaded successfully!")
                    print("Year:", year)
                    print("Week:", week)
                    print("File:", pdf_file)

                    return pdf_file, year, week

            except requests.RequestException as error:
                print("Connection error:", error)

    raise RuntimeError("No valid weekly report was found.")


def normalize_with_mapping(text):

    normalized = []
    positions = []

    for index, character in enumerate(text):

        if character.isspace():

            if normalized and normalized[-1] != " ":
                normalized.append(" ")
                positions.append(index)

        else:
            normalized.append(character.lower())
            positions.append(index)

    return "".join(normalized), positions


def find_table_start(doc, heading):

    normalized_heading, _ = normalize_with_mapping(heading)

    for page_number, page in enumerate(doc, start=1):

        page_text = page.get_text("text")

        normalized_page, positions = normalize_with_mapping(
            page_text
        )

        position = normalized_page.find(normalized_heading)

        if position != -1:

            raw_start = positions[position]

            raw_end = (
                positions[
                    position + len(normalized_heading) - 1
                ] + 1
            )

            print(
                f"Found table heading on PDF page {page_number}"
            )

            text_parts = [page_text[raw_end:]]

            for later_page in range(page_number, len(doc)):
                text_parts.append(
                    doc[later_page].get_text("text")
                )

            return page_number, "\n".join(text_parts)

    raise ValueError(
        f"Could not find table heading: {heading}"
    )


def to_number(value):

    return float(value.replace(",", "."))


def extract_districts(table_text):

    results = {}

    for district_id, names in DISTRICTS.items():

        pattern = (
            re.escape(names["sk"])
            + r"\s+"
            + r"\s+".join([r"(\d+,\d+)"] * 6)
            + r"\s+(-?\d+,\d+)%"
        )

        match = re.search(pattern, table_text)

        if not match:

            raise ValueError(
                f"Could not extract district: {names['sk']}"
            )

        values = match.groups()

        results[district_id] = {
            "name": names,
            "age_0_5": to_number(values[0]),
            "age_6_14": to_number(values[1]),
            "age_15_19": to_number(values[2]),
            "age_20_59": to_number(values[3]),
            "age_60_plus": to_number(values[4]),
            "total_incidence": to_number(values[5]),
            "comparison_percent": to_number(values[6])
        }

    return results


def save_data(data, year, week):

    os.makedirs(LATEST_DIR, exist_ok=True)
    os.makedirs(HISTORY_DIR, exist_ok=True)

    history_file = os.path.join(
        HISTORY_DIR,
        f"kosice_district_data_{year}_week_{week}.json"
    )

    latest_file = os.path.join(
        LATEST_DIR,
        "kosice_district_data_latest.json"
    )

    # Save historical report
    with open(history_file, "w", encoding="utf-8") as file:

        json.dump(
            data,
            file,
            ensure_ascii=False,
            indent=4
        )

    print("\nHistorical report saved:", history_file)

    # Compare with existing latest report
    update_latest = True

    if os.path.exists(latest_file):

        with open(latest_file, "r", encoding="utf-8") as file:
            existing_data = json.load(file)

        existing_year = existing_data["metadata"]["report_year"]
        existing_week = existing_data["metadata"]["calendar_week"]

        existing_version = (existing_year, existing_week)
        new_version = (year, week)

        if new_version < existing_version:

            update_latest = False

            print("\nOlder report detected.")
            print("Existing latest:", existing_version)
            print("Downloaded report:", new_version)
            print("Latest data will not be replaced.")

        elif new_version == existing_version:

            print("\nReport is already from this week.")
            print("Updating its data.")

    if update_latest:

        with open(latest_file, "w", encoding="utf-8") as file:

            json.dump(
                data,
                file,
                ensure_ascii=False,
                indent=4
            )

        print("\nLatest data updated successfully.")

    print("Latest file:", latest_file)


def main():

    print("=" * 55)
    print("HEALTHFINDER - KOSICE HEALTH DATA COLLECTOR")
    print("=" * 55)

    pdf_file, year, week = download_latest_report()

    doc = pymupdf.open(pdf_file)

    data = {
        "metadata": {
            "source": "UVZ_SR",
            "source_name": {
                "sk": "Úrad verejného zdravotníctva Slovenskej republiky",
                "en": "Public Health Authority of the Slovak Republic"
            },
            "source_language": "sk",
            "report_year": year,
            "calendar_week": week,
            "geographic_area": "kosicky_kraj",
            "source_file": pdf_file
        },
        "indicators": {}
    }

    try:

        for code, indicator in INDICATORS.items():

            print("\nExtracting:", indicator["name"]["en"])

            page_number, table_text = find_table_start(
                doc,
                indicator["heading"]
            )

            districts = extract_districts(table_text)

            data["indicators"][indicator["id"]] = {
                "source_code": code,
                "name": indicator["name"],
                "unit": "cases_per_100000",
                "denominator": (
                    "population_under_care_of_reporting_physicians"
                ),
                "measurement_period": "calendar_week",
                "pdf_start_page": page_number,
                "districts": districts
            }

            for district in districts.values():

                print(
                    district["name"]["en"],
                    "| Incidence:",
                    district["total_incidence"],
                    "| Change:",
                    district["comparison_percent"],
                    "%"
                )

    finally:
        doc.close()

    save_data(data, year, week)

    print("\n" + "=" * 55)
    print("COLLECTION COMPLETED SUCCESSFULLY")
    print("Report:", year, "Week", week)
    print("Districts:", len(DISTRICTS))
    print("Indicators:", len(INDICATORS))
    print("=" * 55)


if __name__ == "__main__":

    try:
        main()

    except Exception as error:

        print("\nCOLLECTION FAILED:")
        print(error)
