// data-manifest.json: every object of the public data bucket, with its source,
// sha256, size, and headers. scripts/data-manifest.ts writes it,
// scripts/data-deploy.ts uploads and checks the bucket against it, and
// scripts/data-pull.ts fills web-data/ and .cache/data-files/ from the data host by it.
//
// Data host layout:
//   - The derived data (web-data/) and the download files (static/data/<path>)
//     at their URL paths; API responses without the `.json` suffix of web-data/.
//   - Two zip archives under archives/: the derived data, deflated, and the
//     download files, stored. Each holds its files at the data host paths, with
//     the `.json` suffix of web-data/ for API responses, and the two share no
//     file. The name of each holds the first 16 hex digits of the sha256 over
//     its member list, so it changes only when the members change.
//   - index.json: the objects of the manifest without their sources.
//   - The data store of the edge: the path of every object and of index.json.
// Apart from index.json and robots.txt, no key ever gets new bytes.

import { createHash } from "node:crypto";

import { Crc64Nvme } from "@aws-sdk/crc64-nvme";
import type { HeadObjectCommandOutput } from "@aws-sdk/client-s3";

/** Cache-Control of the immutable objects: every object except index.json and robots.txt. */
export const IMMUTABLE = "public, max-age=31536000, immutable";

/** Cache-Control of the data host's robots.txt. */
export const ROBOTS_CACHE = "public, max-age=3600";

/** Cache-Control of index.json: browsers check it after 5 minutes; CloudFront keeps it until a deploy clears its cache. */
export const INDEX_CACHE = "public, max-age=300, s-maxage=31536000";

/** Key of the published index. */
export const INDEX_KEY = "index.json";

/** Without a filename parameter, browsers save a file under the last segment of its path. */
export const ATTACHMENT = "attachment";

/** S3 reports a full-object SHA-256 only for objects of one PUT, which takes at most 5 GiB. */
export const MAX_SINGLE_PART = 5 * 1024 ** 3;

/** CloudFront compresses only objects from 1 KB to 10 MB. */
export const MAX_COMPRESSED_SIZE = 10_000_000;

// Content types that CloudFront compresses (CloudFront Developer Guide, "File types that CloudFront compresses").
const COMPRESSED_TYPES = new Set([
  "application/dash+xml",
  "application/eot",
  "application/font",
  "application/font-sfnt",
  "application/javascript",
  "application/json",
  "application/opentype",
  "application/otf",
  "application/pdf",
  "application/pkcs7-mime",
  "application/protobuf",
  "application/rss+xml",
  "application/truetype",
  "application/ttf",
  "application/vnd.apple.mpegurl",
  "application/vnd.mapbox-vector-tile",
  "application/vnd.ms-fontobject",
  "application/wasm",
  "application/xhtml+xml",
  "application/xml",
  "application/x-font-opentype",
  "application/x-font-truetype",
  "application/x-font-ttf",
  "application/x-httpd-cgi",
  "application/x-javascript",
  "application/x-mpegurl",
  "application/x-opentype",
  "application/x-otf",
  "application/x-perl",
  "application/x-ttf",
  "font/eot",
  "font/opentype",
  "font/otf",
  "font/ttf",
  "image/svg+xml",
  "text/css",
  "text/csv",
  "text/html",
  "text/javascript",
  "text/js",
  "text/plain",
  "text/richtext",
  "text/tab-separated-values",
  "text/xml",
  "text/x-component",
  "text/x-java-source",
  "text/x-script",
  "vnd.apple.mpegurl",
]);

const SOURCE_KINDS: readonly string[] = ["web-data", "data", "archive"];

/** Read and check a manifest file. */
export async function readManifest(path: string): Promise<Manifest> {
  return parseManifest(await Bun.file(path).json());
}

/** Check the shape of a parsed manifest. */
export function parseManifest(value: unknown): Manifest {
  const objects = field(value, "objects");
  const absent = field(value, "absent");
  if (!Array.isArray(objects) || !Array.isArray(absent) || !absent.every((path) => typeof path === "string")) {
    throw new Error("data-manifest.json needs the arrays objects and absent");
  }
  return { objects: objects.map(parseObject), absent };
}

