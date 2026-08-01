export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({
        success: true,
        service: "meta-tracker",
        status: "healthy",
      });
    }

    return Response.json({
      success: true,
      message: "Meta Tracker Worker is running",
    });
  },
};