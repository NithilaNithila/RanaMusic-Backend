// Shared HTTP transport tuning for all upstream (provider) HTTP clients.
//
// Node's http/https agents default keep-alive OFF on Node < 19, so every
// upstream call would open a fresh TCP+TLS connection. Enabling keep-alive
// (with a bounded idle timeout) reuses sockets across requests, cutting
// TLS handshake latency and file-descriptor churn on the hot paths (search,
// catalog pools, lyrics). A single agent per protocol is shared by all
// upstream clients for maximum connection reuse.
const http = require("http");
const https = require("https");

// A modest idle timeout keeps sockets warm without pinning them forever.
// 50s keeps below typical LB/upstream 60s idle timeouts.
const KEEP_ALIVE_TIMEOUT = 50 * 1000;

const httpAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 64,
  maxFreeSockets: 16,
  timeout: KEEP_ALIVE_TIMEOUT,
});

const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 64,
  maxFreeSockets: 16,
  timeout: KEEP_ALIVE_TIMEOUT,
});

module.exports = { httpAgent, httpsAgent };
