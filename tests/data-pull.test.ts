// scripts/data-pull.ts against a local data host that serves the archives of a
// fixture project.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeZip } from "../scripts/data-archives.ts";
import { writeDataManifest } from "../scripts/data-manifest.ts";
import { pullData } from "../scripts/data-pull.ts";
import type { Manifest } from "../scripts/manifest.ts";
import { PROJECT_FILES, writeProject } from "./fixtures/data-project.ts";

let root = "";
let source = "";
let clone = "";
let manifest: Manifest;
let served = new Map<string, Uint8Array>();
let requests: string[] = [];
let server: ReturnType<typeof Bun.serve>;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "data-pull-test-"));
  source = join(root, "source");
  clone = join(root, "clone");
  await writeProject(source);
  manifest = await writeDataManifest({ root: source, data: join(source, "data") });
  served = new Map(
    await Promise.all(
      manifest.objects.filter((object) => object.source.kind === "archive").map(async (object) => [`/${object.key}`, await Bun.file(join(source, "tmp", "archives", object.source.path)).bytes()] as const),
    ),
  );
  requests = [];
  server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(request) {
      const path = new URL(request.url).pathname;
      requests.push(path);
      const bytes = served.get(path);
      return bytes === undefined ? new Response("Not Found", { status: 404 }) : new Response(bytes);
    },
  });
  await mkdir(clone, { recursive: true });
  await writeFile(join(clone, "data-manifest.json"), await readFile(join(source, "data-manifest.json")));
});

afterEach(async () => {
  await server.stop(true);
  await rm(root, { recursive: true });
});

describe("data-pull", () => {
  test("fills web-data/ of a fresh clone with the files of the derived archive", async () => {
    await pull(["derived"]);
    expect(await treeOf(join(clone, "web-data"))).toEqual(webDataOfProject());
  });

  test("with --files, also fills .cache/data-files/ with the download files", async () => {
    await pull(["derived", "files"]);
    // Expected: the linked data files of the fixture, at their data host paths.
    expect(await treeOf(join(clone, ".cache", "data-files"))).toEqual({
      "static/data/physiological/viral_load_p1.tsv": PROJECT_FILES["data/physiological/viral_load_p1.tsv"] ?? "",
      "static/data/tables/samples_p1.tsv": PROJECT_FILES["data/tables/samples_p1.tsv"] ?? "",
      "static/data/trees/consensi_tree_p1_V3.json": PROJECT_FILES["data/trees/consensi_tree_p1_V3.json"] ?? "",
    });
  });

  test("a second run downloads nothing", async () => {
    await pull(["derived", "files"]);
    requests = [];
    const results = await pull(["derived", "files"]);
    expect([requests, results.map(({ action }) => action)]).toEqual([[], ["up to date", "up to date"]]);
  });

  test("rejects a damaged archive", async () => {
    const key = archiveKey("derived");
    served.set(`/${key}`, Uint8Array.from([...(served.get(`/${key}`) ?? []), 0]));
    expect(await errorOf(pull(["derived"]))).toContain(`${key} from http://127.0.0.1`);
  });

  test("rejects an archive whose member differs from the manifest", async () => {
    // An archive of the right name and recorded sha256 whose robots.txt differs from the manifest's sha256.
    const damaged = join(root, "damaged");
    await writeProject(damaged, { "web-data/robots.txt": "User-agent: *\nAllow: /\n" });
    const entries = Object.keys(webDataOfProject()).map((path) => ({ path, file: join(damaged, "web-data", path) }));
    const zip = join(root, "damaged.zip");
    await writeZip(zip, entries, true);
    const bytes = await Bun.file(zip).bytes();
    const key = archiveKey("derived");
    const patched = { ...manifest, objects: manifest.objects.map((object) => (object.key === key ? { ...object, sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length } : object)) };
    await writeFile(join(clone, "data-manifest.json"), JSON.stringify(patched));
    served.set(`/${key}`, bytes);
    expect(await errorOf(pull(["derived"]))).toContain("robots.txt of the archive has sha256");
  });
});

function pull(kinds: ("derived" | "files")[]): ReturnType<typeof pullData> {
  return pullData({ root: clone, origin: `http://127.0.0.1:${server.port}`, kinds });
}

function archiveKey(kind: string): string {
  const object = manifest.objects.find((candidate) => candidate.key.startsWith(`archives/hivwholeweb-${kind}-`));
  return object === undefined ? "" : object.key;
}

/** Files of web-data/ of the fixture project, by path. */
function webDataOfProject(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(PROJECT_FILES)
      .filter(([path]) => path.startsWith("web-data/"))
      .map(([path, content]) => [path.slice("web-data/".length), content]),
  );
}

async function treeOf(dir: string): Promise<Record<string, string>> {
  const paths = (await Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: dir, dot: true }))).toSorted();
  return Object.fromEntries(await Promise.all(paths.map(async (path) => [path, await Bun.file(join(dir, path)).text()] as const)));
}

async function errorOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
