import requests

WFS_URL = "https://www.geoportalksk.sk/geoserver/wfs"

PARAMS = {
    "service": "WFS",
    "version": "2.0.0",
    "request": "GetFeature",
    "typeNames": "ksk_evucsk:poskytovatelia_zs",
    "count": 5,
    "outputFormat": "application/json",
}


def test_wfs_connection():
    print("Testing KSK WFS 2.0 API...")

    try:
        response = requests.get(
            WFS_URL,
            params=PARAMS,
            timeout=30,
        )

        print("HTTP Status:", response.status_code)
        response.raise_for_status()

        data = response.json()
        features = data.get("features", [])

        print("Records received:", len(features))

        for index, feature in enumerate(features, start=1):
            properties = feature.get("properties", {})

            print(f"\n--- Record {index} ---")
            print("Name:", properties.get("nazov_zariadenia"))
            print("Type:", properties.get("druh_zariadenia"))
            print("City:", properties.get("municipality"))
            print("Phone:", properties.get("telefon"))
            print("Email:", properties.get("email"))

    except requests.exceptions.RequestException as error:
        print("Connection error:", error)

    except ValueError as error:
        print("Invalid JSON response:", error)


if __name__ == "__main__":
    test_wfs_connection()
