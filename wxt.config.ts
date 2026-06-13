import { defineConfig } from "wxt";

export default defineConfig({
  extensionApi: "chrome",
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
    }
  },
});
