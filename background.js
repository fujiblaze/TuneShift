if (typeof importScripts === "function") importScripts("audio/tab-effects-background.js");

const DEFAULTS = Object.freeze({
  speed: 1,
  transpose: 0,
  pitch: 0,
  volume: 100,
  subBass: 0, warmth: 0, air: 0, swapChannels: false, bass: 0,
  mid: 0,
  treble: 0,
  balance: 0,
  compressor: false,
  mono: false,
  loopA: null,
  loopB: null,
  repeat: "off", loopEnabled: true, cues: [],
  overlay: false
});

const DEFAULT_PREFS = Object.freeze({
  rememberSites: true,
  autoApply: true,
  speedStep: 0.1,
  seekStep: 10,
  showBadge: true,
  themeMode: "dark"
});
const SETTINGS_SCHEMA_VERSION = 3;
const MAX_PAGE_PROFILES = 200;
const MAX_TRACK_PROFILES = 200;
const MAX_BPM_ENTRIES = 300;
const BPM_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
let storageQueue = Promise.resolve();

function queueStorage(task) {
  const next = storageQueue.catch(() => undefined).then(task);
  storageQueue = next.catch(() => undefined);
  return next;
}

const applyQueues = new Map();

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get(["defaults", "preferences", "siteSettings", "pageProfiles", "trackProfiles", "customPresets", "extensionEnabled", "settingsSchemaVersion"]);
  const migrateFinePitch = !Number.isFinite(current.settingsSchemaVersion) || current.settingsSchemaVersion < 2;
  const siteSettings = Object.fromEntries(
    Object.entries(current.siteSettings || {}).map(([host, value]) => [host, migrateSettings(value, migrateFinePitch)])
  );
  const pageProfiles = Object.fromEntries(
    Object.entries(current.pageProfiles || {})
      .map(([key, value]) => normalizePageProfile(value, key, migrateFinePitch))
      .filter((profile) => profile.url)
      .sort((a, b) => (a.updatedAt || 0) - (b.updatedAt || 0))
      .map((profile) => [profile.url, profile])
  );
  await chrome.storage.local.set({
    defaults: migrateSettings({ ...DEFAULTS, ...(current.defaults || {}) }, migrateFinePitch),
    preferences: { ...DEFAULT_PREFS, ...(current.preferences || {}) },
    presets: makeBuiltInPresets(),
    customPresets: Array.isArray(current.customPresets) ? current.customPresets : [],
    siteSettings,
    pageProfiles,
    trackProfiles: current.trackProfiles || {},
    extensionEnabled: current.extensionEnabled !== false,
    settingsSchemaVersion: SETTINGS_SCHEMA_VERSION
  });
  await queueStorage(pruneBpmCache);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target === "tuneshift-offscreen") return false;
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((error) => sendResponse({ ok: false, error: friendlyError(error) }));
  return true;
});

chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !isScriptable(tab.url)) return;
  const { preferences = DEFAULT_PREFS, extensionEnabled = true } = await chrome.storage.local.get(["preferences", "extensionEnabled"]);
  if (!extensionEnabled) return;
  try {
    await ensureController(tab.id);
    if (command === "toggle-playback") {
      await chrome.tabs.sendMessage(tab.id, { type: "MEDIA_ACTION", action: "toggle" });
      return;
    }
    if (command === "reset-controls") {
      await queueApply(tab, { ...DEFAULTS }, true);
      return;
    }
    const state = await chrome.tabs.sendMessage(tab.id, { type: "GET_STATE" });
    const delta = command === "speed-up" ? preferences.speedStep : -preferences.speedStep;
    const nextSpeed = clamp(round((state.settings?.speed || 1) + delta, 2), 0.25, 4);
    await queueApply(tab, { ...state.settings, speed: nextSpeed }, true);
  } catch (error) {
    console.warn("TuneShift shortcut failed", error);
  }
});

