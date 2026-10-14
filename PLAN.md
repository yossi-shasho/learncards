# learncards.net → static site

## Status (2026-10-14)

- **Done:** site built, 170 original URLs preserved or redirected, deployed to Cloudflare Pages.
- **Live:** cutover complete; learncards.net is served by Cloudflare Pages (auto-deploys from `main`). WordPress/HostGator is gone and being cancelled. The importer is retired; `scripts/check.mjs` diffs against the frozen `scripts/original-urls.txt`.
- **Remaining:** re-submit the sitemap in Google Search Console; finish Cloudflare Email Routing for webmaster@learncards.net.

(Sections below are the original plan, kept for history.)

## Decisions (settled)

- **Generator:** Eleventy (11ty), Nunjucks templates, no client-side JS.
- **Content:** one Markdown file per trick in `src/tricks/`, YAML front matter:
  `title, slug, date, modified, categories, tags, author, seoTitle, seoDescription, video` (optional YouTube URL).
- **Import:** `scripts/import.mjs` pulls posts, categories, tags, authors and Yoast meta from the live
  WP REST API (`/wp-json/wp/v2/...`), converts HTML → Markdown, **strips all images**, and writes the `.md` files.
  Kept in the repo; re-runnable.
- **Images:** dropped entirely. Only the logo (`wp-content/uploads/2019/06/inner_logo-1.jpg`) is kept, at its
  original path. Old upload URLs are allowed to 404.
- **Videos:** a trick whose video is dead is **removed** (article text is built around the video). Liveness check =
  YouTube oEmbed returns 200. Removed tricks get a 301 to their primary category. Live videos render as a plain
  `<iframe>`. Current state: 1 trick has a video (`the-rising-card`), and it is alive. No AI needed for this check —
  oEmbed is deterministic; revisit only if non-YouTube hosts show up.
- **URLs preserved exactly:** `/<slug>/`, `/category/<x>/`, `/tag/<x>/`, `/author/<x>/`, `/feed/` (RSS),
  `sitemap.xml`, `robots.txt`.
- **URLs redirected (301 via `_redirects`):** `/page/N/` → `/`, `/category/<x>/page/N/` → `/category/<x>/`,
  removed tricks → their category. Dropped without redirect: search, `/wp-json`, date archives, comment feeds.
- **Listing pages:** homepage lists all tricks grouped by category; category/tag/author pages list all their tricks.
  No pagination.
- **SEO per page:** `<title>`, meta description (Yoast), canonical, Open Graph (logo as site-wide `og:image`),
  `Article` JSON-LD on tricks, author byline.
- **Design:** old-school (GeoCities-but-tidy): centered column, system/serif fonts, borders, blue underlined links,
  logo top-left, category nav. One hand-written stylesheet, light only, **responsive** (collapses to single column
  on mobile). Mock shown before full build.
- **Check:** `scripts/check.mjs` runs after build: diffs generated URLs against the live sitemap (170 URLs) and
  **fails** if any is neither generated nor redirected; re-verifies videos and **warns** on dead ones.
- **Hosting/deploy:** GitHub `yossi-shasho/learncards` (public, `main`) → Cloudflare Pages auto-build.
  Deploy = `git push`. DNS cutover is manual, after eyeballing the preview URL. WP stays live until then.
- **Docs:** `README.md` — add a trick (`.md` file) → `git push`.

## Work split

Four pieces, run as **three agents max**, in two waves. Pieces that touch different files run in parallel;
nothing writes to the same files twice.

### Wave 1 (parallel, independent)

| Piece | Files | Model | Why this model |
|---|---|---|---|
| **A. Importer** — `scripts/import.mjs`: REST fetch, HTML→MD (turndown), strip images, oEmbed video check, write `src/tricks/*.md` + `src/_data/{categories,tags,authors}.json`. Run it and commit the content. | `scripts/import.mjs`, `src/tricks/`, `src/_data/` | **Sonnet** | Mechanical: well-known API, well-known library. Correctness is verifiable by diffing counts (157 posts, 9 cats, 1 tag, 2 authors). |
| **B. Site skeleton + templates + CSS** — Eleventy config with permalinks matching WP, layouts (`base`, `trick`, `listing`), home/category/tag/author/feed/sitemap/robots templates, `_redirects`, the stylesheet, logo. Uses 3 hand-written sample tricks until A lands. | `eleventy.config.js`, `src/_includes/`, `src/*.njk`, `src/css/`, `src/wp-content/` | **Opus** | Design-heavy: SEO head, permalink rules, the responsive old-school look. Judgement > throughput. |

### Wave 2 (after both land)

| Piece | Files | Model | Why |
|---|---|---|---|
| **C. Check script + README + wiring** — `scripts/check.mjs` (sitemap diff, redirect awareness, video warn), `npm run build` → check, README. Full build against real content, fix any URL misses. | `scripts/check.mjs`, `package.json`, `README.md` | **Sonnet** | Scripted, spec is exact (URL list is known). |
| **D. Review + mock sign-off** — I (main session) build, open the preview in the browser, compare with the live site on 3 pages (home, a trick, a category), show you the mock, then create the GitHub repo and push. | — | **Opus (this session)** | Needs the whole context and your eyes. |

### Model rule of thumb

- Opus for anything where the spec is fuzzy or taste matters (templates, CSS, SEO head, review).
- Sonnet for anything where the spec is exact and the output is checkable by a script (importer, check script, README).
- No Haiku: nothing here is small enough to be worth the quality risk.
- No agent gets a shared file; the only hand-off is A's output directory, which B only reads.

## Your manual steps

1. Approve the mock.
2. Connect `yossi-shasho/learncards` to Cloudflare Pages (build: `npm run build`, output: `_site`).
3. Check the `*.pages.dev` preview, then point `learncards.net` DNS at Cloudflare.
