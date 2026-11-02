// Local page host: build dist/ from src/, serve it with the rules and headers of
// the production page host (server/handler.ts), and build again when a file
// under src/ changes.
//
// Usage: bun server/serve.ts
//
// The build and the server read the same settings, so the security headers
// name the data host origin and the analytics host of the build.
//
// Environment:
//   PORT                           Port, default 8080
//   HOST                           Address, default 127.0.0.1
//   HIVWHOLEWEB_DATA_URL           Origin of the data host, without a trailing slash
//   HIVWHOLEWEB_PLAUSIBLE_DOMAIN   Domain under which the pages report visits; empty for no analytics

import { type FSWatcher, watch } from "node:fs";
import { join, resolve } from "node:path";

import { type BuildSettings, buildSite } from "../scripts/build.ts";
import { pageStoreKeys } from "../scripts/site-objects.ts";
import { type PageSite, createPageHandler } from "./handler.ts";
import { securityHeaders } from "./security-headers.ts";

const REBUILD_DELAY_MS = 100;

const root = resolve(import.meta.dir, "..");

const src = join(root, "src");

const dist = join(root, "dist");

const settings: BuildSettings = {
  dataUrl: process.env["HIVWHOLEWEB_DATA_URL"] ?? "",
  plausibleDomain: process.env["HIVWHOLEWEB_PLAUSIBLE_DOMAIN"] ?? "",
  preview: false,
};

const server = Bun.serve({
  hostname: process.env["HOST"] ?? "127.0.0.1",
  port: Number(process.env["PORT"] ?? "8080"),
  fetch: createPageHandler(await build()),
});

console.error(`serving ${dist} at http://${server.hostname}:${server.port}/, data from ${settings.dataUrl}`);

/** Rebuilds dist/ after changes under src/, one build at a time, and points the server to each new build. */
class Rebuilder {
  #watcher: FSWatcher;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #running = false;
  #pending = false;

  constructor(directory: string) {
    this.#watcher = watch(directory, { recursive: true }, () => this.#schedule());
  }

  close(): void {
    this.#watcher.close();
    clearTimeout(this.#timer);
  }

  #schedule(): void {
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => void this.#run(), REBUILD_DELAY_MS);
  }

  async #run(): Promise<void> {
    if (this.#running) {
      this.#pending = true;
      return;
    }
    this.#running = true;
    try {
      server.reload({ fetch: createPageHandler(await build()) });
      console.error("rebuilt dist/");
    } catch (error) {
      console.error(`build failed, still serving the previous build: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.#running = false;
    }
    if (this.#pending) {
      this.#pending = false;
      this.#schedule();
    }
  }
}

const rebuilder = new Rebuilder(src);

process.on("SIGINT", () => {
  rebuilder.close();
  process.exit(0);
});

async function build(): Promise<PageSite> {
  const result = await buildSite({ src, dist, ...settings });
  return {
    dist,
    keys: pageStoreKeys(result.files.keys()),
    dataOrigin: settings.dataUrl,
    headers: securityHeaders({ dataOrigin: settings.dataUrl, analytics: settings.plausibleDomain !== "" }),
  };
}