async function handleMessage(message, sender = {}) {
  switch (message?.type) {
    case "LOAD_BPM": {
      if (!sender.tab || !validBpmKey(message.key, sender.tab.url)) return { ok: false };
      return queueStorage(() => loadBpm(message.key));
    }
    case "SAVE_BPM": {
      if (!sender.tab || !validBpmKey(message.key, sender.tab.url) || !validSavedBpm(message.bpm)) return { ok: false };
      return queueStorage(() => saveBpm(message.key, message.bpm));
    }
    case "GET_SAVED_SETTINGS": {
      if (!sender.tab || (message.trackKey && !validBpmKey(message.trackKey, sender.tab.url))) return { ok: false };
      const { preferences = DEFAULT_PREFS, pageProfiles = {}, trackProfiles = {} } =
        await chrome.storage.local.get(["preferences", "pageProfiles", "trackProfiles"]);
      const canRestore = preferences.rememberSites !== false && preferences.autoApply !== false;
      const track = canRestore && message.trackKey ? trackProfiles[message.trackKey] : null;
      const page = canRestore ? pageProfiles[pageKey(sender.tab.url)] : null;
      const saved = track || page;
      return { ok: true, settings: saved?.settings || null, saved: Boolean(saved),
        scope: track ? "track" : page ? "page" : "none" };
    }
    case "SET_TRACK_PROFILE": {
      if (!isPopupSender(sender)) return { ok: false };
      const tab = await getActiveTab(message.windowId, message.expectedTabId);
      await ensureController(tab.id);
      const pageState = await chrome.tabs.sendMessage(tab.id, { type: "GET_STATE" });
      const key = pageState.trackKey;
      if (!validBpmKey(key, tab.url)) return { ok: false, error: "This track has no stable identity yet." };
      return queueStorage(async () => {
        const { preferences = DEFAULT_PREFS, trackProfiles = {} } =
          await chrome.storage.local.get(["preferences", "trackProfiles"]);
        if (preferences.rememberSites === false) return { ok: false, error: "Turn on Remember before saving a track." };
        if (message.enabled) {
          trackProfiles[key] = { url: pageKey(tab.url), title: pageState.media?.title || tab.title || "Audio track",
            settings: sanitizeSettings(message.settings), updatedAt: Date.now() };
        } else delete trackProfiles[key];
        const ordered = Object.entries(trackProfiles).sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0));
        await chrome.storage.local.set({ trackProfiles: Object.fromEntries(ordered.slice(0, MAX_TRACK_PROFILES)) });
        await chrome.tabs.sendMessage(tab.id, { type: "SET_TRACK_SCOPE", enabled: Boolean(message.enabled) }).catch(() => undefined);
        return { ok: true, active: Boolean(message.enabled), trackKey: key };
      });
    }
    case "CLEAR_SAVED_HISTORY": {
      if (!isHistorySender(sender)) return { ok: false };
      return queueStorage(clearSavedHistory);
    }
    case "DELETE_SAVED_PAGE": {
      if (!isHistorySender(sender) || !pageKey(message.url)) return { ok: false };
      return queueStorage(() => deleteSavedPage(pageKey(message.url)));
    }
    case "SET_SIDEBAR_MODE": {
      if (sender.tab || ![chrome.runtime.getURL("popup/popup.html"), chrome.runtime.getURL("popup/popup.html?sidebar=1")].includes(sender.url)) throw new Error("Change sidebar mode from TuneShift.");
      const { preferences = {} } = await chrome.storage.local.get("preferences");
      const enabled = message.enabled === true;
      await configureSidebar(enabled);
      try {
        await chrome.storage.local.set({ preferences: { ...preferences, sidebarMode: enabled } });
      } catch (error) {
        await configureSidebar(preferences.sidebarMode === true);
        throw error;
      }
      return { ok: true };
    }
    case "START_TAB_EFFECTS": {
      if (sender.tab || ![chrome.runtime.getURL("popup/popup.html"), chrome.runtime.getURL("popup/popup.html?sidebar=1")].includes(sender.url)) throw new Error("Start tab effects from the TuneShift popup.");
      const { extensionEnabled = true } = await chrome.storage.local.get("extensionEnabled");
      if (!extensionEnabled) throw new Error("Turn TuneShift on first.");
      const tab = await getActiveTab(message.windowId, message.type === "GET_ACTIVE_STATE" ? undefined : message.expectedTabId);
      if (!await chrome.permissions.contains({ permissions: ["tabCapture"] })) throw new Error("Allow tab capture from the TuneShift popup first.");
      await ensureController(tab.id);
      const settings = sanitizeSettings(message.settings);
      await TuneShiftTabEffects.start(tab, settings);
      return applyToTab(tab, settings, true);
    }
    case "STOP_TAB_EFFECTS": {
      const tab = await getActiveTab(message.windowId, message.type === "GET_ACTIVE_STATE" ? undefined : message.expectedTabId);
      await TuneShiftTabEffects.stop(tab.id);
      const pageState = await chrome.tabs.sendMessage(tab.id, { type: "GET_STATE" });
      pageState.tabEffects = { active: false };
      return { ok: true, pageState };
    }
    case "TAB_EFFECTS_ENDED": {
      if (sender.url !== chrome.runtime.getURL("audio/tab-effects.html")) return { ok: false };
      await TuneShiftTabEffects.stop(message.tabId, String(message.error || ""));
      return { ok: true };
    }
    case "GET_ACTIVE_STATE": {
      const tab = await getActiveTab(message.windowId, message.type === "GET_ACTIVE_STATE" ? undefined : message.expectedTabId);
      if (!isScriptable(tab.url)) return { ok: false, restricted: true, tab: publicTab(tab) };
      await ensureController(tab.id);
      let pageState = await chrome.tabs.sendMessage(tab.id, { type: "GET_STATE" });
      const { extensionEnabled = true, pageProfiles = {}, trackProfiles = {} } =
        await chrome.storage.local.get(["extensionEnabled", "pageProfiles", "trackProfiles"]);
      if (pageState.enabled !== extensionEnabled) {
        pageState = await chrome.tabs.sendMessage(tab.id, { type: "SET_ENABLED", enabled: extensionEnabled });
      }
      const tabEffects = await globalThis.TuneShiftTabEffects?.status(tab.id) || { active: false };
      if (Boolean(pageState.tabEffectsActive) !== tabEffects.active) pageState = await chrome.tabs.sendMessage(tab.id, { type: "SET_TAB_EFFECTS", active: tabEffects.active });
      pageState.tabEffects = tabEffects;
      pageState.audioActive ||= tabEffects.active;
      const pageProfile = pageProfiles[pageKey(tab.url)] || null;
      const trackProfile = pageState.trackKey ? trackProfiles[pageState.trackKey] || null : null;
      return { ok: true, tab: publicTab(tab), pageState, pageProfile, trackProfile, extensionEnabled };
    }
    case "SET_EXTENSION_ENABLED": {
      const enabled = Boolean(message.enabled);
      await chrome.storage.local.set({ extensionEnabled: enabled });
      if (!enabled) await globalThis.TuneShiftTabEffects?.stopAll();
      const activeTab = await getActiveTab(message.windowId);
      const tabs = await chrome.tabs.query({});
      let pageState = null;
      await Promise.all(tabs.filter((tab) => tab.id).map(async (tab) => {
        try {
          const result = await chrome.tabs.sendMessage(tab.id, { type: "SET_ENABLED", enabled });
          if (tab.id === activeTab.id) pageState = result;
          if (enabled) await updateBadge(tab.id, result.settings || DEFAULTS, result.audioActive);
          else await chrome.action.setBadgeText({ tabId: tab.id, text: "" });
        } catch (_) {
          if (!enabled) await chrome.action.setBadgeText({ tabId: tab.id, text: "" }).catch(() => undefined);
        }
      }));
      if (!pageState && isScriptable(activeTab.url)) {
        await ensureController(activeTab.id);
        pageState = await chrome.tabs.sendMessage(activeTab.id, { type: "SET_ENABLED", enabled });
        if (enabled) await updateBadge(activeTab.id, pageState.settings || DEFAULTS, pageState.audioActive);
      }
      return { ok: true, extensionEnabled: enabled, tab: publicTab(activeTab), pageState };
    }
    case "APPLY_SETTINGS": {
      const { extensionEnabled = true } = await chrome.storage.local.get("extensionEnabled");
      if (!extensionEnabled) throw new Error("TuneShift is switched off.");
      const tab = await getActiveTab(message.windowId, message.type === "GET_ACTIVE_STATE" ? undefined : message.expectedTabId);
      if (!isScriptable(tab.url)) throw new Error("This page does not allow extensions to control media.");
      return queueApply(tab, sanitizeSettings(message.settings), Boolean(message.persist));
    }
    case "RECORD_PAGE_PROFILE": {
      if (!sender.tab || !isScriptable(sender.tab.url)) return { ok: false };
      const settings = sanitizeSettings(message.settings);
      await globalThis.TuneShiftTabEffects?.apply(sender.tab.id, settings);
      await persistSettings(sender.tab, settings, message.trackKey);
      return { ok: true };
    }
    case "MEDIA_ACTION": {
      const tab = await getActiveTab(message.windowId, message.type === "GET_ACTIVE_STATE" ? undefined : message.expectedTabId);
      await ensureController(tab.id);
      return chrome.tabs.sendMessage(tab.id, {
        type: "MEDIA_ACTION",
        action: message.action,
        seconds: Number(message.seconds) || 0,
        time: Number(message.time)
      });
    }
    case "BEGIN_MANUAL_BPM": {
      const tab = await getActiveTab(message.windowId, message.type === "GET_ACTIVE_STATE" ? undefined : message.expectedTabId);
      await ensureController(tab.id);
      return chrome.tabs.sendMessage(tab.id, { type: "BEGIN_MANUAL_BPM" });
    }
    case "SET_MANUAL_BPM": {
      const tab = await getActiveTab(message.windowId, message.type === "GET_ACTIVE_STATE" ? undefined : message.expectedTabId);
      await ensureController(tab.id);
      return chrome.tabs.sendMessage(tab.id, {
        type: "SET_MANUAL_BPM",
        bpm: Number(message.bpm),
        source: message.source === "entry" ? "entry" : "tap"
      });
    }
    case "SET_LOOP_POINT": {
      const tab = await getActiveTab(message.windowId, message.type === "GET_ACTIVE_STATE" ? undefined : message.expectedTabId);
      await ensureController(tab.id);
      return chrome.tabs.sendMessage(tab.id, { type: "SET_LOOP_POINT", point: message.point });
    }
    case "SET_LOOP_TIMES": {
      const tab = await getActiveTab(message.windowId, message.expectedTabId);
      await ensureController(tab.id);
      return chrome.tabs.sendMessage(tab.id, { type: "SET_LOOP_TIMES", a: message.a, b: message.b });
    }
    case "CLEAR_LOOP": {
      const tab = await getActiveTab(message.windowId, message.type === "GET_ACTIVE_STATE" ? undefined : message.expectedTabId);
      await ensureController(tab.id);
      return chrome.tabs.sendMessage(tab.id, { type: "CLEAR_LOOP" });
    }
    case "RELOAD_ACTIVE_TAB": {
      const tab = await getActiveTab(message.windowId, message.type === "GET_ACTIVE_STATE" ? undefined : message.expectedTabId);
      await chrome.tabs.reload(tab.id);
      return { ok: true };
    }
    case "OPEN_SHORTCUTS":
      await chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
      return { ok: true };
    default:
      return { ok: false, error: "Unknown request." };
  }
}

