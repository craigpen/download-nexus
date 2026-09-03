const fs = require("fs");
const { test, expect } = require("./fixtures");
const {
  openOptionsTab,
  expectToast,
  writeBackupFile,
  makeBackup,
  makeEncryptedBackup
} = require("./helpers");

/** Trigger an export and return the parsed JSON of the downloaded file. */
async function exportAndRead(page, { password } = {}) {
  await openOptionsTab(page, "backup");
  if (password !== undefined) {
    await page.check("#backupIncludeCreds");
    await expect(page.locator("#backupPasswordWrap")).not.toHaveClass(/d-none/);
    await page.fill("#backupPasswordInput", password);
  }
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 15000 }),
    page.click("#exportBtn")
  ]);
  const path = await download.path();
  return {
    download,
    suggestedFilename: download.suggestedFilename(),
    json: JSON.parse(fs.readFileSync(path, "utf8"))
  };
}

test.describe("Backup & restore", () => {
  test("export without credentials writes a plain JSON backup", async ({ optionsPage, ext }) => {
    await ext.setServices([
      ext.makeService({ id: "a", name: "Alpha", password: "topsecret" }),
      ext.makeService({ id: "b", name: "Bravo", type: "deluge", port: 8112, password: "alsosecret" })
    ]);
    await ext.setWhitelist(["example.com"]);
    await optionsPage.reload();

    const { json, suggestedFilename } = await exportAndRead(optionsPage);
    await expectToast(optionsPage, "Configuration backup created");

    expect(suggestedFilename).toMatch(/^download-nexus-backup-\d{4}-\d{2}-\d{2}\.json$/);
    expect(json.services.map(s => s.name)).toEqual(["Alpha", "Bravo"]);
    expect(json.whitelist).toEqual(["example.com"]);
    expect(json).not.toHaveProperty("encryptedCredentials");
    // Secrets must never leave in the clear.
    for (const svc of json.services) {
      expect(svc.password).toBe("");
      expect(svc.apiToken).toBe("");
    }
  });

  test("backup file carries a version stamp and an export timestamp", async ({ optionsPage, ext }) => {
    await ext.seedService({ id: "a", name: "Alpha" });
    await optionsPage.reload();

    const { json } = await exportAndRead(optionsPage);
    expect(json.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(() => new Date(json.exportedAt).toISOString()).not.toThrow();
    expect(json.whitelistMode).toBe("all");
  });

  test("export with credentials requires a password, then encrypts them", async ({ optionsPage, ext }) => {
    await ext.seedService({ id: "a", name: "Alpha", password: "topsecret" });
    await optionsPage.reload();
    await openOptionsTab(optionsPage, "backup");

    // Ticking the box without typing a password is refused.
    await optionsPage.check("#backupIncludeCreds");
    await optionsPage.click("#exportBtn");
    await expectToast(optionsPage, "Please enter an encryption password");
    await expect(optionsPage.locator("#toast")).toHaveClass(/error/);

    const { json } = await exportAndRead(optionsPage, { password: "correct-horse" });
    await expectToast(optionsPage, "encrypted credentials");

    expect(json.encryptedCredentials).toMatchObject({
      version: 1,
      algorithm: "AES-GCM-256",
      kdf: "PBKDF2-SHA256",
      iterations: 100000
    });
    expect(json.encryptedCredentials.ciphertext).toEqual(expect.any(String));
    // The plaintext password must not appear anywhere in the file.
    expect(JSON.stringify(json)).not.toContain("topsecret");
  });

  test("restoring a plain backup imports services and whitelist rules", async ({ optionsPage, ext, stub }) => {
    const file = writeBackupFile("plain.json", makeBackup({
      services: [
        { id: "r1", type: "qbittorrent", name: "Restored qBit", host: stub.host, port: stub.port, https: false, username: "admin" },
        { id: "r2", type: "transmission", name: "Restored Trans", host: "10.0.0.9", port: 9091, https: false, username: "" }
      ],
      whitelist: ["restored.example"],
      whitelistMode: "whitelist"
    }));

    await openOptionsTab(optionsPage, "backup");
    await optionsPage.setInputFiles("#importFileInput", file);

    await expect(optionsPage.locator("#restoreModal")).not.toHaveClass(/d-none/);
    await expect(optionsPage.locator("#restoreSummaryText"))
      .toContainText("Found 2 services and 1 whitelist rule");
    await expect(optionsPage.locator("#restorePlainPrompt")).not.toHaveClass(/d-none/);
    await expect(optionsPage.locator("#restoreEncryptedPrompt")).toHaveClass(/d-none/);
    await expect(optionsPage.locator("#confirmRestoreBtn")).toHaveText("Restore All");

    await optionsPage.click("#confirmRestoreBtn");
    await expectToast(optionsPage, "Configuration restored successfully");
    await expect(optionsPage.locator("#restoreModal")).toHaveClass(/d-none/);

    const services = await ext.getServices();
    expect(services.map(s => s.name)).toEqual(["Restored qBit", "Restored Trans"]);
    expect(await ext.getWhitelist()).toEqual(["restored.example"]);
    expect(await ext.getWhitelistMode()).toBe("whitelist");
    await expect(optionsPage.locator("#serviceListContainer .device-card")).toHaveCount(2);
  });

  test("restoring overwrites the existing configuration once confirmed", async ({ optionsPage, ext, stub }) => {
    await ext.setServices([
      ext.makeService({ id: "old-1", name: "Old One" }),
      ext.makeService({ id: "old-2", name: "Old Two" })
    ]);
    await optionsPage.reload();
    await expect(optionsPage.locator("#serviceListContainer .device-card")).toHaveCount(2);

    const file = writeBackupFile("overwrite.json", makeBackup({
      services: [{ id: "new-1", type: "qbittorrent", name: "Only Survivor", host: stub.host, port: stub.port, https: false, username: "admin" }]
    }));

    await openOptionsTab(optionsPage, "backup");
    await optionsPage.setInputFiles("#importFileInput", file);
    await expect(optionsPage.locator("#restoreModal")).not.toHaveClass(/d-none/);

    // Backing out leaves the current config untouched…
    await optionsPage.click("#cancelRestoreBtn");
    await expect(optionsPage.locator("#restoreModal")).toHaveClass(/d-none/);
    expect((await ext.getServices()).map(s => s.name)).toEqual(["Old One", "Old Two"]);

    // …confirming replaces it wholesale.
    await optionsPage.setInputFiles("#importFileInput", file);
    await optionsPage.click("#confirmRestoreBtn");
    await expectToast(optionsPage, "restored successfully");
    expect((await ext.getServices()).map(s => s.name)).toEqual(["Only Survivor"]);
  });

  test("restore validation rejects a corrupted or foreign backup file", async ({ optionsPage, ext }) => {
    await ext.seedService({ id: "keep", name: "Keep Me" });
    await optionsPage.reload();
    await openOptionsTab(optionsPage, "backup");

    // Not JSON at all.
    await optionsPage.setInputFiles("#importFileInput", writeBackupFile("garbage.json", "{ this is not json"));
    await expectToast(optionsPage, "Import failed");
    await expect(optionsPage.locator("#toast")).toHaveClass(/error/);
    await expect(optionsPage.locator("#restoreModal")).toHaveClass(/d-none/);

    // Valid JSON, wrong shape.
    await optionsPage.setInputFiles("#importFileInput", writeBackupFile("wrong.json", { hello: "world" }));
    await expectToast(optionsPage, "Invalid backup file format");
    await expect(optionsPage.locator("#restoreModal")).toHaveClass(/d-none/);

    expect((await ext.getServices()).map(s => s.name)).toEqual(["Keep Me"]);
  });

  test("an encrypted backup unlocks with the correct password", async ({ optionsPage, ext, stub }) => {
    const backup = await makeEncryptedBackup({
      password: "correct-horse",
      services: [{
        id: "enc-1", type: "qbittorrent", name: "Encrypted qBit",
        host: stub.host, port: stub.port, https: false, username: "admin",
        password: "restored-secret", apiToken: "restored-token"
      }],
      whitelist: ["enc.example"]
    });
    const file = writeBackupFile("encrypted.json", backup);

    await openOptionsTab(optionsPage, "backup");
    await optionsPage.setInputFiles("#importFileInput", file);

    await expect(optionsPage.locator("#restoreEncryptedPrompt")).not.toHaveClass(/d-none/);
    await expect(optionsPage.locator("#restoreSettingsOnlyBtn")).not.toHaveClass(/d-none/);
    await expect(optionsPage.locator("#confirmRestoreBtn")).toHaveText("Unlock & Restore All");

    await optionsPage.fill("#restorePasswordInput", "correct-horse");
    await optionsPage.click("#confirmRestoreBtn");
    await expectToast(optionsPage, "Configuration and credentials restored successfully");

    const [svc] = await ext.getServices();
    expect(svc.name).toBe("Encrypted qBit");
    expect(svc.password).toBe("restored-secret");
    expect(svc.apiToken).toBe("restored-token");
  });

  test("an encrypted backup refuses the wrong password and can be restored settings-only", async ({ optionsPage, ext, stub }) => {
    const backup = await makeEncryptedBackup({
      password: "correct-horse",
      services: [{
        id: "enc-1", type: "qbittorrent", name: "Encrypted qBit",
        host: stub.host, port: stub.port, https: false, username: "admin",
        password: "restored-secret", apiToken: ""
      }]
    });
    const file = writeBackupFile("encrypted.json", backup);

    await openOptionsTab(optionsPage, "backup");
    await optionsPage.setInputFiles("#importFileInput", file);

    // Empty password is caught before any crypto work.
    await optionsPage.click("#confirmRestoreBtn");
    await expectToast(optionsPage, "Please enter the decryption password");
    expect(await ext.getServices()).toEqual([]);

    // A wrong password fails to decrypt and changes nothing.
    await optionsPage.fill("#restorePasswordInput", "wrong-password");
    await optionsPage.click("#confirmRestoreBtn");
    await expectToast(optionsPage, "Incorrect password or corrupted backup data");
    await expect(optionsPage.locator("#restoreModal")).not.toHaveClass(/d-none/);
    expect(await ext.getServices()).toEqual([]);

    // The settings-only escape hatch imports the config without secrets.
    await optionsPage.click("#restoreSettingsOnlyBtn");
    await expectToast(optionsPage, "Settings restored (credentials skipped)");

    const [svc] = await ext.getServices();
    expect(svc.name).toBe("Encrypted qBit");
    expect(svc.password).toBe("");
  });

  test("the popup's quick export produces the same valid JSON shape", async ({ popupPage, ext }) => {
    await ext.seedService({ id: "a", name: "Alpha", password: "topsecret" });
    await popupPage.reload();
    await popupPage.click("#settingsBtn");

    const [download] = await Promise.all([
      popupPage.waitForEvent("download", { timeout: 15000 }),
      popupPage.click("#popupExportBtn")
    ]);
    const json = JSON.parse(fs.readFileSync(await download.path(), "utf8"));

    expect(download.suggestedFilename()).toMatch(/^download-nexus-backup-\d{4}-\d{2}-\d{2}\.json$/);
    expect(json.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(json.services).toHaveLength(1);
    expect(json.services[0].password).toBe("");
    expect(Array.isArray(json.whitelist)).toBe(true);
    expect(json.whitelistMode).toBe("all");
  });
});
