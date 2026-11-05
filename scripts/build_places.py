"""Build data/places.json and data/addresses.json for the search boxes.

Run from the project root:
    .venv/bin/python scripts/build_places.py

The script gets the named buildings and the named places (libraries,
schools, parks, beaches, malls and more) in the area (data/area.json) from OSM. Then
it adds the UCSD building codes from data/building_codes.csv. OSM has
codes for only a few buildings, so the team keeps the CSV file.

CSV columns:
  code     the UCSD building code, for example CSB
  name     the building name, exactly as OSM has it
  aliases  more names for the search, separated by ";", for example Cog Sci
  source   where the code comes from
"""

import csv
import json
import sys
from pathlib import Path

import osmnx as ox

from build_graph import ROOT, load_area

CODES_CSV = ROOT / "data" / "building_codes.csv"
OUTPUT = ROOT / "data" / "places.json"
ADDRESSES = ROOT / "data" / "addresses.json"

TAGS = {
    "building": True,
    "amenity": ["university", "college", "library", "school", "theatre", "cinema", "hospital",
                "community_centre", "arts_centre", "bus_station", "townhall"],
    "leisure": ["park", "stadium", "sports_centre", "nature_reserve"],
    "natural": ["beach"],
    "shop": ["mall"],
    "tourism": ["museum", "attraction", "aquarium", "viewpoint"],
    "railway": ["station"],
}

# OSM tags that can hold a building code. Codes are short, with no spaces.
CODE_TAGS = ("ref", "abbr_name", "short_name", "alt_name")
# OSM tags that hold another full name.
NAME_TAGS = ("official_name", "alt_name", "old_name", "loc_name")


def is_code(value):
    return 2 <= len(value) <= 6 and " " not in value and value.replace("-", "").isalnum()


def kind(row):
    for key in ("amenity", "leisure", "natural", "shop", "tourism", "railway"):
        value = row.get(key)
        if isinstance(value, str):
            return value
    return "building"


def download():
    ox.settings.cache_folder = str(ROOT / "cache")
    area = load_area()
    features = ox.features_from_polygon(area, TAGS)
    features = features[features["name"].notna()]
    # OSM gives a feature that crosses the edge. Keep it only if its point is inside.
    return features[features.geometry.representative_point().within(area)]


def house_sort_key(number):
    digits = "".join(c for c in number if c.isdigit())
    return (int(digits) if digits else 0, number)


def build_addresses():
    """Street addresses in the area, grouped by street: {street: [[number, lat, lon], ...]}."""
    area = load_area()
    features = ox.features_from_polygon(area, {"addr:housenumber": True})
    features = features[features["addr:street"].notna()]
    points = features.geometry.representative_point()
    features, points = features[points.within(area)], points[points.within(area)]

    streets = {}
    for (_, row), point in zip(features.iterrows(), points):
        # One OSM feature can have more than one street or number, for example
        # "Cliffridge Avenue;Robinhood Lane" or "3260;3262". Text after a comma
        # is a suite, for example "University Center Lane, Suite 100".
        for street in row["addr:street"].split(";"):
            street = street.split(",")[0].strip()
            if not street:
                continue
            numbers = streets.setdefault(street, {})
            for number in str(row["addr:housenumber"]).split(";"):
                number = number.strip()
                if number and number not in numbers:
                    numbers[number] = [number, round(point.y, 6), round(point.x, 6)]

    result = {street: sorted(numbers.values(), key=lambda a: house_sort_key(a[0]))
              for street, numbers in sorted(streets.items())}
    ADDRESSES.write_text(json.dumps(result, separators=(",", ":"), ensure_ascii=False))
    count = sum(len(a) for a in result.values())
    print(f"Wrote {ADDRESSES.relative_to(ROOT)}: {count} addresses on {len(result)} streets")


def read_codes():
    with CODES_CSV.open(newline="") as f:
        return list(csv.DictReader(f))


def main():
    features = download()

    places = {}  # name → place
    for _, row in features.iterrows():
        name = row["name"].strip()
        point = row.geometry.representative_point()  # inside the building outline
        place = places.get(name)
        if place is None:
            place = places[name] = {
                "name": name,
                "codes": [],
                "aliases": [],
                "kind": kind(row),
                "lat": round(point.y, 6),
                "lon": round(point.x, 6),
            }
        for key in CODE_TAGS:
            value = row.get(key)
            if isinstance(value, str) and is_code(value) and value.upper() not in place["codes"]:
                place["codes"].append(value.upper())
        for key in NAME_TAGS:
            value = row.get(key)
            if isinstance(value, str) and not is_code(value) and value not in place["aliases"]:
                place["aliases"].append(value)

    missing = []
    for entry in read_codes():
        place = places.get(entry["name"].strip())
        if place is None:
            missing.append(entry)
            continue
        code = entry["code"].strip().upper()
        if code not in place["codes"]:
            place["codes"].insert(0, code)
        for alias in filter(None, (a.strip() for a in entry["aliases"].split(";"))):
            if alias not in place["aliases"]:
                place["aliases"].append(alias)

    result = sorted(places.values(), key=lambda p: p["name"])
    for place in result:
        if not place["codes"]:
            del place["codes"]
        if not place["aliases"]:
            del place["aliases"]
    OUTPUT.write_text(json.dumps(result, separators=(",", ":"), ensure_ascii=False))

    with_code = sum(1 for p in result if "codes" in p)
    print(f"Wrote {OUTPUT.relative_to(ROOT)}: {len(result)} places, {with_code} with a building code")
    for entry in missing:
        print(f"WARNING {CODES_CSV.name}: no OSM place has the name {entry['name']!r} (code {entry['code']})")

    build_addresses()
    if missing:
        sys.exit(1)


if __name__ == "__main__":
    main()
