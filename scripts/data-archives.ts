// Archives of the data host: the derived data (web-data/), deflated, and the
// download files (static/data/<path>), stored without compression, because
// nearly all of their bytes are BAM and zip files that are compressed already.
//
// Usage: bun scripts/data-archives.ts
//
// Writes the archives to tmp/archives/. An archive is built only when
// data-manifest.json holds no archive with the same member hash
// (scripts/manifest.ts), so an unchanged member list needs no rebuild and no
// upload. Entries are written sorted, with one fixed time and fixed
// permissions, so that two builds of the same members with the same zlib give
// the same bytes. Next to each archive it builds, it writes its manifest entry
// as <archive>.json, which scripts/data-manifest.ts takes up.
//
// Environment:
//   HIVWHOLEWEB_DATA   Data directory, the source of the download files

import { createHash } from "node:crypto";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import { Crc64Nvme } from "@aws-sdk/crc64-nvme";
import yazl from "yazl";

import { downloadObjects, webDataObjects } from "./data-objects.ts";
import {
  ATTACHMENT,
  IMMUTABLE,
  type ArchiveKind,
  type ManifestObject,
  archiveKey,
  archiveMembers,
  memberHash,
  needsMultipart,
  parseManifest,
  readManifest,
} from "./manifest.ts";

// The DOS epoch, built from local-time fields: with forceDosTimestamp, yazl
// writes only the local-time DOS fields, so the bytes do not depend on the time zone.
const ENTRY_TIME = new Date(1980, 0, 1);

const ENTRY_MODE = 0o100644;

/**
 * Return the manifest object of the archive of `kind` for the given objects:
 * the entry of `existing` with the same member hash, the entry of an archive
 * built earlier in `outDir`, or the entry of a new archive built there.
 */
export async function ensureArchive(options: {
  kind: ArchiveKind;
  objects: readonly ManifestObject[];
  sourceFile: (object: ManifestObject) => string;
  existing: readonly ManifestObject[];
  outDir: string;
}): Promise<{ object: ManifestObject; built: boolean }> {
  const { kind, objects, sourceFile, existing, outDir } = options;
  const members = archiveMembers(objects, kind);
  const key = archiveKey(kind, memberHash(members));
  const recorded = existing.find((object) => object.key === key);
  if (recorded !== undefined) {
    return { object: recorded, built: false };
  }
  const name = basename(key);
  const earlier = await readEarlier(outDir, name);
  if (earlier !== undefined) {
    return { object: earlier, built: false };
  }
  const files = new Map(objects.map((object) => [kind === "derived" ? object.source.path : object.key, sourceFile(object)]));
  const digests = await writeZip(
    join(outDir, name),
    members.map(({ path }) => ({ path, file: files.get(path) ?? "" })),
    kind === "derived",
  );
  const object: ManifestObject = {
    key,
    source: { kind: "archive", path: name },
    ...digests,
    contentType: "application/zip",
    cacheControl: IMMUTABLE,
    contentDisposition: ATTACHMENT,
  };
  await Bun.write(join(outDir, `${name}.json`), `${JSON.stringify(object, undefined, 1)}\n`);
  return { object, built: true };
}

/** Write a zip of the files, sorted by archive path, and return its digests, computed while writing. */
export async function writeZip(
  target: string,
  entries: readonly { path: string; file: string }[],
  deflate: boolean,
): Promise<{ sha256: string; size: number; crc64nvme?: string }> {
  await mkdir(resolve(target, ".."), { recursive: true });
  const partial = `${target}.partial`;
  const zip = new yazl.ZipFile();
  entries
    .toSorted((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .forEach(({ path, file }) => {
      zip.addFile(file, path, { mtime: ENTRY_TIME, mode: ENTRY_MODE, forceDosTimestamp: true, ...(deflate ? { compressionLevel: 9 } : { compress: false }) });
    });
  zip.end();
  const sha256 = createHash("sha256");
  const crc = new Crc64Nvme();
  const writer = Bun.file(partial).writer();
  let size = 0;
  try {
    for await (const chunk of zip.outputStream) {
      if (!(chunk instanceof Uint8Array)) {
        throw new Error("the zip stream gave a chunk that is not bytes");
      }
      sha256.update(chunk);
      crc.update(chunk);
      size += chunk.length;
      writer.write(chunk);
      await writer.flush();
    }
    await writer.end();
  } catch (error) {
    await rm(partial, { force: true });
    throw error;
  }
  await rename(partial, target);
  return { sha256: sha256.digest("hex"), size, ...(needsMultipart(size) ? { crc64nvme: Buffer.from(await crc.digest()).toString("hex") } : {}) };
}

/** Return the entry of an archive that an earlier run built in `outDir`, when the archive is there with the recorded size. */
async function readEarlier(outDir: string, name: string): Promise<ManifestObject | undefined> {
  const entry = Bun.file(join(outDir, `${name}.json`));
  if (!(await entry.exists())) {
    return undefined;
  }
  const [object] = parseManifest({ objects: [await entry.json()], absent: [] }).objects;
  const size = await stat(join(outDir, name)).then(
    (stats) => stats.size,
    () => -1,
  );
  return object !== undefined && size === object.size ? object : undefined;
}

/** Ensure both archives of a project in `<root>/tmp/archives/`, for the objects of web-data/ and of the download files. */
export async function ensureArchives(options: {
  root: string;
  data: string;
  webData: readonly ManifestObject[];
  downloads: readonly ManifestObject[];
  existing: readonly ManifestObject[];
}): Promise<{ object: ManifestObject; built: boolean }[]> {
  const { root, data, webData, downloads, existing } = options;
  const outDir = join(root, "tmp", "archives");
  return [
    await ensureArchive({ kind: "derived", objects: webData, sourceFile: (object) => join(root, "web-data", object.source.path), existing, outDir }),
    await ensureArchive({ kind: "files", objects: downloads, sourceFile: (object) => join(data, object.source.path), existing, outDir }),
  ];
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, "..");
  const data = resolve(Bun.env["HIVWHOLEWEB_DATA"] ?? "");
  const manifestPath = join(root, "data-manifest.json");
  const existing = (await Bun.file(manifestPath).exists()) ? (await readManifest(manifestPath)).objects : [];
  const webData = await webDataObjects(join(root, "web-data"));
  const downloads = await downloadObjects({ src: join(root, "src"), webData: join(root, "web-data"), data });
  const results = await ensureArchives({ root, data, webData, downloads: downloads.objects, existing });
  results.forEach(({ object, built }) => console.error(`${built ? "built" : "skipped"} ${object.key}`));
}
