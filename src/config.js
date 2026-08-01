export const SITE_CONFIG = {
  siteId: "open-science-museum",

  // Standard hostname used for genuine aliases of the same website.
  canonicalHost: "opensciencemuseum.org",

  // Add every real production hostname that displays the same website.
  allowedHosts: [
    "opensciencemuseum.org",
    "www.luminresearch.shop",
    "luminresearch.shop",

    // Add your exact legitimate subdomains below:
    // "shop.opensciencemuseum.org",
    // "us.opensciencemuseum.org",
  ],

  // Staging hosts are accepted but marked as test traffic.
  stagingHosts: [
    // "staging.opensciencemuseum.org",
  ],

  preserveOriginalUrl: true,
};

export function resolveSiteHost(hostname) {
  const host = hostname.toLowerCase();

  if (SITE_CONFIG.stagingHosts.includes(host)) {
    return {
      matched: true,
      canonicalHost: SITE_CONFIG.canonicalHost,
      environment: "staging",
      isTestEvent: true,
    };
  }

  if (SITE_CONFIG.allowedHosts.includes(host)) {
    return {
      matched: true,
      canonicalHost: SITE_CONFIG.canonicalHost,
      environment: "production",
      isTestEvent: false,
    };
  }

  return {
    matched: false,
    canonicalHost: null,
    environment: null,
    isTestEvent: false,
  };
}