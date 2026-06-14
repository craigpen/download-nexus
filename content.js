// content.js — NAS Download helper + Torrent Handler

(function () {
  "use strict";

  console.log("[NAS] Content script loaded on", window.location.hostname);

  const ATTR      = "data-syno-injected";
  const TEXT_ATTR = "data-syno-text-injected";

  // NAS device info for tooltips
  let nasDevices = [];
  let nasTooltip = "Send to NAS";
  let whitelist = [];
  let currentDomain = window.location.hostname;
  let whitelistEnabled = false; // True if whitelist has domains
  let nasListLoaded = false;
  let whitelistLoaded = false;

  function injectButtons() {
    if (!nasListLoaded || !whitelistLoaded) return; // Wait for both to load

    // Check if this domain should have buttons
    if (whitelistEnabled && !whitelist.includes(currentDomain)) {
      console.log("[NAS] Domain not whitelisted, skipping injection");
      return;
    }

    console.log("[NAS] Injecting buttons on", currentDomain);
    document.querySelectorAll("a").forEach(processLink);
    scanTextNodes();
  }

  // Load NAS list
  chrome.runtime.sendMessage({ type: "GET_NAS_LIST" }, resp => {
    console.log("[NAS] GET_NAS_LIST response:", resp);
    nasDevices = resp?.list || [];
    if (nasDevices.length === 1) {
      nasTooltip = `Send to ${nasDevices[0].name}`;
    } else if (nasDevices.length > 1) {
      nasTooltip = `Send to: ${nasDevices.map(n => n.name).join(", ")}`;
    }
    nasListLoaded = true;
    injectButtons();
  });

  // Load whitelist
  chrome.runtime.sendMessage({ type: "GET_WHITELIST" }, resp => {
    console.log("[NAS] GET_WHITELIST response:", resp);
    whitelist = resp?.list || [];
    whitelistEnabled = whitelist.length > 0;
    console.log("[NAS] Whitelist enabled:", whitelistEnabled, "Current domain:", currentDomain, "In whitelist:", whitelist.includes(currentDomain));
    whitelistLoaded = true;
    injectButtons();
  });

  // Regex patterns
  const MAGNET_RE  = /magnet:\?[^\s"'<>]+/g;
  const TORRENT_RE = /https?:\/\/[^\s"'<>]+\.torrent(?:\?[^\s"'<>]*)*/g;

  // ── URL validation ────────────────────────────────────────────────────────

  function isValidMagnetURI(url) {
    // Must start with magnet:? and contain required parameters
    if (!url.startsWith("magnet:?")) return false;
    // Must have at least one of: xt (exact topic), dn (display name), or tr (tracker)
    return /[&?](xt|dn|tr)=/.test(url);
  }

  function isValidTorrentURL(url) {
    try {
      const u = new URL(url);
      return /\.torrent(\?|$)/i.test(u.pathname);
    } catch {
      return false;
    }
  }

  // ── send helper ───────────────────────────────────────────────────────────

  function sendUrl(btn, url, nasId, type) {
    // Validate URL format before sending
    const isMagnet = url.startsWith("magnet:");
    const isTorrent = /\.torrent(\?|$)/i.test(url);

    if (isMagnet && !isValidMagnetURI(url)) {
      btn.textContent = "❌";
      btn.disabled = false;
      btn.style.background = "#c0392b";
      btn.title = "Invalid magnet link";
      console.warn(`[NAS] Invalid magnet link attempted: ${url.slice(0, 80)}`);
      return;
    }

    if (isTorrent && !isValidTorrentURL(url)) {
      btn.textContent = "❌";
      btn.disabled = false;
      btn.style.background = "#c0392b";
      btn.title = "Invalid torrent URL";
      console.warn(`[NAS] Invalid torrent URL attempted: ${url.slice(0, 80)}`);
      return;
    }

    // Get display name for confirmation
    let name = "Download";
    if (isMagnet) {
      name = (url.match(/[?&]dn=([^&]+)/) ?? ["", "Download"])[1];
      name = decodeURIComponent(name).substring(0, 50);
    } else if (isTorrent) {
      name = url.split("/").pop().replace(/\.torrent(\?.*)?$/, "").substring(0, 50);
    }

    const nasName = nasDevices.find(n => n.id === nasId)?.name || "NAS";
    const typeLabel = isTorrent ? "torrent file" : "magnet link";
    if (!confirm(`Send ${typeLabel} to ${nasName}?\n\n${name}`)) {
      btn.textContent = "⬇ NAS";
      btn.disabled = false;
      return;
    }

    btn.textContent = "⏳";
    btn.disabled = true;
    chrome.runtime.sendMessage({ type: "SEND_MAGNET", url, nasId }, resp => {
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

  // ── inline button ─────────────────────────────────────────────────────────

  function showNasSelector(btn, url, type) {

    // If no NAS configured, show message
    if (nasDevices.length === 0) {
      alert("No NAS devices configured. Please go to extension options and add a NAS device first.");
      return;
    }

    // If only one NAS, send directly
    if (nasDevices.length === 1) {
      sendUrl(btn, url, nasDevices[0].id);
      return;
    }

    // Create popup menu matching button styling
    const popup = document.createElement("div");
    popup.setAttribute("data-syno-popup", "1");
    const bgColor = "#1a6fb5";
    popup.setAttribute("style", [
      "position: fixed !important",
      "z-index: 999999999 !important",
      `background: ${bgColor} !important`,
      "border: none !important",
      "border-radius: 3px !important",
      "box-shadow: 0 1px 3px rgba(0,0,0,0.2) !important",
      "min-width: 150px !important",
      "padding: 0 !important",
      "font-family: sans-serif !important",
      "font-size: 11px !important",
      "font-weight: 600 !important",
      "color: #fff !important",
      "overflow: hidden !important",
      "pointer-events: auto !important"
    ].join("; "));


    // Add NAS options
    nasDevices.forEach((nas, idx) => {
      const option = document.createElement("div");
      option.textContent = `${idx + 1}. ${nas.name}`;
      Object.assign(option.style, {
        padding:     "4px 8px",
        cursor:      "pointer",
        color:       "#fff",
        transition:  "background 0.15s",
        borderBottom: idx < nasDevices.length - 1 ? "1px solid rgba(255,255,255,0.2)" : "none",
        lineHeight:  "1.4"
      });
      option.addEventListener("mouseenter", () => {
        option.style.background = bgColor === "#1a7a4a" ? "#2a9a5a" : "#2a7fc5";
      });
      option.addEventListener("mouseleave", () => {
        option.style.background = "";
      });
      option.addEventListener("click", (e) => {
        e.stopPropagation();
        document.body.removeChild(popup);
        sendUrl(btn, url, nas.id);
      });
      popup.appendChild(option);
    });

    // Position popup near the button (fixed positioning, so no scroll offsets needed)
    const rect = btn.getBoundingClientRect();
    popup.style.left = rect.left + "px";
    popup.style.top = (rect.bottom + 6) + "px";


    document.body.appendChild(popup);


    // Close popup when clicking outside
    const closePopup = (e) => {
      if (!popup.contains(e.target) && e.target !== btn) {
        if (document.body.contains(popup)) {
          document.body.removeChild(popup);
        }
        document.removeEventListener("click", closePopup);
      }
    };
    setTimeout(() => document.addEventListener("click", closePopup), 0);
  }

  function makeInlineButton(url, type, anchorEl) {
    const btn = document.createElement("button");
    btn.textContent = "⬇ NAS";
    btn.title = nasTooltip;
    btn.setAttribute(ATTR, "btn");
    btn.setAttribute("data-url", url);
    btn.setAttribute("data-type", type);
    btn.setAttribute("style", [
      "display: inline-block !important",
      "margin-left: 4px !important",
      "padding: 2px 6px !important",
      "font-size: 11px !important",
      "font-family: sans-serif !important",
      "font-weight: 600 !important",
      "color: #fff !important",
      "background: #1a6fb5 !important",
      "border: none !important",
      "border-radius: 3px !important",
      "cursor: pointer !important",
      "line-height: 1.4 !important",
      "white-space: nowrap !important",
      "vertical-align: middle !important",
      "user-select: none !important",
      "pointer-events: auto !important",
      "box-shadow: 0 1px 3px rgba(0,0,0,0.2) !important"
    ].join("; "));

    btn.addEventListener("click", e => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      if (!btn.disabled) showNasSelector(btn, url, type);
    });

    // Insert button after the anchor element
    anchorEl.parentNode.insertBefore(btn, anchorEl.nextSibling);
    return btn;
  }

  // ── process anchor links ──────────────────────────────────────────────────

  function processLink(a) {
    // Skip if button already injected
    if (a.nextSibling && a.nextSibling.getAttribute && a.nextSibling.getAttribute(ATTR) === "btn") return;
    if (nasDevices.length === 0) return; // Don't inject if no NAS configured

    // Check whitelist: if enabled, only inject on whitelisted domains
    if (whitelistEnabled && !whitelist.includes(currentDomain)) return;

    const href = a.href || "";
    let type = null;
    if (href.startsWith("magnet:")) type = "magnet";
    else if (/\.torrent(\?|$)/i.test(href)) type = "torrent";
    if (!type) return;

    makeInlineButton(href, type, a);
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
      `background:${"rgba(26,111,181,0.07)"}`,
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
    if (nasDevices.length === 0) return; // Don't scan if no NAS configured

    // Check whitelist: if enabled, only scan on whitelisted domains
    if (whitelistEnabled && !whitelist.includes(currentDomain)) return;

    console.log("[NAS] scanTextNodes() starting, looking for magnet/torrent links in text nodes");

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
          const found = (v.includes("magnet:?") || v.includes(".torrent"));
          if (found) {
            console.log("[NAS] Found magnet/torrent link in text node:", v.slice(0, 100));
          }
          return found ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        }
      }
    );

    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    console.log("[NAS] Found", nodes.length, "text nodes with magnet/torrent links");

    for (const node of nodes) {
      let skip = false;
      let el = node.parentElement;
      while (el) {
        if (el.getAttribute(TEXT_ATTR) || el.getAttribute(ATTR)) { skip = true; break; }
        el = el.parentElement;
      }
      if (skip) continue;

      const text = node.nodeValue;

      // Collect all magnet and torrent link matches, sorted by position
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
      console.log("[NAS] Regex matched", matches.length, "links in this text node");
      if (!matches.length) continue;
      matches.sort((a, b) => a.index - b.index);
      console.log("[NAS] Creating pills and buttons for", matches.length, "links");

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

    // Create inline buttons for all pills
    document.querySelectorAll(`[${TEXT_ATTR}="1"]`).forEach(pill => {
      if (pill.getAttribute("data-btn-created")) return;
      pill.setAttribute("data-btn-created", "1");
      const url  = pill.getAttribute("data-url");
      const type = pill.getAttribute("data-type");
      if (url && type) makeInlineButton(url, type, pill);
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
