// Post-build checks. Usage: node scripts/check.mjs [--offline]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { load as yamlLoad } from 'js-yaml';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = path.join(ROOT, '_site');
const LIVE = 'https://learncards.net';
const SITEMAPS = ['post', 'category', 'post_tag', 'author'].map((n) => `${LIVE}/${n}-sitemap.xml`);
const offline = process.argv.includes('--offline') || process.env.CHECK_OFFLINE === '1';

const errors = [];
const warnings = [];

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

if (!fs.existsSync(SITE)) {
  console.error('ERROR: _site/ not found. Run `eleventy` first.');
  process.exit(1);
}

const files = walk(SITE);
const rel = (f) => path.relative(SITE, f).split(path.sep).join('/');

// --- generated paths
const generated = new Set();
for (const f of files) {
  const r = rel(f);
  if (r === 'index.html') generated.add('/');
  else if (r.endsWith('/index.html')) generated.add('/' + r.slice(0, -'index.html'.length));
}

// --- redirects
function parseRedirects() {
  const f = path.join(SITE, '_redirects');
  if (!fs.existsSync(f)) return [];
  const rules = [];
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const [from] = t.split(/\s+/);
    // Build regex: :param -> one segment, * -> anything
    let re = '';
    for (const seg of from.split(/(\*|:[A-Za-z_]\w*)/)) {
      if (seg === '*') re += '.*';
      else if (/^:[A-Za-z_]\w*$/.test(seg)) re += '[^/]+';
      else re += seg.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    }
    rules.push(new RegExp('^' + re + '$'));
  }
  return rules;
}
const redirectRules = parseRedirects();
const isRedirected = (p) => redirectRules.some((r) => r.test(p));

// --- 1. live sitemap diff
let liveCount = 0, redirectedCount = 0, missing = [];
let diffDone = false;
if (offline) {
  warnings.push('offline mode: skipping live sitemap diff and video re-check');
} else {
  try {
    const live = new Set();
    for (const url of SITEMAPS) {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
      const xml = await res.text();
      for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
        const u = new URL(m[1].replace(/&amp;/g, '&'));
        live.add(decodeURI(u.pathname));
      }
    }
    liveCount = live.size;
    for (const p of [...live].sort()) {
      if (generated.has(p)) continue;
      if (isRedirected(p)) redirectedCount++;
      else missing.push(p);
    }
    diffDone = true;
  } catch (e) {
    warnings.push(`could not fetch live sitemaps (${e.message}); skipping URL diff`);
  }
}
if (missing.length) {
  errors.push(`${missing.length} live URL(s) neither generated nor redirected:\n` + missing.map((p) => '    ' + p).join('\n'));
}

// --- 2. video re-check
if (!offline) {
  const dir = path.join(ROOT, 'src/tricks');
  for (const name of fs.readdirSync(dir).filter((n) => n.endsWith('.md'))) {
    const src = fs.readFileSync(path.join(dir, name), 'utf8');
    const m = src.match(/^---\n([\s\S]*?)\n---/);
    if (!m) continue;
    let fm;
    try { fm = yamlLoad(m[1]); } catch { continue; }
    if (!fm || !fm.video) continue;
    const api = `https://www.youtube.com/oembed?url=${encodeURIComponent(fm.video)}&format=json`;
    try {
      const res = await fetch(api, { signal: AbortSignal.timeout(15000) });
      if (res.status !== 200) warnings.push(`video dead? ${name}: ${fm.video} -> HTTP ${res.status}`);
      else console.log(`video ok: ${name}`);
    } catch (e) {
      warnings.push(`video check failed for ${name} (${e.message})`);
    }
  }
}

// --- 3. local invariants
for (const r of ['sitemap.xml', 'robots.txt', 'feed/index.html', 'css/style.css', 'wp-content/uploads/2019/06/inner_logo-1.jpg']) {
  if (!fs.existsSync(path.join(SITE, r))) errors.push(`missing required file: _site/${r}`);
}
const LOGO = 'wp-content/uploads/2019/06/inner_logo-1.jpg';
const htmlFiles = files.filter((f) => f.endsWith('.html'));
const imgBad = [], canonBad = [];
for (const f of htmlFiles) {
  const html = fs.readFileSync(f, 'utf8');
  if (!/<html[\s>]/i.test(html)) continue; // e.g. feed/index.html is XML
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    if (!m[0].includes(LOGO)) imgBad.push(`${rel(f)}: ${m[0].slice(0, 100)}`);
  }
  const canons = [...html.matchAll(/<link\b[^>]*rel=["']canonical["'][^>]*>/gi)];
  const href = canons.length === 1 ? canons[0][0].match(/href=["']([^"']*)["']/i) : null;
  if (canons.length !== 1 || !href || !href[1].startsWith(LIVE + '/')) {
    canonBad.push(`${rel(f)} (${canons.length} canonical tag(s)${href ? ', href ' + href[1] : ''})`);
  }
}
if (imgBad.length) errors.push(`<img> other than the logo:\n` + imgBad.map((s) => '    ' + s).join('\n'));
if (canonBad.length) errors.push(`bad canonical link:\n` + canonBad.map((s) => '    ' + s).join('\n'));

// --- report
console.log('');
console.log(`Live URLs:        ${diffDone ? liveCount : 'n/a'}`);
console.log(`Generated pages:  ${generated.size}`);
console.log(`Redirected:       ${diffDone ? redirectedCount : 'n/a'}`);
console.log(`Missing:          ${diffDone ? missing.length : 'n/a'}`);
console.log(`HTML files checked: ${htmlFiles.length}`);
for (const w of warnings) console.warn(`WARNING: ${w}`);
for (const e of errors) console.error(`ERROR: ${e}`);
if (errors.length) {
  console.error(`\nCheck FAILED (${errors.length} problem(s)).`);
  process.exit(1);
}
console.log('\nCheck passed.');
