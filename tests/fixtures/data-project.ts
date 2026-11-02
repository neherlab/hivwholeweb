// Small project folder for the tests of the data scripts: a page that links a
// download file, the derived data of web-data/, and a data directory.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/** Files of the fixture project, by path relative to its folder. */
export const PROJECT_FILES: Readonly<Record<string, string>> = {
  "src/index.html": '<a href="/static/data/tables/samples_p1.tsv">samples</a>',
  "web-data/api/data/tree/p1/V3.json": '{"tree": 1}',
  "web-data/static/eti/data/training-0123456789abcdef.bin": "training",
  "web-data/robots.txt": "User-agent: *\nDisallow: /\n",
  "data/tables/samples_p1.tsv": "sample\tdate\n",
  "data/trees/consensi_tree_p1_V3.json": '{"name": "root"}',
  "data/physiological/viral_load_p1.tsv": "date\tload\n",
};

/** Write the fixture project into `root`, with `changes` replacing or adding files. */
export async function writeProject(root: string, changes: Readonly<Record<string, string>> = {}): Promise<void> {
  await Promise.all(
    Object.entries({ ...PROJECT_FILES, ...changes }).map(async ([path, content]) => {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), content);
    }),
  );
}
