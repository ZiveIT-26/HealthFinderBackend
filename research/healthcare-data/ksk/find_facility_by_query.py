import math
import time
import xml.etree.ElementTree as ET

import requests

WFS_URL = "https://www.geoportalksk.sk/geoserver/wfs"
NAME_COLUMNS = ["nazov_zariadenia", "druh_zariadenia"]
GEOMETRY_COLUMN = "geom"
PAGE_SIZE = 500
REQUEST_DELAY = 0.5
KEYS_TO_REMOVE_PROPERTIES = [
    "id",
    "identifikator",
    "kpzs_kod",
    "typ_zariadenia_id",
    "typ_zariadenia_complex_code",
    "poskytovatel_id",
    "poloha_lat", # might be filtered out because we already have data as a point
    "poloha_lon"
]

KEYS_TO_REMOVE_POINT = [
    "type",
    "id",
    "bbox"
]


def get_base_params(name_filter=None, county_filter="Košice I", lat=None, lon=None, radius_km=None):
    params = {
        "service": "WFS",
        "version": "2.0.0",
        "request": "GetFeature",
        "typeNames": "ksk_evucsk:poskytovatelia_zs",
        "outputFormat": "application/json",
        "sortBy": "id A",
        "srsName": "EPSG:4326",
    }

    cql_conditions = []

    if name_filter:
        name_conds = [f"{col} ILIKE '%{name_filter}%'" for col in NAME_COLUMNS]
        cql_conditions.append("(" + " OR ".join(name_conds) + ")")

    if county_filter:
        cql_conditions.append(f"county ILIKE '%{county_filter}%'")

    if lat is not None and lon is not None and radius_km is not None:
        x = lon * 20037508.34 / 180
        y = math.log(math.tan((90 + lat) * math.pi / 360)) / (math.pi / 180) * 20037508.34 / 180

        scale_factor = 1 / math.cos(math.radians(lat))
        radius_meters = (radius_km * 1000) * scale_factor

        cql_conditions.append(
            f"DWITHIN({GEOMETRY_COLUMN}, POINT({x} {y}), {radius_meters}, meters)"
        )

    if cql_conditions:
        params["cql_filter"] = " AND ".join(cql_conditions)

    return params


def get_total_records(session, base_params):
    params = base_params.copy()
    params.pop("outputFormat", None)
    params.pop("sortBy", None)
    params["resultType"] = "hits"

    response = session.get(WFS_URL, params=params, timeout=60)
    response.raise_for_status()

    root = ET.fromstring(response.content)
    total = root.attrib.get("numberMatched")

    if total is None or total == "unknown":
        raise ValueError("The server did not provide a valid record count.")

    return int(total)


def haversine_distance(lat1, lon1, lat2, lon2):
    """Calculates the distance in km between two GPS coordinates."""
    R = 6371.0  # Earth radius in kilometers
    lat1_rad, lon1_rad = math.radians(lat1), math.radians(lon1)
    lat2_rad, lon2_rad = math.radians(lat2), math.radians(lon2)

    dlat = lat2_rad - lat1_rad
    dlon = lon2_rad - lon1_rad

    a = (math.sin(dlat / 2) ** 2 +
         math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(dlon / 2) ** 2)
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

    return R * c

def get_page(session, base_params, start_index, count):
    params = base_params.copy()
    params["startIndex"] = start_index
    params["count"] = count

    response = session.get(WFS_URL, params=params, timeout=120)
    response.raise_for_status()
    data = response.json()

    if "features" not in data:
        raise ValueError("Invalid GeoJSON response.")

    return data["features"]


def find_facility(query, county_filter, user_latitude, user_longitude, radius):
    base_params = get_base_params(
        name_filter=query,
        county_filter=county_filter,
        lat=user_latitude,
        lon=user_longitude,
        radius_km=radius
    )

    with requests.Session() as session:
        try:
            total = get_total_records(session, base_params)
        except Exception as e:
            print(f"Failed to get total records: {e}")
            return []

        if total == 0:
            return []

        all_features = []

        for start_index in range(0, total, PAGE_SIZE):
            expected = min(PAGE_SIZE, total - start_index)

            try:
                features = get_page(session, base_params, start_index, expected)
            except Exception as e:
                print(f"Failed to fetch page starting at {start_index}: {e}")
                break

            if not features:
                break

            all_features.extend(features)

            if len(features) < expected:
                break

            time.sleep(REQUEST_DELAY)

    for feature in all_features:
        for key in KEYS_TO_REMOVE_POINT:
            feature.pop(key, None)

        properties = feature.get("properties", {})
        for key in KEYS_TO_REMOVE_PROPERTIES:
            properties.pop(key, None)

        geom = feature.get("geometry")
        if geom and geom.get("type") == "Point" and user_latitude and user_longitude:
            fac_lon, fac_lat = geom.get("coordinates", [0, 0])
            dist = haversine_distance(user_latitude, user_longitude, fac_lat, fac_lon)
            properties["distance_to_home_km"] = round(dist, 2)
        else:
            properties["distance_to_home_km"] = float('inf')

    if user_latitude and user_longitude:
        all_features.sort(key=lambda f: f["properties"].get("distance_to_home_km", float('inf')))

    return all_features


# Example usage
if __name__ == "__main__":
    results = find_facility(
        query="zubná",
        county_filter="Košice I",
        user_latitude=48.7185309,
        user_longitude=21.2480789,
        radius=1
    )

    print(f"Found {len(results)} facilities.")

    for f in results:
        props = f.get("properties", {})
        print(f)