import json

# Open the cleaned healthcare dataset
with open(
    "healthcare_data_clean.json",
    "r",
    encoding="utf-8"
) as file:

    data = json.load(file)

# Get healthcare records
features = data.get("features", [])

print("Total records:", len(features))

# Display the first 5 records
for index, feature in enumerate(features[:5], start=1):

    properties = feature.get("properties", {})

    print(f"\n--- Healthcare Record {index} ---")

    print("Name:", properties.get("nazov_zariadenia"))
    print("Type:", properties.get("druh_zariadenia"))
    print("City:", properties.get("municipality"))
    print("Address:", properties.get("addressline"))
    print("Phone:", properties.get("telefon"))
    print("Email:", properties.get("email"))
    print("Latitude:", properties.get("poloha_lat"))
    print("Longitude:", properties.get("poloha_lon"))
