// Request handler of the local data host: serves the derived data (web-data/)
// and the pulled download files as the data host serves the objects of
// data-manifest.json:
//
//   /api/<path>           web-data/api/<path>.json (the API keys have no suffix)
//   /static/data/<path>   <dataFiles>/static/data/<path>, as a download
//   other paths           web-data/<path>
//
// Every answer allows every origin (CORS `*`), because the data is public and
// the pages of every host read it, and carries `X-Robots-Tag: noindex, nofollow`.
// Files carry the cache headers of data-manifest.json. Paths are compared as
// sent, without decoding, as the edge function of the data host compares them
// with its key store.

import { stat } from "node:fs/promises";
import { join } from "node:path";

import { isStoreKey } from "../scripts/site-objects.ts";
import { contentType } from "./content-types.ts";

const IMMUTABLE = "public, max-age=31536000, immutable";

const ROBOTS_CACHE = "public, max-age=3600";

const DATA_FILES_PREFIX = "/static/data/";

/** Return the request handler of the local data host. */
export function createDataHandler(dirs: DataDirectories): (request: Request) => Promise<Response> {
  return async (request) => {
    const response = await respond(request, dirs);
    response.headers.set("Access-Control-Allow-Origin", "*");
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
    response.headers.set("X-Content-Type-Options", "nosniff");
    return response;
  };
}

/** Folders of the local data host: the derived data, and the folder that holds the download files under static/data/. */
export interface DataDirectories {
  webData: string;
  dataFiles: string;
}

async function respond(request: Request, dirs: DataDirectories): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const path = new URL(request.url).pathname;
  const file = isStoreKey(path) && !path.split("/").includes("..") ? dataFile(path, dirs) : undefined;
  if (file === undefined || !(await isFile(file))) {
    return new Response("Not Found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  return new Response(Bun.file(file), {
    headers: {
      "Content-Type": contentType(file),
      "Cache-Control": path === "/robots.txt" ? ROBOTS_CACHE : IMMUTABLE,
      ...(path.startsWith(DATA_FILES_PREFIX) ? { "Content-Disposition": "attachment" } : {}),
    },
  });
}

/** Return the local file of a data host path, or `undefined` for a path that names no object. */
function dataFile(path: string, dirs: DataDirectories): string | undefined {
  if (path.endsWith("/")) {
    return undefined;
  }
  if (path.startsWith("/api/")) {
    return join(dirs.webData, `${path.slice(1)}.json`);
  }
  if (path.startsWith(DATA_FILES_PREFIX)) {
    return join(dirs.dataFiles, path.slice(1));
  }
  return join(dirs.webData, path.slice(1));
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch (error) {
    if (error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR")) {
      return false;
    }
    throw error;
  }
}
