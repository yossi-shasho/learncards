// Re-export the importer's data files under a non-colliding name: inside trick templates
// `categories`/`tags` are shadowed by (merged with) the trick's own front matter.
import { readFile } from "node:fs/promises";

const load = async (name) => JSON.parse(await readFile(new URL(`./${name}.json`, import.meta.url), "utf8"));

export default async function () {
  const [categories, tags, authors, removed] = await Promise.all(
    ["categories", "tags", "authors", "removed"].map(load)
  );
  return { categories, tags, authors, removed };
}
