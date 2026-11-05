// Checks for js/search.js on the real places list. Run: node scripts/test_search.mjs

import { readFileSync } from 'node:fs';
import { buildIndex, resultLabel, searchPlaces } from '../js/search.js';

const read = (file) => JSON.parse(readFileSync(new URL(`../data/${file}`, import.meta.url)));
const index = buildIndex(read('places.json'), read('addresses.json'));

// [query, the name of the first result, the room]
const CASES = [
  ['CSB', 'Cognitive Science Building', ''],
  ['csb', 'Cognitive Science Building', ''],
  ['CSB 001', 'Cognitive Science Building', '001'],
  ['csb001', 'Cognitive Science Building', '001'],
  ['CSB-001', 'Cognitive Science Building', '001'],
  ['Cognitive Science Building', 'Cognitive Science Building', ''],
  ['cognitive', 'Cognitive Science Building', ''],
  ['cog sci', 'Cognitive Science Building', ''],
  ['WLH 2005', 'Warren Lecture Hall', '2005'],
  ['wlh', 'Warren Lecture Hall', ''],
  ['warren lec', 'Warren Lecture Hall', ''],
  ['CENTR 105', 'Center Hall', '105'],
  ['Center Hall 105', 'Center Hall', '105'],
  ['PCYNH 109', 'Pepper Canyon Hall', '109'],
  ['EBU3B 1124', 'Computer Science & Engineering', '1124'],
  ['cse building', 'Computer Science & Engineering', ''],
  ['computer science and engineering', 'Computer Science & Engineering', ''],
  ['geisel', 'Geisel Library', ''],
  ['price center', 'Price Center', ''],
  ['4509 Governor Dr', '4509 Governor Drive', ''],
  ['4509 governor drive', '4509 Governor Drive', ''],
  ['4509 Governor Dr, San Diego, CA 92122', '4509 Governor Drive', ''],
  ['4509 governor dr san diego ca 92122', '4509 Governor Drive', ''],
  ['4509 gov', '4509 Governor Drive', ''],
];

// [query, check, description]
const ADDRESS_CASES = [
  ['45 governor dr', (r) => r.length > 1 && r.every((x) => /^45\d* Governor Drive$/.test(x.place.name)), 'a part number lists the addresses that start with it'],
  ['4511 governor dr', (r) => r[0]?.nearestTo === '4511' && Number.parseInt(r[0].place.name, 10) % 2 === 1, 'a missing number gives the nearest odd number'],
  ['9999 governor dr', (r) => r[0]?.nearestTo === '9999' && r[0].place.name.endsWith('Governor Drive'), 'a number past the end gives the last address'],
  ['8 n torrey pines rd', (r) => r.length === 0 || r[0].place.name.includes('North Torrey Pines Road'), '"n" and "rd" expand to North and Road'],
  ['CSB 001', (r) => r[0]?.place.kind !== 'address', 'a building code is not an address'],
];

let failures = 0;
for (const [query, expected, room] of CASES) {
  const [first] = searchPlaces(index, query);
  const ok = first && first.place.name === expected && first.room === room;
  if (!ok) {
    failures += 1;
    const got = first ? `${first.place.name}, room "${first.room}"` : 'no result';
    console.log(`FAIL "${query}": expected ${expected}, room "${room}"; got ${got}`);
  } else {
    console.log(`ok   "${query}" → ${resultLabel(first)}`);
  }
}

for (const [query, check, description] of ADDRESS_CASES) {
  const results = searchPlaces(index, query);
  if (check(results)) {
    console.log(`ok   "${query}" → ${results.slice(0, 2).map(resultLabel).join(', ') || 'no result'}`);
  } else {
    failures += 1;
    console.log(`FAIL "${query}": ${description}. Got ${results.map(resultLabel).join(', ') || 'no result'}`);
  }
}

const empty = searchPlaces(index, '   ');
if (empty.length) {
  failures += 1;
  console.log('FAIL an empty query must give no results');
}

console.log(failures ? `\n${failures} checks failed` : `\nAll ${CASES.length + ADDRESS_CASES.length + 1} checks passed`);
process.exit(failures ? 1 : 0);
