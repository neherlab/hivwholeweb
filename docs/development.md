# Development

The website is a static site: pages, scripts, and data files, with no server code. Until 2026, a Flask application served it at `hiv.biozentrum.unibas.ch`. [`docs/conversion.md`](conversion.md) describes how the static site was made from it. The git tag `server-app-last-deployed-version` holds the code of the old server (its last change before the conversion is commit `92f6e82`); the capture of the live server and the conversion tools are not kept.

[`docs/hosting.md`](hosting.md) describes the hosts that serve the site and its data, and how the deploys fill them.

## Repository layout

- `src/`: the source of the page host: the pages, the static files under `src/static/`, and the shared page parts in `src/_partials/`
- `dist/`: the build output of `src/` (not in git)
- `web-data/`: the derived data, at its URL paths on the data host; `just data-pull` fills it from the data host:
  - `api/`: the API responses, stored with a `.json` suffix, because some API paths are prefixes of others
  - `static/eti/data/`: the training data of the time-since-infection estimator (ETI, [`src/static/eti/README.md`](../src/static/eti/README.md))
  - `robots.txt`: the robots file of the data host, which disallows all crawling
- `data-manifest.json`: every object of the data host, with its source, sha256, size, and headers
- `server/`: the local page host and data host (Bun, no runtime dependencies)
- `scripts/`: the build, the uploads, and the data manifest, archives, deploy, and pull
- `dev/`: the project container
- `.github/`: the CI workflow, which builds and uploads the site ([Deployment from CI](hosting.md#deployment-from-ci))
- `docs/`: the documents for maintainers: development, hosting, and the conversion from the Flask server

## Commands

`mise.toml` pins the tools for the host and for the project container (`dev/dev`). The `justfile` recipes marked "container" run in the project container; the upload recipes read their settings from `.env` (`.env.example`) and their AWS credentials from the standard AWS variables ([Uploads](hosting.md#uploads)). The recipes that run scripts with package imports first run `just deps`, which installs the versions of `bun.lock` into `node_modules/` and fails when `package.json` and `bun.lock` disagree.

- `just serve`: build `dist/` and serve it at http://127.0.0.1:8080/ (`PORT` changes the port); it builds again when a file under `src/` changes
- `just serve-data`: serve `web-data/` and the pulled download files as the data host at http://127.0.0.1:8081/ (`DATA_PORT` changes the port)
- `just format`: format the TypeScript of `scripts/` and `server/` and the HTML, CSS, and JavaScript of `src/` with oxfmt (`.oxfmtrc.json`); the vendored packages in `src/static/components/` keep their own style
- `just typecheck`, `just lint`: the typecheck, and the lint: oxlint and a format check of that code, then actionlint and shellcheck of the workflow and its script
- `just build-dist [--preview]`: write `dist/` ([Build](#build))
- `just data-pull [--files]`: fill `web-data/`, and with `--files` also `.cache/data-files/` with the download files, from the archives of the data host
- `just publish-site`, `just publish-preview <site>...`: upload `dist/` to the production page host or to preview sites ([Page host](hosting.md#page-host))
- `just data-archives`, `just data-manifest`, `just data-verify`, `just data-deploy`: build the data archives, write the manifest, and check and fill the data host ([Data host](hosting.md#data-host))

All checks run only locally and only when called ([Deployment from CI](hosting.md#deployment-from-ci)). No recipe downloads or uploads data on its own: only `just data-pull`, `just data-deploy`, and `just data-verify` reach the data host, and only when called.

## Local servers

By default, the local site reads its data from the production data host. With `HIVWHOLEWEB_DATA_URL=http://127.0.0.1:8081 just serve` and `just serve-data` in a second terminal, it works offline; the downloads and the example tree images need `just data-pull --files` first.

## Build

`just build-dist` (`scripts/build.ts`) builds `dist/` from `src/` in these steps:

1. Read `src/`, without `src/_partials/`.
2. Replace each marker such as `<!-- include nav -->` in a page with the part `src/_partials/nav.html`: the navigation bar and the shared page head live in one file each.
3. Point every data URL of the pages and scripts (`/api/data/`, `/static/data/`, `/static/eti/data/`) to the data host.
4. Apply the analytics setting: write the domain into the Plausible tag of each page, or remove the tag.
5. Leave out the files of the vendor packages in `static/components/` that no page, stylesheet, or script loads, directly or through another vendor file: their sources, docs, and unminified copies.
6. Move `static/` to `static-<hash>/`, where `<hash>` follows the content of the static files, and rewrite every reference to it.
7. For `--preview`, write a `robots.txt` that disallows all crawling.
8. Check the result: the build fails on a leftover include marker, a link that names no file of the build, an unversioned `/static/` reference, a same-host data URL, a stylesheet, font, or script from another host (except the analytics script when analytics is on), a text file over 10 MB, which CloudFront would not compress, and a file path that the key store cannot hold ([Key stores](hosting.md#key-stores)).

Local, preview, and production builds differ only in their settings:

- `HIVWHOLEWEB_DATA_URL`: the origin of the data host, by default `https://data.hiv.neherlab.org`
- `HIVWHOLEWEB_PLAUSIBLE_DOMAIN`: the domain under which the pages report visits to Plausible; empty (the default) for no analytics. Only the production build sets it
- `--preview`

## Data directory

The data directory (`HIVWHOLEWEB_DATA`, by default `../hivwholeweb_data` next to the main checkout) is a copy of the private bucket `s3://hivwholeweb-data`. Only `just data-manifest`, `just data-archives`, and `just data-deploy` read it.
