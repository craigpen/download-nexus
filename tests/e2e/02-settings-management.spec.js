const { test, expect } = require("./fixtures");
const {
  openOptionsTab,
  addServiceViaOptions,
  serviceCards,
  serviceCardByName,
  expectToast
} = require("./helpers");

test.describe("Settings management", () => {
  test("add service: an empty host is rejected by form validation", async ({ optionsPage, ext }) => {
    await optionsPage.click("#emptyAddBtn");
    await optionsPage.selectOption("#serviceType", "qbittorrent");
    await optionsPage.fill("#serviceName", "No Host");
    await optionsPage.fill("#serviceHost", "");
    await optionsPage.click("#saveServiceBtn");

    await expect(optionsPage.locator("#serviceEditorCard")).toBeVisible();
    expect(await optionsPage.locator("#serviceHost").evaluate(el => el.validity.valueMissing)).toBe(true);
    expect(await ext.getServices()).toEqual([]);
  });

  test("add service: an empty display name is rejected by form validation", async ({ optionsPage, ext }) => {
    await optionsPage.click("#emptyAddBtn");
    await optionsPage.fill("#serviceName", "");
    await optionsPage.fill("#serviceHost", "10.0.0.5");
    await optionsPage.click("#saveServiceBtn");

    expect(await optionsPage.locator("#serviceName").evaluate(el => el.validity.valueMissing)).toBe(true);
    expect(await ext.getServices()).toEqual([]);
  });

  test("add service: an out-of-range port is rejected by form validation", async ({ optionsPage, ext }) => {
    await optionsPage.click("#emptyAddBtn");
    await optionsPage.fill("#serviceName", "Bad Port");
    await optionsPage.fill("#serviceHost", "10.0.0.5");
    await optionsPage.fill("#servicePort", "99999");
    await optionsPage.click("#saveServiceBtn");

    const port = optionsPage.locator("#servicePort");
    expect(await port.evaluate(el => el.validity.rangeOverflow)).toBe(true);
    expect(await port.evaluate(el => el.max)).toBe("65535");
    expect(await ext.getServices()).toEqual([]);
  });

  test("add service: every field type round-trips into storage", async ({ optionsPage, ext, stub }) => {
    await addServiceViaOptions(optionsPage, {
      type: "qbittorrent",
      name: "Living Room qBit",
      host: stub.host,
      port: stub.port,
      https: true,
      username: "seeder",
      password: "s3cret",
      defaultPath: "/volume1/downloads"
    });

    await expectToast(optionsPage, "saved successfully");
    await expect(serviceCards(optionsPage)).toHaveCount(1);

    const [svc] = await ext.getServices();
    expect(svc).toMatchObject({
      type: "qbittorrent",
      name: "Living Room qBit",
      host: stub.host,
      port: stub.port,
      https: true,
      username: "seeder",
      password: "s3cret",
      defaultPath: "/volume1/downloads"
    });
    expect(svc.id).toMatch(/^nas-\d+$/);
  });

  test("edit service: changes overwrite the existing entry rather than adding one", async ({ optionsPage, ext, stub }) => {
    await ext.seedService({ id: "svc-edit", name: "Old Name", host: "1.2.3.4", port: 8080 });
    await optionsPage.reload();

    await serviceCardByName(optionsPage, "Old Name").locator(".edit-btn").click();
    await expect(optionsPage.locator("#editorTitle")).toContainText("Edit Service: Old Name");
    await expect(optionsPage.locator("#serviceId")).toHaveValue("svc-edit");

    await optionsPage.fill("#serviceName", "New Name");
    await optionsPage.fill("#serviceHost", stub.host);
    await optionsPage.fill("#servicePort", String(stub.port));
    await optionsPage.click("#saveServiceBtn");

    await expectToast(optionsPage, "New Name");
    await expect(serviceCards(optionsPage)).toHaveCount(1);

    const list = await ext.getServices();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: "svc-edit", name: "New Name", host: stub.host, port: stub.port });
  });

  test("delete service: confirming removes it from the list and from storage", async ({ optionsPage, ext }) => {
    await ext.seedServices(2);
    await optionsPage.reload();
    await expect(serviceCards(optionsPage)).toHaveCount(2);

    optionsPage.onNextDialog(d => {
      expect(d.message()).toContain("Service 1");
      return d.accept();
    });
    await serviceCardByName(optionsPage, "Service 1").locator(".del-btn").click();

    await expectToast(optionsPage, "deleted");
    await expect(serviceCards(optionsPage)).toHaveCount(1);
    const names = (await ext.getServices()).map(s => s.name);
    expect(names).toEqual(["Service 2"]);
  });

  test("delete service: cancelling the confirm keeps the service", async ({ optionsPage, ext }) => {
    await ext.seedServices(2);
    await optionsPage.reload();

    optionsPage.onNextDialog(d => d.dismiss());
    await serviceCardByName(optionsPage, "Service 1").locator(".del-btn").click();
    await optionsPage.waitForTimeout(300);

    await expect(serviceCards(optionsPage)).toHaveCount(2);
    expect(await ext.getServices()).toHaveLength(2);
  });

  test("service type dropdown swaps the default name, username and port", async ({ optionsPage }) => {
    await optionsPage.click("#emptyAddBtn");

    const expectations = [
      ["synology", "Synology NAS", "admin", "5000"],
      ["qbittorrent", "qBittorrent", "admin", "8080"],
      ["transmission", "Transmission", "", "9091"],
      ["deluge", "Deluge Web", "admin", "8112"],
      ["jdownloader", "JDownloader 2", "", "3128"]
    ];

    for (const [type, name, username, port] of expectations) {
      await optionsPage.selectOption("#serviceType", type);
      await expect(optionsPage.locator("#serviceName")).toHaveValue(name);
      await expect(optionsPage.locator("#serviceUsername")).toHaveValue(username);
      await expect(optionsPage.locator("#servicePort")).toHaveValue(port);
    }

    // JDownloader is a local desktop app, so the host is pre-filled for loopback.
    await expect(optionsPage.locator("#serviceHost")).toHaveValue("127.0.0.1");
  });

  test("port hint text tracks the selected service type", async ({ optionsPage }) => {
    await optionsPage.click("#emptyAddBtn");
    const hint = optionsPage.locator("#portHint");

    await optionsPage.selectOption("#serviceType", "synology");
    await expect(hint).toHaveText("5000 (HTTP) or 5001 (HTTPS)");

    await optionsPage.selectOption("#serviceType", "qbittorrent");
    await expect(hint).toHaveText("8080 (default Web UI)");

    await optionsPage.selectOption("#serviceType", "transmission");
    await expect(hint).toHaveText("9091 (default RPC)");

    await optionsPage.selectOption("#serviceType", "jdownloader");
    await expect(hint).toHaveText("3128 (RemoteAPI) or 9666 (Click'n'Load)");
  });

  test("HTTPS toggle selects the secure default port and is persisted", async ({ optionsPage, ext }) => {
    await optionsPage.click("#emptyAddBtn");
    await optionsPage.check("#serviceHttps");
    await optionsPage.selectOption("#serviceType", "synology");
    // With HTTPS ticked, the Synology default flips from 5000 to 5001.
    await expect(optionsPage.locator("#servicePort")).toHaveValue("5001");

    await optionsPage.fill("#serviceName", "Secure NAS");
    await optionsPage.fill("#serviceHost", "nas.local");
    await optionsPage.fill("#servicePassword", "pw");
    await optionsPage.click("#saveServiceBtn");
    await expectToast(optionsPage, "saved successfully");

    const [svc] = await ext.getServices();
    expect(svc.https).toBe(true);
    expect(svc.port).toBe(5001);

    // And the card renders the https scheme.
    await expect(serviceCardByName(optionsPage, "Secure NAS")).toContainText("https://nas.local:5001");
  });

  test("connection test: success path reports the service version", async ({ optionsPage, stub }) => {
    await optionsPage.click("#emptyAddBtn");
    await optionsPage.selectOption("#serviceType", "qbittorrent");
    await optionsPage.fill("#serviceHost", stub.host);
    await optionsPage.fill("#servicePort", String(stub.port));
    await optionsPage.fill("#servicePassword", "adminadmin");

    await optionsPage.click("#testConnBtn");
    await expectToast(optionsPage, "Connection succeeded");
    expect(stub.requestsTo("/api/v2/auth/login").length).toBeGreaterThan(0);
  });

  test("connection test: auth failure surfaces the adapter's error message", async ({ optionsPage, stub }) => {
    stub.setFailMode("auth");

    await optionsPage.click("#emptyAddBtn");
    await optionsPage.selectOption("#serviceType", "synology");
    await optionsPage.fill("#serviceHost", stub.host);
    await optionsPage.fill("#servicePort", String(stub.port));
    await optionsPage.fill("#serviceUsername", "admin");
    await optionsPage.fill("#servicePassword", "wrong");

    await optionsPage.click("#testConnBtn");
    const toast = optionsPage.locator("#toast");
    await expect(toast).toHaveClass(/error/, { timeout: 15000 });
    await expect(toast).toContainText(/Connection failed|Connection error/);
  });

  test("connection test: refuses to run without a host", async ({ optionsPage }) => {
    await optionsPage.click("#emptyAddBtn");
    await optionsPage.fill("#serviceHost", "");
    await optionsPage.click("#testConnBtn");

    await expectToast(optionsPage, "Please enter host and port first");
    await expect(optionsPage.locator("#toast")).toHaveClass(/error/);
  });

  test("connection test: an unresponsive service times out with an actionable error", async ({ optionsPage, stub }) => {
    // The JDownloader adapter aborts after 3s; the stub simply never answers.
    stub.setFailMode("timeout");

    await optionsPage.click("#emptyAddBtn");
    await optionsPage.selectOption("#serviceType", "jdownloader");
    await optionsPage.fill("#serviceHost", stub.host);
    await optionsPage.fill("#servicePort", String(stub.port));

    await optionsPage.click("#testConnBtn");
    const toast = optionsPage.locator("#toast");
    await expect(toast).toHaveClass(/error/, { timeout: 20000 });
    await expect(toast).toContainText("Cannot connect to JDownloader");
  });

  test("service list survives closing and reopening the settings UI", async ({ optionsPage, context, ext, stub }) => {
    await addServiceViaOptions(optionsPage, {
      type: "qbittorrent", name: "Persisted", host: stub.host, port: stub.port, password: "pw"
    });
    await expectToast(optionsPage, "saved successfully");

    await optionsPage.close();
    const reopened = await context.newPage();
    await reopened.goto(ext.optionsUrl);

    await expect(reopened.locator("#serviceListContainer .device-card")).toHaveCount(1);
    await expect(reopened.locator("#serviceListContainer")).toContainText("Persisted");
    await reopened.close();
  });

  test("multiple services: three services all render with their type badges", async ({ optionsPage, ext, stub }) => {
    await ext.setServices([
      ext.makeService({ id: "a", name: "Alpha", type: "qbittorrent" }),
      ext.makeService({ id: "b", name: "Bravo", type: "transmission", port: 9091 }),
      ext.makeService({ id: "c", name: "Charlie", type: "deluge", port: 8112 })
    ]);
    await optionsPage.reload();

    await expect(serviceCards(optionsPage)).toHaveCount(3);
    for (const [name, type] of [["Alpha", "qbittorrent"], ["Bravo", "transmission"], ["Charlie", "deluge"]]) {
      const card = serviceCardByName(optionsPage, name);
      await expect(card).toBeVisible();
      await expect(card.locator(".device-type-badge")).toHaveText(type);
    }
    void stub;
  });

  test("popup service tabs: switching tabs changes the active service", async ({ popupPage, ext }) => {
    await ext.seedServices(3);
    await popupPage.reload();

    const tabs = popupPage.locator("#nasTabBar .nas-tab-btn");
    await expect(tabs).toHaveCount(3);
    await expect(tabs.nth(0)).toHaveClass(/active/);

    await tabs.nth(2).click();
    await expect(tabs.nth(2)).toHaveClass(/active/);
    await expect(tabs.nth(0)).not.toHaveClass(/active/);
    await expect(tabs.nth(2)).toHaveAttribute("data-nas-id", "svc-3");
  });
});
