// Leaflet map setup. Leaflet loads as the global `L` from index.html.

import { edgePoints } from './routing.js';

// The bike facility types from scripts/lts.py (bike_type), from the best to
// the worst. The colors are the same as --bike-* in css/style.css. Green is
// for the bike racks only.
//
// Colorblind mode: each type also gets a line pattern, so a rider can read
// the type with no colors. The legend in css/style.css shows the same
// patterns. The white line under the route shows in the gaps.
const BIKE_STYLE = {
  path: { color: '#1f4e9c', pattern: null }, // solid
  shared_path: { color: '#6fa8dc', pattern: '14 7' }, // long dashes
  buffered: { color: '#7b2d8e', pattern: '14 5 2 5' }, // dash and dot
  lane: { color: '#c77dd1', pattern: '5 7' }, // short dashes
  sharrow: { color: '#d6336c', pattern: '1 9' }, // dots. Not orange: the tiles draw main roads in orange.
  none: { color: '#7d8590', pattern: null }, // solid, but thinner
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

// Gray out the map outside the area. The streets still show through, but the
// rider can see that they are not part of the map. The mask is a polygon with
// a hole: the outer ring goes around the world, and the area is the hole.
function addAreaMask(map, area) {
  const world = [[-89, -360], [89, -360], [89, 360], [-89, 360]];
  L.polygon([world, area], {
    stroke: false,
    fillColor: '#9ca3ab',
    fillOpacity: 0.6,
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
    zIndexOffset: 1000, // above the racks
  });
}

// Draw a route from js/routing.js. Each edge gets the color of its bike
// facility type. A white line under the colors keeps the route clear on the
// map tiles. colorblind: true also gives each type its line pattern.
export function drawRoute(map, route, { colorblind = false } = {}) {
  const layer = L.layerGroup();
  L.polyline(route.points, {
    color: '#ffffff',
    weight: colorblind ? 11 : 9,
    opacity: 0.9,
    interactive: false,
  }).addTo(layer);

  for (const segment of route.segments) {
    const style = BIKE_STYLE[segment.bike];
    const weight = colorblind ? 6 : 5;
    L.polyline(segment.points, {
      color: style.color,
      weight: segment.bike === 'none' ? weight - 2 : weight,
      opacity: 1,
      dashArray: colorblind ? style.pattern : null,
      lineCap: 'round',
      interactive: false,
    }).addTo(layer);
  }
  return layer.addTo(map);
}

// All the bike paths and bike lanes in the graph, as thin lines under the
// route. A canvas draws the 1,700 lines faster than SVG.
//
// Returns an object:
//   show(on)                 put the lines on the map, or remove them
//   setColorblind(on)        add or remove the line patterns
//   setFaded(on)             make the lines faint, so that a route stands out
export function createBikeLayer(map, graph, { colorblind = false } = {}) {
  // A pane under the route and the area mask (the overlay pane is 400).
  if (!map.getPane('bikeNetwork')) {
    map.createPane('bikeNetwork').style.zIndex = 350;
  }
  const renderer = L.canvas({ pane: 'bikeNetwork' });
  const layer = L.layerGroup();
  const seen = new Set();
  for (const node of graph.nodes.values()) {
    for (const edge of node.out) {
      if (!edge.bike || edge.bike === 'none') {
        continue;
      }
      // The graph has most streets two times, one for each direction.
      const key = [edge.from, edge.to].sort().join('-') + edge.length;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      const line = L.polyline(edgePoints(graph, edge), {
        renderer,
        color: BIKE_STYLE[edge.bike].color,
        weight: 3,
        opacity: 0.85,
        dashArray: colorblind ? BIKE_STYLE[edge.bike].pattern : null,
        interactive: false,
      });
      line.bike = edge.bike;
      line.addTo(layer);
    }
  }

  return {
    show(on) {
      if (on) layer.addTo(map);
      else layer.remove();
    },

    setColorblind(on) {
      layer.eachLayer((line) => line.setStyle({ dashArray: on ? BIKE_STYLE[line.bike].pattern : null }));
    },

    setFaded(on) {
      layer.eachLayer((line) => line.setStyle({ opacity: on ? 0.3 : 0.85 }));
    },
  };
}

// A small bicycle, for the rack markers. currentColor sets its color.
const BIKE_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4"
  stroke-linecap="round" stroke-linejoin="round"><circle cx="5.5" cy="15.5" r="3.5"/><circle cx="18.5" cy="15.5" r="3.5"/>
  <path d="M5.5 15.5 9.5 7.5h6l3 8M9.5 7.5 12 15.5h-6.5M15.5 7.5l-3.5 8M8 5.5h3"/></svg>`;
// A padlock, for the badge on an enclosure.
const LOCK_SVG = `<svg viewBox="0 0 12 12" aria-hidden="true"><rect x="2" y="5.5" width="8" height="5.5" rx="1"
  fill="currentColor"/><path d="M4 5.5V4a2 2 0 0 1 4 0v1.5" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`;

const RACK_LABEL = { rack: 'Bike rack', enclosure: 'Bike enclosure (locked)' };
// Racks closer than this to the end of a route show at full size, at every zoom.
const NEAR_M = 150;
// The racks far from B show at this zoom and closer. At a lower zoom, 200+
// markers hide the map.
export const RACK_MIN_ZOOM = 16;

// Put the rack icons in the legend: elements with class "legend-rack" and data-kind.
export function fillRackLegend() {
  for (const box of document.querySelectorAll('.legend-rack')) {
    box.innerHTML = rackIcon({ kind: box.dataset.kind }).options.html;
  }
}

// size: 'small' or 'near'. nearest: true adds a gold ring.
function rackIcon(rack, size = 'small', nearest = false) {
  const px = size === 'near' ? 28 : 20;
  const badge = rack.kind === 'enclosure' ? `<span class="rack-lock">${LOCK_SVG}</span>` : '';
  return L.divIcon({
    className: '',
    html: `<div class="rack-icon ${size}${nearest ? ' nearest' : ''}">${BIKE_SVG}${badge}</div>`,
    iconSize: [px, px],
    iconAnchor: [px / 2, px / 2],
    popupAnchor: [0, -px / 2],
  });
}

function rackPopup(rack) {
  const box = document.createElement('div');
  const name = document.createElement('strong');
  name.textContent = RACK_LABEL[rack.kind];
  box.append(name);
  if (rack.near) {
    box.append(document.createElement('br'), `Near ${rack.near}`);
  }
  return box;
}

// The bike racks and enclosures from data/racks.json.
//
// The racks show at zoom RACK_MIN_ZOOM and closer. After a route, the racks
// near the end show at full size at every zoom, and the nearest rack gets a
// gold ring.
//
// Returns an object:
//   markers            one Leaflet marker for each rack, with the rack in marker.rack
//   show(on)           put the racks on the map, or remove them
//   focus(latlng, nearestMarker)  make the racks near a point big. null clears it.
export function createRackLayer(map, racks) {
  const far = L.layerGroup();
  const near = L.layerGroup();
  let on = false;
  const markers = racks.map((rack) => {
    const title = RACK_LABEL[rack.kind] + (rack.near ? ` near ${rack.near}` : '');
    // keyboard: false keeps the 200+ racks out of the Tab order.
    const marker = L.marker([rack.lat, rack.lon], { icon: rackIcon(rack), title, keyboard: false });
    marker.bindPopup(() => rackPopup(rack));
    marker.rack = rack;
    return marker.addTo(far);
  });

  const update = () => {
    const showFar = on && map.getZoom() >= RACK_MIN_ZOOM;
    if (showFar !== map.hasLayer(far)) {
      if (showFar) far.addTo(map);
      else far.remove();
    }
    if (on !== map.hasLayer(near)) {
      if (on) near.addTo(map);
      else near.remove();
    }
  };
  map.on('zoomend', update);

  return {
    markers,

    show(value) {
      on = value;
      update();
    },

    focus(latlng, nearestMarker = null) {
      // Make all the big racks small again.
      near.eachLayer((marker) => {
        marker.setIcon(rackIcon(marker.rack));
        far.addLayer(marker);
      });
      near.clearLayers();
      if (!latlng) {
        return;
      }
      for (const marker of markers) {
        if (marker === nearestMarker || map.distance(latlng, marker.getLatLng()) <= NEAR_M) {
          far.removeLayer(marker);
          marker.setIcon(rackIcon(marker.rack, 'near', marker === nearestMarker));
          near.addLayer(marker);
        }
      }
    },
  };
}

// A ring that marks the point of a step in the directions.
export function createStepMarker(latlng) {
  return L.circleMarker(latlng, {
    radius: 10,
    color: '#182b49',
    weight: 3,
    fillColor: '#ffcd00',
    fillOpacity: 0.9,
    interactive: false,
  });
}
