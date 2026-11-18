// Traffic zones: paths that are crowded in the 10 minutes between classes.
//
// tools/draw-traffic.html paints the zones and saves them as
// data/traffic-zones.json, a GeoJSON FeatureCollection. Each Feature has the
// brush strokes (MultiLineString) and the properties level, multiplier and
// brush_m. The app finds the street segments under the strokes when it loads,
// so the zones stay correct after a new graph build.
//
// This file has no browser code except loadTrafficZones(), so Node can test it.

export const MULTIPLIERS = { high: 2, medium: 1.5 };

// The class change windows, as [start, end] in minutes after midnight.
// Mon/Wed/Fri classes are 50 minutes: 8:00-8:50, 9:00-9:50, ... 7:00-7:50 PM.
// Tue/Thu classes are 80 minutes: 8:00-9:20, 9:30-10:50, ... 6:30-7:50 PM.
function windows(firstStart, step, lastStart) {
  const list = [];
  for (let start = firstStart; start <= lastStart; start += step) {
    list.push([start, start + 10]);
  }
  return list;
}

const MWF = windows(8 * 60 + 50, 60, 19 * 60 + 50); // 8:50-9:00 ... 7:50-8:00 PM
const TUTH = windows(9 * 60 + 20, 90, 19 * 60 + 50); // 9:20-9:30 ... 7:50-8:00 PM
// Index = Date.getDay(): 0 is Sunday. No classes on the weekend.
export const CLASS_CHANGES = [[], MWF, TUTH, MWF, TUTH, MWF, []];

// The class change window at a time, as [start, end] in minutes, or null.
export function classChangeAt(date) {
  const minute = date.getHours() * 60 + date.getMinutes();
  return CLASS_CHANGES[date.getDay()].find(([start, end]) => minute >= start && minute < end) ?? null;
}

// The next class change window after a time on the same day, or null.
export function nextClassChange(date) {
  const minute = date.getHours() * 60 + date.getMinutes();
  return CLASS_CHANGES[date.getDay()].find(([start]) => start > minute) ?? null;
}

export function formatMinute(minute) {
  const h = Math.floor(minute / 60);
  const m = String(minute % 60).padStart(2, '0');
  return `${((h + 11) % 12) + 1}:${m} ${h < 12 ? 'AM' : 'PM'}`;
}

// Match the strokes to the street segments.

const SAMPLE_M = 5;
// A segment joins a zone when the paint covers half of it, or a length of at
// least the brush width. A cross street that the brush only touches at its
// end has less paint than the brush width on it, so it stays out.
const MIN_SHARE = 0.5;

// A flat projection in meters around lat0. Good enough for a few km.
function projector(lat0) {
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const ky = 110574;
  return ([lat, lon]) => [lon * kx, lat * ky];
}

function pointSegmentDistance([px, py], [x1, y1], [x2, y2]) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

export function distanceToLine(point, xy) {
  if (xy.length === 1) {
    return Math.hypot(point[0] - xy[0][0], point[1] - xy[0][1]);
  }
  let best = Infinity;
  for (let i = 0; i < xy.length - 1; i += 1) {
    best = Math.min(best, pointSegmentDistance(point, xy[i], xy[i + 1]));
  }
  return best;
}

function bounds(xy, pad = 0) {
  const xs = xy.map((p) => p[0]);
  const ys = xy.map((p) => p[1]);
  return [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad];
}

const overlap = (a, b) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];

// Make the street segments ready to match: sample points every SAMPLE_M along
// each line, and a box for a fast first test.
// items: [{ id, line: [[lat, lon], ...] }]
export function prepareEdges(items, lat0) {
  const toXY = projector(lat0);
  return {
    toXY,
    edges: items.map(({ id, line }) => {
      const xy = line.map(toXY);
      const samples = [];
      for (let i = 0; i < xy.length - 1; i += 1) {
        const [[x1, y1], [x2, y2]] = [xy[i], xy[i + 1]];
        const n = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / SAMPLE_M));
        for (let k = 0; k < n; k += 1) {
          samples.push([x1 + ((x2 - x1) * k) / n, y1 + ((y2 - y1) * k) / n]);
        }
      }
      samples.push(xy[xy.length - 1]);
      let length = 0;
      for (let i = 0; i < xy.length - 1; i += 1) {
        length += Math.hypot(xy[i + 1][0] - xy[i][0], xy[i + 1][1] - xy[i][1]);
      }
      return { id, line, samples, length, box: bounds(xy) };
    }),
  };
}

