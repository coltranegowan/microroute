# UCSD MicroMap Build Plan

SYN 100, Fall 2026. Last change: Nov 17, 2026. The dates come from the SYN 100 Canvas modules page.

UCSD MicroMap is an interactive map for bike, e-bike and scooter riders. It gives the safest route or the fastest route.
The study area is UC San Diego, University City and La Jolla Shores. Pedestrian and car routes are out of scope.

| Milestone | Date |
| --- | --- |
| Start | Mon Oct 19 (Week 4) |
| Minimum product | Week 6 |
| Feature stop | Week 8 |
| SYNposium | Thu Dec 3 |
| Final Google Site | Sun Dec 6 |

## Architecture

The site is static and has no server. A Python script builds the street graph one time. The browser does all route calculations.

```text
OSM + SANDAG + USGS  →  scripts/ (Python + osmnx)  →  data/graph.json  →  js/routing.js (A*)  →  Leaflet map on GitHub Pages
```

| Stage | Part | What it does |
| --- | --- | --- |
| Sources | OSM, SANDAG, USGS | Streets, bike network, elevation |
| Build, one time | `scripts/` | Calculates LTS and slope for each street segment |
| Output | `data/graph.json` | Nodes and edges, with time and stress |
| Team input | `data/traffic-zones.json` | Crowded paths at class change, painted with `tools/draw-traffic.html` |
| In the browser | `js/routing.js` | A* search on the graph |
| Display | `js/map.js` | Leaflet map |

## Main decisions

| Topic | Decision | Reason |
| --- | --- | --- |
| Host | GitHub Pages | It is free and has no server to maintain. The Google Site can link to it or embed it. |
| Map library | Leaflet | It is small and free. It uses OpenStreetMap tiles with no API key. |
| Graph build | Python with `osmnx` | The script gets the OSM streets for the three areas. Then it adds the SANDAG bike network and the USGS elevation data. |
| Stress score | Level of Traffic Stress (LTS 1–4) | LTS is a published method (Mekuria, Furth and Nixon, 2012). The script reads `highway`, `maxspeed`, `lanes` and `cycleway` from the OSM tags. |
| Search | A* only | The heuristic is the straight-line distance divided by the top speed. A* then always finds the route with the lowest cost. |
| Time estimates | Speed per mode + slope | Bike, e-bike and scooter each get a speed. A slope penalty adds time on hills, for example La Jolla Shores Drive. |
| Traffic | Fixed schedule, entered by the team | The team marks the street segments that are busy at class changes, with the days and times. There is no live traffic data. |

## Routing cost

```text
cost = time × traffic + w × (stress + zone stress) × length ÷ 4.44 m/s
```

`w` is the safety weight. `stress` is the LTS level of the street segment. `zone stress` is 2 on a path in a high traffic zone and 1 in a medium zone, at all times, because almost every campus path is LTS 1. `time` includes the climb (USGS elevation). The safety part uses the length, not the time, so Safest avoids the same paths for every mode. 4.44 m/s is the flat bike speed.
`traffic` is 1, except on a crowded path in a traffic zone during a class change. There, it is 2 for a high zone and 1.5 for a medium zone. On a segment that the zone covers only in part, the value is 1 + (multiplier − 1) × the covered part.

| Stress level | Typical street | Multiplier when `w = 1` |
| --- | --- | --- |
| LTS 1 | Bike path, quiet campus road | ×2 |
| LTS 2 | Residential street, protected bike lane | ×3 |
| LTS 3 | Painted bike lane next to fast traffic | ×4 |
| LTS 4 | Multi-lane arterial with no bike lane | ×5 |

When `w = 0`, every multiplier is ×1 and the route is the fastest route. A high `w` makes busy streets expensive and gives the safest route.
The rider picks a departure time. The app uses that time to find which traffic zones are busy.
No multiplier is less than 1. Thus the A* heuristic stays admissible.

### Traffic zones

The team paints the crowded paths with `tools/draw-traffic.html`. The tool saves `data/traffic-zones.json`, a GeoJSON file with the brush strokes and the level (high or medium) of each zone.
The app finds the street segments under the strokes when it loads (`js/traffic.js`). Thus the zones stay correct after a new graph build.

All zones are busy in the 10 minutes between classes:

| Days | Class length | Busy windows |
| --- | --- | --- |
| Mon, Wed, Fri | 50 min | 8:50–9:00 AM, then each hour until 7:50–8:00 PM |
| Tue, Thu | 80 min | 9:20–9:30 AM, then each 90 min until 7:50–8:00 PM |

## Schedule

| Week | Dates | Due | Build work |
| --- | --- | --- | --- |
| 4 | Oct 19 – 25 | Oct 23: Annotated Bibliography<br>Oct 25: Draft Project Proposal | Set up the repo on GitHub Pages. Show a Leaflet map of the three areas. Find and download the data sources. |
| 5 | Oct 26 – Nov 1 | Oct 30: Final Project Proposal<br>Oct 30: Team Report: Project Timeline | Write the graph build script. Calculate LTS for each street segment. Export the graph to `data/graph.json`. Observe 3–5 busy places at class change and record the times. |
| 6 | Nov 2 – 8 | Nov 4: Microgrant Application (optional)<br>Nov 6: Weekly journal and report | **Minimum product.** Write A* in the browser. Add the safest / fastest control. Draw the route on the map. |
| 7 | Nov 9 – 15 | Nov 13: Weekly journal and report<br>No class Nov 11 (Veterans Day) | Add data layers: racks, scooter drop-offs, buildings, parking, construction. Add time estimates for each mode. Add the traffic zones and a departure time control. |
| 8 | Nov 16 – 22 | Nov 20: Final SYNposium Details<br>Nov 20: Weekly journal and report | **Feature stop.** Add a colorblind mode. Add spoken directions (Web Speech API). Do user tests with riders. |
| 9 | Nov 23 – 29 | Nov 29: Journal entry<br>Thanksgiving: no class Nov 26, no session | Repair bugs from the user tests. Compare routes with Google Maps bike routes. Add user reports (hazards, theft) only if the team is ahead. |
| 10 | Nov 30 – Dec 4 | Nov 30: Poster to print<br>Dec 3: Draft Google Site<br>Dec 3: SYNposium | Put the app on the Google Site. Prepare a live demo with a QR code on the poster. |
| Finals | Dec 5 – 11 | Dec 6: Final Google Site<br>Dec 6: Signed Author Agreement | Make the final changes. Write the README. |

## Risks

| Risk | Action |
| --- | --- |
| Data quality | OSM tags in University City can be incomplete. Set a default LTS value for each road type. Check 10–20 streets by hand. |
| Scooter rules | UCSD has slow zones and dismount zones. Find an official source before the team adds them to the map. |
| User reports | This feature needs a place to store data, but GitHub Pages cannot store it. A Google Form that writes to a Google Sheet is the simplest option. Keep it as the optional extension. |
| Scope | Weeks 7 and 8 have the most work. If the team is late, remove the parking and construction layers first. |

