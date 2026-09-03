const { test, expect } = require("./fixtures");

test.describe("Extension loading & initialization", () => {
  test("extension loads and registers its background service worker", async ({ context, serviceWorker, extensionId }) => {
    expect(context.serviceWorkers().length).toBeGreaterThan(0);
    expect(serviceWorker.url()).toContain("background.js");
    // Chrome extension ids are 32 lowercase letters.
    expect(extensionId).toMatch(/^[a-p]{32}$/);

    const manifest = await serviceWorker.evaluate(() => chrome.runtime.getManifest());
    expect(manifest.name).toBe("Download Nexus");
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions).toEqual(
      expect.arrayContaining(["storage", "notifications", "tabs", "contextMenus", "alarms"])
    );
  });

  test("popup page opens and renders its shell without console errors", async ({ context, ext }) => {
    const errors = [];
    const page = await context.newPage();
    page.on("pageerror", e => errors.push(e.message));
    page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });

    await page.goto(ext.popupUrl);
    await expect(page.locator("#headerTitle")).toHaveText("Download Nexus");
    await expect(page.locator("#mainView")).toHaveClass(/show/);
    await expect(page.locator("#settingsBtn")).toBeVisible();
    await page.waitForTimeout(500);

    expect(errors, `unexpected popup errors:\n${errors.join("\n")}`).toEqual([]);
    await page.close();
  });

  test("options page loads with every top-level section present", async ({ optionsPage }) => {
    await expect(optionsPage.locator(".nav-tab")).toHaveCount(4);
    for (const tab of ["services", "capture", "whitelist", "backup"]) {
      await expect(optionsPage.locator(`.nav-tab[data-tab="${tab}"]`)).toBeVisible();
      await expect(optionsPage.locator(`#pane-${tab}`)).toHaveCount(1);
    }
    await expect(optionsPage.locator("#pane-services")).toHaveClass(/active/);
    await expect(optionsPage.locator("#extVersion")).toHaveText(/^v\d+\.\d+\.\d+$/);
  });

  test("service list initializes empty on a fresh profile", async ({ optionsPage, popupPage, ext }) => {
    expect(await ext.getServices()).toEqual([]);

    await expect(optionsPage.locator("#serviceListContainer .empty-state")).toBeVisible();
    await expect(optionsPage.locator("#serviceListContainer")).toContainText("No download services configured yet");
    await expect(optionsPage.locator("#serviceListContainer .device-card")).toHaveCount(0);

    await popupPage.reload();
    await expect(popupPage.locator("#noNasContainer")).toHaveClass(/show/);
  });

  test("DOM element contract: every id the scripts reach for exists", async ({ popupPage, optionsPage }) => {
    // If a refactor renames or drops one of these, the corresponding
    // document.getElementById(...) in popup.js / options.js silently no-ops.
    const popupIds = [
      "headerIcon", "headerTitle", "mainHeaderControls", "gearIcon", "backIcon",
      "settingsBtn", "openInTabBtn", "mainView", "settingsView", "addDownloadView",
      "nasTabBar", "tabBar", "taskList", "emptyMsg", "speedBar", "totalDn", "totalUp",
      "taskCountLabel", "statusMsg", "batchFooter", "toggleSelectBtn", "pauseAllBtn",
      "resumeAllBtn", "removeAllBtn", "refreshBtn", "retryBtn", "addDownloadBtn",
      "noNasContainer", "configureBtn", "errorContainer", "errorTitle", "errorDetail",
      "whitelistDropdown", "whitelistBtn", "whitelistMenu", "whitelistAction", "domainInfo",
      "nasForm", "nasName", "nasType", "nasHost", "nasPort", "nasHttps", "nasUsername",
      "nasPassword", "nasDestination", "nasApiToken", "nasFormStatus", "testNasBtn",
      "testNasStatus", "addNasBtn", "backToListBtn", "deleteNasBtn", "formTitle",
      "settingsNasList", "settingsNasListWrap", "usernameField", "passwordField",
      "apiTokenField", "destinationField", "serviceHelpText", "enableMagnet",
      "enableTorrent", "enableHttp", "fileTypesSection", "downloadExtensionsTextarea",
      "saveCaptureSettingsBtn", "whitelistModeSelect", "whitelistTextarea",
      "whitelistDomainsWrap", "whitelistDomainsLabel", "saveDomainRulesBtn",
      "popupExportBtn", "popupOpenTabBackupBtn", "openWebUiBtn",
      "addDlServiceSelect", "addDlUrls", "addDlPasteBtn", "addDlTorrentSection",
      "addDlTorrentInput", "addDlChooseFilesBtn", "addDlFileList", "addDlPathInput",
      "addDlPathHint", "addDlPathSection", "addDlSubmitBtn", "addDlCancelBtn",
      "addDlCapabilityText", "addDlCapabilityBadge"
    ];
    const missingPopup = await popupPage.evaluate(
      ids => ids.filter(id => !document.getElementById(id)),
      popupIds
    );
    expect(missingPopup, "popup.html is missing ids used by popup.js").toEqual([]);

    const optionsIds = [
      "pane-services", "pane-capture", "pane-whitelist", "pane-backup",
      "serviceListContainer", "addServiceBtn", "serviceEditorCard", "editorTitle",
      "serviceForm", "serviceId", "serviceType", "serviceName", "serviceHost",
      "servicePort", "serviceHttps", "serviceUsername", "servicePassword",
      "serviceDefaultPath", "portHint", "usernameGroup", "passwordGroup",
      "apiTokenGroup", "credentialsRow", "saveServiceBtn", "testConnBtn",
      "cancelEditBtn", "cancelEditBtn2", "captureMagnet", "captureTorrent",
      "captureOther", "fileTypesSection", "customExtensions", "saveCaptureSettingsBtn",
      "whitelistMode", "whitelistDomains", "whitelistDomainsGroup",
      "whitelistDomainsLabel", "saveWhitelistBtn", "exportBtn", "importBtn",
      "importFileInput", "backupIncludeCreds", "backupPasswordWrap",
      "backupPasswordInput", "restoreModal", "restoreSummaryText",
      "restoreEncryptedPrompt", "restorePlainPrompt", "restorePasswordInput",
      "restoreSettingsOnlyBtn", "confirmRestoreBtn", "cancelRestoreBtn",
      "closeRestoreModalBtn", "toast", "extVersion", "closeTabBtn"
    ];
    const missingOptions = await optionsPage.evaluate(
      ids => ids.filter(id => !document.getElementById(id)),
      optionsIds
    );
    expect(missingOptions, "options.html is missing ids used by options.js").toEqual([]);
  });
});
