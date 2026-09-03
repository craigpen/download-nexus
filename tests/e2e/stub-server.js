/**
 * stub-server.js — In-process HTTP stub for download services.
 *
 * The extension's background service worker performs *real* `fetch()` calls, and
 * Playwright request interception is unreliable for MV3 service workers. So instead
 * of mocking at the network layer we boot a tiny real HTTP server on 127.0.0.1 and
 * point the extension's service config at it.
 *
 * Implements just enough of the qBittorrent v2 Web API, the Synology DownloadStation
 * WebAPI and the JDownloader RemoteAPI for the extension to talk to it, plus a test
 * fixture page used by the content-script specs.
 *
 * Every server instance is isolated (random port), so specs can run in parallel.
 */

const http = require("http");
const { URL } = require("url");

const DEFAULT_TORRENTS = [
  {
    hash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1",
    name: "Ubuntu 24.04 Desktop ISO",
    state: "downloading",
    progress: 0.42,
    downloaded: 2_100_000_000,
    uploaded: 120_000_000,
    total_size: 5_000_000_000,
    dlspeed: 4_500_000,
    upspeed: 250_000,
    eta: 640
  },
  {
    hash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa2",
    name: "Debian 12 Netinst",
    state: "downloading",
    progress: 0.9,
    downloaded: 630_000_000,
    uploaded: 10_000_000,
    total_size: 700_000_000,
    dlspeed: 1_200_000,
    upspeed: 40_000,
    eta: 60
  },
  {
    hash: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb1",
    name: "Blender Open Movie Archive",
    state: "uploading",
    progress: 1,
    downloaded: 8_000_000_000,
    uploaded: 16_000_000_000,
    total_size: 8_000_000_000,
    dlspeed: 0,
    upspeed: 900_000,
    eta: 8640000
  },
  {
    hash: "ccccccccccccccccccccccccccccccccccccccc1",
    name: "Arch Linux 2026.01 ISO",
    state: "stoppedDL",
    progress: 0.15,
    downloaded: 150_000_000,
    uploaded: 0,
    total_size: 1_000_000_000,
    dlspeed: 0,
    upspeed: 0,
    eta: 8640000
  },
  {
    hash: "ddddddddddddddddddddddddddddddddddddddd1",
    name: "Fedora Workstation 41",
    state: "stalledDL",
    progress: 0.05,
    downloaded: 100_000_000,
    uploaded: 0,
    total_size: 2_000_000_000,
    dlspeed: 0,
    upspeed: 0,
    eta: 8640000
  },
  {
    hash: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee1",
    name: "Big Buck Bunny 4K",
    state: "stoppedUP",
    progress: 1,
    downloaded: 3_000_000_000,
    uploaded: 3_000_000_000,
    total_size: 3_000_000_000,
    dlspeed: 0,
    upspeed: 0,
    eta: 0
  }
];

/**
 * The HTML page used by the content-script specs. Contains magnet links,
 * .torrent links and a few links that must NOT be decorated.
 */
