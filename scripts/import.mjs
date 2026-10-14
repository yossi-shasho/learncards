// Imports learncards.net from the WordPress REST API into Eleventy content.
import { mkdir, writeFile, rm, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import TurndownService from 'turndown';
import * as yaml from 'js-yaml';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://learncards.net/wp-json/wp/v2';
const TRICKS = path.join(ROOT, 'src/tricks');
const DATA = path.join(ROOT, 'src/_data');
const FIELDS = 'id,slug,link,title,date,modified,categories,tags,author,content,excerpt,yoast_head_json';

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»', copy: '©', reg: '®', trade: '™', eacute: 'é', egrave: 'è', agrave: 'à', ccedil: 'ç', times: '×', deg: '°', acute: '’', iexcl: '¡', iquest: '¿', middot: '·', bull: '•', euro: '€', pound: '£', frac12: '½', frac14: '¼', frac34: '¾', hearts: '♥', spades: '♠', clubs: '♣', diams: '♦', prime: '′', Prime: '″' };
const decode = (s = '') =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return String.fromCodePoint(n);
    }
    return NAMED[e] ?? NAMED[e.toLowerCase()] ?? m;
  });

async function getJson(url, { allowFail = false } = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { headers: { 'user-agent': 'learncards-importer' } });
    if (res.ok) return res.json();
    if (allowFail && res.status === 400) return null;
    if (res.status < 500) throw new Error(`${res.status} for ${url}`);
  }
  throw new Error(`Failed: ${url}`);
}

async function getAll(endpoint, extra = '') {
  const out = [];
  for (let page = 1; ; page++) {
    const data = await getJson(`${API}/${endpoint}?per_page=100&page=${page}${extra}`, { allowFail: true });
    if (!data || !data.length) break;
    out.push(...data);
    if (data.length < 100) break;
  }
  return out;
}

const simple = (a) => a.map(({ id, slug, name, description }) => ({ id, slug, name: decode(name), description: decode(description || '') }));

// ---- HTML cleanup -------------------------------------------------------
const YT_RE = /(?:https?:)?\/\/(?:www\.|m\.)?(?:youtube(?:-nocookie)?\.com\/(?:watch\?[^\s"'<>]*?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})[^\s"'<>]*/gi;

function stripImages(html) {
  return html
    .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, '')
    .replace(/<a\b[^>]*>\s*(?:<img\b[^>]*>\s*)+<\/a>/gi, '')
    .replace(/<img\b[^>]*>/gi, '')
    .replace(/<figure\b[^>]*>([\s\S]*?)<\/figure>/gi, (m, inner) =>
      decode(inner.replace(/<[^>]+>/g, '')).trim() ? m : '')
    .replace(/<figcaption\b[^>]*>\s*<\/figcaption>/gi, '')
    .replace(/<p\b[^>]*>(\s|&nbsp;|<br\s*\/?>)*<\/p>/gi, '');
}

function extractVideos(html) {
  const ids = [];
  for (const m of html.matchAll(new RegExp(YT_RE.source, 'gi'))) if (!ids.includes(m[1])) ids.push(m[1]);
  if (!ids.length) return { html, ids };
  let out = html
    .replace(/<a\b[^>]*href="[^"]*(?:youtube|youtu\.be)[^"]*"[^>]*>[\s\S]*?<\/a>/gi, '')
    .replace(new RegExp(YT_RE.source, 'gi'), '')
    .replace(/<figure\b[^>]*>\s*<div\b[^>]*>\s*<\/div>\s*<\/figure>/gi, '')
    .replace(/<p\b[^>]*>(\s|&nbsp;|<br\s*\/?>)*<\/p>/gi, '');
  return { html: out, ids };
}

const td = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-', codeBlockStyle: 'fenced', emDelimiter: '*' });

async function ytAlive(id) {
  const url = `https://www.youtube.com/oembed?url=${encodeURIComponent('https://www.youtube.com/watch?v=' + id)}&format=json`;
  try { return (await fetch(url)).status === 200; } catch { return false; }
}

// Authors folded into the main 'learncards' author (removed from the site; their URL is redirected).
const DROP_AUTHORS = new Set(['arik-w']);
// Display names for authors (WordPress has the login name).
const AUTHOR_NAMES = { learncards: 'Joe Cards' };

// ---- main ---------------------------------------------------------------
const [posts, cats, tags, users] = await Promise.all([
  getAll('posts', `&_fields=${FIELDS}`),
  getAll('categories'),
  getAll('tags'),
  getAll('users'),
]);
const categories = simple(cats.filter((c) => c.count > 0)), tagList = simple(tags.filter((t) => t.count > 0)), authors = simple(users).filter((u) => !DROP_AUTHORS.has(u.slug)).map((u) => ({ ...u, name: AUTHOR_NAMES[u.slug] || u.name }));
const catSlug = new Map(categories.map((c) => [c.id, c.slug]));
const tagSlug = new Map(tagList.map((c) => [c.id, c.slug]));
const authSlug = new Map(simple(users).map((c) => [c.id, DROP_AUTHORS.has(c.slug) ? 'learncards' : c.slug]));

await mkdir(TRICKS, { recursive: true });
await mkdir(DATA, { recursive: true });
for (const f of await readdir(TRICKS)) if (f.endsWith('.md')) await rm(path.join(TRICKS, f));

const removed = [];
const notes = [];
let written = 0;
for (const p of posts) {
  const cs = p.categories.map((id) => catSlug.get(id)).filter(Boolean);
  let html = stripImages(p.content.rendered);
  const { html: noVid, ids } = extractVideos(html);
  html = noVid;
  let video;
  if (ids.length) {
    if (ids.length > 1) notes.push(`${p.slug}: ${ids.length} YouTube videos, using first alive`);
    for (const id of ids) if (await ytAlive(id)) { video = `https://www.youtube.com/watch?v=${id}`; break; }
    if (!video) { removed.push({ slug: p.slug, category: cs[0] }); continue; }
  }
  const body = td.turndown(html).replace(/\n{3,}/g, '\n\n').trim();
  if (!body) notes.push(`${p.slug}: empty body`);
  const y = p.yoast_head_json || {};
  const fm = {
    title: decode(p.title.rendered),
    slug: p.slug,
    date: p.date,
    modified: p.modified,
    categories: cs,
    tags: p.tags.map((id) => tagSlug.get(id)).filter(Boolean),
    author: authSlug.get(p.author),
    seoTitle: decode(y.title || p.title.rendered),
  };
  if (y.description) fm.seoDescription = decode(y.description);
  fm.excerpt = decode(p.excerpt.rendered.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim().replace(/\s*(…|\[…\]|\[&hellip;\]|\.\.\.)$/, '');
  if (video) fm.video = video;
  const text = `---\n${yaml.dump(fm, { lineWidth: -1, quotingType: '"', forceQuotes: true })}---\n\n${body}\n`;
  await writeFile(path.join(TRICKS, `${p.slug}.md`), text);
  written++;
}

const write = (n, d) => writeFile(path.join(DATA, n), JSON.stringify(d, null, 2) + '\n');
await write('categories.json', categories);
await write('tags.json', tagList);
await write('authors.json', authors);
await write('removed.json', removed);

console.log(`Posts fetched: ${posts.length}\nWritten: ${written}\nRemoved (dead video): ${removed.length}`);
console.log(`Categories: ${categories.length}, Tags: ${tagList.length}, Authors: ${authors.length}`);
if (notes.length) console.log('Notes:\n  ' + notes.join('\n  '));
