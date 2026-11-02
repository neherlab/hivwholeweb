import { describe, expect, test } from "bun:test";

import { downloadForms, formLinks } from "../scripts/links.ts";

// Expected URLs follow src/static/js/download_forms.js: the template with each
// {field} replaced by the value of the form's select of that name.
describe("formLinks", () => {
  test("builds one URL per option of a patient page form", () => {
    const html = form("/static/data/alignments/haplotype_alignment_p4_{region}.fasta", select("region", ["psi", "V3", "RT1"]));

    expect(downloadForms(html).flatMap(formLinks)).toEqual([
      "/static/data/alignments/haplotype_alignment_p4_psi.fasta",
      "/static/data/alignments/haplotype_alignment_p4_V3.fasta",
      "/static/data/alignments/haplotype_alignment_p4_RT1.fasta",
    ]);
  });

  test("builds every combination of the options of two selects", () => {
    const html = form("/static/data/alignments/haplotype_alignment_{patient}_{region}.fasta", select("patient", ["p1", "p2"]) + select("region", ["V3", "PR"]));

    expect(downloadForms(html).flatMap(formLinks)).toEqual([
      "/static/data/alignments/haplotype_alignment_p1_V3.fasta",
      "/static/data/alignments/haplotype_alignment_p1_PR.fasta",
      "/static/data/alignments/haplotype_alignment_p2_V3.fasta",
      "/static/data/alignments/haplotype_alignment_p2_PR.fasta",
    ]);
  });

  test("builds the URLs of every download form of a page", () => {
    const html =
      form("/static/data/alignments/consensi_alignment_p1_{region}.fasta", select("region", ["F1"])) +
      form("/static/data/alignments/haplotype_alignment_p1_{region}.fasta", select("region", ["V3"]));

    expect(downloadForms(html).flatMap(formLinks)).toEqual(["/static/data/alignments/consensi_alignment_p1_F1.fasta", "/static/data/alignments/haplotype_alignment_p1_V3.fasta"]);
  });

  test("ignores forms without a download template", () => {
    const html = `<form id="etiForm" name="ETIFrom">${select("codon_pos", ["all", "1"])}</form>`;

    expect(downloadForms(html).flatMap(formLinks)).toEqual([]);
  });

  test("fails when a template field has no select", () => {
    const html = form("/static/data/alignments/haplotype_alignment_{patient}_{region}.fasta", select("region", ["V3"]));

    expect(() => downloadForms(html).flatMap(formLinks)).toThrow("no select named patient");
  });
});

function form(template: string, fields: string): string {
  return `<form role="form" data-download="${template}" name="haplo_precompiled">\n<div class="form-group">${fields}</div>\n<button type="submit">Download</button>\n</form>`;
}

function select(name: string, values: string[]): string {
  const options = values.map((value) => `<option value="${value}">${value}</option>`).join("");
  return `<label for="${name}">${name}</label>\n<select id="${name}" name="${name}">${options}</select>`;
}