function queueApply(tab, settings, persist) {
  const previous = applyQueues.get(tab.id) || Promise.resolve();
  const next = previous.catch(() => undefined).then(() => applyToTab(tab, settings, persist));
  applyQueues.set(tab.id, next);
  next.then(cleanup, cleanup);
  return next;

  function cleanup() {
    if (applyQueues.get(tab.id) === next) applyQueues.delete(tab.id);
  }
}

async function applyToTab(tab, settings, persist) {
  await ensureController(tab.id);
  const tabEffects = await globalThis.TuneShiftTabEffects?.status(tab.id) || { active: false };
  await chrome.tabs.sendMessage(tab.id, { type: "SET_TAB_EFFECTS", active: tabEffects.active });
  const result = await chrome.tabs.sendMessage(tab.id, { type: "APPLY_SETTINGS", settings });
  if (tabEffects.active) await TuneShiftTabEffects.apply(tab.id, settings);
  result.tabEffects = tabEffects;
  result.audioActive ||= tabEffects.active;
  if (!result?.ok) throw new Error(result?.error || "The page audio engine could not start.");
  await updateBadge(tab.id, settings, result.audioActive);
  if (persist) await persistSettings(tab, settings, result.trackKey);
  return {
    ok: true,
    pageState: result,
    audioActive: result.audioActive,
    audioError: result.audioError || null,
    audioErrorCode: result.audioErrorCode || null
  };
}

