// Leaflet map setup. Leaflet loads as the global `L` from index.html.

// Bounding box of the study area: UC San Diego, University City and La Jolla Shores,
// from Torrey Pines south to Rose Canyon and from the coast east to I-805.
// [[south, west], [north, east]]
export const STUDY_AREA = [
  [32.847, -117.258],
  [32.895, -117.180],
];

// The same colors as --lts1 to --lts4 in css/style.css.
const LTS_COLOR = {
  1: '#2166ac',
  2: '#67a9cf',
  3: '#ef8a62',
  4: '#b2182b',
};

// panel: an element over the map, for example the route panel. The first view
// keeps the study area out from under it.
export function createMap(elementId, panel = null) {
  // zoomSnap 0.5 lets the first view fit the study area more closely.
  const map = L.map(elementId, { zoomSnap: 0.5 });

  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);

  L.rectangle(STUDY_AREA, {
    color: '#182b49',
    weight: 2,
    dashArray: '6 6',
    fill: false,
    interactive: false,
  }).addTo(map);

  fitWithPanel(map, STUDY_AREA, panel);
  return map;
}

// Fit the map to bounds, for example a route, and keep them out from under the panel.
export function fitWithPanel(map, bounds, panel, options = {}) {
  map.fitBounds(bounds, { ...panelPadding(map, panel), ...options });
}

function panelPadding(map, panel) {
  if (!panel) {
    return {};
  }
  const mapBox = map.getContainer().getBoundingClientRect();
  const box = panel.getBoundingClientRect();
  const gap = 12;
  // A panel at the bottom of the map (phone layout) takes height. Else it takes width at the right.
  if (box.width > mapBox.width / 2) {
    return { paddingTopLeft: [gap, gap], paddingBottomRight: [gap, mapBox.bottom - box.top + gap] };
  }
  return { paddingTopLeft: [gap, gap], paddingBottomRight: [mapBox.right - box.left + gap, gap] };
}

// A draggable marker with a letter, for the start (A) or the end (B).
export function createPin(latlng, kind) {
  const icon = L.divIcon({
    className: '',
    html: `<div class="pin ${kind}">${kind === 'start' ? 'A' : 'B'}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
  return L.marker(latlng, {
    icon,
    draggable: true,
    keyboard: true,
    title: kind === 'start' ? 'Start' : 'End',
  });
}

// Draw a route from js/routing.js. Each edge gets the color of its LTS level.
// A white line under the colors keeps the route clear on the map tiles.
export function drawRoute(map, route) {
  const layer = L.layerGroup();
  L.polyline(route.points, { color: '#ffffff', weight: 9, opacity: 0.9, interactive: false }).addTo(layer);

  for (const segment of route.segments) {
    L.polyline(segment.points, {
      color: LTS_COLOR[segment.lts],
      weight: 5,
      opacity: 1,
      interactive: false,
    }).addTo(layer);
  }
  return layer.addTo(map);
}
