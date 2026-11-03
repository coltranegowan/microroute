// Checks for js/routing.js on the real graph. Run: node scripts/test_routing.mjs

import { readFileSync } from 'node:fs';
import { buildGraph, findRoute, nearestNode } from '../js/routing.js';

const graph = buildGraph(JSON.parse(readFileSync(new URL('../data/graph.json', import.meta.url))));

const PLACES = {
  'Geisel Library': [32.8811, -117.2376],
  'Westfield UTC': [32.8707, -117.2108],
  'La Jolla Shores beach': [32.8576, -117.2565],
  'Torrey Pines Gliderport': [32.8899, -117.2516],
  'University Square (Governor Dr)': [32.8525, -117.2150],
  'Nobel Hill': [32.8610, -117.1960],
};
const TRIPS = [
  ['Geisel Library', 'Westfield UTC'],
  ['La Jolla Shores beach', 'Geisel Library'],
  ['Torrey Pines Gliderport', 'University Square (Governor Dr)'],
  ['Nobel Hill', 'La Jolla Shores beach'],
];
const WEIGHTS = [0, 1, 3];

let failures = 0;
function check(ok, message) {
  if (!ok) {
    failures += 1;
    console.log(`FAIL ${message}`);
  }
}

const node = (name) => nearestNode(graph, ...PLACES[name]).id;
const km = (m) => (m / 1000).toFixed(2);
const pct = (route, level) => `${Math.round((100 * route.lengthByLts[level]) / route.length)}%`;

for (const [from, to] of TRIPS) {
  console.log(`\n${from} → ${to}`);
  let fastest = null;
  for (const w of WEIGHTS) {
    const started = performance.now();
    const route = findRoute(graph, node(from), node(to), { w });
    const ms = performance.now() - started;
    check(route, `${from} → ${to}, w=${w}: no route`);
    if (!route) continue;

    // A* must give the same cost as Dijkstra. If not, the heuristic is not admissible.
    const dijkstra = findRoute(graph, node(from), node(to), { w, useHeuristic: false });
    check(Math.abs(route.cost - dijkstra.cost) < 1e-6, `w=${w}: A* cost ${route.cost} ≠ Dijkstra cost ${dijkstra.cost}`);

    // The route must be connected: each edge starts where the edge before it ends.
    route.edges.forEach((edge, i) => {
      if (i > 0) check(edge.from === route.edges[i - 1].to, `w=${w}: route breaks at edge ${i}`);
    });

    if (w === 0) {
      fastest = route;
    } else {
      check(route.time >= fastest.time - 1e-6, `w=${w}: route is faster than the fastest route`);
    }

    console.log(`  w=${w}: ${km(route.length)} km, ${(route.time / 60).toFixed(1)} min, `
      + `LTS 1 ${pct(route, 1)}, LTS 3-4 ${Math.round((100 * (route.lengthByLts[3] + route.lengthByLts[4])) / route.length)}%, `
      + `${ms.toFixed(1)} ms`);
  }
}

console.log(failures ? `\n${failures} checks failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
