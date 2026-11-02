// Upload the public data bucket, or check it, against data-manifest.json
// (data host layout in scripts/manifest.ts).
//
// Usage:
//   bun scripts/data-deploy.ts verify [manifest]   list what differs from the manifest (read-only)
//   bun scripts/data-deploy.ts deploy [manifest]   write exactly that, then check
//
// The manifest defaults to data-manifest.json; the sources of its objects are
// read from the folders next to it: web-data/, tmp/archives/, and the data
// directory.
//
// An object matches when S3 reports the manifest's checksum and size, content
// type, cache control, and content disposition (none when the manifest names
// none). The checksum is the full-object SHA-256 of a single PUT, or for an
// object over 5 GiB, which needs a multipart upload, the full-object CRC64NVME.
// A matching object is never written again, so a second deploy writes nothing.
//
// Keys are immutable: before any write, deploy stops when an object other than
// robots.txt holds other bytes than the manifest names. An object with the
// right bytes and other headers gets its headers rewritten by a copy onto itself.
//
// Deploy writes each missing download file with one server-side CopyObject
// from the private data bucket, so no data passes through this machine. When
// the copy's checksum differs from the manifest, it uploads the local file
// instead. Other objects are uploaded from their local files, and S3 rejects
// an upload unless its bytes match the manifest's checksum. Objects over 5 GiB
// go up as multipart uploads with the manifest's full-object CRC64NVME.
//
// When all objects match, deploy adds the new keys to the data store, writes
// index.json, clears the cache of the data distribution after any write, then
// deletes the keys that the manifest no longer names and checks the store.
// verify checks index.json and the store too.
//
// Output: one `<state> <key>` line per object that differs (missing, differs,
// conflict), `differs index.json`, and `missing <path>` or `extra <path>` per
// key of the store that differs.
//
// Environment:
//   AWS_S3_BUCKET                    Public data bucket
//   AWS_S3_SOURCE_BUCKET             Private data bucket, the source of the download files (deploy)
//   AWS_CLOUDFRONT_DISTRIBUTION_ID   Distribution of the data host (deploy)
//   AWS_CLOUDFRONT_KVS_ARN           Key store of the data host
//   AWS_DEFAULT_REGION               Region of both buckets
//   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN: credentials, from a
//   regional STS endpoint, because the key store API accepts only version 2 session tokens
//   HIVWHOLEWEB_DATA                 Local data directory, for files whose copy differs and files over 5 GiB (deploy)

import { createHash } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { Crc64Nvme } from "@aws-sdk/crc64-nvme";

import { aws, awsUnlessMissing, invalidateAll, requireEnv, stringField } from "./aws-cli.ts";
import { mapLimited } from "./concurrency.ts";
import { deleteStoreKeys, planStoreSync, putStoreKeys, readStoreKeys, storeDifferences } from "./key-store.ts";
import { INDEX_CACHE, INDEX_KEY, type ManifestObject, dataStoreKeys, indexText, partRanges, readManifest, storageKey } from "./manifest.ts";

const JOBS = 16;

/** Part size of the multipart uploads: 64 MiB, within the 5 MiB to 5 GiB that S3 takes, for objects of up to 640 GiB in 10000 parts. */
const PART_SIZE = 64 * 1024 ** 2;

const PART_JOBS = 4;

// Keys whose bytes may change: the published index and the robots file.
const MUTABLE_KEYS = new Set([INDEX_KEY, "robots.txt"]);

const mode = Bun.argv[2];

if (mode !== "verify" && mode !== "deploy") {
  console.error("Usage: bun scripts/data-deploy.ts verify|deploy [manifest]");
  process.exit(2);
}

const manifestPath = resolve(Bun.argv[3] ?? join(import.meta.dir, "..", "data-manifest.json"));

const projectDir = dirname(manifestPath);

const bucket = requireEnv("AWS_S3_BUCKET");

const store = requireEnv("AWS_CLOUDFRONT_KVS_ARN");

const manifest = await readManifest(manifestPath);

const index: ManifestObject = indexObject(indexText(manifest));

const states = await mapLimited(manifest.objects, JOBS, async (object) => ({ object, state: await check(object) }));

const pending = states.filter(({ state }) => state !== "match");

pending.forEach(({ object, state }) => console.log(`${state} ${object.key}`));
console.error(`${states.length - pending.length} of ${states.length} objects match the manifest`);

