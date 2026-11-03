// Entry point. Connects the map, routing, voice and reports parts.
import { createMap, createPin, drawRoute } from './map.js';
import { distance, findRoute, loadGraph, nearestNode } from './routing.js';

// A click that is farther than this from the nearest street is outside the map data.
const MAX_SNAP_M = 300;

const map = createMap('map', document.querySelector('.panel'));

const ui = {
  status: document.getElementById('status'),
  mode: document.getElementById('mode'),
  safety: document.getElementById('safety'),
  summary: document.getElementById('summary'),
  distance: document.getElementById('distance'),
  time: document.getElementById('time'),
  lowStress: document.getElementById('low-stress'),
  clear: document.getElementById('clear'),
};

const state = {
  graph: null,
  start: null, // Leaflet marker
  end: null, // Leaflet marker
  routeLayer: null,
};

function setStatus(text, isError = false) {
  ui.status.textContent = text;
  ui.status.classList.toggle('error', isError);
}

function formatDistance(m) {
  return `${(m / 1609.344).toFixed(1)} mi`;
}

function formatTime(s) {
  const minutes = Math.max(1, Math.round(s / 60));
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

function clearRoute() {
  if (state.routeLayer) {
    state.routeLayer.remove();
    state.routeLayer = null;
  }
  ui.summary.hidden = true;
}

function clearAll() {
  clearRoute();
  state.start?.remove();
  state.end?.remove();
  state.start = null;
  state.end = null;
  ui.clear.disabled = true;
  setStatus('Click the map to set the start.');
}

// Find the street node for a marker. Returns null if the marker is too far from all streets.
function snap(marker) {
  const { lat, lng } = marker.getLatLng();
  const node = nearestNode(state.graph, lat, lng);
  return distance(lat, lng, node.lat, node.lon) <= MAX_SNAP_M ? node : null;
}

function updateRoute() {
  clearRoute();
  if (!state.start || !state.end) {
    return;
  }

  const from = snap(state.start);
  const to = snap(state.end);
  if (!from || !to) {
    setStatus('A point is outside the map data. Move it inside the dashed box.', true);
    return;
  }
  if (from.id === to.id) {
    setStatus('The start and the end are at the same place. Move one of them.', true);
    return;
  }

  const route = findRoute(state.graph, from.id, to.id, {
    w: Number(ui.safety.value),
    mode: ui.mode.value,
  });
  if (!route) {
    setStatus('No route found between these points.', true);
    return;
  }

  state.routeLayer = drawRoute(map, route);
  const lowStress = route.lengthByLts[1] + route.lengthByLts[2];
  ui.distance.textContent = formatDistance(route.length);
  ui.time.textContent = formatTime(route.time);
  ui.lowStress.textContent = `${Math.round((100 * lowStress) / route.length)}%`;
  ui.summary.hidden = false;
  setStatus('Drag A or B to change the route.');
}

function addPin(latlng, kind) {
  const pin = createPin(latlng, kind).addTo(map);
  pin.on('dragend', updateRoute);
  return pin;
}

function onMapClick(event) {
  if (!state.graph) {
    return;
  }
  if (!state.start) {
    state.start = addPin(event.latlng, 'start');
    ui.clear.disabled = false;
    setStatus('Click the map to set the end.');
  } else if (!state.end) {
    state.end = addPin(event.latlng, 'end');
    updateRoute();
  } else {
    // A third click starts a new route from the click.
    clearAll();
    onMapClick(event);
  }
}

map.on('click', onMapClick);
ui.mode.addEventListener('change', updateRoute);
ui.safety.addEventListener('input', updateRoute);
ui.clear.addEventListener('click', clearAll);

try {
  state.graph = await loadGraph();
  setStatus('Click the map to set the start.');
} catch (error) {
  console.error(error);
  setStatus('The street map did not load. Refresh the page to try again.', true);
}

// Expose the map and the state for debugging in the browser console.
window.microMap = { map, state };
