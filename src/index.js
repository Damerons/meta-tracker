const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

function jsonResponse(data, status = 200) {
  return Response.json(data, {
    status,
    headers: CORS_HEADERS,
  });
}

export default {
  async fetch(request) {
    const requestUrl = new URL(request.url);

    // Browser preflight request
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS,
      });
    }

    // Health check
    if (requestUrl.pathname === "/health") {
      return jsonResponse({
        success: true,
        service: "meta-tracker",
        status: "healthy",
      });
    }

    // Tracking-event collector
    if (requestUrl.pathname === "/collect") {
      if (request.method !== "POST") {
        return jsonResponse(
          {
            success: false,
            error: "Method not allowed. Send a POST request.",
          },
          405
        );
      }

      const contentType = request.headers.get("content-type") || "";

      if (!contentType.includes("application/json")) {
        return jsonResponse(
          {
            success: false,
            error: "Content-Type must be application/json.",
          },
          415
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
          400
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
          400
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
            error: "The url field must contain a valid HTTP or HTTPS URL.",
          },
          400
        );
      }

      const eventId =
        typeof incomingEvent.event_id === "string" &&
        incomingEvent.event_id.length > 0
          ? incomingEvent.event_id
          : crypto.randomUUID();

      const acceptedEvent = {
        ...incomingEvent,

        event_id: eventId,

        // Always retain the real URL where the event occurred.
        original_url: incomingEvent.url,

        // This remains unchanged until legitimate mapping rules are added.
        canonical_url: incomingEvent.url,

        received_at: new Date().toISOString(),
      };

      // Log only non-sensitive debugging information.
      console.log(
        JSON.stringify({
          event_id: acceptedEvent.event_id,
          event_name: acceptedEvent.event_name,
          source_host: originalUrl.hostname,
          received_at: acceptedEvent.received_at,
        })
      );

      return jsonResponse(
        {
          success: true,
          accepted: true,
          event_id: acceptedEvent.event_id,
          event_name: acceptedEvent.event_name,
          original_url: acceptedEvent.original_url,
          canonical_url: acceptedEvent.canonical_url,
        },
        202
      );
    }

    // Root endpoint
    return jsonResponse({
      success: true,
      service: "meta-tracker",
      message: "Meta Tracker Worker is running",
      endpoints: {
        health: "GET /health",
        collect: "POST /collect",
      },
    });
  },
};