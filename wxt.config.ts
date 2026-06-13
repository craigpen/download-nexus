import { defineConfig } from "wxt";
import fs from "fs";
import path from "path";

export default defineConfig({
  extensionApi: "chrome",
  hooks: {
    "build:done": async ({ config }) => {
      // Fix open_in_tab for options page after build
      const manifestPath = path.join(config.outDir, "manifest.json");
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      if (manifest.options_ui) {
        manifest.options_ui.open_in_tab = true;
      }
      fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    }
  },
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