if (mode === "verify") {
  const indexState = await check(index);
  if (indexState !== "match") {
    console.log(`differs ${INDEX_KEY}`);
  }
  const keys = await storeDifferences(store, dataStoreKeys(manifest));
  keys.forEach((line) => console.log(line));
  process.exit(pending.length === 0 && indexState === "match" && keys.length === 0 ? 0 : 1);
}

const conflicts = pending.filter(({ object, state }) => state === "conflict" && !MUTABLE_KEYS.has(object.key));

if (conflicts.length > 0) {
  console.error(`objects that hold other bytes than the manifest names; keys are immutable, so new content needs a new key:\n${conflicts.map(({ object }) => object.key).join("\n")}`);
  process.exit(1);
}

const results = await mapLimited(pending, JOBS, async ({ object, state }) => ({ object, state: await write(object, state) }));

const failed = results.filter(({ state }) => state !== "match");

failed.forEach(({ object, state }) => console.error(`still ${state} after the write: ${object.key}`));
console.error(`wrote ${results.length - failed.length} objects, ${failed.length} failed`);

if (failed.length > 0) {
  process.exit(1);
}

const plan = planStoreSync(await readStoreKeys(store), dataStoreKeys(manifest), () => false);

console.error(`adding ${plan.puts.length} keys to the data store`);
await putStoreKeys(store, plan.puts);

const indexWritten = (await check(index)) !== "match";

if (indexWritten) {
  await putIndex();
  if ((await check(index)) !== "match") {
    console.error(`${INDEX_KEY} differs from the manifest after the write`);
    process.exit(1);
  }
}

if (results.length > 0 || indexWritten) {
  await invalidateAll(requireEnv("AWS_CLOUDFRONT_DISTRIBUTION_ID"));
}

console.error(`deleting ${plan.deletes.length} keys from the data store`);
await deleteStoreKeys(store, plan.deletes);

const keyDifferences = await storeDifferences(store, plan.final);

if (keyDifferences.length > 0) {
  console.error(`the data store differs from the manifest:\n${keyDifferences.join("\n")}`);
  process.exit(1);
}

/** Write one object that differs from the manifest, and return its state after the write. */
async function write(object: ManifestObject, state: State): Promise<State> {
  if (object.crc64nvme !== undefined) {
    await uploadMultipart(object, sourceFile(object));
  } else if (state === "differs") {
    await aws(["s3api", "copy-object", "--copy-source", `${bucket}/${storageKey(object)}`, "--checksum-algorithm", "SHA256", "--metadata-directive", "REPLACE", ...objectArgs(object)]);
  } else if (object.source.kind === "data") {
    await aws(["s3api", "copy-object", "--copy-source", `${requireEnv("AWS_S3_SOURCE_BUCKET")}/${object.source.path}`, "--checksum-algorithm", "SHA256", "--metadata-directive", "REPLACE", ...objectArgs(object)]);
    const copied = await check(object);
    if (copied === "match") {
      return copied;
    }
    console.error(`copy of ${object.key} differs from the manifest; uploading the local file`);
    await putObject(object, sourceFile(object));
  } else {
    await putObject(object, sourceFile(object));
  }
  return check(object);
}

/**
 * Compare the stored object with the manifest, with one HEAD request: `match`,
 * `missing`, `differs` (right bytes, other headers), or `conflict` (other bytes,
 * or a checksum that S3 does not report).
 */
async function check(object: ManifestObject): Promise<State> {
  const head = await awsUnlessMissing(["s3api", "head-object", "--bucket", bucket, "--key", storageKey(object), "--checksum-mode", "ENABLED", "--output", "json"]);
  if (head === undefined) {
    return "missing";
  }
  const stored: unknown = JSON.parse(head);
  const length: unknown = typeof stored === "object" && stored !== null ? Reflect.get(stored, "ContentLength") : undefined;
  const sameBytes =
    length === object.size &&
    (object.crc64nvme === undefined
      ? stringField(stored, "ChecksumSHA256") === hexToBase64(object.sha256)
      : stringField(stored, "ChecksumCRC64NVME") === hexToBase64(object.crc64nvme) && stringField(stored, "ChecksumType") === "FULL_OBJECT");
  if (!sameBytes) {
    return "conflict";
  }
  const sameHeaders =
    stringField(stored, "ContentType") === object.contentType &&
    stringField(stored, "CacheControl") === object.cacheControl &&
    stringField(stored, "ContentDisposition") === object.contentDisposition;
  return sameHeaders ? "match" : "differs";
}

