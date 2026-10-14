# learncards

The site at https://learncards.net/ (it replaced the old WordPress site), built with [Eleventy](https://www.11ty.dev/).
One Markdown file per card trick, no client-side JS, no images except the logo. URLs match the old WordPress ones.

## Commands

```sh
npm install        # once
npm run serve      # local preview with live reload
npm run build      # eleventy build into _site/, then the check script
npm run check      # check script only (against an existing _site/)
```

## Add or edit a trick

Content is just the `.md` files in `src/tricks/`: edit (or add) one, `git push` to `main`, and Cloudflare Pages deploys it.
(The old WordPress importer survives as `npm run import:legacy`, but it is retired and refuses to run without `--force`.)

Copy an existing file in `src/tricks/`, rename it, edit it. The filename (without `.md`) is the slug and the URL:
`src/tricks/my-trick.md` becomes `/my-trick/`.

| Field | Meaning |
|---|---|
| `title` | Page heading and `<title>` |
| `slug` | Must equal the filename (without `.md`) |
| `date`, `modified` | ISO timestamps, e.g. `2019-03-02T06:39:46` |
| `categories` | List of category slugs (see `src/_data/categories.json`) |
| `tags` | List of tag slugs (may be empty) |
| `author` | Author slug (see `src/_data/authors.json`) |
| `seoTitle` | Optional; overrides `<title>` |
| `seoDescription` / `excerpt` | Meta description / short summary |
| `video` | Optional YouTube URL, rendered as a plain iframe |

The body is Markdown. Do not add images.

**Dead video:** if a trick's video dies (the check script warns about it), delete the trick file and add its slug to
`src/_data/removed.json` so the old URL 301-redirects to its category:

```json
[{ "slug": "the-rising-card", "category": "intermediate-tricks" }]
```

## Deploy

Live on Cloudflare Pages at https://learncards.net (Pages project `learncards`, repo `yossi-shasho/learncards`,
auto-deploys from `main`; every push deploys). DNS is on Cloudflare; the domain is registered at Bluehost.

| Setting | Value |
|---|---|
| Framework preset | None |
| Build command | `npm run build` |
| Build output directory | `_site` |
| Node version | from `.node-version` (22) |

Network failures in the check script only warn, so they cannot fail a deploy.
After a deploy, run `npm run smoke https://learncards.net` (or `https://<project>.pages.dev` for a preview).
Redirects and `Content-Type` headers come from `_redirects` / `_headers`, so those smoke checks only pass on Cloudflare.

### Operations

- Re-submit `https://learncards.net/sitemap.xml` in Google Search Console.
- Email for `webmaster@learncards.net` is Cloudflare Email Routing forwarding to Gmail (being set up).
- HostGator hosting is cancelled; nothing depends on it.

## What the check script enforces

`scripts/check.mjs` runs after every build. It **fails** (exit 1) if:

- a URL in the frozen original WordPress URL list (`scripts/original-urls.txt`, 170 paths) is neither generated nor covered by a rule in `_site/_redirects`
- `_site/sitemap.xml`, `robots.txt`, `feed/index.html`, `css/style.css` or the logo are missing
- any generated HTML page contains an `<img>` other than the logo
- any generated HTML page does not have exactly one `<link rel="canonical">` starting with `https://learncards.net/`

It only **warns** if a trick's YouTube video no longer returns 200 from oEmbed, or if the network is unavailable.
Use `node scripts/check.mjs --offline` or `CHECK_OFFLINE=1` to skip the YouTube check (the URL diff is always file-based).
