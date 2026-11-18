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
- **Bike racks:** each rack is a green bike-parking square, and a locked enclosure has a padlock badge. The racks show at zoom 16 and closer. After a route, the racks within 150 m of B show at full size at every zoom, and the nearest one has a gold ring. The panel names that rack, and the spoken directions say it at the end.
- **Colorblind mode:** the route, the bike lane layer and the legend show each bike lane type as a line pattern, not only a color. The browser keeps the setting for the next visit.

## Bike lanes and stress

The map and the route colors show the type of bike facility on each street: bike path, path shared with
people on foot, buffered bike lane, painted bike lane, sharrow, or none. The types come from the OSM
`cycleway` tags (`bike_type()` in [scripts/lts.py](scripts/lts.py)).
All walking paths are in the graph as paths shared with people on foot, except sidewalks, steps and paths
where OSM says bikes must not ride (`bicycle=no` or `dismount`).

The **Safest** setting does not use the type alone. It uses the Level of Traffic Stress (LTS 1–4), which
also includes the car speed and the number of lanes. A painted bike lane next to fast traffic is high
stress. The route summary shows the part of the route at LTS 1–2 as **Low stress**.

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
.venv/bin/python scripts/build_racks.py
```

The build downloads the OSM streets (about 2–3 minutes) and writes `data/graph.json`.
`build_places.py` writes `data/places.json` and `data/addresses.json`, the places and the street addresses for the From and To search boxes.
`build_racks.py` writes `data/racks.json`, the bike racks and the locked bike enclosures. The points come from the
[UC San Diego Campus Map](https://experience.arcgis.com/experience/c97d6e2efd7947d38738d5184b2debc7) (the Bicycle Racks and
Bicycle Enclosures layers) and from the OpenStreetMap bike parking. The script skips an OSM point that is within 20 m of
a UCSD point, because it is probably the same rack. Run it again when UCSD or OSM changes the racks.

## Change the map area

Everything outside the area in [data/area.json](data/area.json) is gray, and the
routes and the search stay inside it.

1. Start the local server and open http://localhost:8000/tools/draw-area.html.
2. Change the shape, or click **Start over** and draw a new one.
3. Click **Download area.json** and put the file in `data/`. Replace the old file.
4. Run `scripts/build_graph.py`, `scripts/build_places.py` and `scripts/build_racks.py` again.
5. Run the tests, then commit the four data files.

## Class change crowds

The paths in [data/traffic-zones.json](data/traffic-zones.json) are crowded in the 10 minutes between classes:

- Mon/Wed/Fri: 8:50–9:00 AM, 9:50–10:00 AM, and each hour until 7:50–8:00 PM.
- Tue/Thu: 9:20–9:30 AM, 10:50–11:00 AM, and each 90 minutes until 7:50–8:00 PM.

The rider picks **Leave: Now** or a day and a time. At a class change, a high zone makes its paths 2 times
slower and a medium zone 1.5 times slower. The route avoids them where it can, the map shows them as pink
bands, and the route time includes the delay. The schedule is `CLASS_CHANGES` in [js/traffic.js](js/traffic.js).

To change the zones:

1. Open https://coltranegowan.github.io/microroute/tools/draw-traffic.html, or the same path on the local server.
2. Pick **High** or **Medium**, then paint over the crowded paths. The paths that the paint covers change color.
3. Click **Download traffic-zones.json** and put the file in `data/`. Replace the old file.
4. Run `node scripts/test_traffic.mjs`, then commit the file.

Paint on a footway that is not in the street graph has no effect. The graph has a footway only if OSM marks it as open to bikes.

## Add bike racks from the team

The same page, https://coltranegowan.github.io/microroute/tools/draw-traffic.html, has a **Bike racks** tab.
It works on a phone, so a teammate can add racks on campus.

1. Type your name. Then tap the map where a rack is, or click **Add at my location** next to the rack.
2. Pick **Rack** or **Locked enclosure**, and type the building, the number of bike spaces and notes.
3. Click **Download team-racks.json** and send the file to the team.
4. To combine the files, open the page, click **Add a saved file** and pick all the files.
   Then download `team-racks.json` again and put it in `data/`.

The gray dots are the racks from the UCSD campus map and OpenStreetMap ([data/racks.json](data/racks.json)), so the team
does not add them again. The app shows the team racks with the UCSD racks, and the popup says who added them.
**Add a saved file** adds to what is on the page. It never removes your traffic zones or racks.

## Add a UCSD building code

OSM has codes for only a few campus buildings. To add a code, add a line to
[data/building_codes.csv](data/building_codes.csv), then run `build_places.py` again:

```csv
code,name,aliases,source
YORK,York Hall,,UCSD Schedule of Classes
```

`name` must be the building name exactly as OSM has it. `aliases` are more search names,
separated by `;`. The script shows a warning for a name that OSM does not have.