/** Upload a file in one PUT, which S3 rejects unless its SHA-256 matches the manifest. */
async function putObject(object: ManifestObject, file: string): Promise<void> {
  await aws(["s3api", "put-object", "--body", file, "--checksum-sha256", hexToBase64(object.sha256), ...objectArgs(object), "--output", "json"]);
}

/** Upload a file as a multipart upload with the manifest's full-object CRC64NVME, which S3 checks before it stores the object. */
async function uploadMultipart(object: ManifestObject, file: string): Promise<void> {
  const crc64nvme = object.crc64nvme ?? "";
  const created: unknown = JSON.parse(
    await aws(["s3api", "create-multipart-upload", ...objectArgs(object), "--checksum-algorithm", "CRC64NVME", "--checksum-type", "FULL_OBJECT", "--output", "json"]),
  );
  const uploadId = stringField(created, "UploadId");
  if (uploadId === undefined) {
    throw new Error(`create-multipart-upload of ${object.key} returned no UploadId`);
  }
  const partsDir = join(projectDir, "tmp", "multipart", uploadId);
  try {
    await mkdir(partsDir, { recursive: true });
    const parts = await mapLimited(partRanges(object.size, PART_SIZE), PART_JOBS, async ({ number, start, end }) => {
      const bytes = await Bun.file(file).slice(start, end).bytes();
      const partFile = join(partsDir, String(number));
      await Bun.write(partFile, bytes);
      const checksum = await crc64nvmeBase64(bytes);
      const uploaded: unknown = JSON.parse(
        await aws(["s3api", "upload-part", "--bucket", bucket, "--key", storageKey(object), "--upload-id", uploadId, "--part-number", String(number), "--body", partFile, "--checksum-crc64-nvme", checksum, "--output", "json"]),
      );
      await rm(partFile);
      return { ETag: stringField(uploaded, "ETag") ?? "", PartNumber: number, ChecksumCRC64NVME: checksum };
    });
    await aws([
      "s3api",
      "complete-multipart-upload",
      "--bucket",
      bucket,
      "--key",
      storageKey(object),
      "--upload-id",
      uploadId,
      "--multipart-upload",
      JSON.stringify({ Parts: parts }),
      "--checksum-crc64-nvme",
      hexToBase64(crc64nvme),
      "--checksum-type",
      "FULL_OBJECT",
      "--mpu-object-size",
      String(object.size),
      "--output",
      "json",
    ]);
  } catch (error) {
    await aws(["s3api", "abort-multipart-upload", "--bucket", bucket, "--key", storageKey(object), "--upload-id", uploadId]).catch((abortError: unknown) => {
      console.error(`could not abort the multipart upload ${uploadId} of ${object.key}: ${abortError instanceof Error ? abortError.message : String(abortError)}`);
    });
    throw error;
  } finally {
    await rm(partsDir, { recursive: true, force: true });
  }
}

/** Write index.json from the manifest, last of all objects. */
async function putIndex(): Promise<void> {
  const file = join(projectDir, "tmp", "data-deploy", INDEX_KEY);
  await mkdir(dirname(file), { recursive: true });
  await Bun.write(file, indexText(manifest));
  await putObject(index, file);
}

/** Return the local file of an object's source. */
function sourceFile(object: ManifestObject): string {
  switch (object.source.kind) {
    case "web-data":
      return join(projectDir, "web-data", object.source.path);
    case "archive":
      return join(projectDir, "tmp", "archives", object.source.path);
    case "data":
      return join(resolve(requireEnv("HIVWHOLEWEB_DATA")), object.source.path);
  }
}

function indexObject(text: string): ManifestObject {
  const bytes = new TextEncoder().encode(text);
  return {
    key: INDEX_KEY,
    source: { kind: "web-data", path: INDEX_KEY },
    sha256: createHash("sha256").update(bytes).digest("hex"),
    size: bytes.length,
    contentType: "application/json",
    cacheControl: INDEX_CACHE,
  };
}

function objectArgs(object: ManifestObject): string[] {
  return [
    ...["--bucket", bucket, "--key", storageKey(object), "--content-type", object.contentType, "--cache-control", object.cacheControl],
    ...(object.contentDisposition === undefined ? [] : ["--content-disposition", object.contentDisposition]),
  ];
}

async function crc64nvmeBase64(bytes: Uint8Array): Promise<string> {
  const crc = new Crc64Nvme();
  crc.update(bytes);
  return Buffer.from(await crc.digest()).toString("base64");
}

function hexToBase64(hex: string): string {
  return Buffer.from(hex, "hex").toString("base64");
}

type State = "match" | "missing" | "differs" | "conflict";
