// Entry point. Connects the map, routing, search, voice and reports parts.
import { insideArea, loadArea } from './area.js';
import { formatStepDistance, makeDirections, spokenStep } from './directions.js';
import {
  RACK_MIN_ZOOM, createBikeLayer, createMap, createPin, createRackLayer, createStepMarker, drawRoute,
  fillRackLegend, fitWithPanel,
} from './map.js';
import { distance, edgePoints, findRoute, loadGraph, nearestNode } from './routing.js';
import { attachAutocomplete, loadPlaces } from './search.js';
import { classChangeAt, crowdLevelAt, formatMinute, loadTrafficZones, nextClassChange, trafficAt } from './traffic.js';
import { canSpeak, speak, stopSpeaking } from './voice.js';

// A point that is farther than this from the nearest street is outside the map data.
const MAX_SNAP_M = 300;
const MAP_POINT = 'Point on the map';
const OUTSIDE = 'That point is outside the map area. Pick a point that is not gray.';
const COLORBLIND_KEY = 'microroute.colorblind';
const RACKS_KEY = 'microroute.racks';
const BIKE_LANES_KEY = 'microroute.bikeLanes';
// The panel shows the nearest rack to B only if it is closer than this.
const MAX_RACK_M = 400;

// The route card at the right and the map card at the left. A route fits between them.
const panel = [document.querySelector('.panel-stack'), document.getElementById('map-card')];
// The map card starts closed on a phone, so it does not cover the map.
if (window.matchMedia('(max-width: 600px)').matches) {
  document.getElementById('map-card').open = false;
}
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
  leave: document.getElementById('leave'),
  leaveDay: document.getElementById('leave-day'),
  leaveTime: document.getElementById('leave-time'),
  crowdHelp: document.getElementById('crowd-help'),
  crowdNote: document.getElementById('crowd-note'),
  climbNote: document.getElementById('climb-note'),
  crowdKeys: document.querySelectorAll('.crowd-key'),
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
  showBikeLanes: document.getElementById('show-bike-lanes'),
  showRacks: document.getElementById('show-racks'),
  racksHelp: document.getElementById('racks-help'),
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
  bikeLanes: null, // from createBikeLayer() in js/map.js
  racks: null, // from createRackLayer() in js/map.js
  nearestRack: null, // { marker, meters }: the rack nearest to pin B
  zones: [], // from js/traffic.js
  routeCrowds: [], // [{ level, points }]: the crowded parts of the route
  crowdWindow: null, // the class change window that the route uses, as 'start-end', or ''
  crowdSlot: null, // the class change window at the departure time, as [start, end], or null
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
  ui.crowdNote.hidden = true;
  ui.climbNote.hidden = true;
  syncCrowds();
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
  if (!state.racks) {
    return;
  }
  state.racks.show(ui.showRacks.checked);
  ui.racksHelp.hidden = !ui.showRacks.checked || map.getZoom() >= RACK_MIN_ZOOM;
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
  marker.openPopup(); // the nearest rack is big, so it shows at every zoom
}

// Departure time and class change crowds

// The departure time: now, or the day and time in the Leave fields, in this week.
function departure() {
  const date = new Date();
  if (ui.leave.value === 'later') {
    const [h, m] = (ui.leaveTime.value || '00:00').split(':').map(Number);
    date.setDate(date.getDate() + Number(ui.leaveDay.value) - date.getDay());
    date.setHours(h, m, 0, 0);
  }
  return date;
}

function windowKey(date) {
  return classChangeAt(date)?.join('-') ?? '';
}

// Show the crowded paths at a class change, and say when the next one is.
function updateCrowds() {
  const date = departure();
  const slot = classChangeAt(date);
  state.crowdWindow = windowKey(date);
  state.crowdSlot = slot;
  const hasZones = state.zones.some((zone) => zone.shares.size > 0);
  syncCrowds();
  ui.crowdHelp.hidden = !hasZones;
  const when = ui.leave.value === 'now' ? 'now' : 'at this time';
  if (slot) {
    ui.crowdHelp.textContent = `Class change ${when} (${formatMinute(slot[0])}–${formatMinute(slot[1])}). `
      + 'The route avoids the crowded paths where it can. A red or orange outline shows a crowd on the route.';
  } else {
    const next = nextClassChange(date);
    ui.crowdHelp.textContent = next
      ? `No class change ${when}. The next one starts at ${formatMinute(next[0])}.`
      : `No class change ${when}.`;
  }
}

// The map shows a crowd only on the route, as a red or orange outline.
function syncCrowds() {
  const levels = new Set(state.route ? state.routeCrowds.map((run) => run.level) : []);
  ui.crowdKeys.forEach((item) => { item.hidden = !levels.has(item.dataset.level); });
}

// The runs of route edges with the same crowd level at the departure time.
function crowdRuns(route) {
  const levelOf = crowdLevelAt(state.zones, departure());
  const runs = [];
  let last = null;
  for (const edge of route.edges) {
    const level = levelOf(edge);
    const line = edgePoints(state.graph, edge);
    if (level && last?.level === level) {
      last.points.push(...line.slice(1));
    } else if (level) {
      last = { level, points: [...line] };
      runs.push(last);
    } else {
      last = null;
    }
  }
  return runs;
}

