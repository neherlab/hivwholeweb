# Tasks of the static site. Recipes marked "container" run in the project
# container: from the host through dev/dev, inside it directly (CI runs
# `dev/dev just <recipe>`).

set dotenv-load

dev := if env("DEV_CONTAINER", "") == "1" { "" } else { "dev/dev" }

default:
    @just --list

# Install the locked dependencies into node_modules/ without changing bun.lock (container)
deps:
    {{dev}} bun install --frozen-lockfile --no-summary --no-progress

# Run the tests that need no downloaded data (container)
test: deps
    {{dev}} bun run test

# Typecheck the server, the scripts, and the ETI estimator (container)
typecheck: deps
    {{dev}} bun run typecheck