async function ensureController(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (isDrmProtectedHost(safeHost(tab.url))) await injectSpotifyHook(tabId);
  try {
    const pong = await chrome.tabs.sendMessage(tabId, { type: "PING" });
    if (pong?.ok) return;
  } catch (_) {
    // The controller has not been injected in this navigation yet.
  }
  await chrome.scripting.executeScript({ target: { tabId }, files: ["audio/effects-graph.js", "content/content.js"] });
}

async function injectSpotifyHook(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content/spotify-bootstrap.js"],
      world: "MAIN",
      injectImmediately: true
    });
  } catch (_) {
    // The tab may be navigating; the hook retries on the next controller call.
  }
}

async function updateBadge(tabId, settings, audioActive) {
  const { preferences = DEFAULT_PREFS } = await chrome.storage.local.get("preferences");
  const speedActive = Math.abs(settings.speed - 1) > 0.001;
  const transposeActive = Math.abs(settings.transpose) > 0.001;
  const pitchActive = Math.abs(settings.pitch || 0) > 0.001;
  const otherEffectsActive =
    Math.abs((settings.volume ?? 100) - 100) > 0.001 ||
    ["subBass", "warmth", "air", "bass", "mid", "treble", "balance"].some((key) => Math.abs(settings[key] || 0) > 0.001) ||
    Boolean(settings.compressor || settings.mono || settings.swapChannels);
  if (!preferences.showBadge || (!speedActive && !transposeActive && !audioActive)) {
    await chrome.action.setBadgeText({ tabId, text: "" });
    return;
  }
  const showingSpeed = speedActive;
  const showingTranspose = !showingSpeed && transposeActive;
  const showingPitch = !showingSpeed && !showingTranspose && pitchActive && !otherEffectsActive;
  const text = showingSpeed
    ? `${settings.speed.toFixed(1)}×`
    : showingTranspose
      ? formatTransposeBadge(settings.transpose)
      : "FX";
  const badgeColor = showingTranspose ? "#CDB4DB" : showingPitch ? "#A2D2FF" : "#FFAFCC";
  await chrome.action.setBadgeBackgroundColor({ tabId, color: badgeColor });
  await chrome.action.setBadgeTextColor({ tabId, color: "#2F2233" }).catch(() => undefined);
  await chrome.action.setBadgeText({ tabId, text });
}

