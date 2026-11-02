// The archives and the manifest of the data host (scripts/data-archives.ts,
// scripts/data-manifest.ts) for a small fixture project.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { writeDataManifest } from "../scripts/data-manifest.ts";
import { downloadObjects, webDataObjects } from "../scripts/data-objects.ts";
import { ensureArchives } from "../scripts/data-archives.ts";
import { type Manifest, archiveMembers } from "../scripts/manifest.ts";
import { writeProject } from "./fixtures/data-project.ts";

let root = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "data-archives-test-"));
});

afterEach(async () => {
  await rm(root, { recursive: true });
});

describe("data archives", () => {
  test("two builds of the same members into empty folders give the same names and bytes", async () => {
    const first = await manifestOf(join(root, "a"));
    const second = await manifestOf(join(root, "b"));
    const digestsA = await archiveDigests(join(root, "a"), first);
    const digestsB = await archiveDigests(join(root, "b"), second);
    expect([digestsA.length, digestsA.every(({ recorded }) => recorded), digestsB]).toEqual([2, true, digestsA]);
  });

  test("the derived archive holds web-data/ and the files archive the download files, without overlap", async () => {
    const manifest = await manifestOf(root);
    const derived = archiveMembers(manifest.objects, "derived").map(({ path }) => path);
    const files = archiveMembers(manifest.objects, "files").map(({ path }) => path);
    // Expected: the fixture's web-data/ files, and its linked data files at their data host paths.
    expect([derived, files, derived.filter((path) => files.includes(path))]).toEqual([
      ["api/data/tree/p1/V3.json", "robots.txt", "static/eti/data/training-0123456789abcdef.bin"],
      ["static/data/physiological/viral_load_p1.tsv", "static/data/tables/samples_p1.tsv", "static/data/trees/consensi_tree_p1_V3.json"],
      [],
    ]);
  });

  test("the manifest names each archive as an immutable download", async () => {
    const manifest = await manifestOf(root);
    const archives = manifest.objects.filter((object) => object.source.kind === "archive").map(({ key, contentType, cacheControl, contentDisposition }) => ({ key, contentType, cacheControl, contentDisposition }));
    expect(archives).toEqual([
      { key: expect.stringMatching(/^archives\/hivwholeweb-derived-[0-9a-f]{16}\.zip$/u), contentType: "application/zip", cacheControl: "public, max-age=31536000, immutable", contentDisposition: "attachment" },
      { key: expect.stringMatching(/^archives\/hivwholeweb-files-[0-9a-f]{16}\.zip$/u), contentType: "application/zip", cacheControl: "public, max-age=31536000, immutable", contentDisposition: "attachment" },
    ]);
  });

  test("a changed member changes the archive name, and the other archive keeps its name", async () => {
    const before = archiveKeys(await manifestOf(join(root, "a")));
    const after = archiveKeys(await manifestOf(join(root, "b"), { "web-data/api/data/tree/p1/V3.json": '{"tree": 2}' }));
    expect([after[0] === before[0], after[1] === before[1]]).toEqual([false, true]);
  });

  test("skips an archive whose member hash the manifest holds, and builds nothing", async () => {
    const manifest = await manifestOf(root);
    await rm(join(root, "tmp"), { recursive: true });
    const webData = await webDataObjects(join(root, "web-data"));
    const downloads = await downloadObjects({ src: join(root, "src"), webData: join(root, "web-data"), data: join(root, "data") });
    const results = await ensureArchives({ root, data: join(root, "data"), webData, downloads: downloads.objects, existing: manifest.objects });
    expect([results.map(({ built }) => built), await Bun.file(join(root, "tmp")).exists()]).toEqual([[false, false], false]);
  });

  test("the manifest step rejects download files in web-data/", async () => {
    await writeProject(root, { "web-data/static/data/tables/samples_p1.tsv": "x" });
    expect(await errorOf(writeDataManifest({ root, data: join(root, "data") }))).toContain("download files are not derived data");
  });

  test("the manifest step rejects a compressible object over 10 MB, which CloudFront would send uncompressed", async () => {
    await writeProject(root, { "web-data/api/data/big.json": `"${"x".repeat(10_000_000)}"` });
    expect(await errorOf(writeDataManifest({ root, data: join(root, "data") }))).toContain("api/data/big (10000002 bytes)");
  });
});

async function manifestOf(dir: string, changes: Readonly<Record<string, string>> = {}): Promise<Manifest> {
  await mkdir(dir, { recursive: true });
  await writeProject(dir, changes);
  return writeDataManifest({ root: dir, data: join(dir, "data") });
}

function archiveKeys(manifest: Manifest): string[] {
  return manifest.objects.filter((object) => object.source.kind === "archive").map(({ key }) => key);
}

/** Return the name and sha256 of each archive file in a project's tmp/archives/, and check them against the manifest. */
async function archiveDigests(dir: string, manifest: Manifest): Promise<{ name: string; sha256: string; recorded: boolean }[]> {
  const names = (await readdir(join(dir, "tmp", "archives"))).filter((name) => name.endsWith(".zip")).toSorted();
  return Promise.all(
    names.map(async (name) => {
      const sha256 = createHash("sha256").update(await Bun.file(join(dir, "tmp", "archives", name)).bytes()).digest("hex");
      return { name, sha256, recorded: manifest.objects.some((object) => basename(object.key) === name && object.sha256 === sha256) };
    }),
  );
}

async function errorOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
