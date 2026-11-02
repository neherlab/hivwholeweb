// Upload dist/ to sites of the preview host, then clear the cache of the host.
//
// Usage: bun scripts/publish-preview.ts [--dist <dir>] <site>...
//
// Each site is a folder of the preview bucket, and the CloudFront distribution in
// front of it serves the folder at https://<site>.<PREVIEWS_NEHERLAB_CLICK_DOMAIN>.
// The host serves the object `index` for `/` and every other path as the object
// of the same key, so each file goes to `<site>/<objectKey(file)>`
// (scripts/site-objects.ts). A site name is lowercased,
// every character other than a-z, 0-9, and `-` becomes `-`, and the name is cut
// to the 63 characters of a DNS label.
//
// The build is uploaded once, to the first site, with the cache headers of the
// page host (scripts/site-upload.ts), static files before pages. The other
// sites get copies inside the bucket. Files of an earlier upload that this
// build lacks stay, so open pages of the earlier version keep working. The
// preview host has no key store; the upload clears the cache of its
// distribution.
//
// Prints the URL of each site, one per line, in the order of the arguments.
//
// Environment:
//   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY   Credentials that may write the bucket and clear the cache
//   AWS_DEFAULT_REGION                         Region of the bucket
//   AWS_S3_BUCKET                              Bucket of the sites
//   AWS_CLOUDFRONT_DISTRIBUTION_ID             Distribution in front of the bucket
//   PREVIEWS_NEHERLAB_CLICK_DOMAIN             Domain of the preview host, such as previews.neherlab.click

import { join, resolve } from "node:path";

import { aws, invalidateAll, requireEnv } from "./aws-cli.ts";
import { siteName } from "./preview-sites.ts";
import { objectKey } from "./site-objects.ts";
import { buildFiles, uploadBuild } from "./site-upload.ts";

const args = Bun.argv.slice(2);

const distIndex = args.indexOf("--dist");

const DIST = resolve(distIndex === -1 ? join(import.meta.dir, "..", "dist") : (args[distIndex + 1] ?? ""));

const names = distIndex === -1 ? args : args.filter((_, index) => index !== distIndex && index !== distIndex + 1);

if (names.length === 0) {
  console.error("Usage: bun scripts/publish-preview.ts [--dist <dir>] <site>...");
  process.exit(2);
}

const bucket = requireEnv("AWS_S3_BUCKET");

const distribution = requireEnv("AWS_CLOUDFRONT_DISTRIBUTION_ID");

const domain = requireEnv("PREVIEWS_NEHERLAB_CLICK_DOMAIN");

const sites = names.map(siteName);

const files = await buildFiles(DIST);

const [first = "", ...others] = sites;

console.error(`uploading ${files.length} files to ${first}`);
await uploadBuild({ dist: DIST, files, bucket, prefix: `${first}/`, key: objectKey });

for (const site of others) {
  console.error(`copying ${first} to ${site}`);
  await aws(["s3", "cp", "--recursive", "--copy-props", "metadata-directive", "--only-show-errors", `s3://${bucket}/${first}/`, `s3://${bucket}/${site}/`]);
}

await invalidateAll(distribution);

console.log(sites.map((site) => `https://${site}.${domain}`).join("\n"));
