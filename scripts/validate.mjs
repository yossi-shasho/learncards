// Validates trick front matter and editorial data. Run: node scripts/validate.mjs [--strict]
// Non-strict: only YAML parse errors fail. --strict: every SEO field must be present and in range.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { load } from 'js-yaml';

const TRICKS = 'src/tricks';
const strict = process.argv.includes('--strict');
const DIFFICULTY = new Set(['easy', 'intermediate', 'expert']);
const errors = [];
const descs = new Map();

const files = (await readdir(TRICKS)).filter((f) => f.endsWith('.md')).sort();
for (const f of files) {
  const raw = await readFile(path.join(TRICKS, f), 'utf8');
  const m = raw.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) { errors.push(`${f}: no front matter`); continue; }
  let fm;
  try { fm = load(m[1]); } catch (e) { errors.push(`${f}: YAML error: ${e.message.split('\n')[0]}`); continue; }
  const bad = (msg) => errors.push(`${f}: ${msg}`);
  if (!fm.title || !fm.slug || fm.slug !== f.replace(/\.md$/, '')) bad('slug must equal filename');
  if (!Array.isArray(fm.categories) || !fm.categories.length) bad('categories missing');
  if (!strict) continue;
  const d = fm.seoDescription;
  if (typeof d !== 'string') bad('seoDescription missing');
  else {
    if (d.length < 110 || d.length > 160) bad(`seoDescription length ${d.length} (want 110–160)`);
    if (descs.has(d)) bad(`seoDescription duplicates ${descs.get(d)}`); else descs.set(d, f);
  }
  if (!DIFFICULTY.has(fm.difficulty)) bad(`difficulty must be easy|intermediate|expert (got ${fm.difficulty})`);
  if (typeof fm.effect !== 'string' || fm.effect.length < 30 || fm.effect.length > 220) bad('effect: one sentence, 30–220 chars');
  if (!Array.isArray(fm.needs) || !fm.needs.length) bad('needs: non-empty list');
  if (!Array.isArray(fm.skills) || !fm.skills.length) bad('skills: non-empty list');
  if (typeof fm.excerpt !== 'string' || fm.excerpt.length < 60 || fm.excerpt.length > 240 || /…|\.\.\.$/.test(fm.excerpt)) bad('excerpt: 1–2 full sentences, 60–240 chars, no trailing ellipsis');
}

if (strict) {
  const cats = JSON.parse(await readFile('src/_data/categories.json', 'utf8'));
  let intros = {};
  try { intros = JSON.parse(await readFile('src/_data/intros.json', 'utf8')); } catch { errors.push('src/_data/intros.json missing'); }
  for (const c of cats) {
    const t = intros[c.slug];
    if (!t || typeof t.intro !== 'string' || t.intro.split(/\s+/).length < 120) errors.push(`intros.json: ${c.slug} intro missing or under 120 words`);
    if (!t || typeof t.seoDescription !== 'string' || t.seoDescription.length < 110 || t.seoDescription.length > 160) errors.push(`intros.json: ${c.slug} seoDescription 110–160 chars`);
  }
}

console.log(`${files.length} tricks checked${strict ? ' (strict)' : ''}, ${errors.length} problem(s)`);
for (const e of errors) console.log('  ' + e);
process.exit(errors.length ? 1 : 0);
