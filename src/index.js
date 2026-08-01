import {
  SITE_CONFIG,
  PATH_MAPPINGS,
  resolveSiteHost,
} from "./config.js";
import { sendToMeta } from "./meta.js";
const SERVER_EVENT_NAMES = new Set(["Purchase"]);
const SERVER_SIGNATURE_MAX_AGE_SECONDS = 300;

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

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function hexToBytes(hex) {
  if (!/^[0-9a-f]{64}$/i.test(hex)) {
    return null;
  }

  const bytes = new Uint8Array(hex.length / 2);

  for (let index = 0; index < hex.length; index += 2) {
    bytes[index / 2] = Number.parseInt(
      hex.slice(index, index + 2),
      16
    );
  }

  return bytes;
}

async function verifyServerSignature(request, rawBody, env) {
  if (!env.TRACKER_SERVER_SECRET) {
    return {
      ok: false,
      status: 500,
      error: "TRACKER_SERVER_SECRET is not configured.",
    };
  }

  const timestampHeader =
    request.headers.get("X-Tracker-Timestamp");

  const signatureHeader =
    request.headers.get("X-Tracker-Signature");

  if (!timestampHeader || !signatureHeader) {
    return {
      ok: false,
      status: 401,
      error: "Missing server authentication headers.",
    };
  }

  const timestamp = Number(timestampHeader);

  if (!Number.isInteger(timestamp)) {
    return {
      ok: false,
      status: 401,
      error: "Invalid server timestamp.",
    };
  }

  const currentTimestamp = Math.floor(Date.now() / 1000);

  if (
    Math.abs(currentTimestamp - timestamp) >
    SERVER_SIGNATURE_MAX_AGE_SECONDS
  ) {
    return {
      ok: false,
      status: 401,
      error: "Server signature has expired.",
    };
  }

  const signatureBytes = hexToBytes(
    signatureHeader.replace(/^sha256=/i, "").trim()
  );

  if (!signatureBytes) {
    return {
      ok: false,
      status: 401,
      error: "Invalid server signature format.",
    };
  }

  const encoder = new TextEncoder();

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(env.TRACKER_SERVER_SECRET),
    {
      name: "HMAC",
      hash: "SHA-256",
    },
    false,
    ["verify"]
  );

  const verified = await crypto.subtle.verify(
    "HMAC",
    key,
    signatureBytes,
    encoder.encode(`${timestamp}.${rawBody}`)
  );

  if (!verified) {
    return {
      ok: false,
      status: 401,
      error: "Invalid server signature.",
    };
  }

  return {
    ok: true,
  };
}

function validatePurchaseEvent(event) {
  if (!isPlainObject(event)) {
    return "Request body must contain a JSON object.";
  }

  if (!SERVER_EVENT_NAMES.has(event.event_name)) {
    return "Only Purchase is allowed on this endpoint.";
  }

  if (
    typeof event.event_time !== "number" ||
    !Number.isFinite(event.event_time)
  ) {
    return "event_time must be a Unix timestamp number.";
  }

  const now = Math.floor(Date.now() / 1000);
  const sevenDaysAgo = now - 7 * 24 * 60 * 60;
  const fiveMinutesAhead = now + 5 * 60;

  if (
    event.event_time < sevenDaysAgo ||
    event.event_time > fiveMinutesAhead
  ) {
    return "event_time is outside the allowed time window.";
  }

  if (
    typeof event.event_id !== "string" ||
    !event.event_id.trim()
  ) {
    return "Purchase requires a deterministic event_id.";
  }

  if (
    typeof event.url !== "string" ||
    !event.url.trim()
  ) {
    return "Purchase requires a source URL.";
  }

  if (!isPlainObject(event.custom_data)) {
    return "Purchase requires custom_data.";
  }

  const customData = event.custom_data;

  const numericValue = Number(customData.value);

  if (
    !Number.isFinite(numericValue) ||
    numericValue < 0
  ) {
    return "Purchase requires a valid numeric value.";
  }

  if (
    typeof customData.currency !== "string" ||
    !/^[A-Za-z]{3}$/.test(customData.currency.trim())
  ) {
    return "Purchase requires a three-letter currency code.";
  }

  if (
    customData.order_id === undefined ||
    customData.order_id === null ||
    String(customData.order_id).trim() === ""
  ) {
    return "Purchase requires order_id.";
  }

  if (
    !Array.isArray(customData.contents) ||
    customData.contents.length === 0
  ) {
    return "Purchase requires a contents array.";
  }

  for (const item of customData.contents) {
    if (!isPlainObject(item)) {
      return "Every contents item must be an object.";
    }

    if (
      !["string", "number"].includes(typeof item.id)
    ) {
      return "Every contents item requires an ID.";
    }

    if (
      !Number.isFinite(Number(item.quantity)) ||
      Number(item.quantity) <= 0
    ) {
      return "Every contents item requires a positive quantity.";
    }

    if (
      !Number.isFinite(Number(item.item_price)) ||
      Number(item.item_price) < 0
    ) {
      return "Every contents item requires a valid item_price.";
    }
  }

  return null;
}

