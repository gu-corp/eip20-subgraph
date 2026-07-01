#!/usr/bin/env node
/**
 * Local IPFS auth proxy.
 *
 * graph-cli (>=0.9x) uploads to IPFS via the WHATWG `fetch`, which rejects any
 * URL containing credentials ("Request cannot be constructed from a URL that
 * includes credentials"). The sandbox1 IPFS endpoint sits behind Caddy Basic
 * Auth, so we cannot embed `admin:PASSWORD@` in the `--ipfs` URL.
 *
 * This proxy listens on 127.0.0.1 and forwards every request to the real IPFS
 * endpoint over HTTPS, injecting the Authorization header. Point graph-cli at
 * `--ipfs http://127.0.0.1:<PROXY_PORT>`.
 *
 * Env:
 *   IPFS_TARGET  full https URL of the IPFS endpoint (no credentials)
 *   IPFS_USER    Basic Auth user (default: admin)
 *   IPFS_PASS    Basic Auth password
 *   PROXY_PORT   local port to listen on (default: 5001)
 */
import http from "node:http";
import https from "node:https";

const TARGET = process.env.IPFS_TARGET;
const USER = process.env.IPFS_USER || "admin";
const PASS = process.env.IPFS_PASS || "";
const PORT = Number(process.env.PROXY_PORT || 5001);

if (!TARGET) {
  console.error("IPFS_TARGET is required");
  process.exit(1);
}

const target = new URL(TARGET);
const auth = "Basic " + Buffer.from(`${USER}:${PASS}`).toString("base64");

const server = http.createServer((req, res) => {
  const options = {
    hostname: target.hostname,
    port: target.port || 443,
    method: req.method,
    path: req.url,
    headers: { ...req.headers, host: target.host, authorization: auth },
  };
  const proxyReq = https.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
    proxyRes.pipe(res);
  });
  proxyReq.on("error", (err) => {
    console.error("proxy error:", err.message);
    if (!res.headersSent) res.writeHead(502);
    res.end(String(err));
  });
  req.pipe(proxyReq);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`IPFS auth proxy listening on http://127.0.0.1:${PORT} -> ${TARGET}`);
});
