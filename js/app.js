// Entry point. Connects the map, routing, search, voice and reports parts.
import { insideArea, loadArea } from './area.js';
import { formatStepDistance, makeDirections, spokenStep } from './directions.js';
import {
  createMap, createPin, createRackLayer, createStepMarker, drawRoute, fillRackLegend, fitWithPanel,
} from './map.js';
import { distance, findRoute, loadGraph, nearestNode } from './routing.js';
import { attachAutocomplete, loadPlaces } from './search.js';
import { canSpeak, speak, stopSpeaking } from './voice.js';

// A point that is farther than this from the nearest street is outside the map data.
const MAX_SNAP_M = 300;
const MAP_POINT = 'Point on the map';
const OUTSIDE = 'That point is outside the map area. Pick a point that is not gray.';
const COLORBLIND_KEY = 'microroute.colorblind';
const RACKS_KEY = 'microroute.racks';
// The panel shows the nearest rack to B only if it is closer than this.
const MAX_RACK_M = 400;

const panel = document.querySelector('.panel');
const area = await loadArea();
const map = createMap('map', area, panel);

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
  directions: document.getElementById('directions'),
  speak: document.getElementById('speak'),
  stepCount: document.getElementById('step-count'),
  steps: document.getElementById('steps'),
  colorblind: document.getElementById('colorblind'),
  nearestRack: document.getElementById('nearest-rack'),
  showRacks: document.getElementById('show-racks'),
  clear: document.getElementById('clear'),
};

const state = {
  graph: null,
  places: null,
  start: null, // Leaflet marker
  end: null, // Leaflet marker
  endName: null, // the name of the place at pin B, from the search
  route: null,
  routeLayer: null,
  steps: [], // from js/directions.js
  stepMarker: null,
  speaking: false,
  racks: null, // from createRackLayer() in js/map.js
  nearestRack: null, // { marker, meters }: the rack nearest to pin B
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
  state.route = null;
  ui.summary.hidden = true;
  state.nearestRack = null;
  ui.nearestRack.hidden = true;
  state.racks?.focus(null);
  clearDirections();
}

// Directions

function clearDirections() {
  stopReading();
  state.steps = [];
  state.stepMarker?.remove();
  state.stepMarker = null;
  ui.steps.replaceChildren();
  ui.directions.hidden = true;
}

function showDirections(route) {
  state.steps = makeDirections(state.graph, route, state.endName ?? 'point B');
  ui.steps.replaceChildren(...state.steps.map((step, i) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'step';
    const text = document.createElement('span');
    text.textContent = step.text;
    button.append(text);
    if (step.length > 0) {
      const length = document.createElement('span');
      length.className = 'step-length';
      length.textContent = formatStepDistance(step.length);
      button.append(length);
    }
    button.addEventListener('click', () => showStep(i));
    const item = document.createElement('li');
    item.append(button);
    return item;
  }));
  ui.stepCount.textContent = state.steps.length;
  ui.directions.hidden = false;
}

// Mark the point of step i on the map, and zoom to it. The panel does not cover the point.
function showStep(i) {
  const { point } = state.steps[i];
  if (state.stepMarker) {
    state.stepMarker.setLatLng(point);
  } else {
    state.stepMarker = createStepMarker(point).addTo(map);
  }
  fitWithPanel(map, L.latLngBounds([point, point]), panel, { maxZoom: Math.max(map.getZoom(), 17) });
}

// Show which step the app reads now. i = -1 removes the mark.
function markStep(i) {
  ui.steps.querySelectorAll('li').forEach((item, j) => {
    item.classList.toggle('current', j === i);
    if (j === i) {
      item.scrollIntoView({ block: 'nearest' });
    }
  });
}

function setReading(on) {
  state.speaking = on;
  ui.speak.textContent = on ? 'Stop reading' : 'Read directions aloud';
  ui.speak.setAttribute('aria-pressed', String(on));
}

function startReading() {
  setReading(true);
  const sentences = state.steps.map(spokenStep);
  if (state.nearestRack) {
    sentences.push(`${rackSentence(state.nearestRack, { spoken: true })}.`);
  }
  speak(sentences, (i) => {
    markStep(i);
    if (i < 0) {
      setReading(false);
    } else if (i < state.steps.length) {
      showStep(i);
    }
  });
}

function stopReading() {
  if (state.speaking) {
    stopSpeaking();
    setReading(false);
    markStep(-1);
  }
}

// Settings that the browser keeps for the next visit

function loadSetting(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value === 'on';
  } catch {
    return fallback;
  }
}

function saveSetting(key, on) {
  try {
    localStorage.setItem(key, on ? 'on' : 'off');
  } catch {
    // The setting then lasts only until the page closes.
  }
}

// Bike racks

