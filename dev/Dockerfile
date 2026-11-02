# syntax=docker/dockerfile:1
# check=experimental=all
#
# Project container of the static site: the tools of mise.toml (Bun, Node, just,
# jq, actionlint, shellcheck) at the versions of mise.lock. dev/dev
# builds it and runs every command as the host user.
FROM debian:bookworm-slim@sha256:99c0b25c46d0214d5a2091092e7908907dcaecd6a962cde0ac700acee222b6f3
SHELL ["bash", "-euxo", "pipefail", "-c"]

RUN set -euxo pipefail >/dev/null \
&& export DEBIAN_FRONTEND=noninteractive \
&& apt-get update -qq \
&& apt-get install --no-install-recommends --yes -qq \
  ca-certificates \
  curl \
  git \
  unzip \
  xz-utils \
>/dev/null \
&& apt-get clean autoclean >/dev/null \
&& apt-get autoremove --yes >/dev/null \
&& rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*

ARG MISE_VERSION="2026.10.17"
ENV MISE_DATA_DIR="/opt/mise"
ENV MISE_CACHE_DIR="/tmp/mise/cache"
ENV MISE_STATE_DIR="/tmp/mise/state"
COPY mise.toml mise.lock /tmp/mise/project/
RUN set -euxo pipefail >/dev/null \
&& curl -fsSL "https://github.com/jdx/mise/releases/download/v${MISE_VERSION}/mise-v${MISE_VERSION}-linux-x64-musl.tar.gz" | tar xz --strip-components=2 -C "/usr/local/bin" "mise/bin/mise" \
&& export MISE_TRUSTED_CONFIG_PATHS="/tmp/mise/project" \
&& mise -C "/tmp/mise/project" install \
&& for dir in $(mise -C "/tmp/mise/project" bin-paths); do \
  find -L "${dir}" -mindepth 1 -maxdepth 1 -type f -executable -exec ln -sf -t "/usr/local/bin" {} + ; \
done \
&& chmod -R a+rX "${MISE_DATA_DIR}" \
&& rm -rf "/tmp/mise" \
&& bun --version \
&& node --version \
&& just --version

# dev/dev runs as the host user with HOME=/tmp/home.
RUN set -euxo pipefail >/dev/null \
&& mkdir -p "/tmp/home" \
&& chmod 1777 "/tmp/home"
