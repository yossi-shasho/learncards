import markdownIt from "markdown-it";

const md = markdownIt({ html: true, typographer: true });

// Front-matter dates are WordPress ISO strings without a zone; treat them as UTC (as Eleventy does for `date`).
const toDate = (d) =>
  d instanceof Date ? d : d === "now" ? new Date() : new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(d) ? d : d + "Z");

// Plain text of an HTML fragment (tags stripped, common entities decoded, whitespace collapsed).
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const htmlText = (html) =>
  String(html)
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) =>
      e[0] === "#"
        ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : +e.slice(1))
        : ENTITIES[e.toLowerCase()] ?? m
    )
    .replace(/\s+/g, " ")
    .trim();

// Top-level <li> items of every top-level <ol> in `html`, in document order, as plain text
// (a nested list's text stays part of its parent step).
function orderedListItems(html) {
  const items = [];
  let olDepth = 0, liDepth = 0, start = -1;
  for (const m of String(html).matchAll(/<(\/?)(ol|ul|li)\b[^>]*>/gi)) {
    const close = m[1] === "/", tag = m[2].toLowerCase();
    if (tag === "ol" || tag === "ul") {
      if (tag === "ol" && !close && olDepth === 0 && liDepth === 0) { olDepth = 1; continue; }
      if (olDepth > 0 && tag === "ol" && close && liDepth === 0) { olDepth = 0; continue; }
      if (olDepth > 0) olDepth += close ? -1 : 1;
      continue;
    }
    if (olDepth !== 1) continue; // <li> of a nested list
    if (!close && liDepth++ === 0) start = m.index + m[0].length;
    else if (close && liDepth > 0 && --liDepth === 0) {
      const t = htmlText(html.slice(start, m.index));
      if (t) items.push(t);
    }
  }
  return items;
}

// `needs` entries that are people, not things (not listed as HowTo tools/supplies).
const PEOPLE = /spectator|assistant|accomplice|partner|child|volunteer|helper/i;
// `needs` entries that get used up (HowToSupply); everything else is a HowToTool.
const SUPPLY = /tape|rubber band|paper|glue/i;

