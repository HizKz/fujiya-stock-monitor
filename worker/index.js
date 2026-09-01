import { createNotification, handleInteraction } from "./discord.js";
import { triggerMonitorWorkflow } from "./github.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {
      if (request.method === "GET" && url.pathname === "/health") {
        return new Response(JSON.stringify({ ok: true }), {
          headers: { "Content-Type": "application/json; charset=utf-8" },
        });
      }

      if (request.method === "POST" && url.pathname === "/notifications") {
        return await createNotification(request, env);
      }

      if (request.method === "POST" && url.pathname === "/interactions") {
        return await handleInteraction(request, env);
      }

      return new Response("Not found", { status: 404 });
    } catch (error) {
      console.error(error);
      return new Response("Internal server error", { status: 500 });
    }
  },

  async scheduled(_controller, env) {
    await triggerMonitorWorkflow(env);
  },
};