/** Text of index.json: the objects of the manifest without their sources. */
export function indexText(manifest: Manifest): string {
  return `${JSON.stringify({ objects: manifest.objects.map(({ source: _source, ...object }) => object) }, undefined, 1)}\n`;
}

/** Keys of the data store: the path of every object and of index.json. */
export function dataStoreKeys(manifest: Manifest): Set<string> {
  return new Set([...manifest.objects.map((object) => `/${object.key}`), `/${INDEX_KEY}`]);
}

/** Members of an archive kind, from the objects of a manifest: the derived data or the download files. */
export function archiveMembers(objects: readonly ManifestObject[], kind: ArchiveKind): ArchiveMember[] {
  return objects
    .filter((object) => object.source.kind === (kind === "derived" ? "web-data" : "data"))
    .map((object) => ({ path: kind === "derived" ? object.source.path : object.key, sha256: object.sha256 }))
    .toSorted((a, b) => compare(a.path, b.path));
}

/** Kind of archive: the derived data of web-data/, or the download files. */
export type ArchiveKind = "derived" | "files";

/** File of an archive: its path in the archive and its sha256. */
export interface ArchiveMember {
  path: string;
  sha256: string;
}

/** First 16 hex digits of the sha256 over the member list, one `<sha256>  <path>` line per member, sorted by path. */
export function memberHash(members: readonly ArchiveMember[]): string {
  const lines = members
    .toSorted((a, b) => compare(a.path, b.path))
    .map(({ path, sha256 }) => `${sha256}  ${path}\n`)
    .join("");
  return createHash("sha256").update(lines).digest("hex").slice(0, 16);
}

/** Key of an archive on the data host. */
export function archiveKey(kind: ArchiveKind, hash: string): string {
  return `archives/hivwholeweb-${kind}-${hash}.zip`;
}

/** Tell whether an object needs a multipart upload, whose only full-object checksum is CRC64NVME. */
export function needsMultipart(size: number): boolean {
  return size > MAX_SINGLE_PART;
}

/** Return the byte ranges of the parts of a multipart upload of `size` bytes, numbered from 1; one part for an empty object. */
export function partRanges(size: number, partSize: number): { number: number; start: number; end: number }[] {
  return Array.from({ length: Math.max(1, Math.ceil(size / partSize)) }, (_, index) => ({ number: index + 1, start: index * partSize, end: Math.min(size, (index + 1) * partSize) }));
}

/** Tell whether CloudFront compresses a content type. */
export function isCompressed(contentType: string): boolean {
  return COMPRESSED_TYPES.has(contentType.split(";")[0]?.trim() ?? "");
}

/** Return the sha256, size, and for objects that need a multipart upload the CRC64NVME of a file, reading it once. */
export async function fileDigests(path: string): Promise<Digests> {
  const sha256 = createHash("sha256");
  const crc = new Crc64Nvme();
  const file = Bun.file(path);
  const multipart = needsMultipart(file.size);
  let size = 0;
  for await (const chunk of file.stream()) {
    sha256.update(chunk);
    if (multipart) {
      crc.update(chunk);
    }
    size += chunk.length;
  }
  return { sha256: sha256.digest("hex"), size, ...(multipart ? { crc64nvme: Buffer.from(await crc.digest()).toString("hex") } : {}) };
}

/** Digests of a file, as the manifest records them. */
export interface Digests {
  sha256: string;
  size: number;
  crc64nvme?: string;
}

/**
 * Compare a stored object with the manifest: `match`, `missing`, `differs`
 * (the manifest's bytes with other headers), or `conflict` (other bytes, or a
 * checksum that S3 does not report). The bytes match when S3 reports the
 * manifest's size and checksum: the full-object SHA-256 of a single PUT, or
 * for an object that needs a multipart upload the full-object CRC64NVME. The
 * headers match when the content type, cache control, and content disposition
 * equal the manifest's (none when the manifest names none).
 */
