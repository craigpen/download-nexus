const path = require("path");
const fs = require("fs");
const { test, expect, REPO_ROOT } = require("./fixtures");

/**
 * Cross-browser smoke suite.
 *
 * Runs under the `chromium`, `chrome` and `edge` projects (see
 * playwright.config.js), so these three tests execute nine times in total.
 *
 * Firefox is deliberately absent: Playwright has no API for installing a
 * WebExtension into its Firefox build, so there is no way to launch the
 * extension there. The MV2 Firefox artifact is validated structurally instead —
 * see the last test in this file.
 */
test.describe("Cross-browser", () => {
  test("the extension loads and its background worker starts", async ({ context, serviceWorker, extensionId }, testInfo) => {
    expect(context.serviceWorkers().length).toBeGreaterThan(0);
    expect(extensionId).toMatch(/^[a-p]{32}$/);

    const manifest = await serviceWorker.evaluate(() => chrome.runtime.getManifest());
    expect(manifest.name).toBe("Download Nexus");
    expect(manifest.manifest_version).toBe(3);

    testInfo.annotations.push({ type: "browser", description: testInfo.project.name });
  });

  test("the popup renders and can reach the background worker", async ({ context, ext }) => {
    const page = await context.newPage();
    await page.goto(ext.popupUrl);

    await expect(page.locator("#headerTitle")).toHaveText("Download Nexus");
    await expect(page.locator("#noNasContainer")).toHaveClass(/show/);

    const resp = await page.evaluate(
      () => new Promise(r => chrome.runtime.sendMessage({ type: "GET_NAS_LIST" }, r))
    );
    expect(resp).toHaveProperty("list");
    await page.close();
  });

  test("the options page renders and persists a service", async ({ optionsPage, ext, stub }) => {
    await expect(optionsPage.locator(".nav-tab")).toHaveCount(4);
    await expect(optionsPage.locator("#extVersion")).toHaveText(/^v\d+\.\d+\.\d+$/);

    await ext.seedService({ id: "xb", name: "Cross Browser Service" });
    await optionsPage.reload();
    await expect(optionsPage.locator("#serviceListContainer .device-card")).toHaveCount(1);
    await expect(optionsPage.locator("#serviceListContainer")).toContainText("Cross Browser Service");
    await expect(optionsPage.locator("#serviceListContainer")).toContainText(`${stub.host}:${stub.port}`);
  });
});

test.describe("Firefox build", () => {
  // Playwright cannot install an extension into Firefox, so the Firefox
  // artifact is checked structurally: it must be a valid MV2 bundle carrying
  // every file the manifest references.
  test("the Firefox MV2 artifact is complete and correctly downgraded", async () => {
    const dir = path.join(REPO_ROOT, "dist", "firefox-mv3");
    test.skip(!fs.existsSync(dir), 'Firefox build missing — run "npm run build:firefox"');

    const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));

    expect(manifest.manifest_version).toBe(2);
    expect(manifest.background.scripts).toEqual(["background.js"]);
    expect(manifest.background.service_worker).toBeUndefined();
    expect(manifest.browser_action).toBeTruthy();
    expect(manifest.action).toBeUndefined();
    expect(manifest.host_permissions).toBeUndefined();
    expect(manifest.permissions).toContain("<all_urls>");
    expect(manifest.browser_specific_settings.gecko.id).toBe("nas-download-helper@craigpen");

    const referenced = [
      manifest.browser_action.default_popup,
      manifest.options_ui.page,
      ...manifest.background.scripts,
      ...manifest.content_scripts.flatMap(cs => cs.js),
      ...Object.values(manifest.icons)
    ];
    const missing = referenced.filter(f => !fs.existsSync(path.join(dir, f)));
    expect(missing, "manifest references files that are not in the bundle").toEqual([]);

    // The version must track package.json so the store listing stays in sync.
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
    expect(manifest.version).toBe(pkg.version);
  });
});
