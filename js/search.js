// Place search with suggestions, for the From and To boxes.
//
// A rider can type a building code ("CSB"), a room ("CSB 001", "csb001",
// "EBU3B-1124"), a full name ("Cognitive Science Building"), part of a name
// ("cog sci") or the initials of a name ("wlh"). The places come from
// data/places.json, which scripts/build_places.py writes.
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
};

export async function loadPlaces(url = 'data/places.json') {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Cannot load ${url}: HTTP ${response.status}`);
  }
  return buildIndex(await response.json());
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

export function buildIndex(places) {
  const entries = places.map((place) => {
    const names = [place.name, ...(place.aliases ?? [])].map(normalize);
    const words = names.map((name) => name.split(' '));
    const initials = words.map((w) => w.filter((word) => !SMALL_WORDS.has(word)).map((word) => word[0]).join(''));
    return { place, names, words, initials, codes: (place.codes ?? []).map((code) => code.toLowerCase()) };
  });
  // Longest codes first, so that "EBU3B" wins over a code "EBU".
  const codes = [...new Set(entries.flatMap((entry) => entry.codes))].sort((a, b) => b.length - a.length);
  return { entries, codes };
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

function resultDetail({ place, room }) {
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
