// Checks for js/traffic.js on the real graph and zones. Run: node scripts/test_traffic.mjs

import { readFileSync } from 'node:fs';
import { buildGraph, findRoute, nearestNode } from '../js/routing.js';
import { buildZones, classChangeAt, nextClassChange, trafficAt, zoneStressOf } from '../js/traffic.js';

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url)));
const graph = buildGraph(read('../data/graph.json'));
const zones = buildZones(read('../data/traffic-zones.json'), graph);

let failures = 0;
function check(ok, message) {
  if (!ok) {
    failures += 1;
    console.log(`FAIL ${message}`);
  }
}

// Nov 16, 2026 is a Monday. at('Tue', '9:25') gives a Date on that week.
const DAY = { Sun: 15, Mon: 16, Tue: 17, Wed: 18, Thu: 19, Fri: 20, Sat: 21 };
const at = (day, time) => {
  const [h, m] = time.split(':').map(Number);
  return new Date(2026, 10, DAY[day], h, m);
};

// The schedule
const BUSY = [['Mon', '8:50'], ['Mon', '9:59'], ['Wed', '12:55'], ['Fri', '19:50'],
  ['Tue', '9:20'], ['Tue', '10:55'], ['Thu', '12:25'], ['Thu', '19:59']];
const QUIET = [['Mon', '8:49'], ['Mon', '9:00'], ['Mon', '9:20'], ['Fri', '20:50'], ['Tue', '9:50'],
  ['Tue', '9:30'], ['Thu', '11:50'], ['Thu', '20:20'], ['Sat', '9:55'], ['Sun', '12:55']];
BUSY.forEach(([day, time]) => check(classChangeAt(at(day, time)), `${day} ${time} must be a class change`));
QUIET.forEach(([day, time]) => check(!classChangeAt(at(day, time)), `${day} ${time} must not be a class change`));
check(nextClassChange(at('Tue', '9:31'))?.[0] === 10 * 60 + 50, 'the next class change after Tue 9:31 must be 10:50');
check(nextClassChange(at('Fri', '19:55')) === null, 'no class change after Fri 7:50 PM');

// The zones
const matched = zones.filter((zone) => zone.shares.size > 0).length;
console.log(`${zones.length} zones, ${matched} with street segments`);
check(matched >= 10, 'most zones must match street segments');
zones.forEach(({ zone, shares }) => shares.forEach((share, id) => {
  check(share > 0 && share <= 1, `zone ${zone}, edge ${id}: share ${share} is not in (0, 1]`);
}));

const busy = trafficAt(zones, at('Mon', '9:55'));
const quiet = trafficAt(zones, at('Mon', '10:30'));
const edges = [...graph.nodes.values()].flatMap((node) => node.out);
check(edges.every((edge) => busy(edge) >= 1), 'no traffic multiplier can be less than 1');
check(edges.every((edge) => quiet(edge) === 1), 'every multiplier must be 1 outside a class change');
check(edges.some((edge) => busy(edge) > 1), 'some edges must be slow at a class change');

// Routes across the campus walks
const PLACES = {
  'Geisel Library': [32.8811, -117.2376],
  'Center Hall': [32.8777, -117.2373],
  'Warren College': [32.8826, -117.2337],
  'Muir College': [32.8784, -117.2410],
};
const TRIPS = [['Geisel Library', 'Center Hall'], ['Muir College', 'Warren College'], ['Center Hall', 'Warren College']];
const node = (name) => nearestNode(graph, ...PLACES[name]).id;
let delayed = 0;
for (const [from, to] of TRIPS) {
  for (const w of [0, 1]) {
    const crowded = findRoute(graph, node(from), node(to), { w, traffic: busy });
    const calm = findRoute(graph, node(from), node(to), { w, traffic: quiet });
    const dijkstra = findRoute(graph, node(from), node(to), { w, traffic: busy, useHeuristic: false });
    check(Math.abs(crowded.cost - dijkstra.cost) < 1e-6, `${from} → ${to}, w=${w}: A* cost ≠ Dijkstra cost with traffic`);
    check(crowded.cost >= calm.cost - 1e-6, `${from} → ${to}, w=${w}: a class change cannot make the route cheaper`);
    check(calm.crowdDelay === 0, `${from} → ${to}, w=${w}: no crowd delay outside a class change`);
    if (crowded.crowdDelay > 0 || crowded.length !== calm.length) {
      delayed += 1;
    }
    console.log(`  ${from} → ${to}, w=${w}: ${(calm.time / 60).toFixed(1)} min quiet, `
      + `${(crowded.time / 60).toFixed(1)} min at class change (${Math.round(crowded.crowdDelay)} s crowd delay)`);
  }
}
check(delayed > 0, 'a class change must change at least one campus route');

// The zone stress: at a quiet time, Safest must avoid the busy walks and Fastest must not change.
const extraStress = zoneStressOf(zones);
check(edges.every((edge) => extraStress(edge) >= 0), 'no zone stress can be less than 0');
let different = 0;
for (const [from, to] of TRIPS) {
  const plain = findRoute(graph, node(from), node(to), { w: 0, traffic: quiet });
  const fastest = findRoute(graph, node(from), node(to), { w: 0, traffic: quiet, extraStress });
  const safest = findRoute(graph, node(from), node(to), { w: 1.5, traffic: quiet, extraStress });
  const dijkstra = findRoute(graph, node(from), node(to), { w: 1.5, traffic: quiet, extraStress, useHeuristic: false });
  check(Math.abs(fastest.cost - plain.cost) < 1e-6, `${from} → ${to}: the zone stress must not change Fastest`);
  check(Math.abs(safest.cost - dijkstra.cost) < 1e-6, `${from} → ${to}: A* cost ≠ Dijkstra cost with zone stress`);
  const inZones = (route) => route.edges.reduce((sum, edge) => sum + (extraStress(edge) > 0 ? edge.length : 0), 0) / route.length;
  check(inZones(safest) <= inZones(fastest) + 1e-9, `${from} → ${to}: Safest must not use more busy walks than Fastest`);
  if (safest.edges.map((e) => e.id).join() !== fastest.edges.map((e) => e.id).join()) {
    different += 1;
  }
  console.log(`  quiet, ${from} → ${to}: Fastest ${(fastest.time / 60).toFixed(1)} min, ${Math.round(100 * inZones(fastest))}% in zones; `
    + `Safest ${(safest.time / 60).toFixed(1)} min, ${Math.round(100 * inZones(safest))}% in zones`);
}
check(different >= 2, 'Safest must change most campus routes at a quiet time');

console.log(failures ? `\n${failures} checks failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