async function loadRacks(url = 'data/racks.json') {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Cannot load ${url}: HTTP ${response.status}`);
  }
  return response.json();
}

function updateRacks() {
  state.racks?.show(ui.showRacks.checked);
}

// The rack nearest to a point: { marker, meters }, or null if no rack is near.
function findNearestRack(latlng) {
  let best = null;
  for (const marker of state.racks?.markers ?? []) {
    const { lat, lon } = marker.rack;
    const meters = distance(latlng.lat, latlng.lng, lat, lon);
    if (meters <= MAX_RACK_M && (!best || meters < best.meters)) {
      best = { marker, meters };
    }
  }
  return best;
}

function rackSentence({ marker, meters }, { spoken = false } = {}) {
  const kind = marker.rack.kind === 'enclosure' ? 'locked bike enclosure' : 'bike rack';
  const near = marker.rack.near ? `, near ${marker.rack.near}` : '';
  return `The nearest ${kind} to B is ${formatStepDistance(meters, { spoken })} away${near}`;
}

// Make the racks near B big, and name the nearest one in the panel.
function showNearestRack() {
  const end = state.end.getLatLng();
  state.nearestRack = findNearestRack(end);
  state.racks?.focus(end, state.nearestRack?.marker);
  if (state.nearestRack) {
    ui.nearestRack.textContent = `${rackSentence(state.nearestRack)}. Show it on the map.`;
  }
  ui.nearestRack.hidden = !state.nearestRack;
}

// Zoom to the nearest rack and open its popup. This turns the racks on.
function goToNearestRack() {
  const { marker } = state.nearestRack;
  ui.showRacks.checked = true;
  saveSetting(RACKS_KEY, true);
  updateRacks();
  const bounds = L.latLngBounds([marker.getLatLng(), state.end.getLatLng()]);
  fitWithPanel(map, bounds, panel, { maxZoom: 18 });
  state.racks.reveal(marker, () => marker.openPopup());
}

// Colorblind mode

function setColorblind(on) {
  document.body.classList.toggle('colorblind', on);
  ui.colorblind.checked = on;
  saveSetting(COLORBLIND_KEY, on);
  if (state.route) {
    state.routeLayer.remove();
    state.routeLayer = drawRoute(map, state.route, { colorblind: on });
  }
}

function clearAll() {
  clearRoute();
  state.start?.remove();
  state.end?.remove();
  state.start = null;
  state.end = null;
  state.endName = null;
  ui.from.value = '';
  ui.to.value = '';
  ui.clear.disabled = true;
  setStatus('Search for a place, or click the map to set the start.');
}

// Find the street node for a marker. Returns null if the marker is too far from all streets.
function snap(marker) {
  const { lat, lng } = marker.getLatLng();
  if (!insideArea(area, lat, lng)) {
    return null;
  }
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
    setStatus(OUTSIDE, true);
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

  state.route = route;
  state.routeLayer = drawRoute(map, route, { colorblind: ui.colorblind.checked });
  const lowStress = route.lengthByLts[1] + route.lengthByLts[2];
  ui.distance.textContent = formatDistance(route.length);
  ui.time.textContent = formatTime(route.time);
  ui.lowStress.textContent = `${Math.round((100 * lowStress) / route.length)}%`;
  ui.summary.hidden = false;
  showDirections(route);
  showNearestRack();
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
      if (key === 'end') state.endName = null;
      updateRoute();
    });
  }
  state[key].options.title = title;
  if (key === 'end') state.endName = title === MAP_POINT ? null : title;
  input.value = title;
  ui.clear.disabled = false;
}

function onMapClick(event) {
  if (!state.graph) {
    return;
  }
  if (!insideArea(area, event.latlng.lat, event.latlng.lng)) {
    setStatus(OUTSIDE, true);
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
    if (kind === 'end') state.endName = result.room ? `${place.name}, room ${result.room}` : place.name;
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
ui.colorblind.addEventListener('change', () => setColorblind(ui.colorblind.checked));
ui.speak.hidden = !canSpeak;
ui.speak.addEventListener('click', () => (state.speaking ? stopReading() : startReading()));
setColorblind(loadSetting(COLORBLIND_KEY, false));
ui.showRacks.checked = loadSetting(RACKS_KEY, true);
ui.showRacks.addEventListener('change', () => {
  saveSetting(RACKS_KEY, ui.showRacks.checked);
  updateRacks();
});
ui.nearestRack.addEventListener('click', goToNearestRack);
fillRackLegend();
attachAutocomplete(ui.from, ui.fromList, () => state.places, onPick('start'));
attachAutocomplete(ui.to, ui.toList, () => state.places, onPick('end'));

try {
  [state.graph, state.places] = await Promise.all([loadGraph(), loadPlaces()]);
  setStatus('Search for a place, or click the map to set the start.');
} catch (error) {
  console.error(error);
  setStatus('The street map did not load. Refresh the page to try again.', true);
}

// The routes work with no racks, so a rack error shows only in the console.
try {
  state.racks = createRackLayer(map, await loadRacks());
  updateRacks();
  if (state.route) {
    showNearestRack();
  }
} catch (error) {
  console.error(error);
  ui.showRacks.closest('label').hidden = true;
}

// Expose the map and the state for debugging in the browser console.
window.microMap = { map, state };
