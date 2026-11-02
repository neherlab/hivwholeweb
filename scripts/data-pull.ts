// Fill web-data/, and with --files .cache/data-files/, from the archives of the
// data host (scripts/manifest.ts).
//
// Usage: bun scripts/data-pull.ts [--files]
//
// For each archive, it checks the files that the archive holds against the
// sha256 values of data-manifest.json, and stops there when they all match, so
// a second run downloads nothing. Otherwise it downloads the archive from
// HIVWHOLEWEB_DATA_URL to .cache/archives/ (unless the file there already
// matches), checks its sha256, unpacks it, and checks each unpacked file. An
// archive must hold exactly the files that the manifest names for it.
//
//   derived archive   web-data/, the derived data
//   files archive     .cache/data-files/static/data/, the download files (--files)
//
// Environment:
//   HIVWHOLEWEB_DATA_URL   Origin of the data host, without a trailing slash

import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import yauzl from "yauzl";

import { mapLimited } from "./concurrency.ts";
import { type ArchiveKind, type ArchiveMember, type Manifest, archiveMembers, readManifest } from "./manifest.ts";

const JOBS = 8;

/** Pull the archives of the manifest from the data host into a project, and return what each pull did. */
export async function pullData(options: { root: string; origin: string; kinds: readonly ArchiveKind[] }): Promise<PullResult[]> {
  const manifest = await readManifest(join(options.root, "data-manifest.json"));
  const results: PullResult[] = [];
  for (const kind of options.kinds) {
    results.push(await pullArchive(manifest, kind, options));
  }
  return results;
}

/** What a pull of one archive did: nothing, because the files matched; or a download and unpack. */
export interface PullResult {
  kind: ArchiveKind;
  action: "up to date" | "unpacked";
  downloaded: boolean;
}

async function pullArchive(manifest: Manifest, kind: ArchiveKind, options: { root: string; origin: string }): Promise<PullResult> {
  const archives = manifest.objects.filter((object) => object.source.kind === "archive" && object.key.startsWith(`archives/hivwholeweb-${kind}-`));
  const [archive] = archives;
  if (archive === undefined || archives.length > 1) {
    throw new Error(`data-manifest.json needs exactly one ${kind} archive, found ${archives.length}`);
  }
  const target = kind === "derived" ? join(options.root, "web-data") : join(options.root, ".cache", "data-files");
  const members = archiveMembers(manifest.objects, kind);
  const stale = await staleMembers(target, members);
  if (stale.length === 0) {
    return { kind, action: "up to date", downloaded: false };
  }
  const local = join(options.root, ".cache", "archives", basename(archive.key));
  const downloaded = (await sha256OfFile(local)) !== archive.sha256;
  if (downloaded) {
    await download(`${options.origin}/${archive.key}`, local);
    const sha256 = await sha256OfFile(local);
    if (sha256 !== archive.sha256) {
      await rm(local, { force: true });
      throw new Error(`${archive.key} from ${options.origin} has sha256 ${sha256}, the manifest names ${archive.sha256}`);
    }
  }
  await unpack(local, target, members);
  return { kind, action: "unpacked", downloaded };
}

/** Return the members whose file in `target` is missing or differs from its sha256. */
async function staleMembers(target: string, members: readonly ArchiveMember[]): Promise<ArchiveMember[]> {
  const checks = await mapLimited(members, JOBS, async (member) => ((await sha256OfFile(join(target, member.path))) === member.sha256 ? undefined : member));
  return checks.filter((member) => member !== undefined);
}

/** Download a URL to a file, through a partial file that replaces it when complete. */
async function download(url: string, file: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok || response.body === null) {
    throw new Error(`GET ${url} answered ${response.status} ${response.statusText}`);
  }
  await mkdir(dirname(file), { recursive: true });
  const partial = `${file}.partial`;
  await Bun.write(partial, response);
  await rename(partial, file);
}

/** Unpack exactly the members of an archive into `target`, and check each file's sha256 as it is written. */
async function unpack(archive: string, target: string, members: readonly ArchiveMember[]): Promise<void> {
  const expected = new Map(members.map((member) => [member.path, member.sha256]));
  const seen = new Set<string>();
  const zip = await openZip(archive);
  try {
    for (let entry = await nextEntry(zip); entry !== undefined; entry = await nextEntry(zip)) {
      const sha256 = expected.get(entry.fileName);
      if (sha256 === undefined || seen.has(entry.fileName)) {
        throw new Error(`${basename(archive)} holds ${entry.fileName}, which the manifest does not name for it once`);
      }
      seen.add(entry.fileName);
      await extract(zip, entry, join(target, entry.fileName), sha256);
    }
  } finally {
    zip.close();
  }
  const missing = [...expected.keys()].filter((path) => !seen.has(path));
  if (missing.length > 0) {
    throw new Error(`${basename(archive)} lacks ${missing.length} files of the manifest, such as ${missing[0]}`);
  }
}

/** Write one entry to its file through a partial file, and fail unless its sha256 matches. */
async function extract(zip: yauzl.ZipFile, entry: yauzl.Entry, file: string, expected: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const partial = `${file}.partial`;
  const hash = createHash("sha256");
  const stream = await new Promise<NodeJS.ReadableStream>((resolveStream, reject) => {
    zip.openReadStream(entry, (error, opened) => (error === null ? resolveStream(opened) : reject(error)));
  });
  await pipeline(
    stream,
    new Transform({
      transform(chunk: Buffer, _encoding, callback): void {
        hash.update(chunk);
        callback(undefined, chunk);
      },
    }),
    createWriteStream(partial),
  );
  const sha256 = hash.digest("hex");
  if (sha256 !== expected) {
    await rm(partial, { force: true });
    throw new Error(`${entry.fileName} of the archive has sha256 ${sha256}, the manifest names ${expected}`);
  }
  await rename(partial, file);
}

function openZip(path: string): Promise<yauzl.ZipFile> {
  return new Promise((resolveZip, reject) => {
    yauzl.open(path, { lazyEntries: true, autoClose: false, strictFileNames: true }, (error, zip) => (error === null ? resolveZip(zip) : reject(error)));
  });
}

function nextEntry(zip: yauzl.ZipFile): Promise<yauzl.Entry | undefined> {
  return new Promise((resolveEntry, reject) => {
    const cleanup = (): void => {
      zip.off("entry", onEntry);
      zip.off("end", onEnd);
      zip.off("error", onError);
    };
    const onEntry = (entry: yauzl.Entry): void => {
      cleanup();
      resolveEntry(entry);
    };
    const onEnd = (): void => {
      cleanup();
      resolveEntry(undefined);
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    zip.on("entry", onEntry);
    zip.on("end", onEnd);
    zip.on("error", onError);
    zip.readEntry();
  });
}

/** Return the sha256 of a file, or `undefined` when it does not exist. */
async function sha256OfFile(path: string): Promise<string | undefined> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    return undefined;
  }
  const hash = createHash("sha256");
  for await (const chunk of file.stream()) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

if (import.meta.main) {
  const origin = Bun.env["HIVWHOLEWEB_DATA_URL"] ?? "";
  if (origin === "") {
    throw new Error("Set HIVWHOLEWEB_DATA_URL to the origin of the data host: see .env.example");
  }
  const kinds: ArchiveKind[] = Bun.argv.includes("--files") ? ["derived", "files"] : ["derived"];
  const results = await pullData({ root: resolve(import.meta.dir, ".."), origin, kinds });
  results.forEach(({ kind, action, downloaded }) => console.error(`${kind} archive: ${action}${downloaded ? " after a download" : ""}`));
}
