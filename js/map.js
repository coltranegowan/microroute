// Leaflet map setup. Leaflet loads as the global `L` from index.html.

// The same colors as --lts1 to --lts4 in css/style.css.
const LTS_COLOR = {
  1: '#2166ac',
  2: '#67a9cf',
  3: '#ef8a62',
  4: '#b2182b',
};

// area: the outline of the usable area, [[lat, lon], ...], from js/area.js.
// panel: an element over the map, for example the route panel. The first view
// keeps the area out from under it.
export function createMap(elementId, area, panel = null) {
  // zoomSnap 0.5 lets the first view fit the area more closely.
  const map = L.map(elementId, { zoomSnap: 0.5 });

  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);

  addAreaMask(map, area);
  fitWithPanel(map, L.latLngBounds(area), panel);

  // A loose limit: the map stops a short distance outside the first view, and
  // it zooms out one level past it. The limit must be larger than the view.
  // Else Leaflet centers the view in the limit and moves the area under the panel.
  map.setMaxBounds(map.getBounds().pad(0.2));
  map.options.maxBoundsViscosity = 1;
  map.setMinZoom(map.getZoom() - 1);
  return map;
}

// Cover all of the map outside the area with gray. The mask is a polygon with
// a hole: the outer ring goes around the world, and the area is the hole.
function addAreaMask(map, area) {
  const world = [[-89, -360], [89, -360], [89, 360], [-89, 360]];
  L.polygon([world, area], {
    stroke: false,
    fillColor: '#c9cdd2',
    fillOpacity: 1,
    interactive: false,
  }).addTo(map);
  L.polygon(area, {
    color: '#182b49',
    weight: 2,
    fill: false,
    interactive: false,
  }).addTo(map);
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
