const { test, expect } = require("./fixtures");
const {
  waitForTasks,
  selectFilter,
  taskByName,
  openPopupSettings
} = require("./helpers");

// Every test here needs at least one stub-backed service configured before the
// popup boots, so the popup is (re)loaded after seeding.
test.beforeEach(async ({ ext, popupPage }) => {
  await ext.seedService({ id: "svc-main", name: "Stub qBit" });
  await popupPage.reload();
});

test.describe("Popup UI & interactions", () => {
  test("popup shows the configured service and its live totals", async ({ popupPage }) => {
    await expect(popupPage.locator("#noNasContainer")).not.toHaveClass(/show/);
    await waitForTasks(popupPage);

    await expect(popupPage.locator("#speedBar")).toBeVisible();
    await expect(popupPage.locator("#taskCountLabel")).toHaveText(/\d+ tasks?/);
    await expect(popupPage.locator("#totalDn")).toHaveText(/\/s$/);
    await expect(popupPage.locator("#totalUp")).toHaveText(/\/s$/);
    // A single service renders no service tab bar.
    await expect(popupPage.locator("#nasTabBar")).toHaveClass(/d-none/);
  });

  test("filter tabs render the qBittorrent tab set with per-status counts", async ({ popupPage }) => {
    await waitForTasks(popupPage);

    const tabs = popupPage.locator("#tabBar .tab");
    await expect(tabs).toHaveCount(6);
    const filters = await tabs.evaluateAll(els => els.map(e => e.dataset.filter));
    expect(filters).toEqual(["downloading", "seeding", "stalled", "error", "paused", "finished"]);

    // qBittorrent calls it "Stopped", not "Paused" — the label is adapter-aware.
    await expect(popupPage.locator('#tabBar [data-filter="paused"]')).toContainText("Stopped");

    // The stub's fixture data: 2 downloading, 1 seeding, 1 stalled, 2 stopped.
    await expect(popupPage.locator("#cnt-downloading")).toHaveText("2");
    await expect(popupPage.locator("#cnt-seeding")).toHaveText("1");
    await expect(popupPage.locator("#cnt-stalled")).toHaveText("1");
    await expect(popupPage.locator("#cnt-paused")).toHaveText("2");
  });

  test("switching filters swaps which tasks are listed", async ({ popupPage }) => {
    await waitForTasks(popupPage);
    await expect(popupPage.locator("#taskList .task")).toHaveCount(2);
    await expect(taskByName(popupPage, "Ubuntu 24.04 Desktop ISO")).toBeVisible();

    await selectFilter(popupPage, "seeding");
    await expect(popupPage.locator("#taskList .task")).toHaveCount(1);
    await expect(taskByName(popupPage, "Blender Open Movie Archive")).toBeVisible();

    await selectFilter(popupPage, "paused");
    await expect(popupPage.locator("#taskList .task")).toHaveCount(2);

    await selectFilter(popupPage, "finished");
    await expect(popupPage.locator("#taskList .task")).toHaveCount(0);
    await expect(popupPage.locator("#emptyMsg")).toContainText("No finished tasks");
  });

  test("task rows show name, progress, transfer rates and size", async ({ popupPage }) => {
    await waitForTasks(popupPage);
    const row = taskByName(popupPage, "Ubuntu 24.04 Desktop ISO");

    await expect(row.locator(".task-name")).toHaveText("Ubuntu 24.04 Desktop ISO");
    await expect(row.locator(".progress-pct")).toHaveText("42%");
    await expect(row.locator(".progress-fill")).toHaveAttribute("style", /width:\s*42%/);
    await expect(row.locator(".task-dn")).toHaveText("↓ 4.3 MB/s");
    await expect(row.locator(".task-up")).toHaveText("↑ 244.1 KB/s");
    await expect(row.locator(".task-size")).toHaveText("2.0 GB / 4.7 GB");
    await expect(row.locator(".status-dot")).toHaveClass(/s-downloading/);
  });

  test("pause button is offered only for active tasks", async ({ popupPage }) => {
    await waitForTasks(popupPage);
    await expect(taskByName(popupPage, "Ubuntu 24.04 Desktop ISO").locator(".pause-btn")).toBeVisible();

    await selectFilter(popupPage, "paused");
    await expect(popupPage.locator("#taskList .task").first().locator(".pause-btn")).toHaveClass(/d-none/);
  });

  test("resume button is offered only for paused or stalled tasks", async ({ popupPage }) => {
    await waitForTasks(popupPage);
    await expect(taskByName(popupPage, "Ubuntu 24.04 Desktop ISO").locator(".resume-btn")).toHaveClass(/d-none/);

    await selectFilter(popupPage, "paused");
    await expect(popupPage.locator("#taskList .task").first().locator(".resume-btn")).toBeVisible();

    await selectFilter(popupPage, "stalled");
    await expect(popupPage.locator("#taskList .task").first().locator(".resume-btn")).toBeVisible();
  });

  test("pausing a single task calls the service and moves it out of the active list", async ({ popupPage, stub }) => {
    await waitForTasks(popupPage);
    await taskByName(popupPage, "Ubuntu 24.04 Desktop ISO").locator(".pause-btn").click();

    await expect.poll(() => stub.requestsTo("/torrents/stop").length, { timeout: 10000 })
      .toBeGreaterThan(0);
    const req = stub.lastRequestTo("/torrents/stop");
    expect(new URLSearchParams(req.body).get("hashes"))
      .toBe("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1");

    await expect(popupPage.locator("#taskList .task")).toHaveCount(1);
  });

  test("deleting a task asks for confirmation and removes it", async ({ popupPage, stub }) => {
    await waitForTasks(popupPage);

    popupPage.onNextDialog(d => {
      expect(d.message()).toContain("Ubuntu 24.04 Desktop ISO");
      return d.accept();
    });
    await taskByName(popupPage, "Ubuntu 24.04 Desktop ISO").locator(".delete-btn").click();

    await expect.poll(() => stub.requestsTo("/torrents/delete").length, { timeout: 10000 })
      .toBeGreaterThan(0);
    await expect(taskByName(popupPage, "Ubuntu 24.04 Desktop ISO")).toHaveCount(0);
  });

  test("select-all / deselect-all toggles every visible checkbox", async ({ popupPage }) => {
    await waitForTasks(popupPage);
    const toggle = popupPage.locator("#toggleSelectBtn");
    const boxes = popupPage.locator("#taskList .task .task-checkbox");

    await expect(toggle).toHaveText("✓ All");
    await toggle.click();
    await expect(boxes.nth(0)).toBeChecked();
    await expect(boxes.nth(1)).toBeChecked();
    await expect(toggle).toHaveText("✗ None");

    await toggle.click();
    await expect(boxes.nth(0)).not.toBeChecked();
    await expect(boxes.nth(1)).not.toBeChecked();
    await expect(toggle).toHaveText("✓ All");
  });

  test("bulk pause stops every selected task in one call", async ({ popupPage, stub }) => {
    await waitForTasks(popupPage);
    await popupPage.click("#toggleSelectBtn");

    const pauseBtn = popupPage.locator("#pauseAllBtn");
    await expect(pauseBtn).toBeVisible();
    await expect(pauseBtn).toHaveText("⏸ (2)");
    await pauseBtn.click();

    await expect.poll(() => stub.requestsTo("/torrents/stop").length, { timeout: 10000 })
      .toBeGreaterThan(0);
    const hashes = new URLSearchParams(stub.lastRequestTo("/torrents/stop").body).get("hashes");
    expect(hashes.split("|")).toHaveLength(2);
  });

  test("bulk resume restarts every selected paused task", async ({ popupPage, stub }) => {
    await waitForTasks(popupPage);
    await selectFilter(popupPage, "paused");
    await expect(popupPage.locator("#taskList .task")).toHaveCount(2);

    await popupPage.click("#toggleSelectBtn");
    const resumeBtn = popupPage.locator("#resumeAllBtn");
    await expect(resumeBtn).toHaveText("▶ (2)");
    await resumeBtn.click();

    await expect.poll(() => stub.requestsTo("/torrents/start").length, { timeout: 10000 })
      .toBeGreaterThan(0);
    const hashes = new URLSearchParams(stub.lastRequestTo("/torrents/start").body).get("hashes");
    expect(hashes.split("|")).toHaveLength(2);
  });

  test("bulk delete confirms once and removes every selected task", async ({ popupPage, stub }) => {
    await waitForTasks(popupPage);
    await popupPage.click("#toggleSelectBtn");

    let confirmed = "";
    popupPage.onNextDialog(d => { confirmed = d.message(); return d.accept(); });
    await popupPage.locator("#removeAllBtn").click();

    await expect.poll(() => stub.requestsTo("/torrents/delete").length, { timeout: 10000 })
      .toBeGreaterThan(0);
    expect(confirmed).toContain("Remove 2 tasks");
    const params = new URLSearchParams(stub.lastRequestTo("/torrents/delete").body);
    expect(params.get("hashes").split("|")).toHaveLength(2);
    expect(params.get("deleteFiles")).toBe("false");

    await expect(popupPage.locator("#taskList .task")).toHaveCount(0);
  });

  test("refresh button re-queries the service", async ({ popupPage, stub }) => {
    await waitForTasks(popupPage);
    const before = stub.requestsTo("/torrents/info").length;

    await popupPage.click("#refreshBtn");
    await expect.poll(() => stub.requestsTo("/torrents/info").length, { timeout: 10000 })
      .toBeGreaterThan(before);
  });

  test("gear icon toggles between the task view and the settings view", async ({ popupPage }) => {
    await expect(popupPage.locator("#mainView")).toHaveClass(/show/);

    await openPopupSettings(popupPage);
    await expect(popupPage.locator("#headerTitle")).toHaveText("Settings");
    await expect(popupPage.locator("#backIcon")).not.toHaveClass(/d-none/);
    await expect(popupPage.locator("#gearIcon")).toHaveClass(/d-none/);
    await expect(popupPage.locator("#settingsNasList")).toContainText("Stub qBit");

    await popupPage.click("#settingsBtn");
    await expect(popupPage.locator("#mainView")).toHaveClass(/show/);
    await expect(popupPage.locator("#headerTitle")).toHaveText("Download Nexus");
    await expect(popupPage.locator("#gearIcon")).not.toHaveClass(/d-none/);
  });

  test("a failing service surfaces the error panel with a retry affordance", async ({ popupPage, ext, stub }) => {
    await waitForTasks(popupPage);

    // The error panel only appears when there is nothing cached to fall back on,
    // so clear the task cache before making the service fail.
    await ext.writeStorage("local", { taskCache: {} });
    stub.setFailMode("server");
    await popupPage.reload();

    await expect(popupPage.locator("#errorContainer")).toHaveClass(/show/, { timeout: 15000 });
    await expect(popupPage.locator("#retryBtn")).toBeVisible();
    await expect(popupPage.locator("#statusMsg")).toHaveClass(/error/);
  });
});
