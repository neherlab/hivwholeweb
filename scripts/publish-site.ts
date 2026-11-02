// Upload dist/ to the production page host, sync its key store, and clear its cache.
//
// Usage: bun scripts/publish-site.ts [--dist <dir>]
//
// Each file goes to the bucket root under its path in dist/. Objects of earlier
// deploys stay, so a page that a browser or CloudFront still holds keeps working.
//
// The key store of the host holds the URL path of every object that the host
// serves (scripts/key-store.ts). The deploy uploads the static files, adds the
// paths of this build, waits until the edges have them, uploads the pages, and
// clears the cache, so no edge serves a page whose static files it would reject.
// Then it deletes the paths that this build no longer has, except those of the
// versioned static folders (static-<hash>/), whose objects stay in the bucket.
// It fails when the store then differs from the expected key set.
//
// Environment:
//   AWS_S3_BUCKET                    Bucket of the page host
//   AWS_CLOUDFRONT_DISTRIBUTION_ID   Distribution of the page host
//   AWS_CLOUDFRONT_KVS_ARN           Key store of the page host
//   AWS_DEFAULT_REGION               Region of the bucket
//   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN: credentials, from a
//   regional STS endpoint, because the key store API accepts only version 2 session tokens

import { join, resolve } from "node:path";

import { cloudFrontClient, invalidateAll, keyStoreClient, requireEnv, s3Client } from "./aws.ts";
import { deleteStoreKeys, planStoreSync, putStoreKeys, readStoreKeys, storeDifferences, waitForPropagation } from "./key-store.ts";
import { pageStoreKeys } from "./site-objects.ts";
import { JOBS, buildFiles, uploadBuild, uploadSteps } from "./site-upload.ts";

const args = Bun.argv.slice(2);

const distIndex = args.indexOf("--dist");

const DIST = resolve(distIndex === -1 ? join(import.meta.dir, "..", "dist") : (args[distIndex + 1] ?? ""));

const bucket = requireEnv("AWS_S3_BUCKET");

const distribution = requireEnv("AWS_CLOUDFRONT_DISTRIBUTION_ID");

const store = requireEnv("AWS_CLOUDFRONT_KVS_ARN");

const s3 = s3Client(JOBS);

const keyStore = keyStoreClient();

const files = await buildFiles(DIST);

const expected = pageStoreKeys(files);

const current = await readStoreKeys(keyStore, store);

const plan = planStoreSync(current, expected, (key) => key.startsWith("/static-"));

const [staticFiles = [], pages = []] = uploadSteps(files);

console.error(`uploading ${staticFiles.length} static files to s3://${bucket}/`);
await uploadBuild({ client: s3, dist: DIST, files: staticFiles, bucket, prefix: "", key: (file) => file });

console.error(`adding ${plan.puts.length} keys to the key store`);
await putStoreKeys(keyStore, store, plan.puts);
await waitForPropagation(plan.puts.length);

console.error(`uploading ${pages.length} pages to s3://${bucket}/`);
await uploadBuild({ client: s3, dist: DIST, files: pages, bucket, prefix: "", key: (file) => file });

await invalidateAll(cloudFrontClient(), distribution);

console.error(`deleting ${plan.deletes.length} keys from the key store`);
await deleteStoreKeys(keyStore, store, plan.deletes);

const differences = await storeDifferences(keyStore, store, plan.final);

if (differences.length > 0) {
  console.error(`the key store differs from the expected keys:\n${differences.join("\n")}`);
  process.exit(1);
}

console.error(`published ${files.length} files; the key store holds ${plan.final.size} keys`);