export function objectState(object: ManifestObject, stored: StoredObject | undefined): ObjectState {
  if (stored === undefined) {
    return "missing";
  }
  const sameBytes =
    stored.ContentLength === object.size &&
    (object.crc64nvme === undefined
      ? stored.ChecksumSHA256 === hexToBase64(object.sha256)
      : stored.ChecksumCRC64NVME === hexToBase64(object.crc64nvme) && stored.ChecksumType === "FULL_OBJECT");
  if (!sameBytes) {
    return "conflict";
  }
  const sameHeaders = stored.ContentType === object.contentType && stored.CacheControl === object.cacheControl && stored.ContentDisposition === object.contentDisposition;
  return sameHeaders ? "match" : "differs";
}

/** Size, checksums, and headers of a stored object, as HeadObject reports them with ChecksumMode ENABLED. */
export type StoredObject = Pick<HeadObjectCommandOutput, "ContentLength" | "ChecksumSHA256" | "ChecksumCRC64NVME" | "ChecksumType" | "ContentType" | "CacheControl" | "ContentDisposition">;

/** State of a stored object against the manifest. */
export type ObjectState = "match" | "missing" | "differs" | "conflict";

/** Return a hex digest in the base64 form of the S3 checksum fields. */
export function hexToBase64(hex: string): string {
  return Buffer.from(hex, "hex").toString("base64");
}

/** Contents of data-manifest.json. */
export interface Manifest {
  objects: ManifestObject[];
  /** Linked data files that the data directory lacks. */
  absent: string[];
}

/** Object of the public data bucket. */
export interface ManifestObject {
  key: string;
  source: Source;
  sha256: string;
  size: number;
  contentType: string;
  cacheControl: string;
  contentDisposition?: string;
  /** Full-object CRC64NVME, hex, of an object over 5 GiB, which a multipart upload stores. */
  crc64nvme?: string;
}

/**
 * Key of an object in the bucket: its file path. A file of web-data/ keeps its
 * path there, so an API response `api/<path>` is stored as `api/<path>.json`,
 * the name it has on disk; the data host function adds `.json` to `/api/` URLs.
 * The other objects are stored under their public key.
 */
export function storageKey(object: Pick<ManifestObject, "key" | "source">): string {
  return object.source.kind === "web-data" ? object.source.path : object.key;
}

/** Source of an object: a file of web-data/, of the data directory, or of tmp/archives/. */
export interface Source {
  kind: SourceKind;
  path: string;
}

export type SourceKind = "web-data" | "data" | "archive";

function parseObject(value: unknown): ManifestObject {
  const key = field(value, "key");
  const source = field(value, "source");
  const kind = field(source, "kind");
  const path = field(source, "path");
  const sha256 = field(value, "sha256");
  const size = field(value, "size");
  const contentType = field(value, "contentType");
  const cacheControl = field(value, "cacheControl");
  const contentDisposition = field(value, "contentDisposition");
  const crc64nvme = field(value, "crc64nvme");
  if (
    typeof key !== "string" ||
    !isSourceKind(kind) ||
    typeof path !== "string" ||
    typeof sha256 !== "string" ||
    !/^[0-9a-f]{64}$/u.test(sha256) ||
    typeof size !== "number" ||
    typeof contentType !== "string" ||
    typeof cacheControl !== "string" ||
    !(contentDisposition === undefined || typeof contentDisposition === "string") ||
    !(crc64nvme === undefined || (typeof crc64nvme === "string" && /^[0-9a-f]{16}$/u.test(crc64nvme)))
  ) {
    throw new Error(`invalid object in data-manifest.json: ${JSON.stringify(value)}`);
  }
  return {
    key,
    source: { kind, path },
    sha256,
    size,
    contentType,
    cacheControl,
    ...(contentDisposition === undefined ? {} : { contentDisposition }),
    ...(crc64nvme === undefined ? {} : { crc64nvme }),
  };
}

function isSourceKind(value: unknown): value is SourceKind {
  return typeof value === "string" && SOURCE_KINDS.includes(value);
}

function field(value: unknown, name: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, name) : undefined;
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
