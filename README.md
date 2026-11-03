# UCSD MicroMap

Interactive map for micromobility users (bikes, e-bikes, scooters) at UC San Diego,
University City, and La Jolla Shores. Routes are safest or fastest. Pedestrian and car routing are out of scope.

Live site: https://coltranegowan.github.io/microroute/

See [docs/PLAN.md](docs/PLAN.md) for the build plan.

## Run the site locally

The page uses ES modules, so open it through a local server, not `file://`:

```sh
python3 -m http.server
```

Then open http://localhost:8000. Click the map to set the start (A), then click again to set the end (B).

## Build the street graph

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python scripts/test_lts.py
node scripts/test_routing.mjs
node scripts/test_search.mjs
.venv/bin/python scripts/build_graph.py
.venv/bin/python scripts/build_places.py
```

The build downloads the OSM streets (about 2–3 minutes) and writes `data/graph.json`.
`build_places.py` writes `data/places.json`, the places for the From and To search boxes.

## Add a UCSD building code

OSM has codes for only a few campus buildings. To add a code, add a line to
[data/building_codes.csv](data/building_codes.csv), then run `build_places.py` again:

```csv
code,name,aliases,source
YORK,York Hall,,UCSD Schedule of Classes
```

`name` must be the building name exactly as OSM has it. `aliases` are more search names,
separated by `;`. The script shows a warning for a name that OSM does not have.
