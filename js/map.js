// Leaflet map setup. Leaflet loads as the global `L` from index.html.

// Bounding box of the study area: UC San Diego, University City and La Jolla Shores,
// south to La Jolla High School and east to the I-805 / SR 52 interchange.
// [[south, west], [north, east]]
export const STUDY_AREA = [
  [32.830, -117.280],
  [32.895, -117.170],
];

export function createMap(elementId) {
  const map = L.map(elementId, {
    maxBounds: L.latLngBounds(STUDY_AREA).pad(0.5),
    minZoom: 13,
  });

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

  map.fitBounds(STUDY_AREA);
  return map;
}