export default {
  async fetch(request, env) {
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
    if (requestUrl.pathname === "/collect/server") {
  if (request.method !== "POST") {
    return jsonResponse(
      {
        success: false,
        error: "Method not allowed. Send a POST request.",
      },
      405
    );
  }

  const contentType =
    request.headers.get("Content-Type") || "";

  if (
    !contentType
      .toLowerCase()
      .includes("application/json")
  ) {
    return jsonResponse(
      {
        success: false,
        error: "Content-Type must be application/json.",
      },
      415
    );
  }

  /*
   * The raw body must be verified before parsing.
   * The sender must sign this exact body.
   */
  const rawBody = await request.text();

  const authentication =
    await verifyServerSignature(
      request,
      rawBody,
      env
    );

  if (!authentication.ok) {
    return jsonResponse(
      {
        success: false,
        error: authentication.error,
      },
      authentication.status
    );
  }

  let incomingEvent;

  try {
    incomingEvent = JSON.parse(rawBody);
  } catch {
    return jsonResponse(
      {
        success: false,
        error: "Request body contains invalid JSON.",
      },
      400
    );
  }

  const validationError =
    validatePurchaseEvent(incomingEvent);

  if (validationError) {
    return jsonResponse(
      {
        success: false,
        error: validationError,
      },
      400
    );
  }

  let originalUrl;

  try {
    originalUrl = new URL(incomingEvent.url);

    if (
      !["http:", "https:"].includes(
        originalUrl.protocol
      )
    ) {
      throw new Error("Unsupported protocol");
    }
  } catch {
    return jsonResponse(
      {
        success: false,
        error:
          "url must contain a valid HTTP or HTTPS URL.",
      },
      400
    );
  }

  const siteMatch =
    resolveSiteHost(originalUrl.hostname);

  if (!siteMatch.matched) {
    return jsonResponse(
      {
        success: false,
        error:
          "The event URL hostname is not configured.",
        received_host: originalUrl.hostname,
      },
      403
    );
  }

  const canonicalUrl = createCanonicalUrl(
    originalUrl,
    siteMatch
  );

  const acceptedEvent = {
    ...incomingEvent,

    event_name: "Purchase",
    event_id: incomingEvent.event_id.trim(),

    site_id: SITE_CONFIG.siteId,

    canonical_url: canonicalUrl.toString(),

    environment: siteMatch.environment,
    test_event: siteMatch.isTestEvent,

    user_data: isPlainObject(incomingEvent.user_data)
      ? incomingEvent.user_data
      : {},

    custom_data: {
      ...incomingEvent.custom_data,

      canonical_host: siteMatch.canonicalHost,
      canonical_path: canonicalUrl.pathname,
      canonical_url: canonicalUrl.toString(),

      environment: siteMatch.environment,
    },

    received_at: new Date().toISOString(),
  };

  console.log(
    JSON.stringify({
      route: "/collect/server",
      event_id: acceptedEvent.event_id,
      event_name: acceptedEvent.event_name,
      order_id:
        acceptedEvent.custom_data.order_id,
      canonical_host: canonicalUrl.hostname,
      received_at: acceptedEvent.received_at,
    })
  );

  try {
    const metaResult = await sendToMeta(
      acceptedEvent,
      request,
      env
    );

    return jsonResponse(
      {
        success: true,
        accepted: true,
        delivered_to_meta: true,

        event_id: acceptedEvent.event_id,
        event_name: acceptedEvent.event_name,

        canonical_url:
          acceptedEvent.canonical_url,

        meta: {
          status: metaResult.status,

          events_received:
            metaResult.response?.events_received ??
            null,

          messages:
            metaResult.response?.messages ?? [],

          test_event_code_applied:
            metaResult.test_event_code_applied ??
            false,
        },
      },
      202
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Meta delivery failed.";

    console.error(
      JSON.stringify({
        route: "/collect/server",
        event_id: acceptedEvent.event_id,
        event_name: acceptedEvent.event_name,
        delivered_to_meta: false,
        error: message,
      })
    );

    return jsonResponse(
      {
        success: false,
        accepted: true,
        delivered_to_meta: false,
        event_id: acceptedEvent.event_id,
        error: message,
      },
      502
    );
  }
}
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
 * Forward the validated event to Meta CAPI.
 * During testing, META_TEST_EVENT_CODE routes it to Test Events.
 */
let metaResult;

try {
  metaResult = await sendToMeta(
    acceptedEvent,
    request,
    env
  );
} catch (error) {
  console.error(
    JSON.stringify({
      destination: "meta",
      event_id: acceptedEvent.event_id,
      error:
        error instanceof Error
          ? error.message
          : "Unknown Meta delivery error",
    })
  );

  return jsonResponse(
    {
      success: false,
      accepted: true,
      delivered_to_meta: false,
      event_id: acceptedEvent.event_id,
      error:
        error instanceof Error
          ? error.message
          : "Meta delivery failed.",
    },
    502,
    corsHeaders || {}
  );
}

return jsonResponse(
  {
    success: true,
    accepted: true,
    delivered_to_meta: true,
    event_id: acceptedEvent.event_id,
    event_name: acceptedEvent.event_name,
    original_url: acceptedEvent.original_url,
    canonical_url: acceptedEvent.canonical_url,
    environment: acceptedEvent.environment,
    test_event: acceptedEvent.test_event,
    meta: {
      status: metaResult.status,
  events_received:
    metaResult.response?.events_received ?? null,
  messages:
    metaResult.response?.messages ?? [],
  test_event_code_applied:
    metaResult.test_event_code_applied,
},
  },
 202,
  corsHeaders || {}
);
}

/*
 * Root endpoint.
 */
if (
  requestUrl.pathname === "/" &&
  request.method === "GET"
) {
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
        server_purchase: "POST /collect/server",
      },
    },
    200,
    corsHeaders || {}
  );
}

/*
 * Reject every unknown route instead of returning
 * a misleading successful homepage response.
 */
return jsonResponse(
  {
    success: false,
    error: "Route not found.",
    path: requestUrl.pathname,
  },
  404,
  corsHeaders || {}
);
  },
};