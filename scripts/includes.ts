// Shared page parts: each page holds a marker such as `<!-- include nav -->`
// where a part of src/_partials/ belongs, and the build replaces the marker with
// the part. Includes have one level and no variables.

const MARKER = /<!-- include ([a-z0-9-]+) -->/gu;

/** Directory of the shared page parts, relative to the source directory. */
export const PARTIALS_DIR = "_partials";

/**
 * Replace every include marker of a page with its part. A part is the text of
 * `_partials/<name>.html` without its final newline, so that the page keeps
 * the line break after the marker.
 */
export function insertPartials(html: string, partials: ReadonlyMap<string, string>): string {
  return html.replace(MARKER, (marker, name: string) => {
    const part = partials.get(name);
    if (part === undefined) {
      throw new Error(`no part ${PARTIALS_DIR}/${name}.html for ${marker}`);
    }
    return part;
  });
}

/** Return the include markers of a text. */
export function includeMarkers(text: string): string[] {
  return [...text.matchAll(MARKER)].map((match) => match[0]);
}

/** Return the part of a partial file: its text without the final newline. */
export function partialText(fileText: string): string {
  return fileText.endsWith("\n") ? fileText.slice(0, -1) : fileText;
}
