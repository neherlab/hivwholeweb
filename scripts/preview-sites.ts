// Site names of the preview host (scripts/publish-preview.ts).

/** Preview site name as a DNS label. */
export function siteName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/gu, "-")
    .replace(/^-+/u, "")
    .slice(0, 63)
    .replace(/-+$/u, "");
}
