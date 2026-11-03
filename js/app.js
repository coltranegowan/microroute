// Entry point. Connects the map, routing, voice and reports parts.
import { createMap } from './map.js';

const map = createMap('map');

// Expose the map for debugging in the browser console.
window.microMap = map;
