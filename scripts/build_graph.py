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
from shapely.geometry import LineString, shape

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
EXTRA_TAGS = ["cycleway", "cycleway:both", "cycleway:right", "cycleway:left", "bicycle", "surface", "footway",
              "cycleway:buffer", "cycleway:both:buffer", "cycleway:right:buffer", "cycleway:left:buffer"]

# The osmnx "bike" network does not include footways. A second query adds the
# walking paths, and bike_type() in lts.py marks them as shared_path. It skips
# a path where bikes must not ride. Steps are not footways, so they stay out.
BIKE_FILTER = ox._overpass._get_network_filter("bike")
FOOTWAYS_FOR_BIKES = ('["highway"~"^(footway|pedestrian)$"]["area"!~"yes"]'
                      '["bicycle"!~"^(no|dismount)$"]')

# Sidewalks stay only on the UCSD campus. There, many paths join the streets
# through a short sidewalk, and the racks are next to the buildings. Off
# campus, a sidewalk only copies the street next to it.
CAMPUS_NAMES = {"University of California, San Diego", "UC San Diego School of Medicine"}
CAMPUS_BUFFER_M = 30  # includes the sidewalks on the streets at the edge of campus


def load_campus():
    """Return the UCSD campus from OSM, with CAMPUS_BUFFER_M around it (x = longitude, y = latitude)."""
    features = ox.features_from_polygon(load_area(), tags={"amenity": "university"})
    shapes = features[features["name"].isin(CAMPUS_NAMES)].geometry
    if shapes.empty:
        raise SystemExit(f"No OSM area named {sorted(CAMPUS_NAMES)}")
    campus, crs = ox.projection.project_geometry(shapes.union_all())
    campus, _ = ox.projection.project_geometry(campus.buffer(CAMPUS_BUFFER_M), crs=crs, to_latlong=True)
    return campus


def is_sidewalk(data):
    values = data.get("footway")
    values = [values] if isinstance(values, str) else (values or [])
    return bool(values) and all(value == "sidewalk" for value in values)


def remove_sidewalks_off_campus(graph):
    campus = load_campus()
    off_campus = []
    for u, v, k, d in graph.edges(keys=True, data=True):
        if not is_sidewalk(d):
            continue
        line = d.get("geometry") or LineString([(graph.nodes[u]["x"], graph.nodes[u]["y"]),
                                                (graph.nodes[v]["x"], graph.nodes[v]["y"])])
        if not campus.intersects(line):
            off_campus.append((u, v, k))
    graph.remove_edges_from(off_campus)
    print(f"Removed {len(off_campus)} sidewalk edges off campus")


def download():
    ox.settings.useful_tags_way = list(dict.fromkeys(ox.settings.useful_tags_way + EXTRA_TAGS))
    ox.settings.cache_folder = str(ROOT / "cache")
    graph = ox.graph_from_polygon(load_area(), custom_filter=[BIKE_FILTER, FOOTWAYS_FOR_BIKES])
    remove_sidewalks_off_campus(graph)
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
            "sidewalks": "UCSD campus only",
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