function onLeaveChange() {
  const later = ui.leave.value === 'later';
  ui.leaveDay.hidden = !later;
  ui.leaveTime.hidden = !later;
  updateCrowds();
  updateRoute();
}

// Colorblind mode

function setColorblind(on) {
  document.body.classList.toggle('colorblind', on);
  ui.colorblind.checked = on;
  saveSetting(COLORBLIND_KEY, on);
  state.bikeLanes?.setColorblind(on);
  if (state.route) {
    state.routeLayer.remove();
    state.routeLayer = drawRoute(map, state.route, { colorblind: on, crowds: state.routeCrowds });
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
    traffic: trafficAt(state.zones, departure()),
  });
  if (!route) {
    setStatus('No route found between these points.', true);
    return;
  }

  state.route = route;
  state.routeCrowds = crowdRuns(route);
  state.routeLayer = drawRoute(map, route, { colorblind: ui.colorblind.checked, crowds: state.routeCrowds });
  const lowStress = route.lengthByLts[1] + route.lengthByLts[2];
  ui.distance.textContent = formatDistance(route.length);
  ui.time.textContent = formatTime(route.time);
  ui.lowStress.textContent = `${Math.round((100 * lowStress) / route.length)}%`;
  ui.summary.hidden = false;
  syncCrowds();
  // Show the climb only when it adds about a minute or more.
  if (route.climbTime >= 45) {
    ui.climbNote.textContent = `Uphill: ${Math.round(route.climb * 3.28084 / 10) * 10} ft of climbing, `
      + `which adds ${formatTime(route.climbTime)}.`;
    ui.climbNote.hidden = false;
  }
  if (route.crowdDelay >= 30) {
    ui.crowdNote.textContent = `The time includes ${formatTime(route.crowdDelay)} for class change crowds.`;
    ui.crowdNote.hidden = false;
  }
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
ui.leave.addEventListener('change', () => {
  if (ui.leave.value === 'later' && !ui.leaveTime.value) {
    const now = new Date();
    ui.leaveDay.value = String(now.getDay());
    ui.leaveTime.value = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  }
  onLeaveChange();
});
ui.leaveDay.addEventListener('change', onLeaveChange);
ui.leaveTime.addEventListener('change', onLeaveChange);
// With Leave = Now, check each 20 s for the start or the end of a class change.
// The route changes only then, and not while the app reads the directions aloud.
setInterval(() => {
  if (ui.leave.value === 'now' && windowKey(departure()) !== state.crowdWindow) {
    updateCrowds();
    if (!state.speaking) {
      updateRoute();
    }
  }
}, 20000);
ui.clear.addEventListener('click', clearAll);
ui.colorblind.addEventListener('change', () => setColorblind(ui.colorblind.checked));
ui.speak.hidden = !canSpeak;
ui.speak.addEventListener('click', () => (state.speaking ? stopReading() : startReading()));
setColorblind(loadSetting(COLORBLIND_KEY, false));
ui.showBikeLanes.checked = loadSetting(BIKE_LANES_KEY, true);
ui.showBikeLanes.addEventListener('change', () => {
  saveSetting(BIKE_LANES_KEY, ui.showBikeLanes.checked);
  state.bikeLanes?.show(ui.showBikeLanes.checked);
});
ui.showRacks.checked = loadSetting(RACKS_KEY, false); // off at first, so the map is clear
ui.showRacks.addEventListener('change', () => {
  saveSetting(RACKS_KEY, ui.showRacks.checked);
  updateRacks();
});
ui.nearestRack.addEventListener('click', goToNearestRack);
fillRackLegend();
map.on('zoomend', updateRacks);
attachAutocomplete(ui.from, ui.fromList, () => state.places, onPick('start'));
attachAutocomplete(ui.to, ui.toList, () => state.places, onPick('end'));

try {
  [state.graph, state.places] = await Promise.all([loadGraph(), loadPlaces()]);
  state.bikeLanes = createBikeLayer(map, state.graph, { colorblind: ui.colorblind.checked });
  state.bikeLanes.show(ui.showBikeLanes.checked);
  setStatus('Search for a place, or click the map to set the start.');
} catch (error) {
  console.error(error);
  setStatus('The street map did not load. Refresh the page to try again.', true);
}

// The routes work with no traffic zones, so a zone error shows only in the console.
try {
  if (state.graph) {
    state.zones = await loadTrafficZones(state.graph);
    updateCrowds();
    if (state.route) {
      updateRoute();
    }
  }
} catch (error) {
  console.error(error);
}

// The routes work with no racks, so a rack error shows only in the console.
try {
  // The team racks come from tools/draw-traffic.html. The app works without them.
  const [ucsd, team] = await Promise.all([loadRacks(), loadRacks('data/team-racks.json').catch(() => [])]);
  state.racks = createRackLayer(map, [...ucsd, ...team.map((rack) => ({ ...rack, team: true }))]);
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
