// Entry point. Connects the map, routing, search, voice and reports parts.
import { createMap, createPin, drawRoute, fitWithPanel } from './map.js';
import { distance, findRoute, loadGraph, nearestNode } from './routing.js';
import { attachAutocomplete, loadPlaces } from './search.js';

// A point that is farther than this from the nearest street is outside the map data.
const MAX_SNAP_M = 300;
const MAP_POINT = 'Point on the map';

const panel = document.querySelector('.panel');
const map = createMap('map', panel);

const ui = {
  status: document.getElementById('status'),
  from: document.getElementById('from'),
  fromList: document.getElementById('from-list'),
  to: document.getElementById('to'),
  toList: document.getElementById('to-list'),
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
  places: null,
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
  ui.from.value = '';
  ui.to.value = '';
  ui.clear.disabled = true;
  setStatus('Search for a place, or click the map to set the start.');
}

// Find the street node for a marker. Returns null if the marker is too far from all streets.
function snap(marker) {
  const { lat, lng } = marker.getLatLng();
  const node = nearestNode(state.graph, lat, lng);
  return distance(lat, lng, node.lat, node.lon) <= MAX_SNAP_M ? node : null;
}

// fit: true moves the map to show the route, after a search.
function updateRoute({ fit = false } = {}) {
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
  // Fit after the summary shows, because the summary changes the panel height.
  if (fit) {
    fitWithPanel(map, L.latLngBounds(route.points), panel, { maxZoom: 17 });
  }
}

// Put pin A (kind 'start') or pin B (kind 'end') at a point. A pin that is already there moves.
function setPin(kind, latlng, title) {
  const key = kind === 'start' ? 'start' : 'end';
  const input = kind === 'start' ? ui.from : ui.to;
  if (state[key]) {
    state[key].setLatLng(latlng);
  } else {
    state[key] = createPin(latlng, kind).addTo(map);
    state[key].on('dragend', () => {
      input.value = MAP_POINT;
      updateRoute();
    });
  }
  state[key].options.title = title;
  input.value = title;
  ui.clear.disabled = false;
}

function onMapClick(event) {
  if (!state.graph) {
    return;
  }
  if (!state.start) {
    setPin('start', event.latlng, MAP_POINT);
    setStatus(state.end ? 'Finding the route…' : 'Search for the end, or click the map.');
    updateRoute();
  } else if (!state.end) {
    setPin('end', event.latlng, MAP_POINT);
    updateRoute();
  } else {
    // A third click starts a new route from the click.
    clearAll();
    onMapClick(event);
  }
}

function onPick(kind) {
  return (result) => {
    const { place } = result;
    setPin(kind, [place.lat, place.lon], ui[kind === 'start' ? 'from' : 'to'].value);
    if (state.start && state.end) {
      updateRoute({ fit: true });
    } else {
      // No animation: Leaflet ignores a new view while a zoom animation runs,
      // so a fast second pick would not fit the route.
      map.setView([place.lat, place.lon], Math.max(map.getZoom(), 16), { animate: false });
      setStatus(kind === 'start' ? 'Now search for the end, or click the map.' : 'Now search for the start, or click the map.');
      (kind === 'start' ? ui.to : ui.from).focus();
    }
  };
}

map.on('click', onMapClick);
ui.mode.addEventListener('change', () => updateRoute());
ui.safety.addEventListener('input', () => updateRoute());
ui.clear.addEventListener('click', clearAll);
attachAutocomplete(ui.from, ui.fromList, () => state.places, onPick('start'));
attachAutocomplete(ui.to, ui.toList, () => state.places, onPick('end'));

try {
  [state.graph, state.places] = await Promise.all([loadGraph(), loadPlaces()]);
  setStatus('Search for a place, or click the map to set the start.');
} catch (error) {
  console.error(error);
  setStatus('The street map did not load. Refresh the page to try again.', true);
}

// Expose the map and the state for debugging in the browser console.
window.microMap = { map, state };
