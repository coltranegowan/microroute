"""Build data/racks.json, the bike racks and the bike enclosures for the map.

Run from the project root:
    .venv/bin/python scripts/build_racks.py

The points come from two public layers of the UC San Diego Campus Map
(https://experience.arcgis.com/experience/c97d6e2efd7947d38738d5184b2debc7),
which UCSD keeps in ArcGIS Online. The script keeps only the points in the
area (data/area.json).

Output: [{"lat", "lon", "kind", "near"}, ...]
  kind  "rack" or "enclosure" (a locked bike room or cage)
  near  the building or place next to the point, or null
"""

import json
import sys
import urllib.parse
import urllib.request

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
            result.append({"lat": point[0], "lon": point[1], "kind": kind, "near": near})
            kept += 1
        print(f"{kind}: {kept} of {len(features)} points are in the area")

    OUTPUT.write_text(json.dumps(result, separators=(",", ":"), ensure_ascii=False))
    print(f"Wrote {len(result)} points to {OUTPUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
