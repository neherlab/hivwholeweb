# Tasks of the static site. Recipes marked "container" run in the project
# container: from the host through dev/dev, inside it directly (CI runs
# `dev/dev just <recipe>`). `serve` and `serve-data` run on the host with the
# tools of mise.toml.

set dotenv-load

dev := if env("DEV_CONTAINER", "") == "1" { "" } else { "dev/dev" }

# The upload scripts read the AWS settings of one target under the standard AWS
# names; these maps take them from the prefixed names of .env.example and of the
# organization secrets.
preview_env := 'AWS_ACCESS_KEY_ID="${PREVIEWS_NEHERLAB_CLICK_AWS_ACCESS_KEY_ID:-${AWS_ACCESS_KEY_ID:-}}" AWS_SECRET_ACCESS_KEY="${PREVIEWS_NEHERLAB_CLICK_AWS_SECRET_ACCESS_KEY:-${AWS_SECRET_ACCESS_KEY:-}}" AWS_DEFAULT_REGION="${PREVIEWS_NEHERLAB_CLICK_AWS_DEFAULT_REGION:?}" AWS_S3_BUCKET="${PREVIEWS_NEHERLAB_CLICK_AWS_S3_BUCKET:?}" AWS_CLOUDFRONT_DISTRIBUTION_ID="${PREVIEWS_NEHERLAB_CLICK_AWS_CLOUDFRONT_DISTRIBUTION_ID:?}"'
site_env := 'AWS_DEFAULT_REGION="${HIVWHOLEWEB_SITE_AWS_DEFAULT_REGION:?}" AWS_S3_BUCKET="${HIVWHOLEWEB_SITE_AWS_S3_BUCKET:?}" AWS_CLOUDFRONT_DISTRIBUTION_ID="${HIVWHOLEWEB_SITE_AWS_CLOUDFRONT_DISTRIBUTION_ID:?}" AWS_CLOUDFRONT_KVS_ARN="${HIVWHOLEWEB_SITE_AWS_KVS_ARN:?}"'
data_env := 'AWS_DEFAULT_REGION="${HIVWHOLEWEB_DATA_AWS_DEFAULT_REGION:?}" AWS_S3_BUCKET="${HIVWHOLEWEB_DATA_AWS_S3_BUCKET:?}" AWS_S3_SOURCE_BUCKET="${HIVWHOLEWEB_DATA_AWS_S3_SOURCE_BUCKET:?}" AWS_CLOUDFRONT_DISTRIBUTION_ID="${HIVWHOLEWEB_DATA_AWS_CLOUDFRONT_DISTRIBUTION_ID:?}" AWS_CLOUDFRONT_KVS_ARN="${HIVWHOLEWEB_DATA_AWS_KVS_ARN:?}"'

git_common_dir := `git rev-parse --path-format=absolute --git-common-dir`
work_dir := parent_directory(parent_directory(git_common_dir))

# Data files of the old server (static/data), served at /static/data/: outside git.
export HIVWHOLEWEB_DATA := env("HIVWHOLEWEB_DATA", work_dir / "hivwholeweb_data")

# Origin of the data host: the build points the data URLs of the pages to it.
export HIVWHOLEWEB_DATA_URL := if env("HIVWHOLEWEB_DATA_URL", "") == "" { "https://data.hiv.neherlab.org" } else { env("HIVWHOLEWEB_DATA_URL") }

port := env("PORT", "8080")

data_port := env("DATA_PORT", "8081")

default:
    @just --list

# Build dist/ and serve it on the host at http://127.0.0.1:{{port}}/, building again on changes under src/
serve:
    PORT={{port}} mise exec -- bun server/serve.ts

# Build dist/ and serve it from the project container at http://127.0.0.1:{{port}}/
serve-docker:
    DEV_PUBLISH={{port}} dev/dev bun server/serve.ts

# Serve web-data/ and the pulled download files as the data host, at http://127.0.0.1:{{data_port}}/
serve-data:
    DATA_PORT={{data_port}} mise exec -- bun server/serve-data.ts

# Install the locked dependencies into node_modules/ without changing bun.lock (container)
deps:
    {{dev}} bun install --frozen-lockfile --no-summary --no-progress

# Typecheck the server, the scripts, and the ETI estimator (container)
typecheck: deps
    {{dev}} bun run typecheck

# Lint the GitHub workflows and their scripts (container)
lint:
    {{dev}} actionlint
    {{dev}} shellcheck .github/scripts/publish-previews

# Write dist/, the page host files, from src/ (container); see scripts/build.ts
build-dist *args:
    {{dev}} bun scripts/build-dist.ts {{args}}

# Upload dist/ to the production page host and sync its key store (container); see scripts/publish-site.ts
publish-site: deps
    {{site_env}} {{dev}} bun scripts/publish-site.ts

# Upload dist/ to preview sites (container); see scripts/publish-preview.ts
publish-preview +sites: deps
    {{preview_env}} {{dev}} bun scripts/publish-preview.ts {{sites}}

# Build the data archives in tmp/archives/ that data-manifest.json does not name yet (container)
data-archives: deps
    {{dev}} bun scripts/data-archives.ts

# Build the data archives, then write data-manifest.json, the objects of the public data bucket (container)
data-manifest: deps
    {{dev}} bun scripts/data-manifest.ts

# Fill web-data/, and with --files .cache/data-files/, from the archives of the data host (container)
data-pull *args: deps
    {{dev}} bun scripts/data-pull.ts {{args}}

# Check the public data bucket, its index, and its key store against data-manifest.json, read-only (container)
data-verify: deps
    {{data_env}} {{dev}} bun scripts/data-deploy.ts verify

# Write the objects of the public data bucket that are missing or differ, the index, and the key store (container)
data-deploy: deps
    {{data_env}} {{dev}} bun scripts/data-deploy.ts deploy
