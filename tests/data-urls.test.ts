import { describe, expect, test } from "bun:test";

import { rewriteDataUrls, sameHostDataUrls } from "../scripts/data-urls.ts";

const ORIGIN = "https://data.example.org";

describe("rewriteDataUrls", () => {
  test.each([
    ['d3.json("/api/data/tree/"+pname+"/"+region, f)', 'd3.json("https://data.example.org/api/data/tree/"+pname+"/"+region, f)'],
    ['<a href="/static/data/sequences/reference_p1_genomewide.gb">', '<a href="https://data.example.org/static/data/sequences/reference_p1_genomewide.gb">'],
    ['"/static/data/physiological/viral_load_"+pname+".tsv"', '"https://data.example.org/static/data/physiological/viral_load_"+pname+".tsv"'],
    ["<img src='/static/data/trees/tree_p1_V3_example.svg'>", "<img src='https://data.example.org/static/data/trees/tree_p1_V3_example.svg'>"],
    ['const DATA_BASE = "/static/eti/data/";', 'const DATA_BASE = "https://data.example.org/static/eti/data/";'],
    ['data-download="/static/data/alignments/consensi_alignment_p1_{region}.fasta"', 'data-download="https://data.example.org/static/data/alignments/consensi_alignment_p1_{region}.fasta"'],
  ])("points %s to the data host", (text, expected) => {
    expect(rewriteDataUrls(text, ORIGIN)).toBe(expected);
  });

  test.each([
    '<link href="/static/css/hivevo_style.css">',
    'fetch("/static/eti/manifest.json")',
    'import { estimate } from "/static/eti/estimator.js";',
    '<a href="/data/">Data</a>',
    "<p>The base URL is <code>/api/data/</code></p>",
  ])("leaves %s on the page host", (text) => {
    expect(rewriteDataUrls(text, ORIGIN)).toBe(text);
  });

  test("leaves no data URL of the page host", () => {
    const page = '<a href="/static/data/a.gb"></a><script>d3.json("/api/data/x")</script>';
    expect(sameHostDataUrls(rewriteDataUrls(page, ORIGIN))).toEqual([]);
  });
});
