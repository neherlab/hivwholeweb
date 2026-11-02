// Security headers of the page host, for the local server. The infrastructure
// project defines the headers of the production page host; this copy mirrors
// them, so that the local site runs under the same rules.

const PLAUSIBLE = "https://plausible.io";

/**
 * Return the security headers of the page host for a build: the data host
 * origin may serve images and API responses, and `https://plausible.io` may
 * serve the analytics script and take its events when analytics is on.
 */
export function securityHeaders(options: { dataOrigin: string; analytics: boolean }): Record<string, string> {
  const analytics = options.analytics ? [PLAUSIBLE] : [];
  const policy = [
    "default-src 'self'",
    ["script-src 'self' 'unsafe-inline'", ...analytics].join(" "),
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    `img-src 'self' data: ${options.dataOrigin}`,
    ["connect-src 'self'", options.dataOrigin, ...analytics].join(" "),
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
  ];
  return {
    "Content-Security-Policy": policy.join("; "),
    "Cross-Origin-Opener-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "Referrer-Policy": "no-referrer",
    "Strict-Transport-Security": "max-age=15768000; includeSubDomains",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "SAMEORIGIN",
  };
}
