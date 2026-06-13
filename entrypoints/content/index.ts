// content.ts — NAS Download helper content script

if (typeof document !== "undefined" && typeof window !== "undefined") {
  (function () {
    "use strict";

  const ATTR      = "data-syno-injected";
  const TEXT_ATTR = "data-syno-text-injected";

  // NAS device info for tooltips
  let nasDevices: any[] = [];
  let nasTooltip = "Send to NAS";
  let whitelist: string[] = [];
  let currentDomain = "";
  let whitelistEnabled = false; // True if whitelist has domains

  // Set domain at runtime
  try {
    currentDomain = window.location.hostname;
  } catch {
    currentDomain = "";
  }

  // Load NAS list and whitelist on content script load
  const initializeExtension = () => {
    try {
      chrome.runtime.sendMessage({ type: "GET_NAS_LIST" }, (resp: any) => {
        nasDevices = resp?.list || [];
        if (nasDevices.length === 1) {
          nasTooltip = `Send to ${nasDevices[0].name}`;
        } else if (nasDevices.length > 1) {
          nasTooltip = `Send to: ${nasDevices.map((n: any) => n.name).join(", ")}`;
        }
        // Update all existing buttons with new tooltip
        document.querySelectorAll(`[${ATTR}="btn"]`).forEach((btn: any) => {
          btn.title = nasTooltip;
        });

        // Re-scan for links now that NAS list is loaded
        document.querySelectorAll("a").forEach(processLink);
        scanTextNodes();
      });

      // Load whitelist (global across all NAS)
      chrome.runtime.sendMessage({ type: "GET_WHITELIST" }, (resp: any) => {
        whitelist = resp?.list || [];
        whitelistEnabled = whitelist.length > 0;

        // If whitelist is enabled and current domain is NOT whitelisted, remove all injected buttons
        if (whitelistEnabled && !whitelist.includes(currentDomain)) {
          document.querySelectorAll(`[${ATTR}="btn"]`).forEach((btn: any) => {
            btn.remove();
          });
          // Remove pills and their buttons too
          document.querySelectorAll(`[${TEXT_ATTR}="1"]`).forEach((pill: any) => {
            pill.remove();
          });
        } else if (whitelistEnabled) {
          // Domain is whitelisted, re-scan in case buttons were blocked initially
          document.querySelectorAll("a").forEach(processLink);
          scanTextNodes();
        }
      });
    } catch (e) {
      // Chrome API not available during build
    }
  };

  // Delay initialization to avoid running during build
  if (typeof chrome !== "undefined" && chrome?.runtime?.onMessage) {
    setTimeout(initializeExtension, 0);
  }

  // Matches full magnet URIs in plain text
  const MAGNET_RE  = /magnet:\?[^\s"'<>]+/g;
  // Matches http(s) URLs ending in .torrent in plain text
  const TORRENT_RE = /https?:\/\/[^\s"'<>]+\.torrent(?:[^\s"'<>]*)/g;

  // ── URL validation ────────────────────────────────────────────────────────

  function isValidMagnetURI(url: string) {
    // Must start with magnet:? and contain required parameters
    if (!url.startsWith("magnet:?")) return false;
    // Must have at least one of: xt (exact topic), dn (display name), or tr (tracker)
    return /[&?](xt|dn|tr)=/.test(url);
  }

  function isValidTorrentURL(url: string) {
    // Must be http(s) and end with .torrent
    try {
      const u = new URL(url);
      return /\.torrent(\?|$)/i.test(u.pathname);
    } catch {
      return false;
    }
  }

  // ── send helper ───────────────────────────────────────────────────────────

  function sendUrl(btn: any, url: string, type: string, nasId: string) {
    // Validate URL format before sending
    const isValid = type === "torrent" ? isValidTorrentURL(url) : isValidMagnetURI(url);
    if (!isValid) {
      btn.textContent = "❌";
      btn.disabled = false;
      btn.style.background = "#c0392b";
      btn.title = `Invalid ${type} URL`;
      return;
    }

    // Get filename for confirmation
    const typeLabel = type === "torrent" ? "torrent file" : "magnet link";
    const name = type === "torrent"
      ? new URL(url).pathname.split("/").pop()
      : (url.match(/[?&]dn=([^&]+)/) ?? ["", "Torrent"])[1].substring(0, 50);

    const nasName = nasDevices.find((n: any) => n.id === nasId)?.name || "NAS";
    if (!confirm(`Send ${typeLabel} to ${nasName}?\n\n${decodeURIComponent(name)}`)) {
      btn.textContent = "⬇ NAS";
      btn.disabled = false;
      return;
    }

    btn.textContent = "⏳";
    btn.disabled = true;
    const msg = type === "torrent"
      ? { type: "SEND_TORRENT", url, nasId }
      : { type: "SEND_MAGNET",  url, nasId };
    chrome.runtime.sendMessage(msg, (resp: any) => {
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

  function showNasSelector(btn: any, url: string, type: string) {

    // If no NAS configured, show message
    if (nasDevices.length === 0) {
      alert("No NAS devices configured. Please go to extension options and add a NAS device first.");
      return;
    }

    // If only one NAS, send directly
    if (nasDevices.length === 1) {
      sendUrl(btn, url, type, nasDevices[0].id);
      return;
    }

    // Create popup menu matching button styling
    const popup = document.createElement("div");
    popup.setAttribute("data-syno-popup", "1");
    const bgColor = type === "torrent" ? "#1a7a4a" : "#1a6fb5";
    Object.assign(popup.style, {
      position:       "fixed",
      zIndex:         "999999999",
      background:     bgColor,
      border:         "none",
      borderRadius:   "3px",
      boxShadow:      "0 1px 3px rgba(0,0,0,0.2)",
      minWidth:       "150px",
      padding:        "0",
      fontFamily:     "sans-serif",
      fontSize:       "11px",
      fontWeight:     "600",
      color:          "#fff",
      overflow:       "hidden"
    });


    // Add NAS options
    nasDevices.forEach((nas: any, idx: number) => {
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
      option.addEventListener("click", (e: any) => {
        e.stopPropagation();
        document.body.removeChild(popup);
        sendUrl(btn, url, type, nas.id);
      });
      popup.appendChild(option);
    });

    // Position popup near the button (fixed positioning, so no scroll offsets needed)
    const rect = btn.getBoundingClientRect();
    popup.style.left = rect.left + "px";
    popup.style.top = (rect.bottom + 6) + "px";


    document.body.appendChild(popup);


    // Close popup when clicking outside
    const closePopup = (e: any) => {
      if (!popup.contains(e.target) && e.target !== btn) {
        if (document.body.contains(popup)) {
          document.body.removeChild(popup);
        }
        document.removeEventListener("click", closePopup);
      }
    };
    setTimeout(() => document.addEventListener("click", closePopup), 0);
  }

  function makeInlineButton(url: string, type: string, anchorEl: any) {
    const btn = document.createElement("button");
    btn.textContent = "⬇ NAS";
    btn.title = nasTooltip;
    btn.setAttribute(ATTR, "btn");
    btn.setAttribute("data-url", url);
    btn.setAttribute("data-type", type);
    Object.assign(btn.style, {
      display:      "inline-block",
      marginLeft:   "4px",
      padding:      "2px 6px",
      fontSize:     "11px",
      fontFamily:   "sans-serif",
      fontWeight:   "600",
      color:        "#fff",
      background:   type === "torrent" ? "#1a7a4a" : "#1a6fb5",
      border:       "none",
      borderRadius: "3px",
      cursor:       "pointer",
      lineHeight:   "1.4",
      whiteSpace:   "nowrap",
      verticalAlign: "middle",
      userSelect:   "none",
      boxShadow:    "0 1px 3px rgba(0,0,0,0.2)"
    });

    btn.addEventListener("click", (e: any) => {
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

  function processLink(a: any) {
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

  function makePill(url: string, type: string) {
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
    if (nasDevices.length === 0) return; // Don't scan if no NAS configured

    // Check whitelist: if enabled, only scan on whitelisted domains
    if (whitelistEnabled && !whitelist.includes(currentDomain)) return;

    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node: any) {
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

    const nodes: any[] = [];
    let currentNode;
    while (currentNode = walker.nextNode()) nodes.push(currentNode);

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
      const matches: any[] = [];
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
      matches.sort((a: any, b: any) => a.index - b.index);

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
    document.querySelectorAll(`[${TEXT_ATTR}="1"]`).forEach((pill: any) => {
      if (pill.getAttribute("data-btn-created")) return;
      pill.setAttribute("data-btn-created", "1");
      const url  = pill.getAttribute("data-url");
      const type = pill.getAttribute("data-type");
      if (url && type) makeInlineButton(url, type, pill);
    });
  }

  // ── MutationObserver — anchor tags only ───────────────────────────────────

  if (typeof MutationObserver !== "undefined") {
    const observer = new MutationObserver((mutations: any) => {
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
  }

  // ── run ───────────────────────────────────────────────────────────────────

  document.querySelectorAll("a").forEach(processLink);

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", scanTextNodes);
    } else {
      scanTextNodes();
    }

  })();
}

// WXT requires a default export for content scripts
export default {
  matches: ["<all_urls>"],
  run_at: "document_idle"
};
