const META_API_VERSION = "v25.0";

/*
 * Only explicitly approved commerce/event fields are forwarded.
 * Arbitrary incoming fields are not blindly passed to Meta.
 */
function buildCustomData(event) {
  const incoming =
    event.custom_data &&
    typeof event.custom_data === "object" &&
    !Array.isArray(event.custom_data)
      ? event.custom_data
      : {};

  const customData = {};

  const allowedFields = [
    "value",
    "currency",
    "content_ids",
    "contents",
    "content_type",
    "content_name",
    "content_category",
    "num_items",
    "order_id",
    "search_string",
    "status",
  ];

  for (const field of allowedFields) {
    if (
      incoming[field] !== undefined &&
      incoming[field] !== null &&
      incoming[field] !== ""
    ) {
      customData[field] = incoming[field];
    }
  }

  /*
   * Retain the legitimate normalized equivalent for internal debugging.
   * Meta's event_source_url remains the actual URL where the event occurred.
   */
  customData.canonical_url = event.canonical_url;

  return customData;
}

function buildUserData(event, request) {
  const incoming =
    event.user_data &&
    typeof event.user_data === "object" &&
    !Array.isArray(event.user_data)
      ? event.user_data
      : {};

  const userData = {
    client_user_agent:
      incoming.client_user_agent ||
      request.headers.get("User-Agent") ||
      undefined,

    client_ip_address:
      incoming.client_ip_address ||
      request.headers.get("CF-Connecting-IP") ||
      undefined,
  };

  /*
   * Meta browser identifiers may be supplied by the website tracker.
   */
  if (typeof incoming.fbp === "string" && incoming.fbp.trim()) {
    userData.fbp = incoming.fbp.trim();
  }

  if (typeof incoming.fbc === "string" && incoming.fbc.trim()) {
    userData.fbc = incoming.fbc.trim();
  }

  /*
   * Remove undefined values before sending.
   */
  return Object.fromEntries(
    Object.entries(userData).filter(([, value]) => value !== undefined)
  );
}

export async function sendToMeta(event, request, env) {
  if (!env.META_PIXEL_ID) {
    throw new Error("META_PIXEL_ID is not configured.");
  }

  if (!env.META_ACCESS_TOKEN) {
    throw new Error("META_ACCESS_TOKEN is not configured.");
  }

  const userData = buildUserData(event, request);

  if (!userData.client_user_agent) {
    throw new Error(
      "A client user-agent is required for website events."
    );
  }

  const metaEvent = {
    event_name: event.event_name,
    event_time: Math.floor(event.event_time),
    event_id: event.event_id,

    action_source: "website",

    /*
     * This is the actual page where the browser action occurred.
     */
    event_source_url: event.canonical_url,

    user_data: userData,
    custom_data: buildCustomData(event),
  };

  const payload = {
    data: [metaEvent],
  };

  /*
   * While META_TEST_EVENT_CODE exists, events are routed to
   * Meta Events Manager's Test Events screen.
   */
  if (
    typeof env.META_TEST_EVENT_CODE === "string" &&
    env.META_TEST_EVENT_CODE.trim()
  ) {
    payload.test_event_code = env.META_TEST_EVENT_CODE.trim();
  }

  const endpoint =
    `https://graph.facebook.com/${META_API_VERSION}/` +
    `${encodeURIComponent(env.META_PIXEL_ID)}/events` +
    `?access_token=${encodeURIComponent(env.META_ACCESS_TOKEN)}`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const responseText = await response.text();

  let responseBody;

  try {
    responseBody = JSON.parse(responseText);
  } catch {
    responseBody = {
      raw_response: responseText,
    };
  }

  if (!response.ok) {
    console.error(
      JSON.stringify({
        destination: "meta",
        status: response.status,
        event_id: event.event_id,
        response: responseBody,
      })
    );

    throw new Error(
      `Meta rejected the event with HTTP ${response.status}.`
    );
  }

  console.log(
    JSON.stringify({
      destination: "meta",
      success: true,
      status: response.status,
      event_id: event.event_id,
      events_received: responseBody.events_received,
    })
  );

  return {
    success: true,
    status: response.status,
    response: responseBody,
  };
}