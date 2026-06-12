// content.js — NAS Download helper + Torrent Handler

(function () {
  "use strict";

  const ATTR      = "data-syno-injected";
  const TEXT_ATTR = "data-syno-text-injected";

  // Matches full magnet URIs in plain text
  const MAGNET_RE  = /magnet:\?[^\s"'<>]+/g;
  // Matches http(s) URLs ending in .torrent in plain text
  const TORRENT_RE = /https?:\/\/[^\s"'<>]+\.torrent(?:[^\s"'<>]*)/g;

  // ── URL validation ────────────────────────────────────────────────────────

  function isValidMagnetURI(url) {
    // Must start with magnet:? and contain required parameters
    if (!url.startsWith("magnet:?")) return false;
    // Must have at least one of: xt (exact topic), dn (display name), or tr (tracker)
    return /[&?](xt|dn|tr)=/.test(url);
  }

  function isValidTorrentURL(url) {
    // Must be http(s) and end with .torrent
    try {
      const u = new URL(url);
      return /\.torrent(\?|$)/i.test(u.pathname);
    } catch {
      return false;
    }
  }

  // ── send helper ───────────────────────────────────────────────────────────

  function sendUrl(btn, url, type) {
    // Validate URL format before sending
    const isValid = type === "torrent" ? isValidTorrentURL(url) : isValidMagnetURI(url);
    if (!isValid) {
      btn.textContent = "❌ Invalid";
      btn.disabled = false;
      btn.style.background = "#c0392b";
      btn.title = `Invalid ${type} URL`;
      console.warn(`[NAS] Invalid ${type} URL attempted: ${url.slice(0, 80)}`);
      return;
    }

    // Show confirmation dialog before sending
    const typeLabel = type === "torrent" ? "torrent file" : "magnet link";
    const name = type === "torrent" 
      ? new URL(url).pathname.split("/").pop() 
      : (url.match(/[?&]dn=([^&]+)/) ?? ["", "Torrent"])[1].substring(0, 50);
    
    if (!confirm(`Send ${typeLabel} to Download Station?\n\n${decodeURIComponent(name)}`)) {
      btn.textContent = "⬇ NAS";
      btn.disabled = false;
      return;
    }

    btn.textContent = "⏳";
    btn.disabled = true;
    const msg = type === "torrent"
      ? { type: "SEND_TORRENT", url }
      : { type: "SEND_MAGNET",  url };
    chrome.runtime.sendMessage(msg, resp => {
      if (chrome.runtime.lastError || !resp?.ok) {
        btn.textContent = "❌";
        btn.disabled = false;
        btn.style.background = "#c0392b";
        btn.title = resp?.error ?? "Error — check extension options";
      } else {
        btn.textContent = "✅";
        btn.style.background = "#1d7c2d";
      }
    });
  }

  // ── floating button ───────────────────────────────────────────────────────

  function makeFloatingButton(url, type, anchorEl) {
    const btn = document.createElement("button");
    btn.textContent = "⬇ NAS";
    btn.title = type === "torrent"
      ? "Send torrent to Synology Download Station"
      : "Send magnet to Synology Download Station";
    btn.setAttribute(ATTR, "btn");
    btn.setAttribute("data-url", url);
    btn.setAttribute("data-type", type);
    Object.assign(btn.style, {
      position:      "absolute",
      zIndex:        "2147483647",
      padding:       "2px 8px",
      fontSize:      "12px",
      fontFamily:    "sans-serif",
      fontWeight:    "600",
      color:         "#fff",
      background:    type === "torrent" ? "#1a7a4a" : "#1a6fb5",
      border:        "none",
      borderRadius:  "4px",
      cursor:        "pointer",
      lineHeight:    "1.7",
      whiteSpace:    "nowrap",
      pointerEvents: "all",
      userSelect:    "none",
      boxShadow:     "0 1px 4px rgba(0,0,0,0.3)"
    });

    function reposition() {
      const r = anchorEl.getBoundingClientRect();
      const btnWidth = btn.offsetWidth || 60;
      let top  = r.top  + window.scrollY;
      let left = r.right + window.scrollX + 6;
      if (r.right + btnWidth + 10 > window.innerWidth) {
        left = r.left + window.scrollX;
        top  = r.bottom + window.scrollY + 2;
      }
      btn.style.top  = `${top}px`;
      btn.style.left = `${left}px`;
    }

    btn.addEventListener("click", e => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      if (!btn.disabled) sendUrl(btn, url, type);
    });

    document.body.appendChild(btn);
    reposition();
    window.addEventListener("scroll", reposition, { passive: true });
    window.addEventListener("resize", reposition, { passive: true });
    return btn;
  }

  // ── process anchor links ──────────────────────────────────────────────────

  function processLink(a) {
    if (a.getAttribute(ATTR)) return;
    const href = a.href || "";
    let type = null;
    if (href.startsWith("magnet:")) type = "magnet";
    else if (/\.torrent(\?|$)/i.test(href)) type = "torrent";
    if (!type) return;
    a.setAttribute(ATTR, "1");
    makeFloatingButton(href, type, a);
  }

  // ── pill helper ───────────────────────────────────────────────────────────

  function makePill(url, type) {
    const pill = document.createElement("span");
    pill.setAttribute(TEXT_ATTR, "1");
    pill.setAttribute("data-url", url);
    pill.setAttribute("data-type", type);
    pill.title = url;
    pill.style.cssText = [
      "font-family:monospace",
      "font-size:0.85em",
      "word-break:break-all",
      `background:${type === "torrent" ? "rgba(26,122,74,0.08)" : "rgba(26,111,181,0.07)"}`,
      "border-radius:3px",
      "padding:0 2px",
      "display:inline"
    ].join(";");
    pill.textContent = url.length > 60 ? url.slice(0, 60) + "…" : url;
    return pill;
  }

  // ── one-time scan of text nodes ───────────────────────────────────────────

  const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT"]);

  function scanTextNodes() {
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          let el = node.parentElement;
          while (el) {
            if (SKIP_TAGS.has(el.tagName)) return NodeFilter.FILTER_REJECT;
            if (el.getAttribute(TEXT_ATTR) || el.getAttribute(ATTR)) return NodeFilter.FILTER_REJECT;
            el = el.parentElement;
          }
          const v = node.nodeValue;
          return (v.includes("magnet:?") || v.includes(".torrent"))
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_REJECT;
        }
      }
    );

    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);

    for (const node of nodes) {
      let skip = false;
      let el = node.parentElement;
      while (el) {
        if (el.getAttribute(TEXT_ATTR) || el.getAttribute(ATTR)) { skip = true; break; }
        el = el.parentElement;
      }
      if (skip) continue;

      const text = node.nodeValue;

      // Collect all matches (magnets + torrents), sorted by position
      const matches = [];
      let m;
      MAGNET_RE.lastIndex = 0;
      while ((m = MAGNET_RE.exec(text)) !== null) {
        matches.push({ url: m[0], index: m.index, length: m[0].length, type: "magnet" });
      }
      TORRENT_RE.lastIndex = 0;
      while ((m = TORRENT_RE.exec(text)) !== null) {
        matches.push({ url: m[0], index: m.index, length: m[0].length, type: "torrent" });
      }
      if (!matches.length) continue;
      matches.sort((a, b) => a.index - b.index);

      const frag = document.createDocumentFragment();
      let cursor = 0;
      for (const { url, index, length, type } of matches) {
        if (index < cursor) continue; // skip overlapping matches
        if (index > cursor) {
          frag.appendChild(document.createTextNode(text.slice(cursor, index)));
        }
        frag.appendChild(makePill(url, type));
        cursor = index + length;
      }
      if (cursor < text.length) {
        frag.appendChild(document.createTextNode(text.slice(cursor)));
      }

      node.parentNode.replaceChild(frag, node);
    }

    // Create floating buttons for all pills
    document.querySelectorAll(`[${TEXT_ATTR}="1"]`).forEach(pill => {
      if (pill.getAttribute("data-float-created")) return;
      pill.setAttribute("data-float-created", "1");
      const url  = pill.getAttribute("data-url");
      const type = pill.getAttribute("data-type");
      if (url && type) makeFloatingButton(url, type, pill);
    });
  }

  // ── MutationObserver — anchor tags only ───────────────────────────────────

  const observer = new MutationObserver(mutations => {
    for (const mut of mutations) {
      for (const node of mut.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        node.querySelectorAll?.('a').forEach(processLink);
        if (node.matches?.('a')) processLink(node);
      }
    }
  });

  observer.observe(document.body || document.documentElement, {
    childList: true,
    subtree:   true
  });

  // ── run ───────────────────────────────────────────────────────────────────

  document.querySelectorAll("a").forEach(processLink);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scanTextNodes);
  } else {
    scanTextNodes();
  }

})();
