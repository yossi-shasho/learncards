// Post-deploy smoke test. Usage: node scripts/smoke.mjs <base-url>
// Prints PASS/FAIL/WARN per check; exits 1 if any FAIL.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const base = (process.argv[2] || '').replace(/\/+$/, '');
if (!/^https?:\/\//.test(base)) {
  console.error('Usage: node scripts/smoke.mjs <base-url>   e.g. https://learncards.pages.dev');
  process.exit(2);
}
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;

const get = (p) => fetch(base + p, { redirect: 'manual', signal: AbortSignal.timeout(20000) });
function report(ok, name, detail = '') {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
}
const warn = (name, detail) => console.log(`WARN  ${name}  (${detail})`);

async function check(name, fn) {
  try { await fn(); } catch (e) { report(false, name, e.message); }
}
// GET path, expect status, then optional extra assertions on (res, body) returning a failure string or ''.
async function expectStatus(p, status, extra) {
  await check(`GET ${p} -> ${status}`, async () => {
    const res = await get(p);
    const body = await res.text();
    let problem = res.status === status ? '' : `got ${res.status}`;
    if (!problem && extra) problem = extra(res, body) || '';
    report(!problem, `GET ${p} -> ${status}`, problem);
  });
}
async function expectRedirect(p, to) {
  await check(`GET ${p} -> 301 ${to}`, async () => {
    const res = await get(p);
    const loc = res.headers.get('location') || '';
    let locPath = loc;
    try { locPath = new URL(loc, base + '/').pathname; } catch {}
    const ok = res.status === 301 && locPath === to;
    report(ok, `GET ${p} -> 301 ${to}`, ok ? '' : `got ${res.status}${loc ? ' location=' + loc : ''}`);
  });
}

await expectStatus('/', 200, (r, b) => (b.includes('<title>Learncards') ? '' : 'title does not contain "<title>Learncards"'));
await expectStatus('/the-rising-card/', 200, (r, b) => {
  if (!b.includes('href="https://learncards.net/the-rising-card/"')) return 'canonical missing';
  if (!/<iframe[^>]+youtube\.com\/embed/.test(b)) return 'youtube.com/embed iframe missing';
});
for (const p of ['/category/easy-tricks/', '/tag/prediction/', '/author/learncards/', '/about/', '/glossary/']) {
  await expectStatus(p, 200);
}
await expectStatus('/sitemap.xml', 200, (r, b) => {
  const n = (b.match(/<loc>/g) || []).length;
  return n >= 170 ? '' : `only ${n} <loc>`;
});
await expectStatus('/robots.txt', 200, (r, b) => (/Sitemap:/i.test(b) ? '' : 'no Sitemap: line'));

await check('GET /feed/', async () => {
  const res = await get('/feed/');
  await res.text();
  const ct = res.headers.get('content-type') || '';
  if (res.status !== 200) return report(false, 'GET /feed/ -> 200', `got ${res.status}`);
  if (/rss|xml/i.test(ct)) return report(true, 'GET /feed/ -> 200 rss/xml', ct);
  warn('GET /feed/ content-type', `${ct}; _headers should set application/rss+xml on Cloudflare`);
});

await expectRedirect('/page/2/', '/');
await expectRedirect('/category/easy-tricks/page/2/', '/category/easy-tricks/');
await expectRedirect('/author/arik-w/', '/');

await check('GET /img/badges/netscape-now.gif', async () => {
  const res = await get('/img/badges/netscape-now.gif');
  await res.arrayBuffer();
  const ct = res.headers.get('content-type') || '';
  report(res.status === 200 && ct.includes('image/gif'), 'GET /img/badges/netscape-now.gif -> 200 image/gif', `${res.status} ${ct}`);
});
await check('GET logo', async () => {
  const p = '/wp-content/uploads/2019/06/inner_logo-1.jpg';
  const res = await get(p);
  await res.arrayBuffer();
  report(res.status === 200, `GET ${p} -> 200`, res.status === 200 ? '' : `got ${res.status}`);
});
await expectStatus('/this-does-not-exist/', 404);

// Random trick URLs from the local build's sitemap
const sm = path.join(ROOT, '_site', 'sitemap.xml');
if (fs.existsSync(sm)) {
  const paths = [...fs.readFileSync(sm, 'utf8').matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)]
    .map((m) => new URL(m[1]).pathname)
    .filter((p) => /^\/[^/]+\/$/.test(p) && !/^\/(about|glossary|feed)\/$/.test(p));
  for (let i = paths.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [paths[i], paths[j]] = [paths[j], paths[i]];
  }
  for (const p of paths.slice(0, 10)) await expectStatus(p, 200);
} else {
  warn('random trick URLs', '_site/sitemap.xml not found locally; skipped');
}

console.log(fails ? `\n${fails} check(s) FAILED` : '\nAll checks passed');
process.exit(fails ? 1 : 0);
