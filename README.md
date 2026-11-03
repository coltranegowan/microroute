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
.venv/bin/python scripts/build_graph.py
```

The build downloads the OSM streets (about 2–3 minutes) and writes `data/graph.json`.