function formatTransposeBadge(value) {
  const rounded = Math.round(value);
  return `${rounded > 0 ? "+" : ""}${rounded}`;
}

async function persistSettings(tab, settings, trackKey = null) {
  return queueStorage(async () => {
    const { preferences = DEFAULT_PREFS, pageProfiles = {}, trackProfiles = {} } =
      await chrome.storage.local.get(["preferences", "pageProfiles", "trackProfiles"]);
    if (!preferences.rememberSites) return;
    const key = pageKey(tab.url);
    if (!key) return;
    const updatedAt = Date.now();
    if (validBpmKey(trackKey, tab.url) && trackProfiles[trackKey]) {
      trackProfiles[trackKey] = { ...trackProfiles[trackKey], settings: sanitizeSettings(settings), updatedAt };
      await chrome.storage.local.set({ trackProfiles });
      return;
    }
    pageProfiles[key] = {
      url: key,
      title: tab.title || safeHost(key) || "Audio page",
      host: safeHost(key),
      settings: sanitizeSettings(settings),
      updatedAt
    };
    const ordered = Object.entries(pageProfiles).sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0));
    await chrome.storage.local.set({ pageProfiles: Object.fromEntries(ordered.slice(0, MAX_PAGE_PROFILES)) });
  });
}

function validSavedBpm(value) {
  return value && Number.isFinite(value.value) && value.value >= 30 && value.value <= 300 &&
    ["automatic", "manual"].includes(value.status);
}

