import {
  SITE_CONFIG,
  PATH_MAPPINGS,
  resolveSiteHost,
} from "./config.js";

const CORS_BASE_HEADERS = {
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

function getCorsHeaders(request) {
  const origin = request.headers.get("Origin");

  // Server-to-server requests may not contain Origin.
  if (!origin) {
    return {};
  }

  try {
    const originUrl = new URL(origin);
    const workerUrl = new URL(request.url);

    // Permit same-origin testing from the Worker's own URL.
    if (originUrl.origin === workerUrl.origin) {
      return {};
    }

    const siteMatch = resolveSiteHost(originUrl.hostname);

    if (!siteMatch.matched) {
      return null;
    }

    return {
      ...CORS_BASE_HEADERS,
      "Access-Control-Allow-Origin": origin,
      Vary: "Origin",
    };
  } catch {
    return null;
  }
}

function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

function normalizePath(pathname) {
  // Keep the homepage as "/".
  if (!pathname || pathname === "/") {
    return "/";
  }

  // Remove one or more trailing slashes.
  return pathname.replace(/\/+$/, "");
}

function createCanonicalUrl(originalUrl, siteMatch) {
  const canonicalUrl = new URL(originalUrl.toString());

  // Change only the hostname.
  canonicalUrl.hostname = siteMatch.canonicalHost;

  const normalizedOriginalPath = normalizePath(originalUrl.pathname);

  // Apply a configured path mapping when one exists.
  // Otherwise preserve the same path without a trailing slash.
  const mappedPath =
    PATH_MAPPINGS[normalizedOriginalPath] || normalizedOriginalPath;

  canonicalUrl.pathname = normalizePath(mappedPath);

  return canonicalUrl;
}

export default {
  async fetch(request) {
    const requestUrl = new URL(request.url);
    const corsHeaders = getCorsHeaders(request);

    /*
     * Reject browser requests from origins that are not listed
     * in config.js.
     */
    if (request.headers.has("Origin") && corsHeaders === null) {
      return jsonResponse(
        {
          success: false,
          error: "Origin is not authorized.",
        },
        403
      );
    }

    /*
     * Browser CORS preflight.
     */
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders || {},
      });
    }

    /*
     * Health endpoint.
     */
    if (requestUrl.pathname === "/health") {
      return jsonResponse(
        {
          success: true,
          service: "meta-tracker",
          site_id: SITE_CONFIG.siteId,
          canonical_host: SITE_CONFIG.canonicalHost,
          status: "healthy",
        },
        200,
        corsHeaders || {}
      );
    }

    /*
     * Tracking-event collector.
     */
    if (requestUrl.pathname === "/collect") {
      if (request.method !== "POST") {
        return jsonResponse(
          {
            success: false,
            error: "Method not allowed. Send a POST request.",
          },
          405,
          corsHeaders || {}
        );
      }

      const contentType = request.headers.get("Content-Type") || "";

      if (!contentType.toLowerCase().includes("application/json")) {
        return jsonResponse(
          {
            success: false,
            error: "Content-Type must be application/json.",
          },
          415,
          corsHeaders || {}
        );
      }

      let incomingEvent;

      try {
        incomingEvent = await request.json();
      } catch {
        return jsonResponse(
          {
            success: false,
            error: "Request body contains invalid JSON.",
          },
          400,
          corsHeaders || {}
        );
      }

      if (
        !incomingEvent ||
        typeof incomingEvent !== "object" ||
        Array.isArray(incomingEvent)
      ) {
        return jsonResponse(
          {
            success: false,
            error: "Request body must contain a JSON object.",
          },
          400,
          corsHeaders || {}
        );
      }

      const requiredFields = ["event_name", "event_time", "url"];

      const missingFields = requiredFields.filter(
        (field) =>
          incomingEvent[field] === undefined ||
          incomingEvent[field] === null ||
          incomingEvent[field] === ""
      );

      if (missingFields.length > 0) {
        return jsonResponse(
          {
            success: false,
            error: "Required fields are missing.",
            missing_fields: missingFields,
          },
          400,
          corsHeaders || {}
        );
      }

      if (
        typeof incomingEvent.event_name !== "string" ||
        incomingEvent.event_name.trim().length === 0 ||
        incomingEvent.event_name.length > 100
      ) {
        return jsonResponse(
          {
            success: false,
            error: "event_name must be a valid string.",
          },
          400,
          corsHeaders || {}
        );
      }

      if (
        typeof incomingEvent.event_time !== "number" ||
        !Number.isFinite(incomingEvent.event_time)
      ) {
        return jsonResponse(
          {
            success: false,
            error: "event_time must be a Unix timestamp number.",
          },
          400,
          corsHeaders || {}
        );
      }

      let originalUrl;

      try {
        originalUrl = new URL(incomingEvent.url);

        if (!["http:", "https:"].includes(originalUrl.protocol)) {
          throw new Error("Unsupported URL protocol");
        }
      } catch {
        return jsonResponse(
          {
            success: false,
            error: "url must contain a valid HTTP or HTTPS URL.",
          },
          400,
          corsHeaders || {}
        );
      }

      const siteMatch = resolveSiteHost(originalUrl.hostname);

      if (!siteMatch.matched) {
        return jsonResponse(
          {
            success: false,
            error: "The event URL hostname is not configured.",
            received_host: originalUrl.hostname,
          },
          403,
          corsHeaders || {}
        );
      }

      const canonicalUrl = createCanonicalUrl(
        originalUrl,
        siteMatch
      );

      const eventId =
        typeof incomingEvent.event_id === "string" &&
        incomingEvent.event_id.trim().length > 0
          ? incomingEvent.event_id.trim()
          : crypto.randomUUID();

      const acceptedEvent = {
        ...incomingEvent,

        event_name: incomingEvent.event_name.trim(),
        event_id: eventId,
        site_id: SITE_CONFIG.siteId,

        // Exact URL where the event occurred.
        original_url: originalUrl.toString(),

        // Normalized hostname and optional mapped path.
        canonical_url: canonicalUrl.toString(),

        environment: siteMatch.environment,
        test_event: siteMatch.isTestEvent,

        custom_data: {
          ...(incomingEvent.custom_data || {}),
          original_host: originalUrl.hostname,
          original_path: originalUrl.pathname,
          canonical_host: siteMatch.canonicalHost,
          canonical_path: canonicalUrl.pathname,
          environment: siteMatch.environment,
        },

        received_at: new Date().toISOString(),
      };

      /*
       * Safe debugging log. It intentionally avoids logging
       * user_data or other potentially sensitive fields.
       */
      console.log(
        JSON.stringify({
          event_id: acceptedEvent.event_id,
          event_name: acceptedEvent.event_name,
          original_host: originalUrl.hostname,
          original_path: originalUrl.pathname,
          canonical_host: canonicalUrl.hostname,
          canonical_path: canonicalUrl.pathname,
          environment: acceptedEvent.environment,
          received_at: acceptedEvent.received_at,
        })
      );

      /*
       * Meta forwarding will be added later.
       * For now, this endpoint only validates and normalizes.
       */
      return jsonResponse(
        {
          success: true,
          accepted: true,
          event_id: acceptedEvent.event_id,
          event_name: acceptedEvent.event_name,
          original_url: acceptedEvent.original_url,
          canonical_url: acceptedEvent.canonical_url,
          environment: acceptedEvent.environment,
          test_event: acceptedEvent.test_event,
        },
        202,
        corsHeaders || {}
      );
    }

    /*
     * Root endpoint.
     */
    return jsonResponse(
      {
        success: true,
        service: "meta-tracker",
        site_id: SITE_CONFIG.siteId,
        canonical_host: SITE_CONFIG.canonicalHost,
        message: "Meta Tracker Worker is running",
        endpoints: {
          health: "GET /health",
          collect: "POST /collect",
        },
      },
      200,
      corsHeaders || {}
    );
  },
};