// Directory data for every trick: layout + WordPress-style permalink (/<slug>/, never /tricks/...).
// A function permalink is used because Markdown here is not pre-processed by a template engine.
export default {
  layout: "trick.njk",
  permalink: (data) => `/${data.slug || data.page.fileSlug}/index.html`,
};
