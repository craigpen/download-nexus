const { test, expect } = require("./fixtures");
const {
  openOptionsTab,
  addServiceViaOptions,
  serviceCards,
  expectToast,
  openPopupSettings,
  writeTorrentFile,
  recordStatusMessages
} = require("./helpers");

test.describe("Options page", () => {
  test("navigating the sidebar swaps the visible content pane", async ({ optionsPage }) => {
    for (const tab of ["capture", "whitelist", "backup", "services"]) {
      await openOptionsTab(optionsPage, tab);
      await expect(optionsPage.locator(`.nav-tab[data-tab="${tab}"]`)).toHaveClass(/active/);
      const activePanes = await optionsPage.locator(".content-pane.active").evaluateAll(
        els => els.map(e => e.id)
      );
      expect(activePanes).toEqual([`pane-${tab}`]);
    }
  });

  test("a service added in the popup shows up on the options page, and vice versa", async ({ popupPage, optionsPage, ext, stub }) => {
    // popup → options
    await ext.seedService({ id: "from-popup", name: "From Popup" });
    await optionsPage.reload();
    await expect(serviceCards(optionsPage)).toHaveCount(1);
    await expect(optionsPage.locator("#serviceListContainer")).toContainText("From Popup");

    // options → popup
    await addServiceViaOptions(optionsPage, {
      type: "qbittorrent", name: "From Options", host: stub.host, port: stub.port, password: "pw"
    });
    await expectToast(optionsPage, "saved successfully");

    await popupPage.reload();
    await openPopupSettings(popupPage);
    await expect(popupPage.locator("#settingsNasList")).toContainText("From Popup");
    await expect(popupPage.locator("#settingsNasList")).toContainText("From Options");
    await expect(popupPage.locator("#settingsNasList .nas-item")).toHaveCount(2);
  });

  test("capture settings: enabling other file types reveals and saves the extension list", async ({ optionsPage, ext }) => {
    await openOptionsTab(optionsPage, "capture");
    await expect(optionsPage.locator("#fileTypesSection")).toHaveClass(/d-none/);

    await optionsPage.check("#captureOther");
    await expect(optionsPage.locator("#fileTypesSection")).not.toHaveClass(/d-none/);
    await optionsPage.fill("#customExtensions", "iso\nmkv\n.7z\n\n");
    await optionsPage.uncheck("#captureTorrent");
    await optionsPage.click("#saveCaptureSettingsBtn");
    await expectToast(optionsPage, "Downloadable link settings saved");

    const local = await ext.readStorage("local", { enabledProtocols: null });
    expect(local.enabledProtocols).toEqual({ magnet: true, torrent: false, otherFileTypes: true });
    const sync = await ext.readStorage("sync", { downloadExtensions: "" });
    // Leading dots are stripped and blank lines dropped.
    expect(sync.downloadExtensions).toBe("iso\nmkv\n7z");
  });

  test("whitelist mode toggle reveals the domain list and relabels it per mode", async ({ optionsPage, ext }) => {
    await openOptionsTab(optionsPage, "whitelist");
    await expect(optionsPage.locator("#whitelistMode")).toHaveValue("all");
    await expect(optionsPage.locator("#whitelistDomainsGroup")).toHaveClass(/d-none/);

    await optionsPage.selectOption("#whitelistMode", "restricted");
    await expect(optionsPage.locator("#whitelistDomainsGroup")).not.toHaveClass(/d-none/);
    await expect(optionsPage.locator("#whitelistDomainsLabel"))
      .toHaveText("Whitelisted Domains (One per line)");

    await optionsPage.selectOption("#whitelistMode", "all");
    await expect(optionsPage.locator("#whitelistDomainsGroup")).toHaveClass(/d-none/);

    await optionsPage.selectOption("#whitelistMode", "restricted");
    await optionsPage.click("#saveWhitelistBtn");
    await expectToast(optionsPage, "Domain routing rules saved");
    expect(await ext.getWhitelistMode()).toBe("restricted");
  });

  test("whitelist view lists every stored domain", async ({ optionsPage, ext }) => {
    await ext.setWhitelistMode("restricted");
    await ext.setWhitelist(["example.com", "tracker.test", "*.mirror.org"]);
    await optionsPage.reload();
    await openOptionsTab(optionsPage, "whitelist");

    await expect(optionsPage.locator("#whitelistMode")).toHaveValue("restricted");
    await expect(optionsPage.locator("#whitelistDomains"))
      .toHaveValue("example.com\ntracker.test\n*.mirror.org");
  });

  test("whitelist: adding a domain persists it, lower-cased and trimmed", async ({ optionsPage, ext }) => {
    await openOptionsTab(optionsPage, "whitelist");
    await optionsPage.selectOption("#whitelistMode", "restricted");
    await optionsPage.fill("#whitelistDomains", "  Example.COM  \nTracker.Test\n\n");
    await optionsPage.click("#saveWhitelistBtn");
    await expectToast(optionsPage, "Domain routing rules saved");

    expect(await ext.getWhitelist()).toEqual(["example.com", "tracker.test"]);
  });

  test("whitelist: removing a domain deletes it from storage", async ({ optionsPage, ext }) => {
    await ext.setWhitelistMode("restricted");
    await ext.setWhitelist(["keep.example", "drop.example"]);
    await optionsPage.reload();
    await openOptionsTab(optionsPage, "whitelist");

    await optionsPage.fill("#whitelistDomains", "keep.example");
    await optionsPage.click("#saveWhitelistBtn");
    await expectToast(optionsPage, "Domain routing rules saved");

    expect(await ext.getWhitelist()).toEqual(["keep.example"]);
  });

  test("whitelist: the popup captures the domain of the active browser tab", async ({ context, popupPage, ext, stub }) => {
    await ext.seedService({ id: "svc-main", name: "Stub qBit" });
    await ext.setWhitelistMode("restricted");

    // Make an ordinary http tab the active one, then let the popup re-read it.
    const site = await context.newPage();
    await site.goto(stub.testPageUrl);
    await site.bringToFront();

    await popupPage.reload();
    await popupPage.evaluate(() => getCurrentDomain());

    await expect(popupPage.locator("#whitelistDropdown")).not.toHaveClass(/d-none/);
    await expect(popupPage.locator("#domainInfo")).toHaveText("127.0.0.1");

    await popupPage.click("#whitelistBtn");
    await expect(popupPage.locator("#whitelistAction")).toHaveText("+ Add to whitelist");
    await popupPage.click("#whitelistAction");

    await expect.poll(() => ext.getWhitelist()).toContain("127.0.0.1");
    await expect(popupPage.locator("#whitelistBtn")).toHaveClass(/whitelisted/);

    // And toggling again removes it.
    await popupPage.click("#whitelistBtn");
    await expect(popupPage.locator("#whitelistAction")).toHaveText("✓ Remove from whitelist");
    await popupPage.click("#whitelistAction");
    await expect.poll(() => ext.getWhitelist()).not.toContain("127.0.0.1");

    await site.close();
  });
});

