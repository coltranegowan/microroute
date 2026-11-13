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

## Accessibility

- **Directions:** the panel lists each turn of the route. Click a step to zoom the map to it.
- **Read directions aloud:** the browser speaks the steps with the Web Speech API. The button does not show in a browser that cannot speak.
- **Colorblind mode:** the route and the legend show each stress level as a line pattern, not only a color. The browser keeps the setting for the next visit.

## Build the street graph

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python scripts/test_lts.py
node scripts/test_routing.mjs
node scripts/test_search.mjs
node scripts/test_directions.mjs
.venv/bin/python scripts/build_graph.py
.venv/bin/python scripts/build_places.py
```

The build downloads the OSM streets (about 2–3 minutes) and writes `data/graph.json`.
`build_places.py` writes `data/places.json` and `data/addresses.json`, the places and the street addresses for the From and To search boxes.

## Change the map area

Everything outside the area in [data/area.json](data/area.json) is gray, and the
routes and the search stay inside it.

1. Start the local server and open http://localhost:8000/tools/draw-area.html.
2. Change the shape, or click **Start over** and draw a new one.
3. Click **Download area.json** and put the file in `data/`. Replace the old file.
4. Run `scripts/build_graph.py` and `scripts/build_places.py` again.
5. Run the tests, then commit the three data files.

## Add a UCSD building code

OSM has codes for only a few campus buildings. To add a code, add a line to
[data/building_codes.csv](data/building_codes.csv), then run `build_places.py` again:

```csv
code,name,aliases,source
YORK,York Hall,,UCSD Schedule of Classes
```

`name` must be the building name exactly as OSM has it. `aliases` are more search names,
separated by `;`. The script shows a warning for a name that OSM does not have.
