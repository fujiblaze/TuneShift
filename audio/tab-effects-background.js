(() => {
  const documentPath = "audio/tab-effects.html";
  let creating = null;
  let queue = Promise.resolve();
  const serialize = task => { const next = queue.catch(() => {}).then(task); queue = next; return next; };
  async function exists() {
    return (await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"], documentUrls: [chrome.runtime.getURL(documentPath)] })).length > 0;
  }
  async function ensureDocument() {
    if (await exists()) return;
    if (!creating) creating = chrome.offscreen.createDocument({ url: documentPath, reasons: ["USER_MEDIA"], justification: "Process audio from the tab selected by the user and play it locally." }).finally(() => { creating = null; });
    await creating;
  }
  const request = (action, data = {}) => chrome.runtime.sendMessage({ target: "tuneshift-offscreen", action, ...data });
  const errorKey = tabId => `tabEffectsError:${tabId}`;
  async function status(tabId) {
    const saved = await chrome.storage.session.get(errorKey(tabId));
    if (!await exists()) return { active: false, error: saved[errorKey(tabId)] || "" };
    const response = await request("state", { tabId }).catch(() => ({ active: false }));
    return { active: Boolean(response?.active), signalDetected: Boolean(response?.signalDetected), error: saved[errorKey(tabId)] || "" };
  }
  async function restorePage(tabId) {
    await chrome.tabs.sendMessage(tabId, { type: "SET_TAB_EFFECTS", active: false }).catch(() => undefined);
  }
  async function stop(tabId, error = "") {
    return serialize(async () => {
      if (await exists()) {
        const result = await request("stop", { tabId }).catch(() => null);
        if (result?.remaining === 0) await chrome.offscreen.closeDocument().catch(() => undefined);
      }
      await restorePage(tabId);
      if (error) await chrome.storage.session.set({ [errorKey(tabId)]: error });
      else await chrome.storage.session.remove(errorKey(tabId));
      return { active: false, error };
    });
  }
  async function start(tab, settings) {
    return serialize(async () => {
      const existing = await status(tab.id);
      if (existing.active) return existing;
      await chrome.storage.session.remove(errorKey(tab.id));
      try {
        const page = await chrome.tabs.sendMessage(tab.id, { type: "SET_TAB_EFFECTS", active: true });
        if (!page?.media || page.media.paused) throw new Error("Start playback in this tab before enabling tab effects.");
        const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
        await ensureDocument();
        const result = await request("start", { tabId: tab.id, streamId, settings });
        if (!result?.ok) throw new Error(result?.error || "Could not start tab audio.");
        // Navigation or global bypass during startup must not leave a capture running.
        const current = await chrome.tabs.get(tab.id);
        const { extensionEnabled = true } = await chrome.storage.local.get("extensionEnabled");
        if (current.url !== tab.url || !extensionEnabled) throw new Error("Tab effects stopped because the tab changed or TuneShift was turned off.");
        return result;
      } catch (error) {
        if (await exists()) {
          const result = await request("stop", { tabId: tab.id }).catch(() => null);
          if (result?.remaining === 0) await chrome.offscreen.closeDocument().catch(() => undefined);
        }
        await restorePage(tab.id);
        await chrome.storage.session.set({ [errorKey(tab.id)]: error.message });
        throw error;
      }
    });
  }
  async function apply(tabId, settings) {
    return serialize(async () => {
      if (!(await status(tabId)).active) return { active: false };
      const result = await request("apply", { tabId, settings });
      if (!result?.ok) throw new Error(result?.error || "Could not update tab effects.");
      return result;
    });
  }
  async function stopAll() {
    if (!await exists()) return;
    const state = await request("state");
    for (const tabId of state.tabIds || []) await stop(tabId);
  }
  chrome.tabs.onRemoved.addListener(tabId => { stop(tabId).catch(() => undefined); });
  chrome.tabs.onUpdated.addListener((tabId, change) => { if (change.status === "loading" || change.url) stop(tabId).catch(() => undefined); });
  globalThis.TuneShiftTabEffects = { start, stop, stopAll, status, apply };
})();
