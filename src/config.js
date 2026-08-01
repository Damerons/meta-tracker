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
    "shop.luminresearch.shop",
    "www.shop.luminresearch.shop",

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
  "/products/bac-water": "/shop/microscope-measurement-reference-cards/",
  "/products/pt-141": "/shop/prepared-microscopy-slide-collection/",
  "/products/tesamorelin": "/shop/historical-microscopy-observation-kit/",
  "/products/ipamorelin": "/shop/microscope-measurement-starter-set/",
  "/products/wolverine": "/shop/advanced-botanical-materials-slide-collection/",
  "/products/klow": "/shop/complete-microscope-calibration-observation-set/",
  "/products/kpv": "/shop/optical-resolution-test-slide-set/",
  "/products/glow": "/shop/advanced-botanical-materials-slide-collection/",
  "/products/ghk-cu": "/shop/prepared-microscopy-slide-collection/",
  "/products/tb-500": "/shop/microscope-measurement-starter-set/",
  "/products/bpc-157": "/shop/prepared-microscopy-slide-collection/",
  "/products/ss-31": "/shop/prepared-microscopy-slide-collection/",
  "/products/mots-c": "/shop/stage-micrometer-calibration-slide/",
  "/products/nad": "/shop/stage-micrometer-calibration-slide/",
  "/products/aod-9604": "/shop/prepared-microscopy-slide-collection/",
  "/products/glp3-rt": "/shop/advanced-botanical-materials-slide-collection/",
  "/products/glp2-tz": "/shop/optical-resolution-test-slide-set/",
  "/products/glp1-sm": "/shop/historical-microscopy-observation-kit/",
  "/checkout/order-recieved": "/thank-you",
  "/order-confirmed": "/thank-you",
  "/order-confirmed/thank-you-page-2": "/thank-you",
  "/privacy-policy": "/privacy",


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