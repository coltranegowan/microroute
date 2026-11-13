"""Build data/graph.json, the street graph for bike routing in the browser.

Run from the project root:
    .venv/bin/python scripts/build_graph.py

The script gets the OSM streets for the study area, calculates the LTS of
each street segment (see lts.py) and writes the nodes and edges to JSON.
Speed and time depend on the mode (bike, e-bike, scooter), so the browser
calculates the time from the length. Each edge also gets its bike facility
type (bike_type in lts.py) for the map. Slope (USGS) and the SANDAG bike
network come later.
"""

import json
from datetime import date
from pathlib import Path

import osmnx as ox
from shapely.geometry import shape

from lts import BIKE_TYPES, bike_type, lts

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "data" / "graph.json"

# The usable area, drawn with tools/draw-area.html. The app uses the same file.
AREA_FILE = ROOT / "data" / "area.json"


def load_area():
    """Return the area as a shapely Polygon (x = longitude, y = latitude)."""
    feature = json.loads(AREA_FILE.read_text())
    return shape(feature.get("geometry", feature))

# Tags that lts.py needs, in addition to the osmnx defaults.
EXTRA_TAGS = ["cycleway", "cycleway:both", "cycleway:right", "cycleway:left", "bicycle", "surface",
              "cycleway:buffer", "cycleway:both:buffer", "cycleway:right:buffer", "cycleway:left:buffer"]

# The osmnx "bike" network does not include footways. Campus paths are often
# footways with bicycle=yes, so a second query adds them.
BIKE_FILTER = ox._overpass._get_network_filter("bike")
FOOTWAYS_FOR_BIKES = '["highway"~"footway|pedestrian"]["area"!~"yes"]["bicycle"~"yes|designated|permissive"]'


def download():
    ox.settings.useful_tags_way = list(dict.fromkeys(ox.settings.useful_tags_way + EXTRA_TAGS))
    ox.settings.cache_folder = str(ROOT / "cache")
    graph = ox.graph_from_polygon(load_area(), custom_filter=[BIKE_FILTER, FOOTWAYS_FOR_BIKES])
    # Keep only the part where every node can reach every other node.
    # Otherwise A* can start in a piece that has no route out.
    return ox.truncate.largest_component(graph, strongly=True)


def point(lon, lat):
    return [round(lat, 6), round(lon, 6)]


def to_json(graph):
    west, south, east, north = load_area().bounds
    nodes = {str(n): point(d["x"], d["y"]) for n, d in graph.nodes(data=True)}

    edges = []
    for u, v, k, d in graph.edges(keys=True, data=True):
        edge = {
            "id": f"{u}-{v}-{k}",
            "from": str(u),
            "to": str(v),
            "length": round(d["length"], 1),
            "lts": lts(d),
            "bike": bike_type(d),
        }
        name = d.get("name")
        if name:
            edge["name"] = name if isinstance(name, str) else " / ".join(name)
        highway = d.get("highway")
        edge["highway"] = highway if isinstance(highway, str) else highway[0]
        # A street segment with no geometry is a straight line between its nodes.
        if "geometry" in d:
            edge["geometry"] = [point(x, y) for x, y in d["geometry"].coords]
        edges.append(edge)

    return {
        "meta": {
            "built": date.today().isoformat(),
            "source": "OpenStreetMap contributors (ODbL)",
            "area": "data/area.json",
            "bbox": {"west": west, "south": south, "east": east, "north": north},
            "stress": "LTS 1-4, simplified from Mekuria, Furth and Nixon (2012). See scripts/lts.py.",
            "lengthUnit": "m",
            "nodeCount": len(nodes),
            "edgeCount": len(edges),
        },
        "nodes": nodes,
        "edges": edges,
    }


def main():
    graph = download()
    data = to_json(graph)
    OUTPUT.write_text(json.dumps(data, separators=(",", ":")))

    counts = {level: 0 for level in range(1, 5)}
    for edge in data["edges"]:
        counts[edge["lts"]] += 1
    print(f"Wrote {OUTPUT.relative_to(ROOT)}: {data['meta']['nodeCount']} nodes, "
          f"{data['meta']['edgeCount']} edges, {OUTPUT.stat().st_size / 1e6:.1f} MB")
    for level, count in counts.items():
        print(f"  LTS {level}: {count} edges ({count / len(data['edges']):.0%})")
    for kind in BIKE_TYPES:
        count = sum(edge["bike"] == kind for edge in data["edges"])
        print(f"  {kind}: {count} edges ({count / len(data['edges']):.0%})")


if __name__ == "__main__":
    main()
