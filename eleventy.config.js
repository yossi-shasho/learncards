import markdownIt from "markdown-it";

const md = markdownIt({ html: true, typographer: true });

// Front-matter dates are WordPress ISO strings without a zone; treat them as UTC (as Eleventy does for `date`).
const toDate = (d) =>
  d instanceof Date ? d : d === "now" ? new Date() : new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(d) ? d : d + "Z");

export default function (eleventyConfig) {
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
  eleventyConfig.addFilter("isoDate", (d) => toDate(d).toISOString().replace(".000Z", "Z"));
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
