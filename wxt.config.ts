import { defineConfig } from "wxt";

export default defineConfig({
  extensionApi: "chrome",
  publics: "icons/",
  manifest: {
    name: "NAS Download helper",
    description: "Intercepts magnet links and sends them to Synology Download Station.",
    version: "1.1.0",
    permissions: ["storage", "notifications", "tabs"],
    host_permissions: ["<all_urls>"],
    content_scripts: [
      {
        matches: ["<all_urls>"],
        js: ["content"],
        run_at: "document_idle"
      }
    ],
    options_ui: {
      page: "options.html",
      open_in_tab: true
    },
    icons: {
      16: "icons/icon16.png",
      48: "icons/icon48.png",
      128: "icons/icon128.png"
    },
    action: {
      default_icon: {
        16: "icons/icon16.png",
        48: "icons/icon48.png",
        128: "icons/icon128.png"
      }
    }
  },
});
