// Local data host: serve web-data/ and the pulled download files
// (.cache/data-files/, `just data-pull --files`) as the data host serves them
// (server/data-handler.ts).
//
// Usage: bun server/serve-data.ts
//
// With HIVWHOLEWEB_DATA_URL=http://127.0.0.1:8081 for the page host, the site
// works offline and without the production data host.
//
// Environment:
//   DATA_PORT   Port, default 8081
//   HOST        Address, default 127.0.0.1

import { join, resolve } from "node:path";

import { createDataHandler } from "./data-handler.ts";

const root = resolve(import.meta.dir, "..");

const server = Bun.serve({
  hostname: process.env["HOST"] ?? "127.0.0.1",
  port: Number(process.env["DATA_PORT"] ?? "8081"),
  fetch: createDataHandler({ webData: join(root, "web-data"), dataFiles: join(root, ".cache", "data-files") }),
});

console.error(`serving the data host at http://${server.hostname}:${server.port}/`);
