// Replace every link to an outside site with its plain link text. Usage: node scripts/strip-external-links.mjs [--dry-run]
//
// Scope: the bodies of src/tricks/*.md, src/glossary.md and src/about.md (front matter, including `video:`, is
// never touched), plus every string value in src/_data/intros.json and src/_data/home.json. Templates are not
// touched (badge/RSS links stay).
// "Outside" = an absolute http(s):// or protocol-relative //host URL whose host is not learncards.net or
// www.learncards.net. Relative links and links to learncards.net stay as they are.
// Handled forms: inline Markdown links [text](url "title") (text may span lines / contain **bold**), reference
// links [text][ref] with a matching [ref]: url definition (the definition line is dropped too), autolinks <url>,
// and HTML <a href="url">text</a>. Images (![...]) are left alone; the site has none in content.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OWN_HOSTS = new Set(['learncards.net', 'www.learncards.net']);
const dryRun = process.argv.includes('--dry-run');

function isExternal(url) {
  const u = url.trim().replace(/^<|>$/g, '');
  if (!/^(https?:)?\/\//i.test(u)) return false;
  try {
    return !OWN_HOSTS.has(new URL(u, 'https://learncards.net').hostname.toLowerCase());
  } catch {
    return true; // unparseable absolute URL: treat as outside
  }
}

// Returns [newText, removedLinks[]]
function strip(text) {
  const removed = [];
  let out = text;

  // Reference definitions: [ref]: url "title"
  const refs = new Map();
  out = out.replace(/^ {0,3}\[([^\]]+)\]:\s*(<[^>]*>|\S+)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?[ \t]*\n?/gm, (m, ref, url) => {
    if (!isExternal(url)) return m;
    refs.set(ref.toLowerCase(), url);
    return '';
  });
  if (refs.size) {
    out = out.replace(/(?<!!)\[((?:[^\[\]]|\[[^\[\]]*\])+)\]\[([^\]]*)\]/g, (m, label, ref) => {
      const url = refs.get((ref || label).toLowerCase());
      if (!url) return m;
      removed.push(url);
      return label;
    });
  }

  // Inline links: [text](url "title") — text may contain one level of nested brackets and newlines.
  out = out.replace(
    /(?<!!)\[((?:[^\[\]]|\[[^\[\]]*\])*)\]\(\s*(<[^>]*>|[^\s()]+(?:\([^\s()]*\)[^\s()]*)*)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g,
    (m, label, url) => {
      if (!isExternal(url)) return m;
      removed.push(url);
      return label;
    },
  );

  // Autolinks <https://...>
  out = out.replace(/<((?:https?:)?\/\/[^\s<>]+)>/gi, (m, url) => {
    if (!isExternal(url)) return m;
    removed.push(url);
    return url;
  });

  // HTML anchors
  out = out.replace(/<a\b[^>]*?\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi, (m, q, url, label) => {
    if (!isExternal(url)) return m;
    removed.push(url);
    return label;
  });

  return [out, removed];
}

const report = [];
let total = 0;

async function doMarkdown(file) {
  const src = await readFile(file, 'utf8');
  const m = src.match(/^---\n[\s\S]*?\n---\n/);
  const head = m ? m[0] : '';
  const [body, removed] = strip(src.slice(head.length));
  if (!removed.length) return;
  if (!dryRun) await writeFile(file, head + body);
  report.push([file, removed]);
  total += removed.length;
}

async function doJson(file) {
  const data = JSON.parse(await readFile(file, 'utf8'));
  const removedAll = [];
  const walk = (v) => {
    if (typeof v === 'string') {
      const [s, removed] = strip(v);
      removedAll.push(...removed);
      return s;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  const out = walk(data);
  if (!removedAll.length) return;
  if (!dryRun) await writeFile(file, JSON.stringify(out, null, 2) + '\n');
  report.push([file, removedAll]);
  total += removedAll.length;
}

const tricksDir = path.join(ROOT, 'src/tricks');
for (const f of (await readdir(tricksDir)).filter((n) => n.endsWith('.md')).sort()) await doMarkdown(path.join(tricksDir, f));
for (const f of ['src/glossary.md', 'src/about.md']) await doMarkdown(path.join(ROOT, f));
for (const f of ['src/_data/intros.json', 'src/_data/home.json']) await doJson(path.join(ROOT, f));

for (const [file, removed] of report) {
  console.log(`${path.relative(ROOT, file)}: ${removed.length}`);
  for (const u of removed) console.log(`    ${u}`);
}
console.log(`\n${total} external link(s) removed from ${report.length} file(s)${dryRun ? ' (dry run)' : ''}.`);
