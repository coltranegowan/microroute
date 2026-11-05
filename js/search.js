// Place search with suggestions, for the From and To boxes.
//
// A rider can type a building code ("CSB"), a room ("CSB 001", "csb001",
// "EBU3B-1124"), a full name ("Cognitive Science Building"), part of a name
// ("cog sci"), the initials of a name ("wlh") or a street address
// ("4509 Governor Dr"). The places come from data/places.json and the
// addresses from data/addresses.json. scripts/build_places.py writes both.
//
// searchPlaces() has no browser code, so Node can test it.

const MAX_RESULTS = 6;
const ROOM = /^[a-z]?\d{1,4}[a-z]?$/; // 001, 1124, B210, 2100A
const SMALL_WORDS = new Set(['and', 'of', 'the', 'at', 'for']);

const KIND_LABEL = {
  building: 'Building',
  university: 'Campus',
  library: 'Library',
  park: 'Park',
  beach: 'Beach',
  mall: 'Shopping center',
  station: 'Station',
  school: 'School',
  hospital: 'Hospital',
  nature_reserve: 'Nature reserve',
  address: 'Address',
};

// Short forms of street words. The search expands them in the query and in
// the street names, so "Governor Dr" matches "Governor Drive".
const STREET_WORDS = {
  dr: 'drive', st: 'street', ave: 'avenue', av: 'avenue', rd: 'road', blvd: 'boulevard',
  ln: 'lane', ct: 'court', pl: 'place', cir: 'circle', ter: 'terrace', pkwy: 'parkway',
  hwy: 'highway', wy: 'way', sq: 'square', trl: 'trail', pt: 'point', mt: 'mount',
  n: 'north', s: 'south', e: 'east', w: 'west',
};

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Cannot load ${url}: HTTP ${response.status}`);
  }
  return response.json();
}

export async function loadPlaces(placesUrl = 'data/places.json', addressesUrl = 'data/addresses.json') {
  const [places, addresses] = await Promise.all([fetchJson(placesUrl), fetchJson(addressesUrl)]);
  return buildIndex(places, addresses);
}

export function normalize(text) {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // accents
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const compact = (text) => normalize(text).replace(/ /g, '');

const expandStreet = (text) => normalize(text).split(' ').map((word) => STREET_WORDS[word] ?? word).join(' ');

const houseValue = (number) => parseInt(number, 10) || 0;

// addresses: { street: [[number, lat, lon], ...] } from data/addresses.json.
export function buildIndex(places, addresses = {}) {
  const entries = places.map((place) => {
    const names = [place.name, ...(place.aliases ?? [])].map(normalize);
    const words = names.map((name) => name.split(' '));
    const initials = words.map((w) => w.filter((word) => !SMALL_WORDS.has(word)).map((word) => word[0]).join(''));
    return { place, names, words, initials, codes: (place.codes ?? []).map((code) => code.toLowerCase()) };
  });
  // Longest codes first, so that "EBU3B" wins over a code "EBU".
  const codes = [...new Set(entries.flatMap((entry) => entry.codes))].sort((a, b) => b.length - a.length);

  // OSM can spell one street in two ways, for example "Avenida de la Playa"
  // and "Avenida De La Playa". The expanded name merges them.
  const streets = new Map();
  for (const [name, list] of Object.entries(addresses)) {
    const key = expandStreet(name);
    if (!streets.has(key)) {
      streets.set(key, { name, key, words: key.split(' '), houses: [] });
    }
    const street = streets.get(key);
    for (const [number, lat, lon] of list) {
      street.houses.push({ number, key: normalize(number), value: houseValue(number), lat, lon });
    }
  }
  return { entries, codes, streets: [...streets.values()] };
}

// Split "4509 Governor Dr, San Diego, CA 92122" into a house number and a street.
function parseAddress(query) {
  const text = normalize(query.split(',')[0])
    .replace(/ \d{5}( \d{4})?$/, '') // ZIP code
    .replace(/ (ca|california)$/, '')
    .replace(/ san diego$/, '');
  const match = text.match(/^(\d+[a-z]?) (.+)$/);
  return match ? { number: match[1], street: expandStreet(match[2]) } : null;
}

function scoreStreet(street, query) {
  if (street.key === query) return 3;
  if (street.key.startsWith(query)) return 2;
  const words = query.split(' ');
  return words.every((q) => street.words.some((word) => word.startsWith(q))) ? 1 : 0;
}

function addressResult(street, house, score, nearestTo = null) {
  return {
    place: { name: `${house.number} ${street.name}`, kind: 'address', lat: house.lat, lon: house.lon },
    room: '',
    score,
    nearestTo,
  };
}

// Returns address results for a query with a house number and a street, else [].
function searchAddresses(index, query) {
  const parsed = parseAddress(query);
  if (!parsed) {
    return [];
  }
  const results = [];
  for (const street of index.streets) {
    const streetScore = scoreStreet(street, parsed.street);
    if (!streetScore) continue;

    const exact = street.houses.find((house) => house.key === parsed.number);
    if (exact) {
      results.push(addressResult(street, exact, 90 + streetScore));
      continue;
    }
    // The rider is still typing the number: "45 governor" → 4509, 4510, ...
    const partial = street.houses.filter((house) => house.key.startsWith(parsed.number));
    if (partial.length) {
      results.push(...partial.slice(0, MAX_RESULTS).map((house) => addressResult(street, house, 80 + streetScore)));
      continue;
    }
    // The number is not in the data. Give the nearest number on the same side of the street.
    const wanted = houseValue(parsed.number);
    const sameSide = street.houses.filter((house) => house.value % 2 === wanted % 2);
    const nearest = (sameSide.length ? sameSide : street.houses)
      .reduce((best, house) => (Math.abs(house.value - wanted) < Math.abs(best.value - wanted) ? house : best));
    results.push(addressResult(street, nearest, 70 + streetScore, parsed.number));
  }
  return results.sort((a, b) => b.score - a.score).slice(0, MAX_RESULTS);
}

// Split a query into a building code and a room, for example "CSB 001" → csb, 001.
function parseCode(index, query) {
  const text = compact(query);
  for (const code of index.codes) {
    if (text.startsWith(code)) {
      const room = text.slice(code.length);
      if (room === '' || ROOM.test(room)) {
        return { code, room: room.toUpperCase() };
      }
    }
  }
  return null;
}

function scoreName(entry, query, queryWords) {
  let best = 0;
  entry.names.forEach((name, i) => {
    const words = entry.words[i];
    let score = 0;
    if (name === query) {
      score = 95;
    } else if (name.startsWith(query)) {
      score = 75;
    } else if (queryWords.every((q) => words.some((word) => word.startsWith(q)))) {
      // "cog sci" → Cognitive Science Building. A match on the first word ranks higher.
      score = words[0].startsWith(queryWords[0]) ? 65 : 60;
    } else if (query.length >= 2 && !query.includes(' ') && entry.initials[i].startsWith(query)) {
      score = 50; // "wlh" → Warren Lecture Hall
    } else if (query.length >= 3 && name.includes(query)) {
      score = 40;
    }
    best = Math.max(best, score);
  });
  return best;
}

function scoreCode(entry, query) {
  const text = query.replace(/ /g, '');
  let best = 0;
  for (const code of entry.codes) {
    if (code === text) {
      best = Math.max(best, 100);
    } else if (text.length >= 2 && code.startsWith(text)) {
      best = Math.max(best, 80 - (code.length - text.length));
    }
  }
  return best;
}

function rank(results) {
  return results
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score
      || Number(Boolean(b.place.codes)) - Number(Boolean(a.place.codes))
      || a.place.name.length - b.place.name.length)
    .slice(0, MAX_RESULTS);
}

// Returns up to six results: [{ place, room, score }], the best first.
export function searchPlaces(index, query) {
  const text = normalize(query);
  if (!text) {
    return [];
  }

  // 0. A street address: "4509 Governor Dr".
  const addresses = searchAddresses(index, query);
  if (addresses.length) {
    return addresses;
  }

  // 1. A building code, with or without a room: "CSB", "CSB 001".
  const parsed = parseCode(index, query);
  if (parsed) {
    const exact = index.entries.filter((entry) => entry.codes.includes(parsed.code));
    const others = parsed.room ? [] : search(index, text, '').filter((r) => !exact.some((e) => e.place === r.place));
    return [...exact.map((entry) => ({ place: entry.place, room: parsed.room, score: 100 })), ...others]
      .slice(0, MAX_RESULTS);
  }

  // 2. A name with a room at the end: "Center Hall 105".
  const words = text.split(' ');
  const last = words[words.length - 1];
  if (words.length > 1 && ROOM.test(last) && /\d/.test(last)) {
    const withRoom = search(index, words.slice(0, -1).join(' '), last.toUpperCase());
    if (withRoom.length) {
      return withRoom;
    }
  }

  // 3. A name, part of a name, or initials.
  return search(index, text, '');
}

function search(index, text, room) {
  const queryWords = text.split(' ');
  return rank(index.entries.map((entry) => ({
    place: entry.place,
    room,
    score: Math.max(scoreCode(entry, text), scoreName(entry, text, queryWords)),
  })));
}

// The text for the box after the rider picks a result.
export function resultLabel({ place, room }) {
  const code = place.codes?.[0];
  if (code && room) return `${code} ${room} · ${place.name}`;
  if (room) return `${place.name}, room ${room}`;
  return code ? `${place.name} (${code})` : place.name;
}

function resultDetail({ place, room, nearestTo }) {
  if (nearestTo) {
    return `Nearest address to number ${nearestTo}`;
  }
  const parts = [];
  if (place.codes) parts.push(place.codes.join(', '));
  if (room) parts.push(`Room ${room}`);
  if (!parts.length) parts.push(KIND_LABEL[place.kind] ?? 'Place');
  return parts.join(' · ');
}

// Connect a text box to a suggestion list. onPick(result) runs when the rider picks a result.
// The box must have role="combobox" and aria-controls set to the id of the list.
export function attachAutocomplete(input, list, getIndex, onPick) {
  let results = [];
  let active = -1;

  function close() {
    list.hidden = true;
    list.replaceChildren();
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
  }

  function setActive(i) {
    active = i;
    [...list.children].forEach((item, j) => item.setAttribute('aria-selected', String(j === i)));
    if (i >= 0) {
      input.setAttribute('aria-activedescendant', list.children[i].id);
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  }

  function pick(i) {
    const result = results[i];
    if (!result) return;
    input.value = resultLabel(result);
    close();
    onPick(result);
  }

  function render() {
    const index = getIndex();
    results = index ? searchPlaces(index, input.value) : [];
    list.replaceChildren(...results.map((result, i) => {
      const item = document.createElement('li');
      item.id = `${list.id}-${i}`;
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', 'false');
      const name = document.createElement('span');
      name.className = 'suggestion-name';
      name.textContent = result.place.name;
      const detail = document.createElement('span');
      detail.className = 'suggestion-detail';
      detail.textContent = resultDetail(result);
      item.append(name, detail);
      // mousedown, not click: a click comes after the blur that closes the list.
      item.addEventListener('mousedown', (event) => {
        event.preventDefault();
        pick(i);
      });
      return item;
    }));
    if (results.length) {
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      setActive(0);
    } else {
      close();
    }
  }

  input.addEventListener('input', render);
  input.addEventListener('focus', () => input.select());
  input.addEventListener('blur', close);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' && results.length) {
      event.preventDefault();
      if (list.hidden) render();
      else setActive((active + 1) % results.length);
    } else if (event.key === 'ArrowUp' && results.length) {
      event.preventDefault();
      setActive((active - 1 + results.length) % results.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (!list.hidden && active >= 0) pick(active);
    } else if (event.key === 'Escape') {
      close();
    }
  });
}