function validBpmKey(key, tabUrl) {
  const page = pageKey(tabUrl);
  return page && typeof key === "string" &&
    (key === `bpm:${page}` || key.startsWith(`bpm:${page}|`));
}

function isHistorySender(sender) {
  return !sender.tab && sender.url?.startsWith(chrome.runtime.getURL("popup/history.html"));
}

function isPopupSender(sender) {
  return !sender.tab && [chrome.runtime.getURL("popup/popup.html"),
    chrome.runtime.getURL("popup/popup.html?sidebar=1")].includes(sender.url);
}

async function pruneBpmCache(snapshot = null, keepKey = "") {
  const all = snapshot || await chrome.storage.local.get(null);
  const now = Date.now();
  const records = [];
  const updates = {};
  const remove = [];
  for (const [key, value] of Object.entries(all)) {
    if (!key.startsWith("bpm:")) continue;
    if (!validSavedBpm(value)) { remove.push(key); continue; }
    const updatedAt = Number(value.updatedAt) || now;
    if (updatedAt > now || now - updatedAt > BPM_MAX_AGE_MS) { remove.push(key); continue; }
    if (!value.updatedAt) updates[key] = { ...value, updatedAt };
    records.push([key, updatedAt]);
  }
  records.sort((a, b) => b[1] - a[1] || Number(b[0] === keepKey) - Number(a[0] === keepKey));
  remove.push(...records.slice(MAX_BPM_ENTRIES).map(([key]) => key));
  for (const key of remove) delete updates[key];
  if (Object.keys(updates).length) await chrome.storage.local.set(updates);
  if (remove.length) await chrome.storage.local.remove(remove);
}

async function loadBpm(key) {
  const stored = await chrome.storage.local.get(["preferences", key]);
  if (stored.preferences?.rememberSites === false) return { ok: true, bpm: null };
  const bpm = stored[key];
  if (!validSavedBpm(bpm)) return { ok: true, bpm: null };
  const updatedAt = Number(bpm.updatedAt) || Date.now();
  if (Date.now() - updatedAt > BPM_MAX_AGE_MS) {
    await chrome.storage.local.remove(key);
    return { ok: true, bpm: null };
  }
  return { ok: true, bpm };
}

async function saveBpm(key, bpm) {
  const stored = await chrome.storage.local.get("preferences");
  if (stored.preferences?.rememberSites === false) return { ok: true, saved: false };
  const value = { value: bpm.value, status: bpm.status, source: bpm.source || null,
    confidence: Number(bpm.confidence) || 0, updatedAt: Date.now() };
  await chrome.storage.local.set({ [key]: value });
  await pruneBpmCache(null, key);
  return { ok: true, saved: true };
}

async function clearSavedHistory() {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter(key => key.startsWith("bpm:"));
  await chrome.storage.local.set({ pageProfiles: {}, trackProfiles: {} });
  if (keys.length) await chrome.storage.local.remove(keys);
  return { ok: true };
}

