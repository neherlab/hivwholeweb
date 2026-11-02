// Write data-manifest.json: every object of the public data bucket
// (scripts/manifest.ts).
//
// Usage: bun scripts/data-manifest.ts
//
// The objects are the derived data of web-data/, the files of the data
// directory that the site links (scripts/links.ts), and the two archives of
// scripts/data-archives.ts, whose step runs first, in the same process, so that
// each file is read once. The manifest records each object's source, sha256,
// size, content type, and cache control, `Content-Disposition: attachment` for
// the download files and the archives, and the full-object CRC64NVME of objects
// over 5 GiB. It fails when web-data/static/data/ exists, and for an object
// over 10 MB whose content type CloudFront compresses, because CloudFront would
// send it uncompressed.
//
// Environment:
//   HIVWHOLEWEB_DATA   Data directory, a copy of the private data bucket

import { join, resolve } from "node:path";

import { ensureArchives } from "./data-archives.ts";
import { downloadObjects, webDataObjects } from "./data-objects.ts";
import { MAX_COMPRESSED_SIZE, type Manifest, isCompressed, readManifest } from "./manifest.ts";

/** Write `<root>/data-manifest.json` from `<root>/web-data/`, the linked files of `data`, and the archives in `<root>/tmp/archives/`, and return it. */
export async function writeDataManifest(options: { root: string; data: string }): Promise<Manifest> {
  const { root, data } = options;
  const manifestPath = join(root, "data-manifest.json");
  const existing = (await Bun.file(manifestPath).exists()) ? (await readManifest(manifestPath)).objects : [];
  const webData = await webDataObjects(join(root, "web-data"));
  const downloads = await downloadObjects({ src: join(root, "src"), webData: join(root, "web-data"), data });
  const uncompressed = [...webData, ...downloads.objects].filter((object) => object.size > MAX_COMPRESSED_SIZE && isCompressed(object.contentType));
  if (uncompressed.length > 0) {
    throw new Error(
      `objects over ${MAX_COMPRESSED_SIZE} bytes that CloudFront would send uncompressed:\n${uncompressed.map((object) => `${object.key} (${object.size} bytes)`).join("\n")}`,
    );
  }
  const archives = await ensureArchives({ root, data, webData, downloads: downloads.objects, existing });
  archives.forEach(({ object, built }) => console.error(`${built ? "built" : "kept"} ${object.key}`));
  const objects = [...webData, ...downloads.objects, ...archives.map(({ object }) => object)].toSorted((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const manifest = { objects, absent: downloads.absent };
  await Bun.write(manifestPath, `${JSON.stringify(manifest, undefined, 1)}\n`);
  return manifest;
}

if (import.meta.main) {
  const manifest = await writeDataManifest({ root: resolve(import.meta.dir, ".."), data: resolve(Bun.env["HIVWHOLEWEB_DATA"] ?? "") });
  console.error(`${manifest.objects.length} objects, ${manifest.absent.length} linked files absent from the data directory`);
}
