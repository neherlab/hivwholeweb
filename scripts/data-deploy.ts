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
// Every request goes through the AWS SDK, up to JOBS at once over reused
// connections, so a deploy or check of a few thousand objects takes seconds.
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
import { createReadStream } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { Readable } from "node:stream";

import {
  AbortMultipartUploadCommand,
  ChecksumAlgorithm,
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  HeadObjectCommand,
  PutObjectCommand,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { Crc64Nvme } from "@aws-sdk/crc64-nvme";

import { cloudFrontClient, copySource, invalidateAll, isNotFound, keyStoreClient, requireEnv, s3Client } from "./aws.ts";
import { mapLimited } from "./concurrency.ts";
import { deleteStoreKeys, planStoreSync, putStoreKeys, readStoreKeys, storeDifferences } from "./key-store.ts";
import {
  INDEX_CACHE,
  INDEX_KEY,
  type ManifestObject,
  type ObjectState,
  type StoredObject,
  dataStoreKeys,
  hexToBase64,
  indexText,
  objectState,
  partRanges,
  readManifest,
  storageKey,
} from "./manifest.ts";

const JOBS = 64;

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

const s3 = s3Client(JOBS);

const keyStore = keyStoreClient();

const manifest = await readManifest(manifestPath);

const indexBytes = new TextEncoder().encode(indexText(manifest));

const index: ManifestObject = indexObject(indexBytes);

const states = await mapLimited(manifest.objects, JOBS, async (object) => ({ object, state: await check(object) }));

const pending = states.filter(({ state }) => state !== "match");

pending.forEach(({ object, state }) => console.log(`${state} ${object.key}`));
console.error(`${states.length - pending.length} of ${states.length} objects match the manifest`);

if (mode === "verify") {
  const indexState = await check(index);
  if (indexState !== "match") {
    console.log(`differs ${INDEX_KEY}`);
  }
  const keys = await storeDifferences(keyStore, store, dataStoreKeys(manifest));
  keys.forEach((line) => console.log(line));
  process.exit(pending.length === 0 && indexState === "match" && keys.length === 0 ? 0 : 1);
}

const conflicts = pending.filter(({ object, state }) => state === "conflict" && !MUTABLE_KEYS.has(object.key));

if (conflicts.length > 0) {
  console.error(
    `objects that hold other bytes than the manifest names; keys are immutable, so new content needs a new key:\n${conflicts.map(({ object }) => object.key).join("\n")}`,
  );
  process.exit(1);
}

const results = await mapLimited(pending, JOBS, async ({ object, state }) => ({ object, state: await write(object, state) }));

const failed = results.filter(({ state }) => state !== "match");

failed.forEach(({ object, state }) => console.error(`still ${state} after the write: ${object.key}`));
console.error(`wrote ${results.length - failed.length} objects, ${failed.length} failed`);

if (failed.length > 0) {
  process.exit(1);
}

const plan = planStoreSync(await readStoreKeys(keyStore, store), dataStoreKeys(manifest), () => false);

console.error(`adding ${plan.puts.length} keys to the data store`);
await putStoreKeys(keyStore, store, plan.puts);

const indexWritten = (await check(index)) !== "match";

if (indexWritten) {
  await putObject(index, indexBytes);
  if ((await check(index)) !== "match") {
    console.error(`${INDEX_KEY} differs from the manifest after the write`);
    process.exit(1);
  }
}

if (results.length > 0 || indexWritten) {
  await invalidateAll(cloudFrontClient(), requireEnv("AWS_CLOUDFRONT_DISTRIBUTION_ID"));
}

console.error(`deleting ${plan.deletes.length} keys from the data store`);
await deleteStoreKeys(keyStore, store, plan.deletes);

const keyDifferences = await storeDifferences(keyStore, store, plan.final);

if (keyDifferences.length > 0) {
  console.error(`the data store differs from the manifest:\n${keyDifferences.join("\n")}`);
  process.exit(1);
}

/** Write one object that differs from the manifest, and return its state after the write. */
async function write(object: ManifestObject, state: ObjectState): Promise<ObjectState> {
  if (object.crc64nvme !== undefined) {
    await uploadMultipart(object, sourceFile(object));
  } else if (state === "differs") {
    await copyObject(object, copySource(bucket, storageKey(object)));
  } else if (object.source.kind === "data") {
    await copyObject(object, copySource(requireEnv("AWS_S3_SOURCE_BUCKET"), object.source.path));
    const copied = await check(object);
    if (copied === "match") {
      return copied;
    }
    console.error(`copy of ${object.key} differs from the manifest; uploading the local file`);
    await putObject(object, createReadStream(sourceFile(object)));
  } else {
    await putObject(object, createReadStream(sourceFile(object)));
  }
  return check(object);
}

/** Compare the stored object with the manifest, with one HEAD request (objectState of scripts/manifest.ts). */
async function check(object: ManifestObject): Promise<ObjectState> {
  return objectState(object, await head(storageKey(object)));
}

/** Return the size, checksums, and headers of a stored object, or `undefined` when it is missing. */
async function head(key: string): Promise<StoredObject | undefined> {
  try {
    return await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key, ChecksumMode: "ENABLED" }));
  } catch (error) {
    if (isNotFound(error)) {
      return undefined;
    }
    throw new Error(`HEAD of ${key} failed`, { cause: error });
  }
}

