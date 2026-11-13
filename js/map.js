// Leaflet map setup. Leaflet loads as the global `L` from index.html.

// The same colors as --lts1 to --lts4 in css/style.css.
const LTS_COLOR = {
  1: '#2166ac',
  2: '#67a9cf',
  3: '#ef8a62',
  4: '#b2182b',
};

// Colorblind mode: each LTS level also gets a line pattern, so a rider can
// read the stress with no colors. The legend in css/style.css shows the same
// patterns. The white line under the route shows in the gaps.
const LTS_PATTERN = {
  1: null, // solid
  2: '14 7', // long dashes
  3: '5 7', // short dashes
  4: '1 9', // dots
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
    zIndexOffset: 1000, // above the racks and the rack clusters
  });
}

// Draw a route from js/routing.js. Each edge gets the color of its LTS level.
// A white line under the colors keeps the route clear on the map tiles.
// colorblind: true also gives each LTS level its line pattern.
export function drawRoute(map, route, { colorblind = false } = {}) {
  const layer = L.layerGroup();
  L.polyline(route.points, {
    color: '#ffffff',
    weight: colorblind ? 11 : 9,
    opacity: 0.9,
    interactive: false,
  }).addTo(layer);

  for (const segment of route.segments) {
    L.polyline(segment.points, {
      color: LTS_COLOR[segment.lts],
      weight: colorblind ? 6 : 5,
      opacity: 1,
      dashArray: colorblind ? LTS_PATTERN[segment.lts] : null,
      lineCap: 'round',
      interactive: false,
    }).addTo(layer);
  }
  return layer.addTo(map);
}

// A small bicycle, for the rack markers. currentColor sets its color.
const BIKE_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4"
  stroke-linecap="round" stroke-linejoin="round"><circle cx="5.5" cy="15.5" r="3.5"/><circle cx="18.5" cy="15.5" r="3.5"/>
  <path d="M5.5 15.5 9.5 7.5h6l3 8M9.5 7.5 12 15.5h-6.5M15.5 7.5l-3.5 8M8 5.5h3"/></svg>`;
// A padlock, for the badge on an enclosure.
const LOCK_SVG = `<svg viewBox="0 0 12 12" aria-hidden="true"><rect x="2" y="5.5" width="8" height="5.5" rx="1"
  fill="currentColor"/><path d="M4 5.5V4a2 2 0 0 1 4 0v1.5" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`;

const RACK_LABEL = { rack: 'Bike rack', enclosure: 'Bike enclosure (locked)' };
// Racks closer than this to the end of a route show at full size and never join a cluster.
const NEAR_M = 150;
// At this zoom and closer, every rack shows by itself. The plugin rounds
// the zoom, so 18 keeps the clusters up to zoom 17.5.
const NO_CLUSTER_ZOOM = 18;

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

// A green bubble with the number of racks in a cluster.
function clusterIcon(cluster) {
  const count = cluster.getChildCount();
  const px = count < 10 ? 30 : count < 30 ? 36 : 42;
  return L.divIcon({
    className: '',
    html: `<div class="rack-cluster" title="${count} bike racks. Click to zoom in.">${count}</div>`,
    iconSize: [px, px],
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
// Far from the end of a route, the racks join in clusters: a green bubble
// with a number. A click on a bubble zooms in. Near the end of a route, the
// racks show at full size, and the nearest rack gets a gold ring.
//
// Returns an object:
//   markers            one Leaflet marker for each rack, with the rack in marker.rack
//   show(on)           put the racks on the map, or remove them
//   focus(latlng, nearestMarker)  make the racks near a point big. null clears it.
//   reveal(marker, done)          zoom until the marker shows, then call done()
export function createRackLayer(map, racks) {
  const clusters = L.markerClusterGroup({
    // In pixels, for each zoom level (the plugin rounds the zoom). At zoom 15
    // to 16, the campus racks are dense, so the clusters are larger there.
    maxClusterRadius: (zoom) => (zoom <= 14 ? 50 : zoom <= 16 ? 80 : 60),
    disableClusteringAtZoom: NO_CLUSTER_ZOOM,
    showCoverageOnHover: false,
    spiderfyOnMaxZoom: false,
    iconCreateFunction: clusterIcon,
  });
  const near = L.layerGroup();
  const markers = racks.map((rack) => {
    const title = RACK_LABEL[rack.kind] + (rack.near ? ` near ${rack.near}` : '');
    // keyboard: false keeps the 200+ racks out of the Tab order.
    const marker = L.marker([rack.lat, rack.lon], { icon: rackIcon(rack), title, keyboard: false });
    marker.bindPopup(() => rackPopup(rack));
    marker.rack = rack;
    return marker;
  });
  clusters.addLayers(markers);

  return {
    markers,

    show(on) {
      for (const layer of [clusters, near]) {
        if (on) layer.addTo(map);
        else layer.remove();
      }
    },

    focus(latlng, nearestMarker = null) {
      // Put all the big racks back in the clusters.
      const old = near.getLayers();
      near.clearLayers();
      old.forEach((marker) => marker.setIcon(rackIcon(marker.rack)));
      clusters.addLayers(old);
      if (!latlng) {
        return;
      }
      const close = markers.filter((marker) => marker === nearestMarker
        || map.distance(latlng, marker.getLatLng()) <= NEAR_M);
      clusters.removeLayers(close);
      close.forEach((marker) => {
        marker.setIcon(rackIcon(marker.rack, 'near', marker === nearestMarker));
        near.addLayer(marker);
      });
    },

    reveal(marker, done) {
      if (near.hasLayer(marker)) {
        done();
      } else {
        clusters.zoomToShowLayer(marker, done);
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
