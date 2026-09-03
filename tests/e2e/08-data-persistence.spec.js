const { test, expect } = require("./fixtures");
const { openOptionsTab, expectToast } = require("./helpers");

test.describe("Data persistence", () => {
  test("services survive a full page teardown and reload", async ({ context, ext, stub }) => {
    await ext.setServices([
      ext.makeService({ id: "p1", name: "Persist One", password: "pw-one" }),
      ext.makeService({ id: "p2", name: "Persist Two", type: "deluge", port: 8112, password: "pw-two" })
    ]);

    // Close every extension page, then open fresh ones — the same thing a user
    // does when they dismiss the popup and come back later.
    const first = await context.newPage();
    await first.goto(ext.optionsUrl);
    await expect(first.locator("#serviceListContainer .device-card")).toHaveCount(2);
    await first.close();

    const second = await context.newPage();
    await second.goto(ext.optionsUrl);
    await expect(second.locator("#serviceListContainer .device-card")).toHaveCount(2);
    await expect(second.locator("#serviceListContainer")).toContainText("Persist One");
    await expect(second.locator("#serviceListContainer")).toContainText("Persist Two");

    // Credentials come back intact, so a reconnect needs no re-entry.
    const services = await ext.getServices();
    expect(services.map(s => s.password)).toEqual(["pw-one", "pw-two"]);
    expect(services.map(s => s.host)).toEqual([stub.host, stub.host]);
    await second.close();
  });

  test("whitelist rules and routing mode persist across sessions", async ({ context, ext }) => {
    await ext.setWhitelistMode("restricted");
    await ext.setWhitelist(["alpha.example", "*.bravo.example"]);

    const page = await context.newPage();
    await page.goto(ext.optionsUrl);
    await openOptionsTab(page, "whitelist");
    await expect(page.locator("#whitelistMode")).toHaveValue("restricted");
    await expect(page.locator("#whitelistDomains")).toHaveValue("alpha.example\n*.bravo.example");
    await page.close();

    // Values are held in chrome.storage.sync, not in page memory.
    const sync = await ext.readStorage("sync", { whitelist: null, whitelistMode: null });
    expect(sync.whitelist).toEqual(["alpha.example", "*.bravo.example"]);
    expect(sync.whitelistMode).toBe("restricted");
  });

  test("credentials are held in local storage only, never in synced storage", async ({ ext }) => {
    await ext.setServices([
      ext.makeService({ id: "sec-1", name: "Secretive", password: "hunter2", apiToken: "tok-abc" })
    ]);

    const sync = await ext.readStorage("sync", { nasList: [] });
    expect(sync.nasList).toHaveLength(1);
    // Sync storage crosses devices, so it must carry metadata only.
    expect(sync.nasList[0]).not.toHaveProperty("password");
    expect(sync.nasList[0]).not.toHaveProperty("apiToken");
    expect(sync.nasList[0].name).toBe("Secretive");
    expect(JSON.stringify(sync.nasList)).not.toContain("hunter2");
    expect(JSON.stringify(sync.nasList)).not.toContain("tok-abc");

    // The secrets live in device-local storage instead…
    const local = await ext.readStorage("local", { nasCredentials: {} });
    expect(local.nasCredentials["sec-1"]).toEqual({ password: "hunter2", apiToken: "tok-abc" });

    // …and the background stitches them back together for consumers.
    const [svc] = await ext.getServices();
    expect(svc.password).toBe("hunter2");
    expect(svc.apiToken).toBe("tok-abc");
  });

  test("capture settings persist and are re-applied on the next page load", async ({ optionsPage, context, ext }) => {
    await openOptionsTab(optionsPage, "capture");
    await optionsPage.uncheck("#captureMagnet");
    await optionsPage.check("#captureOther");
    await optionsPage.fill("#customExtensions", "iso\nimg");
    await optionsPage.click("#saveCaptureSettingsBtn");
    await expectToast(optionsPage, "Downloadable link settings saved");
    await optionsPage.close();

    const reopened = await context.newPage();
    await reopened.goto(ext.optionsUrl);
    await openOptionsTab(reopened, "capture");

    await expect(reopened.locator("#captureMagnet")).not.toBeChecked();
    await expect(reopened.locator("#captureTorrent")).toBeChecked();
    await expect(reopened.locator("#captureOther")).toBeChecked();
    await expect(reopened.locator("#fileTypesSection")).not.toHaveClass(/d-none/);
    await expect(reopened.locator("#customExtensions")).toHaveValue("iso\nimg");
    await reopened.close();
  });

  test("the task cache is written per service so the popup can paint instantly", async ({ popupPage, ext }) => {
    await ext.seedService({ id: "cache-svc", name: "Cached Service" });
    await popupPage.reload();
    await expect(popupPage.locator("#taskList .task").first()).toBeVisible({ timeout: 15000 });

    const local = await ext.readStorage("local", { taskCache: {} });
    expect(Object.keys(local.taskCache)).toEqual(["cache-svc"]);
    expect(local.taskCache["cache-svc"].tasks.length).toBeGreaterThan(0);
    expect(typeof local.taskCache["cache-svc"].timestamp).toBe("number");
  });

  test("deleting a service also drops its cached tasks", async ({ popupPage, ext }) => {
    await ext.seedService({ id: "cache-svc", name: "Cached Service" });
    await popupPage.reload();
    await expect(popupPage.locator("#taskList .task").first()).toBeVisible({ timeout: 15000 });
    expect(Object.keys((await ext.readStorage("local", { taskCache: {} })).taskCache)).toContain("cache-svc");

    await popupPage.click("#settingsBtn");
    await popupPage.locator('.nas-item[data-nas-id="cache-svc"] .btn-action-mini.danger').click();

    await expect.poll(() => ext.getServices()).toEqual([]);
    await expect
      .poll(async () => Object.keys((await ext.readStorage("local", { taskCache: {} })).taskCache))
      .not.toContain("cache-svc");
  });
});
