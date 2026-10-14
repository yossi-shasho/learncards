// Front-matter dates are WordPress ISO strings without a zone; treat them as UTC (as Eleventy does for `date`).
const toDate = (d) =>
  d instanceof Date ? d : d === "now" ? new Date() : new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(d) ? d : d + "Z");

export default function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy("src/css");
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

  return {
    dir: { input: "src", output: "_site", includes: "_includes", data: "_data" },
    templateFormats: ["md", "njk"],
    markdownTemplateEngine: false,
    htmlTemplateEngine: "njk",
  };
}
