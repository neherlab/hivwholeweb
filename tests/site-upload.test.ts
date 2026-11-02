import { describe, expect, test } from "bun:test";

import { uploadSteps } from "../scripts/site-upload.ts";

describe("uploadSteps", () => {
  test("uploads the static files before the pages, so no page refers to a file that is not stored yet", () => {
    const files = ["404.html", "favicon.ico", "index.html", "patient/p1/index.html", "static-0123456789ab/css/site.css"];
    expect(uploadSteps(files)).toEqual([
      ["favicon.ico", "static-0123456789ab/css/site.css"],
      ["404.html", "index.html", "patient/p1/index.html"],
    ]);
  });
});