/** Copy an object onto its key with the manifest's headers and a full-object SHA-256. */
async function copyObject(object: ManifestObject, source: string): Promise<void> {
  await s3.send(
    new CopyObjectCommand({ ...objectFields(object), CopySource: source, ChecksumAlgorithm: ChecksumAlgorithm.SHA256, MetadataDirective: "REPLACE" }),
  );
}

/** Upload an object in one PUT, which S3 rejects unless its SHA-256 matches the manifest. */
async function putObject(object: ManifestObject, body: Uint8Array | Readable): Promise<void> {
  await s3.send(new PutObjectCommand({ ...objectFields(object), Body: body, ContentLength: object.size, ChecksumSHA256: hexToBase64(object.sha256) }));
}

/** Upload a file as a multipart upload with the manifest's full-object CRC64NVME, which S3 checks before it stores the object. */
async function uploadMultipart(object: ManifestObject, file: string): Promise<void> {
  const key = storageKey(object);
  const created = await s3.send(
    new CreateMultipartUploadCommand({ ...objectFields(object), ChecksumAlgorithm: ChecksumAlgorithm.CRC64NVME, ChecksumType: "FULL_OBJECT" }),
  );
  const uploadId = created.UploadId;
  if (uploadId === undefined) {
    throw new Error(`CreateMultipartUpload of ${key} returned no UploadId`);
  }
  try {
    const parts = await mapLimited(partRanges(object.size, PART_SIZE), PART_JOBS, async ({ number, start, end }) => {
      const bytes = await Bun.file(file).slice(start, end).bytes();
      const checksum = await crc64nvmeBase64(bytes);
      const uploaded = await s3.send(
        new UploadPartCommand({ Bucket: bucket, Key: key, UploadId: uploadId, PartNumber: number, Body: bytes, ChecksumCRC64NVME: checksum }),
      );
      return { ETag: uploaded.ETag, PartNumber: number, ChecksumCRC64NVME: checksum };
    });
    await s3.send(
      new CompleteMultipartUploadCommand({
        Bucket: bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: { Parts: parts },
        ChecksumCRC64NVME: hexToBase64(object.crc64nvme ?? ""),
        ChecksumType: "FULL_OBJECT",
        MpuObjectSize: object.size,
      }),
    );
  } catch (error) {
    await s3.send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId })).catch((abortError: unknown) => {
      console.error(
        `could not abort the multipart upload ${uploadId} of ${object.key}: ${abortError instanceof Error ? abortError.message : String(abortError)}`,
      );
    });
    throw error;
  }
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

function indexObject(bytes: Uint8Array): ManifestObject {
  return {
    key: INDEX_KEY,
    source: { kind: "web-data", path: INDEX_KEY },
    sha256: createHash("sha256").update(bytes).digest("hex"),
    size: bytes.length,
    contentType: "application/json",
    cacheControl: INDEX_CACHE,
  };
}

/** Bucket, key, and headers of an object. */
function objectFields(object: ManifestObject): { Bucket: string; Key: string; ContentType: string; CacheControl: string; ContentDisposition?: string } {
  return {
    Bucket: bucket,
    Key: storageKey(object),
    ContentType: object.contentType,
    CacheControl: object.cacheControl,
    ...(object.contentDisposition === undefined ? {} : { ContentDisposition: object.contentDisposition }),
  };
}

async function crc64nvmeBase64(bytes: Uint8Array): Promise<string> {
  const crc = new Crc64Nvme();
  crc.update(bytes);
  return Buffer.from(await crc.digest()).toString("base64");
}