// Returns a Map of edge id → share: the part of the edge (0-1) under the paint.
// strokes: [[[lat, lon], ...], ...]   brush: the brush width in meters
export function matchStrokes(prepared, strokes, brush) {
  const radius = brush / 2;
  const lines = strokes.filter((s) => s.length > 0).map((stroke) => {
    const xy = stroke.map(prepared.toXY);
    return { xy, box: bounds(xy, radius) };
  });
  const shares = new Map();
  for (const edge of prepared.edges) {
    const near = lines.filter(({ box }) => overlap(edge.box, box));
    if (near.length === 0) {
      continue;
    }
    const covered = edge.samples.filter((p) => near.some(({ xy }) => distanceToLine(p, xy) <= radius)).length;
    const share = covered / edge.samples.length;
    if (share >= MIN_SHARE || share * edge.length >= brush) {
      shares.set(edge.id, share);
    }
  }
  return shares;
}

// Zones from data/traffic-zones.json, matched to a graph from js/routing.js.
// Returns [{ zone, name, level, multiplier, shares: Map(edge id → share) }].
export function buildZones(collection, graph) {
  const items = [];
  for (const node of graph.nodes.values()) {
    for (const edge of node.out) {
      const line = edge.geometry ?? [[node.lat, node.lon], [graph.nodes.get(edge.to).lat, graph.nodes.get(edge.to).lon]];
      items.push({ id: edge.id, line });
    }
  }
  const { south, north } = graph.meta.bbox;
  const prepared = prepareEdges(items, (south + north) / 2);
  return collection.features.map((feature) => {
    const p = feature.properties;
    const level = p.level === 'medium' ? 'medium' : 'high';
    const strokes = feature.geometry.coordinates.map((s) => s.map(([lon, lat]) => [lat, lon]));
    return {
      zone: p.zone,
      name: p.name ?? '',
      level,
      multiplier: Math.max(1, p.multiplier ?? MULTIPLIERS[level]),
      shares: matchStrokes(prepared, strokes, p.brush_m ?? 20),
    };
  });
}

// The traffic function for findRoute() in js/routing.js. Only the painted part
// of a segment is slow: a segment with share s gets 1 + (multiplier - 1) × s.
// Outside a class change, every segment gets 1. No value is less than 1, so
// the A* heuristic stays admissible.
export function trafficAt(zones, date) {
  if (!classChangeAt(date) || zones.length === 0) {
    return () => 1;
  }
  const factor = new Map();
  for (const { multiplier, shares } of zones) {
    for (const [id, share] of shares) {
      factor.set(id, Math.max(factor.get(id) ?? 1, 1 + (multiplier - 1) * share));
    }
  }
  return (edge) => factor.get(edge.id) ?? 1;
}

// The crowd level of an edge at a time: 'high', 'medium' or null. Outside a
// class change, every edge gets null. A high zone wins over a medium zone.
export function crowdLevelAt(zones, date) {
  if (!classChangeAt(date)) {
    return () => null;
  }
  const levels = new Map();
  for (const { level, shares } of zones) {
    for (const id of shares.keys()) {
      if (levels.get(id) !== 'high') {
        levels.set(id, level);
      }
    }
  }
  return (edge) => levels.get(edge.id) ?? null;
}

export async function loadTrafficZones(graph, url = 'data/traffic-zones.json') {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Cannot load ${url}: HTTP ${response.status}`);
  }
  return buildZones(await response.json(), graph);
}