test.describe("Add downloads", () => {
  test.beforeEach(async ({ ext, popupPage }) => {
    await ext.setServices([
      ext.makeService({ id: "svc-a", name: "qBit A" }),
      ext.makeService({ id: "svc-b", name: "qBit B" })
    ]);
    await popupPage.reload();
    await popupPage.click("#addDownloadBtn");
    await expect(popupPage.locator("#addDownloadView")).toHaveClass(/show/);
  });

  test("the service dropdown lists every configured service", async ({ popupPage }) => {
    const options = popupPage.locator("#addDlServiceSelect option");
    await expect(options).toHaveCount(2);
    await expect(options.nth(0)).toHaveText("qBit A (qbittorrent)");
    await expect(options.nth(1)).toHaveText("qBit B (qbittorrent)");
    await expect(popupPage.locator("#addDlCapabilityText"))
      .toHaveText("Supports: Magnet links & .torrent files");
  });

  test("a single magnet link is dispatched to the selected service", async ({ popupPage, stub }) => {
    const status = await recordStatusMessages(popupPage);

    await popupPage.selectOption("#addDlServiceSelect", "svc-b");
    await popupPage.fill("#addDlUrls", "magnet:?xt=urn:btih:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa9&dn=Solo");
    await popupPage.click("#addDlSubmitBtn");

    await expect.poll(() => stub.requestsTo("/torrents/add").length, { timeout: 15000 }).toBe(1);
    expect(stub.lastRequestTo("/torrents/add").body).toContain("btih:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa9");

    // The view returns to the task list and reports the result.
    await expect(popupPage.locator("#mainView")).toHaveClass(/show/);
    await expect.poll(status.all, { timeout: 10000 }).toContain("Added 1 download!");
  });

  test("several links pasted at once are each dispatched", async ({ popupPage, stub }) => {
    const status = await recordStatusMessages(popupPage);
    await popupPage.fill("#addDlUrls", [
      "magnet:?xt=urn:btih:1111111111111111111111111111111111111111&dn=One",
      "magnet:?xt=urn:btih:2222222222222222222222222222222222222222&dn=Two",
      "magnet:?xt=urn:btih:3333333333333333333333333333333333333333&dn=Three"
    ].join("\n"));
    await popupPage.fill("#addDlPathInput", "/volume1/e2e");
    await popupPage.click("#addDlSubmitBtn");

    await expect.poll(() => stub.requestsTo("/torrents/add").length, { timeout: 20000 }).toBe(3);
    await expect.poll(status.all, { timeout: 10000 }).toContain("Added 3 downloads!");

    const bodies = stub.requestsTo("/torrents/add").map(r => r.body).join("\n");
    expect(bodies).toContain("btih:1111111111111111111111111111111111111111");
    expect(bodies).toContain("btih:2222222222222222222222222222222222222222");
    expect(bodies).toContain("btih:3333333333333333333333333333333333333333");
    expect(bodies).toContain("/volume1/e2e");
  });

  test("a .torrent file is parsed into a magnet and dispatched", async ({ popupPage, stub }) => {
    const torrent = writeTorrentFile("e2e-fixture.bin");
    const status = await recordStatusMessages(popupPage);

    await popupPage.setInputFiles("#addDlTorrentInput", torrent.path);
    await expect(popupPage.locator("#addDlFileList .file-pill")).toHaveCount(1);
    await expect(popupPage.locator("#addDlFileList")).toContainText(torrent.fileName);

    await popupPage.click("#addDlSubmitBtn");

    await expect.poll(() => stub.requestsTo("/torrents/add").length, { timeout: 20000 }).toBe(1);
    const body = stub.lastRequestTo("/torrents/add").body;
    expect(body).toContain("magnet:?xt=urn:btih:");
    expect(body).toContain("e2e-fixture.bin");
    await expect.poll(status.all, { timeout: 10000 }).toContain("Added 1 download!");
  });

  test("submitting with nothing entered is rejected before any network call", async ({ popupPage, stub }) => {
    await popupPage.click("#addDlSubmitBtn");
    await expect(popupPage.locator("#statusMsg"))
      .toHaveText("Enter at least 1 link or choose a .torrent file.");
    await expect(popupPage.locator("#statusMsg")).toHaveClass(/error/);
    expect(stub.requestsTo("/torrents/add")).toHaveLength(0);
  });

  test("a torrent-only service rejects a plain web link before dispatching", async ({ popupPage, stub }) => {
    await popupPage.fill("#addDlUrls", "https://example.com/some-file.bin");
    await popupPage.click("#addDlSubmitBtn");

    await expect(popupPage.locator("#statusMsg")).toHaveText("qBit A only accepts torrents or magnets.");
    expect(stub.requestsTo("/torrents/add")).toHaveLength(0);
  });
});