function testPageHtml() {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Torrent Test Site</title></head>
<body>
  <h1>Torrent Test Site</h1>
  <ul>
    <li><a id="magnet-1" href="magnet:?xt=urn:btih:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1&amp;dn=Ubuntu+24.04">Ubuntu 24.04 (magnet)</a></li>
    <li><a id="magnet-2" href="magnet:?xt=urn:btih:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb1&amp;dn=Debian+12">Debian 12 (magnet)</a></li>
    <li><a id="torrent-1" href="http://127.0.0.1:__PORT__/files/ubuntu-24.04.torrent">Ubuntu 24.04 (.torrent)</a></li>
    <li><a id="torrent-2" href="http://127.0.0.1:__PORT__/files/debian-12.torrent?dl=1">Debian 12 (.torrent with query)</a></li>
    <li><a id="plain-link" href="http://127.0.0.1:__PORT__/about.html">About this site (should not be decorated)</a></li>
    <li><a id="archive-link" href="http://127.0.0.1:__PORT__/files/bundle.zip">bundle.zip (only with otherFileTypes on)</a></li>
  </ul>
  <p id="bare-magnet-text">magnet:?xt=urn:btih:ccccccccccccccccccccccccccccccccccccccc1&amp;dn=Bare+Text+Magnet</p>
</body>
</html>`;
}

function readBody(req) {
  return new Promise(resolve => {
    const chunks = [];
    req.on("data", c => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

/**
 * Boot a stub service.
 *
 * @returns {Promise<StubServer>}
 */
async function startStubServer() {
  /** @type {{method:string, path:string, body:string, headers:object, at:number}[]} */
  const requests = [];
  let torrents = JSON.parse(JSON.stringify(DEFAULT_TORRENTS));

  // Failure injection: "none" | "auth" | "server" | "timeout" | "garbage"
  let failMode = "none";
  let latencyMs = 0;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1`);
    const body = (await readBody(req)).toString("utf8");
    requests.push({
      method: req.method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      body,
      headers: req.headers,
      at: Date.now()
    });

    const send = (status, payload, contentType = "application/json") => {
      res.writeHead(status, {
        "Content-Type": contentType,
        // The extension calls this origin from an extension page / service worker.
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
      });
      res.end(typeof payload === "string" ? payload : JSON.stringify(payload));
    };

    if (latencyMs > 0) await new Promise(r => setTimeout(r, latencyMs));

    if (req.method === "OPTIONS") return send(204, "");

    // ── Test-fixture pages (used by the content-script specs) ────────────────
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return send(200, testPageHtml().replace(/__PORT__/g, String(server.address().port)), "text/html; charset=utf-8");
    }
    if (url.pathname === "/about.html") {
      return send(200, "<!doctype html><title>About</title><h1>About</h1>", "text/html; charset=utf-8");
    }
    if (url.pathname === "/blank.html") {
      return send(200, "<!doctype html><title>Blank</title><body></body>", "text/html; charset=utf-8");
    }

    // ── Failure injection ────────────────────────────────────────────────────
    if (failMode === "timeout") {
      // Never respond — the adapter's AbortController should fire.
      return;
    }
    if (failMode === "server" && url.pathname.startsWith("/api")) {
      return send(500, "Internal Server Error", "text/plain");
    }
    if (failMode === "garbage" && url.pathname.startsWith("/api")) {
      return send(200, "<html>not json</html>", "text/html");
    }

    // ── qBittorrent Web API v2 ───────────────────────────────────────────────
    if (url.pathname === "/api/v2/auth/login") {
      if (failMode === "auth") return send(200, "Fails.", "text/plain");
      return send(200, "Ok.", "text/plain");
    }
    if (url.pathname === "/api/v2/app/webapiVersion") {
      if (failMode === "auth") return send(403, "Forbidden", "text/plain");
      return send(200, "2.11.2", "text/plain");
    }
    if (url.pathname === "/api/v2/app/version") {
      return send(200, "v5.0.1", "text/plain");
    }
    if (url.pathname === "/api/v2/torrents/info") {
      if (failMode === "auth") return send(403, "Forbidden", "text/plain");
      return send(200, torrents);
    }
    if (url.pathname === "/api/v2/torrents/add") {
      return send(200, "Ok.", "text/plain");
    }
    if (/^\/api\/v2\/torrents\/(stop|start|pause|resume|delete)$/.test(url.pathname)) {
      const action = url.pathname.split("/").pop();
      const params = new URLSearchParams(body);
      const hashes = (params.get("hashes") || "").split("|").filter(Boolean);
      if (action === "delete") {
        torrents = torrents.filter(t => !hashes.includes(t.hash));
      } else if (action === "stop" || action === "pause") {
        torrents.forEach(t => {
          if (hashes.includes(t.hash)) t.state = t.progress >= 1 ? "stoppedUP" : "stoppedDL";
        });
      } else {
        torrents.forEach(t => {
          if (hashes.includes(t.hash)) t.state = t.progress >= 1 ? "uploading" : "downloading";
        });
      }
      return send(200, "", "text/plain");
    }

    // ── Synology DownloadStation WebAPI ──────────────────────────────────────
    if (url.pathname === "/webapi/query.cgi") {
      return send(200, {
        success: true,
        data: {
          "SYNO.API.Auth": { path: "auth.cgi", minVersion: 1, maxVersion: 7 },
          "SYNO.DownloadStation.Task": { path: "DownloadStation/task.cgi", minVersion: 1, maxVersion: 3 }
        }
      });
    }
    if (url.pathname === "/webapi/auth.cgi") {
      if (failMode === "auth") return send(200, { success: false, error: { code: 400 } });
      return send(200, { success: true, data: { sid: "stub-sid-12345" } });
    }
    if (url.pathname.includes("task.cgi") || url.pathname === "/webapi/DownloadStation/task.cgi") {
      const method = url.searchParams.get("method") || new URLSearchParams(body).get("method");
      if (method === "create" || method === "delete" || method === "pause" || method === "resume") {
        return send(200, { success: true });
      }
      return send(200, {
        success: true,
        data: {
          total: torrents.length,
          tasks: torrents.map(t => ({
            id: t.hash,
            title: t.name,
            size: t.total_size,
            status: t.state === "uploading" ? "seeding" : t.state === "stoppedDL" ? "paused" : "downloading",
            additional: {
              transfer: {
                size_downloaded: t.downloaded,
                size_uploaded: t.uploaded,
                speed_download: t.dlspeed,
                speed_upload: t.upspeed
              },
              detail: { create_time: 1700000000 }
            }
          }))
        }
      });
    }

    // ── JDownloader RemoteAPI ────────────────────────────────────────────────
    if (url.pathname === "/jd/version") {
      if (failMode === "auth") return send(403, "Forbidden", "text/plain");
      return send(200, { data: 47331 });
    }
    if (url.pathname === "/downloadsV2/queryLinks") {
      return send(200, {
        data: torrents.slice(0, 2).map((t, i) => ({
          uuid: 1000 + i,
          name: t.name,
          bytesTotal: t.total_size,
          bytesLoaded: t.downloaded,
          speed: t.dlspeed,
          status: null,
          finished: false,
          running: true
        }))
      });
    }
    if (url.pathname === "/linkcollector/queryLinks") {
      return send(200, { data: [] });
    }
    if (url.pathname.startsWith("/linkgrabberv2/addLinks")
      || url.pathname.startsWith("/toolbar/")
      || url.pathname.startsWith("/downloadsV2/removeLinks")
      || url.pathname.startsWith("/linkcollector/removeLinks")) {
      return send(200, { data: true });
    }

    // ── Transmission RPC ─────────────────────────────────────────────────────
    if (url.pathname === "/transmission/rpc") {
      if (!req.headers["x-transmission-session-id"]) {
        res.writeHead(409, {
          "X-Transmission-Session-Id": "stub-session-id",
          "Content-Type": "text/plain",
          "Access-Control-Allow-Origin": "*"
        });
        return res.end("409: Conflict");
      }
      let parsed = {};
      try { parsed = JSON.parse(body || "{}"); } catch { /* ignore */ }
      if (parsed.method === "session-get") {
        return send(200, { result: "success", arguments: { version: "4.0.5" } });
      }
      if (parsed.method === "torrent-get") {
        return send(200, {
          result: "success",
          arguments: {
            torrents: torrents.map((t, i) => ({
              id: i + 1,
              name: t.name,
              status: t.state === "uploading" ? 6 : t.state === "stoppedDL" ? 0 : 4,
              percentDone: t.progress,
              totalSize: t.total_size,
              downloadedEver: t.downloaded,
              uploadedEver: t.uploaded,
              rateDownload: t.dlspeed,
              rateUpload: t.upspeed,
              eta: t.eta,
              error: 0,
              errorString: ""
            }))
          }
        });
      }
      return send(200, { result: "success", arguments: {} });
    }

    // ── Static test files ────────────────────────────────────────────────────
    if (url.pathname.startsWith("/files/")) {
      return send(200, "d8:announce0:4:infod4:name4:test12:piece lengthi16384eee",
        "application/x-bittorrent");
    }

    return send(404, { error: "not found", path: url.pathname });
  });

  // Browsers hold keep-alive sockets open, which would make server.close() hang
  // until the OS timeout. Track them so teardown can destroy them immediately.
  const sockets = new Set();
  server.on("connection", socket => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  server.keepAliveTimeout = 1000;

  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;

  return {
    port,
    host: "127.0.0.1",
    origin: `http://127.0.0.1:${port}`,
    /** URL of the magnet/torrent fixture page. */
    testPageUrl: `http://127.0.0.1:${port}/`,
    blankPageUrl: `http://127.0.0.1:${port}/blank.html`,

    /** Replace the torrent list the stub reports. */
    setTorrents(list) { torrents = JSON.parse(JSON.stringify(list)); },
    getTorrents() { return JSON.parse(JSON.stringify(torrents)); },

    /** "none" | "auth" | "server" | "timeout" | "garbage" */
    setFailMode(mode) { failMode = mode; },
    setLatency(ms) { latencyMs = ms; },

    /** All requests seen so far. */
    requests() { return requests.slice(); },
    requestsTo(pathFragment) {
      return requests.filter(r => r.path.includes(pathFragment));
    },
    lastRequestTo(pathFragment) {
      const hits = requests.filter(r => r.path.includes(pathFragment));
      return hits[hits.length - 1] || null;
    },
    reset() {
      requests.length = 0;
      torrents = JSON.parse(JSON.stringify(DEFAULT_TORRENTS));
      failMode = "none";
      latencyMs = 0;
    },
    async stop() {
      // "timeout" mode deliberately leaves requests unanswered; destroy every
      // socket so close() can resolve.
      for (const socket of sockets) socket.destroy();
      sockets.clear();
      await new Promise(resolve => server.close(resolve));
    }
  };
}

module.exports = { startStubServer, DEFAULT_TORRENTS };
