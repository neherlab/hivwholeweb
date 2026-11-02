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

import {
  type CloudFrontKeyValueStoreClient,
  DescribeKeyValueStoreCommand,
  type UpdateKeysCommandInput,
  UpdateKeysCommand,
  paginateListKeys,
} from "@aws-sdk/client-cloudfront-keyvaluestore";

/** UpdateKeys changes at most 50 keys, or 3 MB, per request (CloudFront quotas on key value stores). */
export const UPDATE_BATCH = 50;

/** ListKeys returns at most 50 keys per page; without MaxResults it returns 10. */
const LIST_PAGE = 50;

// The edge function only tests whether a key exists.
const VALUE = "1";

/** Read every key of a key store, one page after another. */
export async function readStoreKeys(client: CloudFrontKeyValueStoreClient, arn: string): Promise<Set<string>> {
  const pages = await Array.fromAsync(paginateListKeys({ client, pageSize: LIST_PAGE }, { KvsARN: arn }));
  return new Set(pages.flatMap((page) => (page.Items ?? []).map((item) => item.Key ?? "")));
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

/** Split keys into the batches of the updates: at most UPDATE_BATCH keys each, in order. */
export function updateBatches(keys: readonly string[]): string[][] {
  return Array.from({ length: Math.ceil(keys.length / UPDATE_BATCH) }, (_, index) => keys.slice(index * UPDATE_BATCH, (index + 1) * UPDATE_BATCH));
}

/** Add keys to a store, in batches of at most UPDATE_BATCH keys. */
export async function putStoreKeys(client: CloudFrontKeyValueStoreClient, arn: string, keys: readonly string[]): Promise<void> {
  await updateInBatches(client, arn, keys, (batch) => ({ Puts: batch.map((key) => ({ Key: key, Value: VALUE })) }));
}

/** Delete keys from a store, in batches of at most UPDATE_BATCH keys. */
export async function deleteStoreKeys(client: CloudFrontKeyValueStoreClient, arn: string, keys: readonly string[]): Promise<void> {
  await updateInBatches(client, arn, keys, (batch) => ({ Deletes: batch.map((key) => ({ Key: key })) }));
}

/** Return the differences of a store from the expected key set: `missing <key>` and `extra <key>` lines, sorted. */
export async function storeDifferences(client: CloudFrontKeyValueStoreClient, arn: string, expected: ReadonlySet<string>): Promise<string[]> {
  const stored = await readStoreKeys(client, arn);
  return [
    ...[...expected].filter((key) => !stored.has(key)).map((key) => `missing ${key}`),
    ...[...stored].filter((key) => !expected.has(key)).map((key) => `extra ${key}`),
  ].toSorted();
}

/** Apply the keys in batches, one after another, each with the ETag that the previous update returned. */
async function updateInBatches(
  client: CloudFrontKeyValueStoreClient,
  arn: string,
  keys: readonly string[],
  change: (batch: readonly string[]) => Pick<UpdateKeysCommandInput, "Puts" | "Deletes">,
): Promise<void> {
  const batches = updateBatches(keys);
  if (batches.length === 0) {
    return;
  }
  let etag = requireEtag((await client.send(new DescribeKeyValueStoreCommand({ KvsARN: arn }))).ETag, arn);
  for (const batch of batches) {
    etag = requireEtag((await client.send(new UpdateKeysCommand({ KvsARN: arn, IfMatch: etag, ...change(batch) }))).ETag, arn);
  }
}

function requireEtag(etag: string | undefined, arn: string): string {
  if (etag === undefined) {
    throw new Error(`the key store ${arn} returned no ETag`);
  }
  return etag;
}
