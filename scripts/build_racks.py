"""Build data/racks.json, the bike racks and the bike enclosures for the map.

Run from the project root:
    .venv/bin/python scripts/build_racks.py

The points come from two public layers of the UC San Diego Campus Map
(https://experience.arcgis.com/experience/c97d6e2efd7947d38738d5184b2debc7),
which UCSD keeps in ArcGIS Online. The script then adds the OpenStreetMap
bike parking (amenity=bicycle_parking) that is not within OSM_SAME_M of a
UCSD point, because that is probably the same rack. It keeps only the points
in the area (data/area.json).

Output: [{"lat", "lon", "kind", "near", "source", ...}, ...]
  kind    "rack" or "enclosure" (a locked bike room, cage or locker)
  near    the building or place next to the point, or null
  source  "ucsd" or "osm"
  spaces  the number of bike spaces, if OSM has it (OSM only)
  notes   for example "Covered" or "Private" (OSM only)
"""

import json
import math
import sys
import urllib.parse
import urllib.request

import osmnx as ox
from shapely.geometry import Point

from build_graph import ROOT, load_area

OUTPUT = ROOT / "data" / "racks.json"
SERVICES = "https://services9.arcgis.com/mXNwDpiENQiMIzRv/arcgis/rest/services"
LAYERS = {
    "rack": f"{SERVICES}/Bicycle_Rack_POIs/FeatureServer/1",
    "enclosure": f"{SERVICES}/Bicycle_Enclosures/FeatureServer/1",
}
# The layers have fewer points than this. The script stops if a layer has more,
# because the query then does not get all of them.
MAX_RECORDS = 2000
# An OSM point this close to a UCSD point is probably the same rack.
OSM_SAME_M = 20
# An OSM point with no name takes the name of the nearest building within this distance.
NEAR_BUILDING_M = 75
OSM_ENCLOSURES = {"building", "shed", "lockers"}
PLACES = ROOT / "data" / "places.json"


def download(url):
    query = urllib.parse.urlencode({
        "where": "1=1",
        "outFields": "FacilityLongName",
        "outSR": 4326,
        "f": "geojson",
    })
    with urllib.request.urlopen(f"{url}/query?{query}", timeout=60) as response:
        data = json.load(response)
    if "error" in data:
        sys.exit(f"{url}: {data['error']}")
    if data.get("properties", {}).get("exceededTransferLimit"):
        sys.exit(f"{url}: more than {MAX_RECORDS} points. Add paging to this script.")
    return data["features"]


def meters(lat1, lon1, lat2, lon2):
    """Distance in meters on a flat projection. Good enough for a few km."""
    dx = (lon2 - lon1) * 111320 * math.cos(math.radians(lat1))
    dy = (lat2 - lat1) * 110574
    return math.hypot(dx, dy)


def nearest_building(lat, lon, buildings):
    best = min(buildings, key=lambda b: meters(lat, lon, b["lat"], b["lon"]), default=None)
    if best and meters(lat, lon, best["lat"], best["lon"]) <= NEAR_BUILDING_M:
        return best["name"]
    return None


def osm_racks(area, ucsd):
    """The OSM bike parking in the area that is not near a UCSD point."""
    ox.settings.cache_folder = str(ROOT / "cache")
    features = ox.features_from_polygon(area, tags={"amenity": "bicycle_parking"})
    places = json.loads(PLACES.read_text()) if PLACES.exists() else []
    buildings = [p for p in places if p.get("kind") == "building"]
    result = []
    skipped = 0
    for _, row in features.iterrows():
        tag = lambda key: row.get(key) if isinstance(row.get(key), str) else None
        if tag("access") == "no":
            continue
        centre = row.geometry.centroid  # an area of bike parking becomes its center point
        lat, lon = round(centre.y, 6), round(centre.x, 6)
        if not area.contains(Point(lon, lat)):
            continue
        if any(meters(lat, lon, r["lat"], r["lon"]) <= OSM_SAME_M for r in ucsd):
            skipped += 1
            continue
        rack = {
            "lat": lat,
            "lon": lon,
            "kind": "enclosure" if tag("bicycle_parking") in OSM_ENCLOSURES else "rack",
            "near": tag("name") or nearest_building(lat, lon, buildings),
            "source": "osm",
        }
        capacity = tag("capacity")
        if capacity and capacity.isdigit():
            rack["spaces"] = int(capacity)
        notes = [text for key, value, text in (("covered", "yes", "Covered"), ("access", "private", "Private"),
                                               ("access", "customers", "For customers only")) if tag(key) == value]
        if notes:
            rack["notes"] = ". ".join(notes)
        result.append(rack)
    print(f"osm: {len(result)} new points, {skipped} skipped because a UCSD point is within {OSM_SAME_M} m")
    return result


def main():
    area = load_area()
    result = []
    seen = set()
    for kind, url in LAYERS.items():
        features = download(url)
        kept = 0
        for feature in features:
            lon, lat = feature["geometry"]["coordinates"]
            point = (round(lat, 6), round(lon, 6))
            if point in seen or not area.contains(Point(lon, lat)):
                continue
            seen.add(point)
            near = (feature["properties"].get("FacilityLongName") or "").strip() or None
            result.append({"lat": point[0], "lon": point[1], "kind": kind, "near": near, "source": "ucsd"})
            kept += 1
        print(f"{kind}: {kept} of {len(features)} points are in the area")
    result += osm_racks(area, list(result))

    OUTPUT.write_text(json.dumps(result, separators=(",", ":"), ensure_ascii=False))
    print(f"Wrote {len(result)} points to {OUTPUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
