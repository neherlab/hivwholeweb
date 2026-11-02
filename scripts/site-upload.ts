// Upload of a build (dist/) to a bucket of a page host, shared by the
// production site (scripts/publish-site.ts) and the previews
// (scripts/publish-preview.ts).

import { join } from "node:path";

import { CopyObjectCommand, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";

import { contentType } from "../server/content-types.ts";
import { copySource } from "./aws.ts";
import { mapLimited } from "./concurrency.ts";
import { siteCacheControl } from "./site-objects.ts";

/** Requests at once of an upload or a copy of a build. */
export const JOBS = 64;

/** Return the files of a build, sorted; fail when the directory holds no build. */
export async function buildFiles(dist: string): Promise<string[]> {
  const files = (await Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: dist, dot: true }))).toSorted();
  if (!files.includes("index.html")) {
    throw new Error(`no build in ${dist}: run just build-dist first`);
  }
  return files;
}

/**
 * Split the files of a build into the steps of an upload: the static files,
 * then the pages, so that a page never refers to a file that is not stored yet.
 */
export function uploadSteps(files: readonly string[]): string[][] {
  return [files.filter((file) => !file.endsWith(".html")), files.filter((file) => file.endsWith(".html"))];
}

/**
 * Upload every file of a build to `s3://<bucket>/<prefix><key(file)>`, with its
 * content type and the Cache-Control of scripts/site-objects.ts, static files
 * before pages.
 */
export async function uploadBuild(options: { client: S3Client; dist: string; files: readonly string[]; bucket: string; prefix: string; key: (file: string) => string }): Promise<void> {
  const { client, dist, files, bucket, prefix, key } = options;
  for (const step of uploadSteps(files)) {
    await mapLimited(step, JOBS, async (file) => {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: `${prefix}${key(file)}`,
          Body: await Bun.file(join(dist, file)).bytes(),
          ContentType: contentType(file),
          CacheControl: siteCacheControl(file),
        }),
      );
    });
  }
}

/**
 * Copy the objects of a build inside a bucket, from `<from><key(file)>` to
 * `<to><key(file)>`, with their content type and cache headers, static files
 * before pages.
 */
export async function copyBuild(options: { client: S3Client; files: readonly string[]; bucket: string; from: string; to: string; key: (file: string) => string }): Promise<void> {
  const { client, files, bucket, from, to, key } = options;
  for (const step of uploadSteps(files)) {
    await mapLimited(step, JOBS, async (file) => {
      await client.send(new CopyObjectCommand({ Bucket: bucket, Key: `${to}${key(file)}`, CopySource: copySource(bucket, `${from}${key(file)}`), MetadataDirective: "COPY" }));
    });
  }
}