export default function (eleventyConfig) {
  // Body headings: Markdown in old posts jumps from the page <h1> straight to ### or ####. Renumber each
  // document's headings to start at <h2> with no skipped levels (h1 stays reserved for the page title). A
  // renumbered heading keeps its look via a `hl-<original level>` class (see css/style.css).
  eleventyConfig.amendLibrary("md", (mdLib) => {
    mdLib.core.ruler.push("contiguous_headings", (state) => {
      // Outline stack of [original level, new level]: a heading nests one below the nearest earlier
      // heading of a smaller original level, or sits at <h2> when there is none.
      const stack = [];
      let open = null;
      for (const t of state.tokens) {
        if (t.type === "heading_open") {
          const from = +t.tag.slice(1);
          while (stack.length && stack[stack.length - 1][0] >= from) stack.pop();
          const to = Math.min(6, (stack.length ? stack[stack.length - 1][1] : 1) + 1);
          stack.push([from, to]);
          open = to;
          if (to !== from) { t.tag = "h" + to; t.attrJoin("class", "hl-" + from); }
        } else if (t.type === "heading_close" && open) {
          t.tag = "h" + open;
          open = null;
        }
      }
    });
  });

  eleventyConfig.addPassthroughCopy("src/css");
  eleventyConfig.addPassthroughCopy("src/img");
  eleventyConfig.addPassthroughCopy("src/wp-content");
  eleventyConfig.addPassthroughCopy("src/_headers");

  // Global data arrays (categories.json, tags.json) are deep-merged by Eleventy into each
  // trick's own `categories`/`tags` front matter, so templates use `| strs` to keep only the slugs.
  eleventyConfig.addFilter("strs", (arr) => (Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : []));

  eleventyConfig.addCollection("tricks", (api) =>
    api.getFilteredByGlob("src/tricks/*.md").sort((a, b) => b.date - a.date)
  );

  // Look up a {slug,name,...} record in one of the data arrays.
  eleventyConfig.addFilter("bySlug", (list, slug) => (list || []).find((x) => x.slug === slug));
  // Tricks whose front-matter array `field` contains `slug` (or equals it, for `author`).
  eleventyConfig.addFilter("withTerm", (tricks, field, slug) =>
    (tricks || []).filter((t) => {
      const v = t.data[field];
      return Array.isArray(v) ? v.includes(slug) : v === slug;
    })
  );
  eleventyConfig.addFilter("head", (arr, n) => (arr || []).slice(0, n));
  eleventyConfig.addFilter("isoDate", (d) => toDate(d).toISOString().replace(/\.\d{3}Z$/, "Z"));
  eleventyConfig.addFilter("ymd", (d) => toDate(d).toISOString().slice(0, 10));
  eleventyConfig.addFilter("rfc822", (d) => toDate(d).toUTCString());
  eleventyConfig.addFilter("longDate", (d) =>
    toDate(d).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" })
  );
  eleventyConfig.addFilter("youtubeId", (url) => {
    const m = String(url || "").match(/[?&]v=([\w-]{11})/);
    return m ? m[1] : "";
  });
  eleventyConfig.addFilter("latestDate", (items) =>
    items.reduce((max, t) => {
      const d = toDate(t.data.modified || t.date);
      return d > max ? d : max;
    }, new Date(0))
  );

  // Render a Markdown string (intros in _data/*.json) to HTML.
  eleventyConfig.addFilter("markdown", (str) => (str ? md.render(String(str)) : ""));

  // "More tricks like this": the `n` tricks after `url` in the (date-sorted) list, wrapping around.
  eleventyConfig.addFilter("related", (items, url, n = 5) => {
    const list = items || [];
    const i = list.findIndex((t) => t.url === url);
    const out = [];
    for (let k = 1; k < list.length && out.length < n; k++) out.push(list[(Math.max(i, 0) + k) % list.length]);
    return out.filter((t) => t.url !== url);
  });

  // schema.org HowTo node for a trick whose body has an ordered list (>= 2 steps); null otherwise.
  // Steps are the <ol> items verbatim; tools/supplies come from the `needs` front matter.
  eleventyConfig.addFilter("howToLd", (html, { id, name, description, needs }) => {
    const steps = orderedListItems(html);
    if (steps.length < 2) return null;
    const things = (needs || []).filter((n) => typeof n === "string" && !PEOPLE.test(n));
    const tool = things.filter((n) => !SUPPLY.test(n)).map((n) => ({ "@type": "HowToTool", name: n }));
    const supply = things.filter((n) => SUPPLY.test(n)).map((n) => ({ "@type": "HowToSupply", name: n }));
    return {
      "@type": "HowTo",
      "@id": id,
      name,
      description,
      tool: tool.length ? tool : undefined,
      supply: supply.length ? supply : undefined,
      step: steps.map((text, i) => ({ "@type": "HowToStep", position: i + 1, text })),
    };
  });

  // One JSON-LD block per page: {"@context", "@graph": [...]}, safe inside <script>.
  eleventyConfig.addFilter("jsonLd", (graph) =>
    JSON.stringify({ "@context": "https://schema.org", "@graph": (graph || []).filter(Boolean) }, null, 1).replace(
      /</g,
      "\\u003c"
    )
  );
  // BreadcrumbList node from [{name, url}] (site-relative urls).
  eleventyConfig.addFilter("breadcrumbLd", (crumbs, base) => ({
    "@type": "BreadcrumbList",
    "@id": base + crumbs[crumbs.length - 1].url + "#breadcrumb",
    itemListElement: crumbs.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, item: base + c.url })),
  }));

  return {
    dir: { input: "src", output: "_site", includes: "_includes", data: "_data" },
    templateFormats: ["md", "njk"],
    markdownTemplateEngine: false,
    htmlTemplateEngine: "njk",
  };
}
