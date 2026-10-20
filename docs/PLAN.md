# Plan
1. Set up repo and GitHub Pages.
2. Build the street graph (campus, University City, La Jolla Shores) from OpenStreetMap and SANDAG.
3. Add data layers: racks, scooter drop-offs, buildings, parking, construction.
4. Add access features: colorblind mode, spoken directions.
5. Add time estimates.
6. Add user reports (optional extension).

Routing: A* only, with a cost = time x (1 + safety weight x stress).
