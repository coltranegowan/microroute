"""Level of Traffic Stress (LTS 1-4) from OSM tags.

A simplified form of the method by Mekuria, Furth and Nixon (2012),
"Low-Stress Bicycling and Network Connectivity". The rules use only the
tags that OSM gives: highway, maxspeed, lanes, oneway, cycleway and bicycle.

Rules:
  1. A path that cars cannot use (cycleway, path, footway with bikes
     allowed) or a separated bike track is LTS 1.
  2. A street with a painted bike lane uses the bike lane table. A buffer
     between the bike lane and the cars lowers the stress by one level.
  3. All other streets use the mixed traffic table.
When a tag is missing, the default for the road type from DEFAULT_SPEED_MPH
and DEFAULT_LANES is used.

bike_type() gives the kind of bike facility on a segment, for the map. The
routing uses LTS, because the facility alone does not include the car speed.
"""

import re

# Roads with no car traffic.
CAR_FREE = {"cycleway", "path", "footway", "pedestrian", "track", "bridleway"}

# Speed limit in mph when `maxspeed` is missing. California default limits.
DEFAULT_SPEED_MPH = {
    "motorway": 65,
    "motorway_link": 45,
    "trunk": 50,
    "trunk_link": 35,
    "primary": 45,
    "primary_link": 35,
    "secondary": 40,
    "secondary_link": 30,
    "tertiary": 30,
    "tertiary_link": 25,
    "unclassified": 25,
    "residential": 25,
    "living_street": 15,
    "service": 15,
}

# Total number of through lanes (both directions) when `lanes` is missing.
DEFAULT_LANES = {
    "motorway": 6,
    "trunk": 4,
    "primary": 4,
    "secondary": 4,
    "tertiary": 2,
}

BIKE_LANE_VALUES = {"lane", "opposite_lane", "buffered_lane"}
SEPARATED_VALUES = {"track", "opposite_track"}
SHARED_LANE_VALUES = {"shared_lane", "share_busway"}
CYCLEWAY_KEYS = ("cycleway", "cycleway:both", "cycleway:right", "cycleway:left")
# OSM tags a buffered lane as cycleway:<side>=lane with cycleway:<side>:buffer=yes
# (or a width). "buffered_lane" is an old value that few ways use.
BUFFER_KEYS = tuple(f"{key}:buffer" for key in CYCLEWAY_KEYS)


def _values(tag):
    """Return the tag as a list. osmnx gives a list when it merges ways."""
    if tag is None:
        return []
    if isinstance(tag, list):
        return [str(v) for v in tag]
    return [str(tag)]


def _speed_mph(text):
    """Parse an OSM maxspeed value, for example "25 mph" or "40", to mph."""
    match = re.search(r"\d+", text)
    if not match:
        return None
    value = int(match.group())
    # OSM speeds with no unit are km/h.
    return value if "mph" in text else round(value / 1.609)


def _highway(tags):
    values = _values(tags.get("highway"))
    return values[0] if values else "unclassified"


def _speed(tags, highway):
    speeds = [s for s in (_speed_mph(v) for v in _values(tags.get("maxspeed"))) if s]
    if speeds:
        return max(speeds)
    return DEFAULT_SPEED_MPH.get(highway.removesuffix("_link"), 25)


def _total_lanes(tags, highway):
    """Through lanes in both directions. A one-way street counts double."""
    lanes = [int(m.group()) for v in _values(tags.get("lanes")) if (m := re.search(r"\d+", v))]
    oneway = "yes" in _values(tags.get("oneway")) or "True" in _values(tags.get("oneway"))
    if lanes:
        total = max(lanes)
        return total * 2 if oneway else total
    return DEFAULT_LANES.get(highway.removesuffix("_link"), 2)


def _cycleway_values(tags):
    found = set()
    for key in CYCLEWAY_KEYS:
        found.update(_values(tags.get(key)))
    return found


def _has_buffer(tags, cycleway):
    if "buffered_lane" in cycleway:
        return True
    for key in BUFFER_KEYS:
        if any(v not in ("no", "none", "0") for v in _values(tags.get(key))):
            return True
    return False


# The bike facility types, from the best to the worst. Keep the same keys in js/map.js.
BIKE_TYPES = ("path", "shared_path", "buffered", "lane", "sharrow", "none")


def bike_type(tags):
    """Return the bike facility of a segment: one of BIKE_TYPES.

    path         a bike path, or a bike track that is separated from cars
    shared_path  a path or walkway that bikes share with people on foot
    buffered     a painted bike lane with a buffer from the cars
    lane         a painted bike lane
    sharrow      a shared lane marking in the car lane
    none         a street with no bike facility
    """
    highway = _highway(tags)
    cycleway = _cycleway_values(tags)
    if highway == "cycleway" or cycleway & SEPARATED_VALUES:
        return "path"
    if highway in CAR_FREE:
        return "path" if "designated" in _values(tags.get("bicycle")) else "shared_path"
    if cycleway & BIKE_LANE_VALUES:
        return "buffered" if _has_buffer(tags, cycleway) else "lane"
    if cycleway & SHARED_LANE_VALUES:
        return "sharrow"
    return "none"


def lts(tags):
    """Return the LTS level (1-4) for a street segment with these OSM tags."""
    highway = _highway(tags)
    cycleway = _cycleway_values(tags)

    # Rule 1: no car traffic, or a bike track that is separated from cars.
    if highway in CAR_FREE or cycleway & SEPARATED_VALUES:
        return 1

    speed = _speed(tags, highway)
    lanes = _total_lanes(tags, highway)

    # Rule 2: painted bike lane. Furth table for bike lanes not next to parking.
    if cycleway & BIKE_LANE_VALUES:
        by_lanes = 1 if lanes <= 2 else 3
        if speed <= 30:
            by_speed = 1
        elif speed <= 35:
            by_speed = 3
        else:
            by_speed = 4
        level = max(by_lanes, by_speed)
        # A buffer keeps the cars farther away. It never makes a street LTS 1.
        if _has_buffer(tags, cycleway) and level > 2:
            level -= 1
        return level

    # Rule 3: mixed traffic. Furth table by speed limit and total lanes.
    if speed <= 25:
        return 1 if lanes <= 3 else 3 if lanes <= 5 else 4
    if speed <= 30:
        return 2 if lanes <= 3 else 4
    return 3 if lanes <= 3 else 4
