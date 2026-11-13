// A* route search on data/graph.json.
//
// cost = time × traffic × (1 + w × stress)
//
// time is the travel time in seconds, stress is the LTS level (1-4) and w is
// the safety weight. When w = 0, the route is the fastest route. traffic is 1
// for now. The traffic zones from data/traffic.json come in Week 7.
//
// This file has no browser code except loadGraph(), so Node can test it.

// Travel speed in m/s for each mode. These are first estimates. Week 7 adds
// the slope penalty and checks these values.
export const MODE_SPEED = {
  bike: 16 / 3.6, // 16 km/h
  ebike: 24 / 3.6, // 24 km/h
  scooter: 20 / 3.6, // 20 km/h
};

const EARTH_RADIUS_M = 6371009; // the same radius that osmnx uses for `length`

export async function loadGraph(url = 'data/graph.json') {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Cannot load ${url}: HTTP ${response.status}`);
  }
  return buildGraph(await response.json());
}

// Make the adjacency lists from the JSON that scripts/build_graph.py writes.
export function buildGraph(data) {
  const nodes = new Map();
  for (const [id, [lat, lon]] of Object.entries(data.nodes)) {
    nodes.set(id, { id, lat, lon, out: [] });
  }
  for (const edge of data.edges) {
    nodes.get(edge.from).out.push(edge);
  }
  return { meta: data.meta, nodes };
}

// Great-circle distance in meters. It is never more than the `length` of an
// edge between the same two points, so the A* heuristic stays admissible.
export function distance(lat1, lon1, lat2, lon2) {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

// Find the graph node that is nearest to a point, for example a map click.
export function nearestNode(graph, lat, lon) {
  let best = null;
  let bestDistance = Infinity;
  for (const node of graph.nodes.values()) {
    const d = distance(lat, lon, node.lat, node.lon);
    if (d < bestDistance) {
      best = node;
      bestDistance = d;
    }
  }
  return best;
}

// Find the route with the lowest cost from startId to goalId.
//
// options:
//   w        safety weight, 0 or more (0 = fastest)
//   mode     a key of MODE_SPEED
//   traffic  function(edge) that gives a multiplier of 1 or more
//   useHeuristic  false gives Dijkstra, for tests
//
// Returns null if no route exists.
export function findRoute(graph, startId, goalId, options = {}) {
  const {
    w = 0,
    mode = 'bike',
    traffic = () => 1,
    useHeuristic = true,
  } = options;
  const speed = MODE_SPEED[mode];
  if (!speed) {
    throw new Error(`Unknown mode: ${mode}`);
  }
  if (w < 0) {
    throw new Error('The safety weight w must be 0 or more');
  }

  const goal = graph.nodes.get(goalId);
  if (!graph.nodes.has(startId) || !goal) {
    throw new Error('The start node or the goal node is not in the graph');
  }

  // The lowest multiplier is (1 + w): LTS is 1 or more and traffic is 1 or more.
  // Thus this heuristic is never more than the true remaining cost.
  const minFactor = useHeuristic ? (1 + w) / speed : 0;
  const heuristic = (node) => minFactor * distance(node.lat, node.lon, goal.lat, goal.lon);

  const edgeCost = (edge) => (edge.length / speed) * traffic(edge) * (1 + w * edge.lts);

  const bestCost = new Map([[startId, 0]]);
  const cameBy = new Map(); // node id → the edge that reached it
  const closed = new Set();
  const open = new MinHeap();
  open.push(heuristic(graph.nodes.get(startId)), startId);

  while (open.size > 0) {
    const id = open.pop();
    if (closed.has(id)) {
      continue; // an old entry for a node that was already done
    }
    if (id === goalId) {
      return makeRoute(graph, cameBy, startId, goalId, bestCost.get(goalId), speed);
    }
    closed.add(id);

    for (const edge of graph.nodes.get(id).out) {
      if (closed.has(edge.to)) {
        continue;
      }
      const cost = bestCost.get(id) + edgeCost(edge);
      if (cost < (bestCost.get(edge.to) ?? Infinity)) {
        bestCost.set(edge.to, cost);
        cameBy.set(edge.to, edge);
        open.push(cost + heuristic(graph.nodes.get(edge.to)), edge.to);
      }
    }
  }
  return null;
}

function makeRoute(graph, cameBy, startId, goalId, cost, speed) {
  const edges = [];
  for (let id = goalId; id !== startId; id = cameBy.get(id).from) {
    edges.push(cameBy.get(id));
  }
  edges.reverse();

  const lengthByLts = { 1: 0, 2: 0, 3: 0, 4: 0 };
  const points = [];
  const segments = [];
  for (const edge of edges) {
    lengthByLts[edge.lts] += edge.length;
    const line = edgePoints(graph, edge);
    // The first point of each edge is the last point of the edge before it.
    points.push(...(points.length ? line.slice(1) : line));

    const bike = edge.bike ?? 'none';
    const last = segments[segments.length - 1];
    if (last && last.bike === bike) {
      last.points.push(...line.slice(1));
    } else {
      segments.push({ bike, points: [...line] });
    }
  }
  const length = edges.reduce((sum, edge) => sum + edge.length, 0);

  return {
    edges,
    points, // [[lat, lon], ...] for a Leaflet polyline
    segments, // [{ bike, points }, ...]: runs of edges with the same bike facility type
    length, // m
    time: length / speed, // s, with no traffic or slope
    cost,
    lengthByLts,
  };
}

// The points of an edge, in the direction from `from` to `to`.
export function edgePoints(graph, edge) {
  const from = graph.nodes.get(edge.from);
  const to = graph.nodes.get(edge.to);
  if (!edge.geometry) {
    return [[from.lat, from.lon], [to.lat, to.lon]];
  }
  const [lat, lon] = edge.geometry[0];
  const reversed = distance(lat, lon, to.lat, to.lon) < distance(lat, lon, from.lat, from.lon);
  return reversed ? [...edge.geometry].reverse() : edge.geometry;
}

// Binary heap of [priority, value], with the lowest priority on top.
class MinHeap {
  constructor() {
    this.items = [];
  }

  get size() {
    return this.items.length;
  }

  push(priority, value) {
    const items = this.items;
    items.push([priority, value]);
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (items[parent][0] <= items[i][0]) {
        break;
      }
      [items[parent], items[i]] = [items[i], items[parent]];
      i = parent;
    }
  }

  pop() {
    const items = this.items;
    const top = items[0];
    const last = items.pop();
    if (items.length > 0) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const left = 2 * i + 1;
        const right = left + 1;
        let smallest = i;
        if (left < items.length && items[left][0] < items[smallest][0]) smallest = left;
        if (right < items.length && items[right][0] < items[smallest][0]) smallest = right;
        if (smallest === i) break;
        [items[smallest], items[i]] = [items[i], items[smallest]];
        i = smallest;
      }
    }
    return top[1];
  }
}
