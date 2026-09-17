// Vendored from https://github.com/zhangyang-crazy-one/dsh-zen-proxy
// (fork of https://github.com/Yee-h/dsh-zen-proxy, MIT).
// Source of truth for TUI compositions (source + lightweight modes);
// dsh-tui/plugins/zen-proxy is synced FROM this copy. Edit the fork and
// re-vendor rather than editing here.

// dsh-zen-proxy — Cordis plugin: in-process OpenAI-compatible proxy that
// injects OpenCode Zen official client headers on upstream requests.
//
// Why: the Zen gateway rate-limits free models for third-party clients by
// validating the User-Agent and x-opencode-* headers. dsh's LLM adapters
// forcibly send their own `user-agent` attribution header and cannot be
// configured to send the official opencode one, so a plain adapter cannot
// reach the free tier. This plugin runs a tiny local HTTP server (inside the
// dsh process, started/stopped with the profile) that rewrites the identity
// headers before forwarding to https://opencode.ai/zen/v1.
//
// Point the opencode provider baseURL in settings.yaml at the proxy:
//   llm-pi-ai.providers.opencode.baseURL: http://127.0.0.1:4097/v1
//
// Configuration (cordis.patch.yml):
//   - id: zen-proxy
//     name: 'dsh-zen-proxy'
//     config:
//       host: 127.0.0.1
//       port: 4097

import z from "@deepseek-ai/schemastery";
import crypto from "node:crypto";
import http from "node:http";
import https from "node:https";

export const name = "zen-proxy";

export const Config = z.object({
  host: z.string().default("127.0.0.1"),
  port: z.number().default(4097),
  upstreamHost: z.string().default("opencode.ai"),
  upstreamBasePath: z.string().default("/zen/v1"),
  userAgent: z
    .string()
    .default("opencode/1.18.30"),
  clientHeader: z.string().default("cli"),
  projectHeader: z.string().default("global"),
});

export const inject = [];

/** Deterministic per-request random id: `ses_` / `msg_` + 26 hex chars. */
const rnd = (p) => `${p}${crypto.randomBytes(13).toString("hex")}`;

/**
 * @param {import("@deepseek-ai/cordis").Context} ctx
 * @param {z.infer<typeof Config>} config
 */
export function apply(ctx, config) {
  const server = http.createServer((req, res) => {
    const { method, url } = req;
    const parsed = new URL(url, "http://127.0.0.1");
    // Normalize repeated /v1 prefixes (e.g. /v1/v1/messages -> /v1/messages)
    // and strip trailing slashes.
    const pathname = parsed.pathname.replace(/^(\/v1)+/, "/v1").replace(/\/+$/, "") || "/";

    // GET /v1/models — model-list discovery passthrough.
    if (method === "GET" && (pathname === "/v1/models" || pathname === "/models")) {
      forward(req, res, { method: "GET", path: `${config.upstreamBasePath}/models`, body: null });
      return;
    }

    // muse-spark (and other responses-only models) are served by the Zen
    // gateway at /v1/responses instead of /v1/chat/completions (oh-my-pi
    // #8957); union-alpha and other Claude models are served natively at
    // /v1/messages (Anthropic Messages protocol).
    let targetRoute = null;
    if (pathname === "/v1/chat/completions" || pathname === "/chat/completions") {
      targetRoute = "/chat/completions";
    } else if (pathname === "/v1/responses" || pathname === "/responses") {
      targetRoute = "/responses";
    } else if (pathname === "/v1/messages" || pathname === "/messages") {
      targetRoute = "/messages";
    }

    if (method !== "POST" || !targetRoute) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { type: "not_found", message: `zen-proxy: unsupported ${method} ${url}` } }));
      return;
    }

    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      // Forward each route to its matching upstream path without client query
      // params like ?beta=true (which Zen gateway rejects with 500/Endpoint unavailable).
      forward(req, res, { method: "POST", path: `${config.upstreamBasePath}${targetRoute}`, body });
    });
  });

  server.on("error", (error) => {
    ctx.logger.warn(`zen-proxy: server error: ${error.message}`);
  });

  ctx.effect(() => {
    server.listen(config.port, config.host, () => {
      ctx.logger.info(
        `zen-proxy: listening on http://${config.host}:${config.port}${config.upstreamBasePath} (upstream https://${config.upstreamHost})`
      );
    });
    return () => {
      server.close();
    };
  }, "zen-proxy.server");

  /** Forward one request to the Zen upstream with official headers injected. */
  function forward(req, res, { method, path, body }) {
    const sessionId = rnd("ses_");
    const headers = {
      "content-type": "application/json",
      "user-agent": config.userAgent,
      "x-opencode-client": config.clientHeader,
      "x-opencode-project": config.projectHeader,
      "x-opencode-session": sessionId,
      "x-session-id": sessionId,
      "x-opencode-request": rnd("msg_"),
    };
    // Pass through the caller's Authorization if present; nothing else.
    if (req.headers.authorization !== undefined) {
      headers.authorization = req.headers.authorization;
    }
    if (req.headers["anthropic-version"] !== undefined) {
      headers["anthropic-version"] = req.headers["anthropic-version"];
    } else if (path.endsWith("/messages")) {
      headers["anthropic-version"] = "2023-06-01";
    }
    if (req.headers["anthropic-beta"] !== undefined) {
      headers["anthropic-beta"] = req.headers["anthropic-beta"];
    }
    if (body !== null) {
      headers["content-length"] = Buffer.byteLength(body);
    }

    const out = https.request(
      {
        host: config.upstreamHost,
        port: 443,
        method,
        path,
        headers,
      },
      (up) => {
        res.writeHead(up.statusCode, up.headers);
        up.pipe(res);
      }
    );
    out.on("error", (e) => {
      ctx.logger.warn(`zen-proxy: upstream error: ${e.message}`);
      res.writeHead(502);
      res.end(String(e));
    });
    if (body === null) {
      out.end();
    } else {
      out.end(body);
    }
  }
}
