// Leaflet map setup. Leaflet loads as the global `L` from index.html.

// Bounding box of the study area: UC San Diego, University City and La Jolla Shores,
// from Torrey Pines south to Rose Canyon and from the coast east to I-805.
// [[south, west], [north, east]]
export const STUDY_AREA = [
  [32.847, -117.258],
  [32.895, -117.180],
];

export function createMap(elementId) {
  const map = L.map(elementId);

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