async function deleteSavedPage(page) {
  const all = await chrome.storage.local.get(null);
  const pageProfiles = { ...(all.pageProfiles || {}) };
  const trackProfiles = { ...(all.trackProfiles || {}) };
  delete pageProfiles[page];
  for (const [key, profile] of Object.entries(trackProfiles)) {
    if (profile?.url === page) delete trackProfiles[key];
  }
  const prefix = `bpm:${page}`;
  const keys = Object.keys(all).filter(key => key === prefix || key.startsWith(`${prefix}|`));
  await chrome.storage.local.set({ pageProfiles, trackProfiles });
  if (keys.length) await chrome.storage.local.remove(keys);
  return { ok: true };
}

function normalizePageProfile(value = {}, fallbackUrl = "", migrateFinePitch = false) {
  const url = pageKey(value.url || fallbackUrl);
  return {
    url,
    title: String(value.title || safeHost(url) || "Audio page"),
    host: String(value.host || safeHost(url)),
    settings: migrateSettings(value.settings || value, migrateFinePitch),
    updatedAt: Number(value.updatedAt) || Date.now()
  };
}

function sanitizeSettings(input = {}) {
  return {
    speed: clamp(number(input.speed, 1), 0.25, 4),
    transpose: clamp(Math.round(number(input.transpose, 0)), -12, 12),
    pitch: clamp(number(input.pitch, 0), -1, 1),
    volume: clamp(number(input.volume, 100), 0, 200),
    subBass: clamp(number(input.subBass, 0), -12, 12),
    warmth: clamp(number(input.warmth, 0), -12, 12),
    air: clamp(number(input.air, 0), -12, 12),
    swapChannels: Boolean(input.swapChannels),
    bass: clamp(number(input.bass, 0), -12, 12),
    mid: clamp(number(input.mid, 0), -12, 12),
    treble: clamp(number(input.treble, 0), -12, 12),
    balance: clamp(number(input.balance, 0), -1, 1),
    compressor: Boolean(input.compressor),
    mono: Boolean(input.mono),
    loopA: nullableNumber(input.loopA),
    loopB: nullableNumber(input.loopB),
    repeat: ["off", "track", "once", "twice", "five"].includes(input.repeat) ? input.repeat : "off",
    loopEnabled: input.loopEnabled !== false,
    cues: Array.isArray(input.cues) ? input.cues.filter(c => Number.isFinite(c?.time) && c.time >= 0).slice(0, 9).map(c => ({ time: c.time, name: String(c.name || "Cue").slice(0, 40) })) : [],
    overlay: Boolean(input.overlay)
  };
}

function migrateSettings(input = {}, migrateFinePitch = false) {
  if (input.transpose === undefined && input.pitch !== undefined) {
    return sanitizeSettings({ ...input, transpose: input.pitch, pitch: 0 });
  }
  return sanitizeSettings({
    ...input,
    pitch: migrateFinePitch ? number(input.pitch, 0) / 100 : input.pitch
  });
}

