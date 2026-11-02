# Tasks of the static site. Recipes marked "container" run in the project
# container: from the host through dev/dev, inside it directly (CI runs
# `dev/dev just <recipe>`). `serve` and `serve-data` run on the host with the
# tools of mise.toml.

set dotenv-load

dev := if env("DEV_CONTAINER", "") == "1" { "" } else { "dev/dev" }

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

# Run the tests that need no downloaded data (container)
test: deps
    {{dev}} bun run test

# Compare the ETI estimator with the golden master of the old ETI page (container); needs web-data/ from just data-pull
test-eti: deps
    {{dev}} bun run test-eti

# Typecheck the server, the scripts, and the ETI estimator (container)
typecheck: deps
    {{dev}} bun run typecheck

# Write dist/, the page host files, from src/ (container); see scripts/build.ts
build-dist *args:
    {{dev}} bun scripts/build-dist.ts {{args}}
