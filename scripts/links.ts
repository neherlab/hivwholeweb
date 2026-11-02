// The data files that the site links to: the /static/data/ links and images of
// the pages, the links that page scripts and download forms build. The public
// data copy holds exactly these files.

import { join } from "node:path";

const PATIENTS = ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8", "p9", "p10", "p11"];

const DATA_PREFIX = "/static/data/";

/**
 * Return the files of the data directory that the site links to or shows,
 * sorted: from the pages of `site` and the tree API responses of `webData`.
 */
export async function linkedDataFiles(site: string, webData: string): Promise<string[]> {
  const pages = await readPages(site);
  const linked = pages.flatMap((html) => matchAll(html, /(?:href|src)=["']\/static\/data\/([^"']+)["']/gu));
  const forms = pages
    .flatMap(downloadForms)
    .flatMap(formLinks)
    .filter((url) => url.startsWith(DATA_PREFIX))
    .map((url) => url.slice(DATA_PREFIX.length));
  return [...new Set([...linked, ...forms, ...(await scriptFiles(webData))])].toSorted();
}

/**
 * Return the download forms of a page: the URL template of the data-download
 * attribute of each form, with `{field}` for each select, and the option values
 * of each select.
 */
export function downloadForms(html: string): DownloadForm[] {
  return [...html.matchAll(/<form[^>]*\sdata-download="([^"]+)"[^>]*>(.*?)<\/form>/gsu)].map((form) => ({
    template: form[1] ?? "",
    fields: new Map(
      [...(form[2] ?? "").matchAll(/<select[^>]*\sname="(\w+)"[^>]*>(.*?)<\/select>/gsu)].map((select) => [
        select[1] ?? "",
        matchAll(select[2] ?? "", /<option value="([^"]*)"/gu),
      ]),
    ),
  }));
}

/**
 * Return the URLs that a download form builds, decoded: its template with every
 * combination of the options of its selects, as src/static/js/download_forms.js
 * builds them.
 */
export function formLinks(form: DownloadForm): string[] {
  return formChoices(form).map((choice) => fillTemplate(form.template, choice));
}

/** Return every combination of the option values of the fields of a form's template. */
export function formChoices(form: DownloadForm): ReadonlyMap<string, string>[] {
  return [...new Set(templateFields(form.template))].reduce<ReadonlyMap<string, string>[]>(
    (choices, name) => {
      const values = form.fields.get(name);
      if (values === undefined) {
        throw new Error(`download form ${form.template} has no select named ${name}`);
      }
      return choices.flatMap((choice) => values.map((value) => new Map([...choice, [name, value]])));
    },
    [new Map()],
  );
}

/** Replace each `{field}` of a template with the value of the field. */
export function fillTemplate(template: string, choice: ReadonlyMap<string, string>): string {
  return template.replace(/\{(\w+)\}/gu, (placeholder, name: string) => {
    const value = choice.get(name);
    if (value === undefined) {
      throw new Error(`no value for ${placeholder} of ${template}`);
    }
    return value;
  });
}

/** Download form of a page: its URL template and the option values of each select. */
export interface DownloadForm {
  template: string;
  fields: ReadonlyMap<string, readonly string[]>;
}

/**
 * Return the files that page scripts link: the genome and the physiological
 * tables of each patient, and the tree that the tree page shows for each patient
 * and region of the tree API (web-data/api/data/tree/<patient>/<region>.json).
 * The paths follow the scripts of src/method/{genomes,physiological,trees}/index.html.
 */
async function scriptFiles(webData: string): Promise<string[]> {
  const responses = await Array.fromAsync(new Bun.Glob("api/data/tree/*/*.json").scan(webData));
  const trees = responses
    .map((path) => /^api\/data\/tree\/([^/]+)\/([^/]+)\.json$/u.exec(path))
    .filter((match) => match !== null)
    .map(([, patient = "", region = ""]) =>
      region.endsWith("_minor") ? `trees/haplotype_tree_${patient}_${region.slice(0, -"_minor".length)}.json` : `trees/consensi_tree_${patient}_${region}.json`,
    );
  return [
    ...PATIENTS.flatMap((p) => [`sequences/reference_${p}_genomewide.gb`, `physiological/viral_load_${p}.tsv`, `physiological/cell_count_${p}.tsv`]),
    ...trees,
  ];
}

async function readPages(site: string): Promise<string[]> {
  const paths = await Array.fromAsync(new Bun.Glob("**/*.html").scan(site));
  return Promise.all(paths.map((path) => Bun.file(join(site, path)).text()));
}

function templateFields(template: string): string[] {
  return matchAll(template, /\{(\w+)\}/gu);
}

function matchAll(text: string, pattern: RegExp): string[] {
  return [...text.matchAll(pattern)].map((m) => m[1] ?? "");
}
