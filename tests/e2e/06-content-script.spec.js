const { test, expect } = require("./fixtures");
const {
  mockTorrentSite,
  injectedButtons,
  injectedButtonFor,
  captureContextMenuCreates
} = require("./helpers");

test.describe("Content script link decoration", () => {
  test("injects a send button next to every magnet link", async ({ context, ext, stub }) => {
    await ext.seedService({ id: "svc-a", name: "qBit A" });
    const page = await mockTorrentSite(context, stub);

    await expect(injectedButtonFor(page, "magnet-1")).toBeVisible();
    await expect(injectedButtonFor(page, "magnet-2")).toBeVisible();
    await expect(injectedButtonFor(page, "magnet-1"))
      .toHaveAttribute("data-type", "magnet");
    await expect(injectedButtonFor(page, "magnet-1"))
      .toHaveAttribute("data-url", /^magnet:\?xt=urn:btih:aaaa/);
    await page.close();
  });

  test("injects a send button next to .torrent links, including ones with a query string", async ({ context, ext, stub }) => {
    await ext.seedService({ id: "svc-a", name: "qBit A" });
    const page = await mockTorrentSite(context, stub);

    await expect(injectedButtonFor(page, "torrent-1")).toBeVisible();
    await expect(injectedButtonFor(page, "torrent-1")).toHaveAttribute("data-type", "torrent");
    await expect(injectedButtonFor(page, "torrent-2")).toBeVisible();
    await page.close();
  });

  test("leaves ordinary links alone, and honours the file-type opt-in", async ({ context, ext, stub }) => {
    await ext.seedService({ id: "svc-a", name: "qBit A" });
    let page = await mockTorrentSite(context, stub);

    // A plain HTML page link is never decorated.
    await expect(injectedButtonFor(page, "plain-link")).toHaveCount(0);
    // Neither is a .zip while "other file types" is off (the default).
    await expect(injectedButtonFor(page, "archive-link")).toHaveCount(0);
    // 2 magnet anchors + 2 .torrent anchors + 1 bare magnet found in page text.
    await expect(injectedButtons(page)).toHaveCount(5);
    await expect(page.locator("[data-syno-text-injected]")).toHaveCount(1);
    await page.close();

    // With magnets disabled, magnet links stop being decorated.
    await ext.setEnabledProtocols({ magnet: false, torrent: true, otherFileTypes: false });
    page = await mockTorrentSite(context, stub);
    await expect(injectedButtonFor(page, "magnet-1")).toHaveCount(0);
    await expect(injectedButtonFor(page, "torrent-1")).toBeVisible();
    await page.close();
  });

  test("no buttons are injected when no service is configured", async ({ context, ext, stub }) => {
    expect(await ext.getServices()).toEqual([]);
    const page = await mockTorrentSite(context, stub, { expectButtons: false });
    await page.waitForTimeout(1500);
    await expect(injectedButtons(page)).toHaveCount(0);
    await page.close();
  });

  test("with one service, clicking the button sends the link straight to it", async ({ context, ext, stub }) => {
    await ext.seedService({ id: "svc-only", name: "Only Service" });
    const page = await mockTorrentSite(context, stub);

    await injectedButtonFor(page, "magnet-1").click();

    await expect.poll(() => stub.requestsTo("/torrents/add").length, { timeout: 15000 }).toBe(1);
    expect(stub.lastRequestTo("/torrents/add").body)
      .toContain("btih:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1");
    await page.close();
  });

  test("with several services, the button opens a picker and routes to the chosen one", async ({ context, ext, stub }) => {
    await ext.setServices([
      ext.makeService({ id: "svc-a", name: "Service Alpha" }),
      ext.makeService({ id: "svc-b", name: "Service Bravo" })
    ]);
    const page = await mockTorrentSite(context, stub);

    await injectedButtonFor(page, "magnet-2").click();

    const popup = page.locator("[data-syno-popup]");
    await expect(popup).toBeVisible();
    await expect(popup).toContainText("Service Alpha");
    await expect(popup).toContainText("Service Bravo");

    await popup.getByText("Service Bravo").click();
    await expect.poll(() => stub.requestsTo("/torrents/add").length, { timeout: 15000 }).toBe(1);
    expect(stub.lastRequestTo("/torrents/add").body)
      .toContain("btih:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb1");
    await page.close();
  });

  test("restricted routing mode is not yet honoured by the content script", async ({ context, ext, stub }) => {
    // KNOWN GAP — see docs/E2E_TESTING.md.
    //
    // The routing-mode dropdowns in options.html and popup.html offer
    // "whitelist" / "blacklist", but content.js only treats the literal value
    // "restricted" as "restrict injection". Choosing "Only Active on Whitelisted
    // Domains" therefore has no effect: buttons are still injected everywhere.
    //
    // Marked test.fail() so it runs and reports. When the mode values are
    // reconciled this test will start passing, and Playwright will flag the
    // annotation as stale — that is the signal to drop test.fail().
    test.fail();

    await ext.seedService({ id: "svc-a", name: "qBit A" });
    await ext.setWhitelistMode("whitelist");
    await ext.setWhitelist(["some-other-site.example"]);

    const page = await mockTorrentSite(context, stub, { expectButtons: false });
    await page.waitForTimeout(2000);
    await expect(injectedButtons(page)).toHaveCount(0, { timeout: 1000 });
    await page.close();
  });

  test('the "restricted" mode value does gate injection correctly', async ({ context, ext, stub }) => {
    await ext.seedService({ id: "svc-a", name: "qBit A" });
    await ext.setWhitelistMode("restricted");
    await ext.setWhitelist(["some-other-site.example"]);

    let page = await mockTorrentSite(context, stub, { expectButtons: false });
    await page.waitForTimeout(1500);
    await expect(injectedButtons(page)).toHaveCount(0);
    await page.close();

    // Whitelisting this host brings the buttons back.
    await ext.setWhitelist(["127.0.0.1"]);
    page = await mockTorrentSite(context, stub);
    await expect(injectedButtons(page)).toHaveCount(5);
    await page.close();
  });
});

