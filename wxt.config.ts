import { defineConfig } from "wxt";

export default defineConfig({
  extensionApi: "chrome",
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "NAS Download helper",
    description: "Intercepts magnet links and sends them to Synology Download Station.",
    version: "1.1.0",
    permissions: ["storage", "notifications", "tabs"],
    host_permissions: ["<all_urls>"],
  },
});
