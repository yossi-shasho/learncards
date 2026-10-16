// One-off (2026-10): re-date the tricks imported from WordPress with 2018/2019 dates so the archive
// reflects the site's 2007 founding. Usage: node scripts/redate.mjs [--dry-run]
//
// Selection: every src/tricks/*.md whose `date` is before 2020-01-01. Tricks already dated in the target
// window (2007-03-01 .. 2010-12-31) are skipped, so re-running is a no-op. Tricks dated 2020+ are untouched.
// Of the selected tricks (sorted by filename, then shuffled with a seeded RNG), round(3/4) get a uniformly
// random date+time in [2007-03-01 00:00:00, 2007-07-31 23:59:59] and the rest one in
// [2007-08-01 00:00:00, 2010-12-31 23:59:59] (UTC, second resolution). Both `date` and `modified` are set
// to the new value, in the existing 'YYYY-MM-DDTHH:MM:SS' format. Only those two front-matter lines change.
// The RNG (mulberry32) is seeded with SEED, so the output is reproducible.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SEED = 20070301;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'src/tricks');
const CUTOFF = '2020-01-01';
const WINDOW_END = '2010-12-31T23:59:59';
const BUCKETS = {
  early: ['2007-03-01T00:00:00Z', '2007-07-31T23:59:59Z'],
  late: ['2007-08-01T00:00:00Z', '2010-12-31T23:59:59Z'],
};
const dryRun = process.argv.includes('--dry-run');

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);
const randInt = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1)); // inclusive
const randDate = ([from, to]) => {
  const s = randInt(Date.parse(from) / 1000, Date.parse(to) / 1000);
  return new Date(s * 1000).toISOString().slice(0, 19);
};

const DATE_RE = /^date: '([^']+)'$/m;
const MOD_RE = /^modified: '([^']+)'$/m;

const selected = [];
for (const f of (await readdir(DIR)).filter((n) => n.endsWith('.md')).sort()) {
  const src = await readFile(path.join(DIR, f), 'utf8');
  const fm = src.match(/^---\n([\s\S]*?)\n---\n/);
  const d = fm && fm[1].match(DATE_RE);
  if (!d) throw new Error(`${f}: no quoted date line in front matter`);
  if (!MOD_RE.test(fm[1])) throw new Error(`${f}: no quoted modified line in front matter`);
  if (d[1] >= CUTOFF || d[1] <= WINDOW_END) continue;
  selected.push({ f, src });
}

// Fisher-Yates shuffle, then the first round(3/4) go to the early bucket.
for (let i = selected.length - 1; i > 0; i--) {
  const j = randInt(0, i);
  [selected[i], selected[j]] = [selected[j], selected[i]];
}
const nEarly = Math.round(selected.length * 3 / 4);
const counts = { early: 0, late: 0 };
for (const [i, t] of selected.entries()) {
  const bucket = i < nEarly ? 'early' : 'late';
  const nd = randDate(BUCKETS[bucket]);
  counts[bucket]++;
  const end = t.src.indexOf('\n---\n', 4);
  const head = t.src.slice(0, end).replace(DATE_RE, `date: '${nd}'`).replace(MOD_RE, `modified: '${nd}'`);
  if (!dryRun) await writeFile(path.join(DIR, t.f), head + t.src.slice(end));
  console.log(`${bucket.padEnd(5)} ${nd}  ${t.f}`);
}
console.log(`\n${selected.length} tricks re-dated${dryRun ? ' (dry run)' : ''}: ` +
  `${counts.early} in 2007-03-01..2007-07-31, ${counts.late} in 2007-08-01..2010-12-31`);
