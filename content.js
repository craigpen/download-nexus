// content.js — Download Nexus content script for magnet/torrent link handling

// ── Instance Lifecycle Management ──────────────────────────────────────────
// Track instance to prevent multiple content scripts from interfering

const CLEANUP_EVENT = 'download-nexus-content-script-cleanup';
const INSTANCE_ID = Math.random().toString(36).slice(2, 9);

console.log(`[ContentScript] 🆕 New instance spawned: ${INSTANCE_ID}`);

// Signal any existing older instance to destroy itself
document.dispatchEvent(new CustomEvent(CLEANUP_EVENT));

// Mark THIS instance as the active one
(window).downloadNexusScriptActive = INSTANCE_ID;
console.log(`[ContentScript] ✨ Instance ${INSTANCE_ID} is now active`);

(function () {
  "use strict";

  const ATTR      = "data-syno-injected";
  const TEXT_ATTR = "data-syno-text-injected";

  // NAS device info for tooltips
  let nasDevices = [];
  let nasTooltip = "Send to NAS";
  let whitelist = [];
  let currentDomain = window.location.hostname;
  let whitelistEnabled = false; // True when restricted mode is on
  let nasListLoaded = false;
  let whitelistLoaded = false;

  function isDomainWhitelisted(domain, patterns) {
    // If no patterns, nothing is whitelisted
    if (!patterns || patterns.length === 0) return false;
    // "*" matches everything
    if (patterns.includes("*")) return true;
    // Check exact and wildcard matches
    for (const pattern of patterns) {
      if (pattern === domain) return true; // Exact match
      if (pattern.startsWith("*.")) {
        // Wildcard: *.example.com matches www.example.com, sub.example.com, but not example.com itself
        const suffix = pattern.slice(1); // Remove the *, keep the .domain.com
        if (domain.endsWith(suffix)) return true;
      }
    }
    return false;
  }

  function injectButtons() {
    if (!nasListLoaded || !whitelistLoaded) return; // Wait for both to load

    // Check if this domain should have buttons
    if (whitelistEnabled && !isDomainWhitelisted(currentDomain, whitelist)) return;

    document.querySelectorAll("a").forEach(processLink);
    scanTextNodes();
  }

  // Load NAS list
  chrome.runtime.sendMessage({ type: "GET_NAS_LIST" }, resp => {
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
    whitelist = resp?.list || [];
    whitelistEnabled = resp?.mode === "restricted";
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
      "position: absolute !important",
      "top: 100% !important",
      "left: 0 !important",
      "margin-top: 6px !important",
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
        lineHeight:  "1.4",
        pointerEvents: "auto"
      });
      option.addEventListener("mouseenter", () => {
        option.style.background = bgColor === "#1a7a4a" ? "#2a9a5a" : "#2a7fc5";
      });
      option.addEventListener("mouseleave", () => {
        option.style.background = "";
      });
      option.addEventListener("click", (e) => {
        e.stopPropagation();
        btn.removeChild(popup);
        sendUrl(btn, url, nas.id);
      });
      popup.appendChild(option);
    });

    // Attach popup to button (absolute positioning)
    btn.appendChild(popup);

    // Close popup when clicking outside
    const closePopup = (e) => {
      if (!popup.contains(e.target) && e.target !== btn) {
        if (btn.contains(popup)) {
          btn.removeChild(popup);
        }
        document.removeEventListener("click", closePopup);
      }
    };

    popup.style.pointerEvents = "auto";
    setTimeout(() => document.addEventListener("click", closePopup), 0);
  }

  function makeInlineButton(url, type, anchorEl) {
    const btn = document.createElement("button");
    btn.title = nasTooltip;
    btn.setAttribute(ATTR, "btn");
    btn.setAttribute("data-url", url);
    btn.setAttribute("data-type", type);
    const iconDataUri = "data:image/png;base64,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";
    btn.setAttribute("style", [
      "position: relative !important",
      "display: inline-block !important",
      "overflow: visible !important",
      "margin-left: 4px !important",
      "width: 20px !important",
      "height: 20px !important",
      "padding: 0 !important",
      "background-image: url('" + iconDataUri + "') !important",
      "background-size: contain !important",
      "background-repeat: no-repeat !important",
      "background-position: center !important",
      "background-color: transparent !important",
      "border: none !important",
      "cursor: pointer !important",
      "vertical-align: middle !important",
      "user-select: none !important",
      "pointer-events: auto !important"
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
          return found ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
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

  // Defer initial scan until both NAS list and whitelist load (via injectButtons)
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", injectButtons);
  } else {
    injectButtons();
  }

  // ── Cleanup Handler ───────────────────────────────────────────────────────
  // When new script instance loads, old instance cleans up gracefully

  window.downloadNexusPerformCleanup = function performCleanup() {
    console.log(`[ContentScript] 🛑 Instance ${INSTANCE_ID} cleaning up...`);

    try {
      // Disconnect the observer
      observer?.disconnect?.();
      console.log('[ContentScript] ✅ Cleanup complete');
    } catch (err) {
      console.error('[ContentScript] Cleanup error:', err);
    }
  };

  // Listen for cleanup signal from new instance
  document.addEventListener(CLEANUP_EVENT, () => {
    console.log(`[ContentScript] 🔔 Cleanup event received, terminating instance ${INSTANCE_ID}`);
    window.downloadNexusPerformCleanup?.();
  });

})();

