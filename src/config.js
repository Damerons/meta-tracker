export const SITE_CONFIG = {
  siteId: "open-science-museum",

  // The hostname that legitimate aliases/subdomains are normalized to.
  canonicalHost: "opensciencemuseum.org",

  // Every production hostname allowed to send events.
  allowedHosts: [
    "opensciencemuseum.org",
    "www.opensciencemuseum.org",
    "luminresearch.shop",
    "www.luminresearch.shop",

    // Add additional legitimate subdomains here:
    // "shop.opensciencemuseum.org",
    // "us.opensciencemuseum.org",
  ],

  // Staging domains are accepted but marked as test traffic.
  stagingHosts: [
    // "staging.opensciencemuseum.org",
  ],

  preserveOriginalUrl: true,
};

/*
 * Maps a page path on a legitimate alias/subdomain
 * to the corresponding canonical page path.
 *
 * Example:
 * store.opensciencemuseum.org/shop/microscope
 * becomes:
 * opensciencemuseum.org/products/measurement
 */
export const PATH_MAPPINGS = {
  "/shop/microscope": "/products/measurement",

  // Add additional mappings in this format:
  // "/shop/old-page": "/products/new-page",
  // "/store/micrographia": "/collection/micrographia",
};

/**
 * Checks whether a hostname belongs to this configured website.
 */
export function resolveSiteHost(hostname) {
  const host = hostname.toLowerCase().replace(/\.$/, "");

  if (SITE_CONFIG.stagingHosts.includes(host)) {
    return {
      matched: true,
      originalHost: host,
      canonicalHost: SITE_CONFIG.canonicalHost,
      environment: "staging",
      isTestEvent: true,
    };
  }

  if (SITE_CONFIG.allowedHosts.includes(host)) {
    return {
      matched: true,
      originalHost: host,
      canonicalHost: SITE_CONFIG.canonicalHost,
      environment: "production",
      isTestEvent: false,
    };
  }

  return {
    matched: false,
    originalHost: host,
    canonicalHost: null,
    environment: null,
    isTestEvent: false,
  };
}