test.describe("Context menu", () => {
  test('the parent "Download to…" item is created for links and selections', async ({ serviceWorker, ext }) => {
    await ext.seedService({ id: "svc-a", name: "qBit A" });

    const created = await captureContextMenuCreates(serviceWorker, "initContextMenu");
    const parent = created.find(m => m.id === "download-nexus-menu");

    expect(parent).toBeTruthy();
    expect(parent.title).toBe("Download to…");
    expect(parent.contexts).toEqual(["link", "selection"]);
  });

  test("the submenu carries one entry per configured service", async ({ serviceWorker, ext }) => {
    await ext.setServices([
      ext.makeService({ id: "svc-a", name: "Service Alpha" }),
      ext.makeService({ id: "svc-b", name: "Service Bravo" }),
      ext.makeService({ id: "svc-c", name: "Service Charlie" })
    ]);

    const created = await captureContextMenuCreates(serviceWorker, "updateContextMenu");
    expect(created).toHaveLength(3);
    expect(created.map(m => m.title)).toEqual(["Service Alpha", "Service Bravo", "Service Charlie"]);
    expect(created.map(m => m.id)).toEqual([
      "download-nexus-service-svc-a",
      "download-nexus-service-svc-b",
      "download-nexus-service-svc-c"
    ]);
    for (const item of created) {
      expect(item.parentId).toBe("download-nexus-menu");
      expect(item.contexts).toEqual(["link", "selection"]);
    }
  });

  test("the submenu is rebuilt when the service list changes", async ({ serviceWorker, ext }) => {
    await ext.seedService({ id: "only", name: "Only One" });
    let created = await captureContextMenuCreates(serviceWorker, "updateContextMenu");
    expect(created.map(m => m.title)).toEqual(["Only One"]);

    await ext.setServices([]);
    created = await captureContextMenuCreates(serviceWorker, "updateContextMenu");
    expect(created).toHaveLength(0);
  });

  test("choosing a service menu item sends the magnet to that service", async ({ ext, stub }) => {
    // Native context menus cannot be opened by Playwright, so this drives the
    // exact message the onClicked handler dispatches.
    await ext.setServices([
      ext.makeService({ id: "svc-a", name: "Service Alpha" }),
      ext.makeService({ id: "svc-b", name: "Service Bravo" })
    ]);

    const resp = await ext.sendMessage({
      type: "SEND_MAGNET",
      url: "magnet:?xt=urn:btih:9999999999999999999999999999999999999999&dn=FromMenu",
      nasId: "svc-b"
    });

    expect(resp.ok).toBe(true);
    await expect.poll(() => stub.requestsTo("/torrents/add").length, { timeout: 15000 }).toBe(1);
    expect(stub.lastRequestTo("/torrents/add").body).toContain("btih:9999");
  });

  test("choosing a service menu item sends a .torrent URL to that service", async ({ ext, stub }) => {
    await ext.seedService({ id: "svc-a", name: "Service Alpha" });

    const resp = await ext.sendMessage({
      type: "SEND_MAGNET",
      url: `${stub.origin}/files/ubuntu-24.04.torrent`,
      nasId: "svc-a"
    });

    expect(resp.ok).toBe(true);
    await expect.poll(() => stub.requestsTo("/torrents/add").length, { timeout: 15000 }).toBe(1);
  });
});
