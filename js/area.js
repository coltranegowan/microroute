// The usable area of the map. tools/draw-area.html draws it and saves it as
// data/area.json, a GeoJSON Feature with one Polygon. The build scripts use the
// same file, so the street graph and the places stay inside the area.
//
// This file has no browser code except loadArea(), so Node can test it.

// The box that the app uses when data/area.json is missing. [[south, west], [north, east]]
export const FALLBACK_BOX = [
  [32.847, -117.258],
  [32.895, -117.180],
];

// Returns the outline of the area as [[lat, lon], ...], with no repeated last point.
export async function loadArea(url = 'data/area.json') {
  try {
    const response = await fetch(url);
    if (response.ok) {
      return ringFromGeoJSON(await response.json());
    }
  } catch (error) {
    console.warn(`Cannot load ${url}. The app uses the fallback box.`, error);
  }
  const [[s, w], [n, e]] = FALLBACK_BOX;
  return [[s, w], [n, w], [n, e], [s, e]];
}

export function ringFromGeoJSON(feature) {
  const geometry = feature.type === 'Feature' ? feature.geometry : feature;
  if (geometry?.type !== 'Polygon') {
    throw new Error('The area must be a GeoJSON Polygon');
  }
  const ring = geometry.coordinates[0].map(([lon, lat]) => [lat, lon]);
  const [first, last] = [ring[0], ring[ring.length - 1]];
  if (first[0] === last[0] && first[1] === last[1]) {
    ring.pop();
  }
  return ring;
}

export function ringToGeoJSON(ring) {
  const coordinates = ring.map(([lat, lon]) => [round(lon), round(lat)]);
  coordinates.push(coordinates[0]); // GeoJSON closes the ring with the first point
  return {
    type: 'Feature',
    properties: { name: 'UCSD MicroMap area' },
    geometry: { type: 'Polygon', coordinates: [coordinates] },
  };
}

const round = (value) => Math.round(value * 1e6) / 1e6;

// Ray casting: true if the point is inside the ring.
export function insideArea(ring, lat, lon) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [latI, lonI] = ring[i];
    const [latJ, lonJ] = ring[j];
    if ((latI > lat) !== (latJ > lat)
      && lon < ((lonJ - lonI) * (lat - latI)) / (latJ - latI) + lonI) {
      inside = !inside;
    }
  }
  return inside;
}