function makeBuiltInPresets() {
  return [
    { id: "lecture", name: "Lecture", settings: { speed: 1.5, transpose: 0, pitch: 0, volume: 110, bass: -2, mid: 3, treble: 2, compressor: true } },
    { id: "podcast", name: "Podcast", settings: { speed: 1.25, transpose: 0, pitch: 0, volume: 105, bass: 1, mid: 2, treble: 1, compressor: true } },
    { id: "deep", name: "Deep", settings: { speed: 1, transpose: -3, pitch: 0, volume: 100, bass: 4, mid: 0, treble: -1 } },
    { id: "dreamy", name: "Dreamy", settings: { speed: 0.9, transpose: -2, pitch: 0, volume: 100, bass: 2, treble: -2 } },
    { id: "practice", name: "Practice", settings: { speed: 0.75, transpose: 0, pitch: 0, volume: 100 } },
    { id: "bright", name: "Bright", settings: { speed: 1, transpose: 2, pitch: 0, volume: 100, bass: -1, mid: 1, treble: 4 } },
    { id: "velvet", name: "Velvet", requiresDsp: true, settings: { subBass: 3, warmth: 4, treble: -2, air: -2 } },
    { id: "sparkle", name: "Sparkle", requiresDsp: true, settings: { bass: -1, treble: 2, air: 5 } },
    { id: "cinema", name: "Cinema", requiresDsp: true, settings: { subBass: 5, bass: 2, mid: 1, air: 3 } },
    { id: "lofi", name: "Lo-fi", requiresDsp: true, settings: { speed: 0.95, warmth: 4, treble: -5, air: -8 } },
    { id: "radio", name: "Radio", requiresDsp: true, settings: { subBass: -8, bass: -4, mid: 4, air: -5, compressor: true, mono: true } },
    { id: "night", name: "Night", requiresDsp: true, settings: { volume: 75, subBass: -4, warmth: 2, air: -3, compressor: true } },
    { id: "mirror", name: "Mirror", requiresDsp: true, settings: { warmth: 1, air: 2, swapChannels: true } }
  ];
}

async function getActiveTab(windowId, expectedTabId) {
  const [tab] = await chrome.tabs.query({ active: true, ...(Number.isInteger(windowId) ? { windowId } : { currentWindow: true }) });
  if (expectedTabId !== undefined && tab?.id !== expectedTabId) throw new Error("The active tab changed. Try again.");
  if (!tab?.id) throw new Error("No active tab found.");
  return tab;
}

function isScriptable(url = "") {
  return /^https?:\/\//.test(url) || /^file:\/\//.test(url);
}

function isDrmProtectedHost(hostname = "") {
  return /(^|\.)spotify\.com$/.test(hostname);
}

function publicTab(tab) {
  return { id: tab.id, title: tab.title || "", url: tab.url || "", host: safeHost(tab.url), favIconUrl: tab.favIconUrl || "" };
}

function safeHost(url = "") {
  try { return new URL(url).hostname || "local-file"; } catch (_) { return ""; }
}

function pageKey(url = "") {
  try {
    const parsed = new URL(url);
    if (!isScriptable(parsed.href)) return "";
    parsed.hash = "";
    const videoId = youTubeVideoId(parsed);
    if (videoId) return `https://www.youtube.com/watch?v=${videoId}`;
    return parsed.href;
  } catch (_) {
    return "";
  }
}

function youTubeVideoId(parsed) {
  const host = parsed.hostname.replace(/^(www|m)\./, "");
  let candidate = "";
  if (host === "youtu.be") candidate = parsed.pathname.split("/")[1] || "";
  else if (host === "youtube.com" || host === "music.youtube.com") {
    if (parsed.pathname === "/watch") candidate = parsed.searchParams.get("v") || "";
    else {
      const match = parsed.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/]+)/);
      if (match) candidate = match[1];
    }
  }
  return /^[A-Za-z0-9_-]{11}$/.test(candidate) ? candidate : "";
}

function friendlyError(error) {
  const message = error?.message || String(error);
  if (message.includes("Cannot access")) return "Chrome blocks extensions on this page.";
  if (message.includes("activeTab") || message.includes("permission")) return "Reopen TuneShift on the tab and try again.";
  return message;
}

function nullableNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : null;
}

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}


async function configureSidebar(enabled) {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: enabled });
  await chrome.action.setPopup({ popup: enabled ? "" : "popup/popup.html" });
}

async function restoreSidebar() {
  if (!chrome.sidePanel) return;
  const { preferences = {} } = await chrome.storage.local.get("preferences");
  await configureSidebar(preferences.sidebarMode === true);
}
chrome.runtime.onStartup?.addListener(() => restoreSidebar().catch(console.error));
chrome.runtime.onInstalled.addListener(() => restoreSidebar().catch(console.error));
