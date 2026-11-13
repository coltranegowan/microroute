// Turn-by-turn directions from a route that js/routing.js finds.
//
// The route is a list of edges. A leg is a run of edges on the same street.
// Each leg starts with a step: "Turn left onto Gilman Drive". A street with
// no name in OSM gets a name from its type, for example "the path". Two edges
// with no name are in different legs if the turn between them is sharp.
//
// This file has no browser code, so Node can test it.

import { distance, edgePoints } from './routing.js';

// A leg that is shorter than this joins the leg before it. Short connectors,
// for example a few meters of driveway between two streets, are not steps.
const MIN_LEG_M = 25;
// A turn of more than this many degrees between two edges with no name starts a new leg.
const UNNAMED_TURN_DEG = 50;
// The bearing at a junction uses the point this far along the line, so that
// small bends near the junction do not change the turn.
const BEARING_M = 15;

const UNNAMED = {
  footway: 'the footpath',
  path: 'the path',
  pedestrian: 'the walkway',
  cycleway: 'the bike path',
  track: 'the track',
  service: 'the service road',
  busway: 'the bus lane',
  living_street: 'the street',
  residential: 'the street',
  unclassified: 'the road',
  primary_link: 'the ramp',
  secondary_link: 'the ramp',
  tertiary_link: 'the ramp',
};

const COMPASS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];

function highwayOf(edge) {
  return Array.isArray(edge.highway) ? edge.highway[0] : edge.highway;
}

// The names of the street of an edge, and true if OSM gives a name. OSM gives
// some edges two names, and scripts/build_graph.py joins them with " / ".
function streetOf(edge) {
  if (edge.name) {
    return { names: edge.name.split(' / '), named: true };
  }
  return { names: [UNNAMED[highwayOf(edge)] ?? 'the road'], named: false };
}

// The names that two lists have in common.
const common = (a, b) => a.filter((name) => b.includes(name));

// Compass bearing in degrees (0 = north, 90 = east) from point a to point b.
export function bearing([lat1, lon1], [lat2, lon2]) {
  const toRad = Math.PI / 180;
  const y = Math.sin((lon2 - lon1) * toRad) * Math.cos(lat2 * toRad);
  const x = Math.cos(lat1 * toRad) * Math.sin(lat2 * toRad)
    - Math.sin(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.cos((lon2 - lon1) * toRad);
  return (Math.atan2(y, x) / toRad + 360) % 360;
}

// The point that is `meters` along a line from its first point, or the last point.
function pointAlong(line, meters) {
  let walked = 0;
  for (let i = 1; i < line.length; i += 1) {
    walked += distance(...line[i - 1], ...line[i]);
    if (walked >= meters) {
      return line[i];
    }
  }
  return line[line.length - 1];
}

// The direction of travel at the start and at the end of a line.
const bearingOut = (line) => bearing(line[0], pointAlong(line, BEARING_M));
const bearingIn = (line) => {
  const reversed = [...line].reverse();
  return bearing(pointAlong(reversed, BEARING_M), reversed[0]);
};

// The turn from one bearing to the next, from -180 (left) to 180 (right).
export function turnAngle(inBearing, outBearing) {
  return ((outBearing - inBearing + 540) % 360) - 180;
}

// The words for a turn angle.
export function turnWords(angle) {
  const side = angle < 0 ? 'left' : 'right';
  const size = Math.abs(angle);
  if (size < 20) return 'Continue';
  if (size < 60) return `Bear ${side}`;
  if (size < 135) return `Turn ${side}`;
  return `Make a sharp ${side}`;
}

// Add the edges of leg b to the end of leg a. Keep the names that they have in common.
function join(a, b) {
  a.names = common(a.names, b.names).length ? common(a.names, b.names) : a.names;
  a.length += b.length;
  a.lines.push(...b.lines);
}

// Group the edges of a route into legs: [{ names, named, length, lines }].
// A leg continues while the street names overlap, for example from
// "Kennel Way / Naga Way" to "Naga Way".
function makeLegs(graph, edges) {
  const legs = [];
  let lastBearing = null;
  for (const edge of edges) {
    const line = edgePoints(graph, edge);
    const leg = { ...streetOf(edge), length: edge.length, lines: [line] };
    const last = legs[legs.length - 1];
    const sharp = lastBearing !== null && Math.abs(turnAngle(lastBearing, bearingOut(line))) > UNNAMED_TURN_DEG;
    if (last && common(last.names, leg.names).length && (leg.named || !sharp)) {
      join(last, leg);
    } else {
      legs.push(leg);
    }
    lastBearing = bearingIn(line);
  }

  // Join each short leg to the leg before it. The first leg joins the leg after it.
  for (let i = legs.length - 1; i >= 0 && legs.length > 1; i -= 1) {
    if (legs[i].length >= MIN_LEG_M) {
      continue;
    }
    if (i > 0) {
      join(legs[i - 1], legs[i]);
      legs.splice(i, 1);
    } else {
      join(legs[0], legs[1]);
      legs[0].names = legs[1].names; // the short first leg takes the street of the leg after it
      legs[0].named = legs[1].named;
      legs.splice(1, 1);
    }
  }

  // Two legs on the same street can touch after the join. Make them one leg.
  for (let i = legs.length - 1; i > 0; i -= 1) {
    if (legs[i].named && legs[i - 1].named && common(legs[i - 1].names, legs[i].names).length) {
      join(legs[i - 1], legs[i]);
      legs.splice(i, 1);
    }
  }
  return legs;
}

// Make the steps for a route. destination is the name of the end, for example "Geisel Library".
//
// Returns [{ text, length, point }]:
//   text    the instruction, for example "Turn left onto Gilman Drive"
//   length  the distance in meters to the next step (0 for the last step)
//   point   [lat, lon] where the step starts
export function makeDirections(graph, route, destination = 'your destination') {
  const legs = makeLegs(graph, route.edges);
  const steps = legs.map((leg, i) => {
    const street = leg.names.join(' / ');
    const firstLine = leg.lines[0];
    const point = firstLine[0];
    if (i === 0) {
      const heading = COMPASS[Math.round(bearingOut(firstLine) / 45) % 8];
      return { text: `Head ${heading} on ${street}`, length: leg.length, point };
    }
    const previous = legs[i - 1].lines;
    const angle = turnAngle(bearingIn(previous[previous.length - 1]), bearingOut(firstLine));
    return { text: `${turnWords(angle)} onto ${street}`, length: leg.length, point };
  });
  steps.push({ text: `Arrive at ${destination}`, length: 0, point: route.points[route.points.length - 1] });
  return steps;
}

// US units, the same as the route summary. Under 0.1 mi, the distance is in feet.
export function formatStepDistance(meters, { spoken = false } = {}) {
  const feet = meters * 3.28084;
  if (feet < 528) {
    const rounded = Math.max(50, Math.round(feet / 50) * 50);
    return spoken ? `${rounded} feet` : `${rounded} ft`;
  }
  const miles = (meters / 1609.344).toFixed(1);
  return spoken ? `${miles} ${miles === '1.0' ? 'mile' : 'miles'}` : `${miles} mi`;
}

// One step as a sentence to speak, for example "Turn left onto Gilman Drive, then go 0.3 miles."
export function spokenStep(step) {
  return step.length > 0 ? `${step.text}, then go ${formatStepDistance(step.length, { spoken: true })}.` : `${step.text}.`;
}
