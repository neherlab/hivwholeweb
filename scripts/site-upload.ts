// Upload of a build (dist/) to a bucket of a page host, shared by the
// production site (scripts/publish-site.ts) and the previews
// (scripts/publish-preview.ts).

import { join } from "node:path";

import { contentType } from "../server/content-types.ts";
import { aws } from "./aws-cli.ts";
import { mapLimited } from "./concurrency.ts";
import { siteCacheControl } from "./site-objects.ts";

const JOBS = 16;

/** Return the files of a build, sorted; fail when the directory holds no build. */
export async function buildFiles(dist: string): Promise<string[]> {
  const files = (await Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: dist, dot: true }))).toSorted();
  if (!files.includes("index.html")) {
    throw new Error(`no build in ${dist}: run just build-dist first`);
  }
  return files;
}

/**
 * Upload every file of a build to `s3://<bucket>/<prefix><key(file)>`, with its
 * content type and the Cache-Control of scripts/site-objects.ts.
 * Pages go last, so that a page never refers to a file that is not stored yet.
 */
export async function uploadBuild(options: { dist: string; files: readonly string[]; bucket: string; prefix: string; key: (file: string) => string }): Promise<void> {
  const { dist, files, bucket, prefix, key } = options;
  const upload = async (file: string): Promise<void> => {
    await aws([
      "s3",
      "cp",
      "--content-type",
      contentType(file),
      "--cache-control",
      siteCacheControl(file),
      "--no-guess-mime-type",
      "--only-show-errors",
      join(dist, file),
      `s3://${bucket}/${prefix}${key(file)}`,
    ]);
  };
  await mapLimited(
    files.filter((file) => !file.endsWith(".html")),
    JOBS,
    upload,
  );
  await mapLimited(
    files.filter((file) => file.endsWith(".html")),
    JOBS,
    upload,
  );
}
