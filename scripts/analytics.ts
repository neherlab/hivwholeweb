// Analytics of the pages: the Plausible tag of each page reports visits under
// the domain of the build setting HIVWHOLEWEB_PLAUSIBLE_DOMAIN, or the build
// removes the tag when the setting is empty.

const PLAUSIBLE_TAG = /<script id="plausible"[^>]*><\/script>/gu;

const DATA_DOMAIN = /\sdata-domain="[^"]*"/u;

// A host name, so that the value cannot leave the attribute.
const DOMAIN = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/u;

/** Origin of the Plausible script and of its event requests. */
export const PLAUSIBLE_ORIGIN = "https://plausible.io";

/**
 * Apply the analytics setting to the pages: write `domain` into the
 * `data-domain` of each page's Plausible tag, or remove the tag when `domain`
 * is empty. Fail when a page holds more than one tag or when no page holds one.
 */
export function applyAnalytics(pages: ReadonlyMap<string, string>, domain: string): Map<string, string> {
  if (domain !== "" && !DOMAIN.test(domain)) {
    throw new Error(`HIVWHOLEWEB_PLAUSIBLE_DOMAIN is not a host name: ${domain}`);
  }
  const counts = [...pages].map(([name, html]) => ({ name, count: html.match(PLAUSIBLE_TAG)?.length ?? 0 }));
  const repeated = counts.filter(({ count }) => count > 1).map(({ name }) => name);
  if (repeated.length > 0) {
    throw new Error(`pages with more than one Plausible tag: ${repeated.join(", ")}`);
  }
  if (counts.every(({ count }) => count === 0)) {
    throw new Error("no page holds a Plausible tag");
  }
  return new Map(
    [...pages].map(([name, html]) => [name, html.replace(PLAUSIBLE_TAG, (tag) => (domain === "" ? "" : tag.replace(DATA_DOMAIN, ` data-domain="${domain}"`)))]),
  );
}
