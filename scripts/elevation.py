"""Ground elevation from USGS 3DEP, and the climb of a line.

The points come from the 3DEPElevation ImageServer of The National Map
(getSamples, bilinear). It is the bare-earth model, so it gives the ground
under a bridge, not the bridge deck. The script keeps the values in
cache/elevations.json, so a new graph build asks only for new points.
"""

import json
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

SERVICE = "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/getSamples"
CACHE = ROOT / "cache" / "elevations.json"
BATCH = 500  # points in one request
# A change in height must be more than this before it counts as a climb, so
# small errors in the model do not add up along a long line.
MIN_STEP_M = 1.0


def _key(lon, lat):
    return f"{lon:.6f},{lat:.6f}"


def _request(points):
    body = urllib.parse.urlencode({
        "geometry": json.dumps({"points": points, "spatialReference": {"wkid": 4326}}),
        "geometryType": "esriGeometryMultipoint",
        "returnFirstValueOnly": "true",
        "interpolation": "RSP_BilinearInterpolation",
        "outFields": "",
        "f": "json",
    }).encode()
    for attempt in range(4):
        try:
            with urllib.request.urlopen(SERVICE, data=body, timeout=120) as response:
                data = json.load(response)
            if "samples" in data:
                return data["samples"]
            raise RuntimeError(data.get("error", data))
        except Exception as error:  # the service sometimes times out; try again
            if attempt == 3:
                raise
            print(f"  elevation request failed ({error}), trying again")
            time.sleep(5 * (attempt + 1))
    return []


def elevations(points):
    """Return {(lon, lat): meters or None} for a list of (lon, lat) points."""
    cache = json.loads(CACHE.read_text()) if CACHE.exists() else {}
    missing = sorted({_key(lon, lat) for lon, lat in points} - cache.keys())
    if missing:
        print(f"Getting the elevation of {len(missing)} points from USGS 3DEP")
    for start in range(0, len(missing), BATCH):
        batch = [[float(v) for v in key.split(",")] for key in missing[start:start + BATCH]]
        for key in missing[start:start + BATCH]:
            cache[key] = None  # a point with no data (for example the ocean) stays None
        for sample in _request(batch):
            value = sample.get("value")
            try:
                height = round(float(value), 2)
            except (TypeError, ValueError):
                continue
            location = sample["location"]
            cache[_key(location["x"], location["y"])] = height
        CACHE.parent.mkdir(exist_ok=True)
        CACHE.write_text(json.dumps(cache, separators=(",", ":")))
        print(f"  {min(start + BATCH, len(missing))} of {len(missing)}")
    return {(lon, lat): cache.get(_key(lon, lat)) for lon, lat in points}


def climb(heights):
    """The total uphill height (m) along a line of heights, in the order given.

    A change counts only when it is more than MIN_STEP_M from the last height
    that counted. A height of None is skipped.
    """
    heights = [h for h in heights if h is not None]
    if len(heights) < 2:
        return 0.0
    total = 0.0
    anchor = heights[0]
    for height in heights[1:]:
        if abs(height - anchor) >= MIN_STEP_M:
            total += max(0.0, height - anchor)
            anchor = height
    # The last part can be smaller than MIN_STEP_M, but the end height is real.
    return total + max(0.0, heights[-1] - anchor)
