// CloudFront key store of a host: the set of URL paths that the host serves.
// The edge function of the host (defined by the infrastructure project) passes
// a request whose path is a key of the store and answers every other path with
// 404, so a deploy keeps the store equal to the paths of its objects.
//
// A deploy syncs the store in this order: upload the objects, add the new
// keys (putStoreKeys), clear the cache of the distribution, then delete the
// keys that the deploy no longer serves (deleteStoreKeys), and check the store
// against the expected key set (storeDifferences). So a path is never in the
// store before its object exists, and a cached object never outlives its key.

import { aws, stringField } from "./aws-cli.ts";

/** UpdateKeys changes at most 50 keys, or 3 MB, per request (CloudFront quotas on key value stores). */
export const UPDATE_BATCH = 50;

// The edge function only tests whether a key exists.
const VALUE = "1";

/** Read every key of a key store. */
export async function readStoreKeys(arn: string): Promise<Set<string>> {
  const listed: unknown = JSON.parse(await aws(["cloudfront-keyvaluestore", "list-keys", "--kvs-arn", arn, "--output", "json"]));
  const items: unknown = typeof listed === "object" && listed !== null ? Reflect.get(listed, "Items") : undefined;
  if (!Array.isArray(items)) {
    throw new Error(`list-keys of ${arn} returned no Items`);
  }
  return new Set(items.map((item: unknown) => stringField(item, "Key") ?? ""));
}

/**
 * Plan the sync of a store from its current keys to the expected keys: the
 * keys to add, the keys to delete (never those that `keep` holds), and the
 * key set after the sync.
 */
export function planStoreSync(current: ReadonlySet<string>, expected: ReadonlySet<string>, keep: (key: string) => boolean): StorePlan {
  const puts = [...expected].filter((key) => !current.has(key)).toSorted();
  const deletes = [...current].filter((key) => !expected.has(key) && !keep(key)).toSorted();
  const final = new Set([...expected, ...[...current].filter((key) => !expected.has(key) && keep(key))]);
  return { puts, deletes, final };
}

/** Keys to add and delete, and the key set of the store after the sync. */
export interface StorePlan {
  puts: string[];
  deletes: string[];
  final: Set<string>;
}

/** Add keys to a store, in batches of at most UPDATE_BATCH keys. */
export async function putStoreKeys(arn: string, keys: readonly string[]): Promise<void> {
  await updateInBatches(arn, keys, (batch) => ["--puts", JSON.stringify(batch.map((key) => ({ Key: key, Value: VALUE })))]);
}

/** Delete keys from a store, in batches of at most UPDATE_BATCH keys. */
export async function deleteStoreKeys(arn: string, keys: readonly string[]): Promise<void> {
  await updateInBatches(arn, keys, (batch) => ["--deletes", JSON.stringify(batch.map((key) => ({ Key: key })))]);
}

/** Return the differences of a store from the expected key set: `missing <key>` and `extra <key>` lines, sorted. */
export async function storeDifferences(arn: string, expected: ReadonlySet<string>): Promise<string[]> {
  const stored = await readStoreKeys(arn);
  return [
    ...[...expected].filter((key) => !stored.has(key)).map((key) => `missing ${key}`),
    ...[...stored].filter((key) => !expected.has(key)).map((key) => `extra ${key}`),
  ].toSorted();
}

/** Apply the keys in batches, each with the ETag that the previous update returned. */
async function updateInBatches(arn: string, keys: readonly string[], change: (batch: readonly string[]) => string[]): Promise<void> {
  if (keys.length === 0) {
    return;
  }
  const described: unknown = JSON.parse(await aws(["cloudfront-keyvaluestore", "describe-key-value-store", "--kvs-arn", arn, "--output", "json"]));
  let etag = requireEtag(described, arn);
  for (let start = 0; start < keys.length; start += UPDATE_BATCH) {
    const batch = keys.slice(start, start + UPDATE_BATCH);
    const updated: unknown = JSON.parse(await aws(["cloudfront-keyvaluestore", "update-keys", "--kvs-arn", arn, "--if-match", etag, ...change(batch), "--output", "json"]));
    etag = requireEtag(updated, arn);
  }
}

function requireEtag(response: unknown, arn: string): string {
  const etag = stringField(response, "ETag");
  if (etag === undefined) {
    throw new Error(`the key store ${arn} returned no ETag`);
  }
  return etag;
}
