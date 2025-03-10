import { BunRequest, serve } from "bun";
import { statSync } from "fs";
import { join } from "path";
import { modelRoute } from "system/model/model-route";
import config from "../../config.json";
import { parseServerUrl } from "../../shared/types/config";
import * as api from "./lib/generated/api";

const { port: PORT, host: HOST } = process.env.PORT
  ? { port: parseInt(process.env.PORT), host: "localhost" }
  : parseServerUrl(config.backend.url);
const STATIC_DIR = "../../frontend/dist";

const invalidPath = new Set<string>();

function serveStatic(path: string) {
  try {
    if (invalidPath.has(path)) {
      return null;
    }
    const fullPath = join(import.meta.dir, STATIC_DIR, path);
    const stat = statSync(fullPath);

    if (stat.isFile()) {
      return new Response(Bun.file(fullPath));
    }
    return null;
  } catch (e) {
    invalidPath.add(path);
    return null;
  }
}

const routes = {} as Record<string, any>;
for (const [_, value] of Object.entries(api)) {
  routes[value.path] = async (req: BunRequest) => {
    if (req.method === "POST") {
      const args = (await req.json()) as unknown[];
      const ip_addr = server.requestIP(req);

      const result = await (value.handler as any).call(
        { req, ip: ip_addr?.address.split("").pop() },
        ...(args as Parameters<typeof value.handler>)
      );

      // If response is already a Response object, just add CORS headers
      if (result instanceof Response) {
        addCorsHeaders(result.headers);
        return result;
      }

      // Create response and preserve headers from API result
      const response = Response.json(result);

      // If the handler returned headers, add them to the response
      if (result && typeof result === "object" && "headers" in result) {
        const headerEntries = Object.entries(result.headers);
        for (const [key, value] of headerEntries) {
          response.headers.set(key, value as string);
        }
        // Remove headers from the JSON response
        delete (result as any).headers;
      }

      addCorsHeaders(response.headers);
      return response;
    } else {
      const response = new Response(null, { status: 200 });
      addCorsHeaders(response.headers);
      return response;
    }
  };
}

// CORS headers setup
function addCorsHeaders(headers: Headers) {
  headers.set("Access-Control-Allow-Origin", config.frontend.url);
  headers.set(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, DELETE, OPTIONS"
  );
  headers.set("Access-Control-Allow-Headers", "Content-Type, Set-Cookie");
  headers.set("Access-Control-Expose-Headers", "Set-Cookie");
  headers.set("Access-Control-Allow-Credentials", "true");
}


const server = serve({
  port: PORT,
  hostname: HOST,
  routes: {
    ...routes,
    "/_system/models/:model": async (req) => {
      const response = await modelRoute(req);
      addCorsHeaders(response.headers);
      return response;
    },
  },
  async fetch(req) {
    const url = new URL(req.url);

    // Handle CORS preflight requests
    if (req.method === "OPTIONS") {
      const response = new Response(null, { status: 204 });
      addCorsHeaders(response.headers);
      return response;
    }

    // Serve static files directly
    const staticResponse = serveStatic(url.pathname.slice(1));
    if (staticResponse) {
      addCorsHeaders(staticResponse.headers);
      return staticResponse;
    }

    // If it's an API route that wasn't handled by the routes above, return 404 JSON
    if (url.pathname.startsWith("/_system/")) {
      const response = new Response(JSON.stringify({ error: "Not Found" }), {
        status: 404,
        headers: {
          "Content-Type": "application/json",
        },
      });
      addCorsHeaders(response.headers);
      return response;
    }

    // // serve frontend static site
    // const indexResponse = serveStatic("index.html");
    // if (indexResponse) {
    //   addCorsHeaders(indexResponse.headers);
    //   return indexResponse;
    // }

    const readyResponse = new Response(
      JSON.stringify({ status: "Server Ready" }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
    addCorsHeaders(readyResponse.headers);
    return readyResponse;
  },
});

// Handle graceful shutdown
process.on("SIGINT", () => {
  server.stop();
  process.exit(0);
});

process.on("SIGTERM", () => {
  server.stop();
  process.exit(0);
});
