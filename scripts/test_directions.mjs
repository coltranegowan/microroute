// Checks for js/directions.js on the real graph. Run: node scripts/test_directions.mjs

import { readFileSync } from 'node:fs';
import {
  bearing, formatStepDistance, makeDirections, spokenStep, turnAngle, turnWords,
} from '../js/directions.js';
import { buildGraph, findRoute, nearestNode } from '../js/routing.js';

const graph = buildGraph(JSON.parse(readFileSync(new URL('../data/graph.json', import.meta.url))));

let failures = 0;
function check(ok, message) {
  if (!ok) {
    failures += 1;
    console.log(`FAIL ${message}`);
  }
}

// Bearings and turns
check(Math.abs(bearing([32.88, -117.24], [32.89, -117.24])) < 1e-6, 'due north is 0°');
check(Math.abs(bearing([32.88, -117.24], [32.88, -117.23]) - 90) < 0.1, 'due east is 90°');
check(turnAngle(0, 90) === 90, 'north to east is a right turn of 90°');
check(turnAngle(0, 270) === -90, 'north to west is a left turn of 90°');
check(turnAngle(350, 10) === 20, 'a turn across north');
check(turnWords(5) === 'Continue', '5° is continue');
check(turnWords(-40) === 'Bear left', '-40° is bear left');
check(turnWords(95) === 'Turn right', '95° is turn right');
check(turnWords(-160) === 'Make a sharp left', '-160° is a sharp left');

// Distances
check(formatStepDistance(30) === '100 ft', `30 m is ${formatStepDistance(30)}`);
check(formatStepDistance(10) === '50 ft', `10 m is ${formatStepDistance(10)}`);
check(formatStepDistance(800) === '0.5 mi', `800 m is ${formatStepDistance(800)}`);
check(formatStepDistance(1609, { spoken: true }) === '1.0 mile', 'one mile is singular');
check(spokenStep({ text: 'Turn left onto Gilman Drive', length: 480 }) === 'Turn left onto Gilman Drive, then go 0.3 miles.',
  'spoken step');
check(spokenStep({ text: 'Arrive at Geisel Library', length: 0 }) === 'Arrive at Geisel Library.', 'spoken last step');

// Real routes
const PLACES = {
  'Geisel Library': [32.8811, -117.2376],
  'Westfield UTC': [32.8707, -117.2108],
  'La Jolla Shores beach': [32.8576, -117.2565],
  'Torrey Pines Gliderport': [32.8899, -117.2516],
};
const TRIPS = [
  ['Geisel Library', 'Westfield UTC', 1],
  ['La Jolla Shores beach', 'Geisel Library', 3],
  ['Torrey Pines Gliderport', 'Westfield UTC', 0],
];
const node = (name) => nearestNode(graph, ...PLACES[name]).id;

for (const [from, to, w] of TRIPS) {
  const route = findRoute(graph, node(from), node(to), { w });
  const steps = makeDirections(graph, route, to);
  const name = `${from} → ${to}, w=${w}`;
  console.log(`${name}: ${steps.length} steps`);

  check(steps[0].text.startsWith('Head '), `${name}: the first step is "${steps[0].text}"`);
  check(steps[steps.length - 1].text === `Arrive at ${to}`, `${name}: the last step is "${steps[steps.length - 1].text}"`);
  check(steps.length < route.edges.length, `${name}: ${steps.length} steps for ${route.edges.length} edges`);

  // The step lengths must add up to the route length.
  const total = steps.reduce((sum, step) => sum + step.length, 0);
  check(Math.abs(total - route.length) < 0.5, `${name}: steps add up to ${total} m, the route is ${route.length} m`);

  // Each step is on a different street from the step before it, except for a turn off an unnamed road.
  for (let i = 1; i < steps.length - 1; i += 1) {
    const street = steps[i].text.split(' onto ')[1];
    const before = steps[i - 1].text.split(/ onto | on /)[1];
    check(street !== before || street.startsWith('the '), `${name}: step ${i + 1} repeats ${street}`);
  }
  // The first point is the start of the route.
  check(steps[0].point === route.points[0], `${name}: the first step is not at the start`);
}

console.log(failures ? `\n${failures} checks failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
