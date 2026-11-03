// Checks for js/search.js on the real places list. Run: node scripts/test_search.mjs

import { readFileSync } from 'node:fs';
import { buildIndex, resultLabel, searchPlaces } from '../js/search.js';

const index = buildIndex(JSON.parse(readFileSync(new URL('../data/places.json', import.meta.url))));

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

const empty = searchPlaces(index, '   ');
if (empty.length) {
  failures += 1;
  console.log('FAIL an empty query must give no results');
}

console.log(failures ? `\n${failures} checks failed` : `\nAll ${CASES.length + 1} checks passed`);
process.exit(failures ? 1 : 0);
