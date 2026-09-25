const DEFAULTS = {

  speed: 1, transpose: 0, pitch: 0, volume: 100, subBass: 0, warmth: 0, air: 0, swapChannels: false, bass: 0, mid: 0, treble: 0,

  balance: 0, compressor: false, mono: false, loopA: null, loopB: null, repeat: "off", loopEnabled: true, cues: [], overlay: false

};



const sidebarView = new URLSearchParams(location.search).has("sidebar");
let controllerWindowId;
let settings = { ...DEFAULTS };

let activeTab = null;

let mediaState = null;

let preferences = {};

let applySequence = 0;

let applyTimer = null;

let pollTimer = null;

let isSeeking = false;
let decimalTime = false;

let lastShownAudioError = null;

let extensionEnabled = true;

let tapTimes = [];

let cancelBpmEdit = false;
let editingCue = null;
let profileDefinitions = [];
let builtInPresets = [];
let customPresets = [];
let trackProfileActive = false;
let editingProfileId = null;
let profilePage = 0;
let preferenceSave = Promise.resolve();
let tabEffectsBusy = false;
let pendingApplies = 0;



const controls = Object.fromEntries(

  ["speed", "transpose", "pitch", "volume", "subBass", "warmth", "air", "swapChannels", "bass", "mid", "treble", "balance", "compressor", "mono", "overlay"]

    .map((id) => [id, document.getElementById(id)])

);

const progress = document.getElementById("media-progress");

const transposeInput = document.getElementById("transpose-value");

const pitchInput = document.getElementById("pitch-value");

const transposeDisplay = document.getElementById("transpose-display");

const pitchDisplay = document.getElementById("pitch-display");

const transposeSign = document.getElementById("transpose-sign");

const pitchSign = document.getElementById("pitch-sign");

const bpmInput = document.getElementById("bpm-value");

const enabledInput = document.getElementById("extension-enabled");



document.addEventListener("DOMContentLoaded", initialize);



async function initialize() {

  controllerWindowId = (await chrome.windows.getCurrent()).id;
  bindEvents();
  if (sidebarView) {
    chrome.tabs.onActivated.addListener(info => {
      if (info.windowId === controllerWindowId) {
        clearTimeout(applyTimer);
        window.location.reload();
      }
    });
    chrome.tabs.onUpdated.addListener((tabId, change) => {
      if (tabId === activeTab?.id && (change.url || change.status === "loading")) {
        clearTimeout(applyTimer);
        window.location.reload();
      }
    });
  }

  const stored = await chrome.storage.local.get(["preferences", "presets", "customPresets"]);

  preferences = stored.preferences || {};
  renderSeekButtons();
  renderFooterPreferences();

  applyTheme(preferences.themeMode);

  builtInPresets = stored.presets || [];
  customPresets = Array.isArray(stored.customPresets) ? stored.customPresets : [];
  renderPresets();



  const response = await send({ type: "GET_ACTIVE_STATE" });

  if (!response?.ok) {

    activeTab = response?.tab || null;
    showBlocked(response?.error);
    pollTimer = setInterval(refreshPageState, 750);
    window.addEventListener("unload", () => clearInterval(pollTimer));
    return;

  }



  activeTab = response.tab;

  mediaState = response.pageState;

  extensionEnabled = response.extensionEnabled !== false;



  const returningFromSettings = sessionStorage.getItem("tuneshift-return-from-settings") === "1";
  sessionStorage.removeItem("tuneshift-return-from-settings");
  const startingSettings = preferences.rememberSites !== false && preferences.autoApply !== false
    ? response.trackProfile?.settings || response.pageProfile?.settings || DEFAULTS
    : DEFAULTS;
  trackProfileActive = Boolean(response.trackProfile);
  renderTrackPreference();

  settings = normalize(returningFromSettings ? response.pageState?.settings || DEFAULTS : startingSettings);

  renderAll(response.pageState?.audioActive);

  renderEnabled();



  // Opening TuneShift always establishes the exact page's profile. Pages with

  // no saved record start neutral, including single-page-app navigations where

  // the previous URL's controller is still alive.

  if (extensionEnabled && !returningFromSettings) await applySettings(Boolean(response.pageState?.mediaCount));

  pollTimer = setInterval(refreshPageState, 750);

  window.addEventListener("unload", () => clearInterval(pollTimer));

}



function bindEvents() {
  document.getElementById("footer-sidebar").addEventListener("change", toggleSidebar);
  const tabEffectsMenu = document.getElementById("tab-effects-menu");
  document.addEventListener("click", event => {
    if (!tabEffectsMenu.contains(event.target)) tabEffectsMenu.open = false;
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && tabEffectsMenu.open) {
      tabEffectsMenu.open = false;
      document.getElementById("tab-effects-status").focus();
    }
  });
  document.getElementById("tab-effects-toggle").addEventListener("click", async () => {
    if (tabEffectsBusy) return;
    const stopping = Boolean(mediaState?.tabEffects?.active);
    tabEffectsBusy = true;
    renderStatus(mediaState?.audioActive);
    try {
      if (!stopping) {
        const granted = await chrome.permissions.request({ permissions: ["tabCapture"] });
        if (!granted) {
          showToast("Tab effects need capture permission.", true);
          return;
        }
      }
      const response = await send({ type: stopping ? "STOP_TAB_EFFECTS" : "START_TAB_EFFECTS", settings });
      if (!response?.ok) showToast(response?.error || "Could not change tab effects.", true);
      if (response?.pageState) mediaState = response.pageState;
      await refreshPageState();
    } catch (error) {
      showToast(error?.message || "Could not request tab capture.", true);
    } finally { tabEffectsBusy = false; renderAll(mediaState?.audioActive); }
  });

  document.getElementById("profiles-prev").addEventListener("click", () => { if (profilePage > 0) { profilePage--; renderPresetPage(); } });
  document.getElementById("profiles-next").addEventListener("click", () => { if ((profilePage + 1) * 7 < profileDefinitions.length) { profilePage++; renderPresetPage(); } });
  for (const [id, key] of [["footer-remember", "rememberSites"], ["footer-auto-apply", "autoApply"]]) {
    document.getElementById(id).addEventListener("change", event => {
      const value = event.target.checked;
      preferenceSave = preferenceSave.then(async () => {
        const stored = await chrome.storage.local.get("preferences");
        preferences = { ...(stored.preferences || {}), [key]: value };
        await chrome.storage.local.set({ preferences });
        renderFooterPreferences();
      }).catch(async () => {
        showToast("Could not save preference.", true);
        const stored = await chrome.storage.local.get("preferences").catch(() => ({}));
        preferences = stored.preferences || {};
        renderFooterPreferences();
      });
    });
  }
  document.getElementById("footer-track").addEventListener("change", toggleTrackProfile);
  document.getElementById("save-profile").addEventListener("click", () => openProfileDialog());
  document.getElementById("profile-cancel").addEventListener("click", () => document.getElementById("profile-dialog").close());
  document.getElementById("profile-confirm").addEventListener("click", saveCustomProfile);
  document.getElementById("profile-delete").addEventListener("click", deleteCustomProfile);
  document.getElementById("profile-name").addEventListener("keydown", event => { if (event.key === "Enter") saveCustomProfile(); });
  document.getElementById("edit-loop").addEventListener("click", openLoopDialog);
  document.getElementById("loop-cancel").addEventListener("click", () => document.getElementById("loop-dialog").close());
  document.getElementById("loop-confirm").addEventListener("click", saveExactLoop);
  for (const id of ["loop-edit-a", "loop-edit-b"]) document.getElementById(id).addEventListener("keydown", nudgeLoopInput);
  document.getElementById("bpm-half").addEventListener("click", () => correctBpm(0.5));
  document.getElementById("bpm-double").addEventListener("click", () => correctBpm(2));
  document.getElementById("cue-cancel").addEventListener("click", () => document.getElementById("cue-dialog").close());
  document.getElementById("cue-confirm").addEventListener("click", saveCueDialog);
  document.getElementById("cue-dialog").addEventListener("close", () => { editingCue = null; renderCues(); });
  document.getElementById("cue-edit-time").addEventListener("keydown", nudgeLoopInput);
  for (const id of ["cue-edit-name", "cue-edit-time"]) {
    document.getElementById(id).addEventListener("keydown", event => {
      if (event.key === "Enter") { event.preventDefault(); saveCueDialog(); }
    });
  }
  document.getElementById("paste-tuning").addEventListener("click", pasteTuning);
  document.getElementById("copy-tuning").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(JSON.stringify({ version: chrome.runtime.getManifest().version, settings }, null, 2)); showToast("Tuning copied."); }
    catch (_) { showToast("Could not copy tuning.", true); }
  });

  for (const element of document.querySelectorAll("#time-display, .deck-icon")) {
    for (const event of ["pointerenter", "focus"]) {
      element.addEventListener(event, () => {
        element.title = element.dataset.tooltip || element.title;
      });
    }
  }
  chrome.storage.onChanged?.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.preferences) {
      preferences = changes.preferences.newValue || {};
      renderSeekButtons();
      renderFooterPreferences();
    }
    if (changes.customPresets) {
      customPresets = Array.isArray(changes.customPresets.newValue) ? changes.customPresets.newValue : [];
      renderPresets();
    }
  });

  document.getElementById("time-display").addEventListener("click", () => {
    decimalTime = !decimalTime;
    renderPlaybackProgress();
    const display = document.getElementById("time-display");
    display.title = display.dataset.tooltip;
  });
  document.getElementById("site-icon").addEventListener("error", event => { event.currentTarget.hidden = true; });

  document.getElementById("refresh-media").addEventListener("click", reloadActiveTab);

  document.getElementById("repeat-mode").addEventListener("change", event => {

    settings.repeat = event.target.value;

    flushApply(true);

  });

  document.getElementById("toggle-loop").addEventListener("click", () => {

    settings.loopEnabled = !settings.loopEnabled;

    renderValues();

    flushApply(true);

  });

  document.getElementById("add-cue").addEventListener("click", async () => {

    await refreshPageState();

    const time = mediaState?.media?.currentTime;

    if (!Number.isFinite(time)) return showToast("Play media before adding a cue.");

    if (settings.cues.length >= 9) return showToast("You can save up to 9 cues per audio.");

    settings.cues.push({ time: round(time, 2), name: `Cue ${settings.cues.length + 1}` });

    settings.cues.sort((a, b) => a.time - b.time);

    renderCues();

    flushApply(true);

  });

  for (const [name, control] of Object.entries(controls)) {

    if (control.type === "checkbox") {

      control.addEventListener("change", () => {

        settings[name] = control.checked;

        renderValues();

        flushApply(true);

      });

      continue;

    }

    control.addEventListener("input", () => {

      settings[name] = Number(control.value);

      renderValues();

      scheduleApply(true);

    });

    control.addEventListener("change", () => flushApply(true));

  }



  document.querySelectorAll("[data-step]").forEach((button) => button.addEventListener("click", () => {

    const key = button.dataset.step;

    const input = controls[key];

    const next = clamp(round(Number(input.value) + Number(button.dataset.delta), 2), Number(input.min), Number(input.max));

    input.value = String(next);

    settings[key] = next;

    renderValues();

    flushApply(true);

  }));



  document.querySelectorAll("[data-reset]").forEach((button) => button.addEventListener("click", () => {

    const key = button.dataset.reset;

    settings[key] = DEFAULTS[key];

    controls[key].value = String(DEFAULTS[key]);

    renderValues();

    flushApply(true);

  }));



  document.getElementById("play-toggle").addEventListener("click", () => mediaAction("toggle"));

  document.getElementById("tap-bpm").addEventListener("click", tapBpm);
  document.getElementById("open-bpm-panel").addEventListener("click", () => {
    document.getElementById("speed-main-page").hidden = true;
    document.getElementById("speed-bpm-page").hidden = false;
    document.getElementById("open-bpm-panel").setAttribute("aria-expanded", "true");
    renderBpm();
    document.getElementById("close-bpm-panel").focus();
  });
  document.getElementById("close-bpm-panel").addEventListener("click", () => {
    document.getElementById("speed-bpm-page").hidden = true;
    document.getElementById("speed-main-page").hidden = false;
    document.getElementById("open-bpm-panel").setAttribute("aria-expanded", "false");
    document.getElementById("open-bpm-panel").focus();
  });

  document.getElementById("bpm-status-text").addEventListener("click", () => {
    document.getElementById("bpm-indicator").classList.remove("bpm-status-visible");
    document.getElementById("bpm-status-text").hidden = true;
    bpmInput.focus();
  });
  bpmInput.addEventListener("focus", () => {
    document.getElementById("bpm-indicator").classList.remove("bpm-status-visible");
    document.getElementById("bpm-status-text").hidden = true;

    cancelBpmEdit = false;

    const sourceBpm = Number(mediaState?.bpm?.value);

    bpmInput.value = Number.isFinite(sourceBpm) && sourceBpm > 0

      ? String(Math.round(sourceBpm * settings.speed))

      : "";

    bpmInput.select();

  });

  bpmInput.addEventListener("keydown", (event) => {

    if (event.key === "Enter") bpmInput.blur();

    if (event.key === "Escape") {

      cancelBpmEdit = true;

      bpmInput.blur();

    }

  });

  bpmInput.addEventListener("blur", () => {

    if (cancelBpmEdit) {

      cancelBpmEdit = false;

      renderBpm();

      return;

    }

    commitExactBpm();

  });

  document.querySelector('[data-seek="back"]').addEventListener("click", () => mediaAction("seek", -seekSeconds()));

  document.querySelector('[data-seek="forward"]').addEventListener("click", () => mediaAction("seek", seekSeconds()));

  document.getElementById("reset-all").addEventListener("click", () => {

    settings = normalize({ ...DEFAULTS, overlay: settings.overlay });

    renderAll(false);

    flushApply(true);

  });

  document.getElementById("set-loop-a").addEventListener("click", () => setLoop("A"));

  document.getElementById("set-loop-b").addEventListener("click", () => setLoop("B"));

  document.getElementById("clear-loop").addEventListener("click", clearLoop);

  document.getElementById("open-history").addEventListener("click", () => {

    window.location.href = sidebarView ? "history.html?sidebar=1" : "history.html";

  });

  document.getElementById("open-settings").addEventListener("click", () => { window.location.href = sidebarView ? "../options/options.html?embedded=1&sidebar=1" : "../options/options.html?embedded=1"; });

  enabledInput.addEventListener("change", toggleExtension);



  progress.addEventListener("pointerdown", () => { isSeeking = true; });

  progress.addEventListener("input", previewSeek);

  progress.addEventListener("change", commitSeek);

  progress.addEventListener("pointerup", commitSeek);

  progress.addEventListener("keydown", (event) => {

    if (["ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"].includes(event.key)) {

      isSeeking = true;

      requestAnimationFrame(commitSeek);

    }

  });

  transposeInput.parentElement.addEventListener("click", () => transposeInput.focus());

  transposeInput.addEventListener("focus", () => {

    transposeSign.classList.add("editing");

    transposeInput.value = String(settings.transpose);

    transposeInput.select();

  });

  transposeInput.addEventListener("keydown", (event) => {

    if (event.key === "Enter") transposeInput.blur();

    if (event.key === "Escape") {

      transposeInput.value = String(settings.transpose);

      transposeInput.blur();

    }

  });

  transposeInput.addEventListener("blur", commitExactTranspose);

  pitchInput.parentElement.addEventListener("click", () => pitchInput.focus());

  pitchInput.addEventListener("focus", () => {

    pitchSign.classList.add("editing");

    pitchInput.value = String(settings.pitch);

    pitchInput.select();

  });

  pitchInput.addEventListener("keydown", (event) => {

    if (event.key === "Enter") pitchInput.blur();

    if (event.key === "Escape") {

      pitchInput.value = String(settings.pitch);

      pitchInput.blur();

    }

  });

  pitchInput.addEventListener("blur", commitExactPitch);

}



async function toggleExtension() {

  const requested = enabledInput.checked;

  enabledInput.disabled = true;

  const response = await send({ type: "SET_EXTENSION_ENABLED", enabled: requested });

  enabledInput.disabled = false;

  if (!response?.ok) {

    enabledInput.checked = extensionEnabled;

    showToast(response?.error || "Could not change TuneShift state.", true);

    return;

  }

  extensionEnabled = response.extensionEnabled;

  if (response.pageState) mediaState = response.pageState;

  renderEnabled();

  renderStatus(mediaState?.audioActive);

  renderMedia();

  showToast(extensionEnabled ? "TuneShift is on." : "TuneShift is bypassed.");

}



function scheduleApply(persist) {

  clearTimeout(applyTimer);

  applyTimer = setTimeout(() => { applyTimer = null; applySettings(persist); }, 45);

}



function flushApply(persist) {

  clearTimeout(applyTimer);

  applyTimer = null;

  applySettings(persist);

}



async function applySettings(persist) {

  if (!extensionEnabled) return;

  const sequence = ++applySequence;

  pendingApplies += 1;
  const response = await send({ type: "APPLY_SETTINGS", settings, persist });
  pendingApplies -= 1;

  if (sequence !== applySequence) return;

  if (!response?.ok) {

    showToast(response?.error || "Could not apply controls.", true);

    return;

  }

  mediaState = response.pageState;

  extensionEnabled = response.extensionEnabled !== false;

  renderEnabled();

  renderStatus(response.audioActive);

  renderMedia();

  if (response.audioError && response.audioError !== lastShownAudioError) {

    lastShownAudioError = response.audioError;

    if (response.audioErrorCode === "DRM_PROTECTED") return;

    const recovery =

      response.audioErrorCode === "MEDIA_SOURCE_CONFLICT"

        ? { label: "Refresh tab", handler: reloadActiveTab }

        : null;

    showToast(response.audioError, true, recovery);

  }

}



function sameSettings(current, next) {
  for (const key of Object.keys(DEFAULTS)) {
    if (key === "cues") {
      if (current.cues.length !== next.cues.length || current.cues.some((cue, index) => cue.time !== next.cues[index].time || cue.name !== next.cues[index].name)) return false;
    } else if (current[key] !== next[key]) return false;
  }
  return true;
}

async function refreshPageState() {
  const beforePoll = applySequence;

  const response = await send({ type: "GET_ACTIVE_STATE" });

  if (!response?.ok) { showBlocked(response?.error); return; }
  document.querySelector(".app").classList.remove("page-blocked");
  document.getElementById("blocked-view").hidden = true;

  const changedPage = activeTab?.id !== response.tab?.id || activeTab?.url !== response.tab?.url;
  activeTab = response.tab;
  mediaState = response.pageState;
  trackProfileActive = Boolean(response.trackProfile);
  renderTrackPreference();

  if (changedPage) {
    settings = normalize(response.pageState?.settings || DEFAULTS);
    renderAll(response.pageState?.audioActive);
  } else if (response.pageState?.settings && beforePoll === applySequence && !pendingApplies && !applyTimer && !editingCue && !document.querySelector("input:focus")) {
    const nextSettings = normalize(response.pageState.settings);
    if (!sameSettings(settings, nextSettings)) {
      settings = nextSettings;
      renderAll(response.pageState?.audioActive);
    }
  }
  extensionEnabled = response.extensionEnabled !== false;
  renderEnabled();
  renderStatus(response.pageState?.audioActive);

  renderMedia();

}



async function mediaAction(action, seconds = 0, time = NaN) {

  const response = await send({ type: "MEDIA_ACTION", action, seconds, time });

  if (!response?.ok) return showToast(response?.error || "No media found.", true);

  mediaState = { ...mediaState, media: response.media };

  renderMedia();

}



function renderFooterPreferences() {
  renderTrackPreference();
  document.getElementById("footer-sidebar").checked = preferences.sidebarMode === true;
  document.getElementById("footer-remember").checked = preferences.rememberSites !== false;
  document.getElementById("footer-auto-apply").checked = preferences.autoApply !== false;
}

function renderTrackPreference() {
  const input = document.getElementById("footer-track");
  input.checked = trackProfileActive;
  input.disabled = preferences.rememberSites === false || !mediaState?.trackKey;
  input.closest("label").title = input.disabled ? "Play a track and enable Remember to save its tuning." : "Save separate tuning for this track";
}

async function toggleTrackProfile(event) {
  const input = event.currentTarget;
  input.disabled = true;
  const response = await send({ type: "SET_TRACK_PROFILE", enabled: input.checked, settings });
  if (!response?.ok) {
    input.checked = trackProfileActive;
    showToast(response?.error || "Could not save track tuning.", true);
  } else {
    trackProfileActive = response.active;
    showToast(trackProfileActive ? "Tuning saved for this track." : "Track tuning removed.");
  }
  renderTrackPreference();
}

function seekSeconds() {
  const step = Number(preferences.seekStep);
  return Number.isFinite(step) && step > 0 ? step : 10;
}

function renderSeekButtons() {
  const seconds = seekSeconds();
  for (const direction of ["back", "forward"]) {
    const button = document.querySelector(`[data-seek="${direction}"]`);
    button.querySelector("small").textContent = String(seconds);
    button.title = `${direction === "back" ? "Back" : "Forward"} ${seconds} seconds`;
    button.setAttribute("aria-label", button.title);
  }
}

function previewSeek() {

  isSeeking = true;

  const duration = mediaState?.media?.duration || 0;

  renderPlaybackProgress();

  updateRangeFill(progress);

}



function commitSeek() {

  if (!isSeeking) return;

  const duration = mediaState?.media?.duration || 0;

  const time = duration * (Number(progress.value) / 100);

  isSeeking = false;

  if (duration > 0) mediaAction("seekTo", 0, time);

}



function commitExactTranspose() {

  transposeSign.classList.remove("editing");

  const parsed = parseTransposeValue(transposeInput.value);

  if (!Number.isFinite(parsed)) {

    renderValues();

    showToast("Enter a whole transpose value from −12 to +12.", true);

    return;

  }

  settings.transpose = clamp(Math.round(parsed), -12, 12);

  controls.transpose.value = String(settings.transpose);

  renderValues();

  flushApply(true);

}



function commitExactPitch() {

  pitchSign.classList.remove("editing");

  const parsed = parseTransposeValue(pitchInput.value);

  if (!Number.isFinite(parsed)) {

    renderValues();

    showToast("Enter a pitch value from −1.00 to +1.00.", true);

    return;

  }

  settings.pitch = clamp(round(parsed, 2), -1, 1);

  controls.pitch.value = String(settings.pitch);

  renderValues();

  flushApply(true);

}



function parseTransposeValue(value) {

  return Number(String(value)

    .trim()

    .replace(/[−‒–—]/g, "-")

    .replace(",", "."));

}



async function setLoop(point) {

  const response = await send({ type: "SET_LOOP_POINT", point });

  if (!response?.ok) return showToast(response?.error || "Play media before setting a loop.", true);

  settings = normalize({ ...settings, ...response.settings });

  renderValues();

  await applySettings(true);

}



async function clearLoop() {

  const response = await send({ type: "CLEAR_LOOP" });

  if (response?.ok) {

    settings.loopA = null;

    settings.loopB = null;

    renderValues();

    await applySettings(true);

  }

}



function renderAll(audioActive) {

  for (const [key, control] of Object.entries(controls)) {

    if (control.type === "checkbox") control.checked = Boolean(settings[key]);

    else control.value = String(settings[key]);

  }

  renderValues();

  renderStatus(audioActive);

  renderMedia();

}



function renderEnabled() {
  renderTransportIndicators();

  enabledInput.checked = extensionEnabled;

  const app = document.querySelector(".app");

  app.classList.toggle("extension-off", !extensionEnabled);

  for (const section of app.querySelectorAll(".display-grid,.transport,.section,.studio")) {

    section.inert = !extensionEnabled;

  }

  const power = document.getElementById("power-switch");

  power.title = extensionEnabled ? "Turn TuneShift off" : "Turn TuneShift on";

  enabledInput.setAttribute("aria-label", extensionEnabled ? "Disable TuneShift" : "Enable TuneShift");

}



function applyTheme(mode) {

  document.documentElement.dataset.theme = mode === "light" ? "light" : "dark";
  sessionStorage.setItem("tuneshift-theme", document.documentElement.dataset.theme);

}



function renderValues() {
  renderTransportIndicators();
  renderActiveProfile();
  TuneShiftDropdowns.syncAll();

  const speedDisplay = document.getElementById("speed-value");

  renderDigitalSlots(speedDisplay, settings.speed.toFixed(2));

  speedDisplay.setAttribute("aria-label", `${settings.speed.toFixed(2)} times speed`);

  if (document.activeElement !== transposeInput) {

    const transpose = Math.round(settings.transpose);

    transposeSign.textContent = transpose < 0 ? "−" : "+";

    renderDigitalSlots(transposeDisplay, String(Math.abs(transpose)));

    transposeInput.value = String(Math.abs(transpose));

  }

  if (document.activeElement !== pitchInput) {

    const pitch = clamp(round(settings.pitch, 2), -1, 1);

    pitchSign.textContent = pitch < 0 ? "−" : pitch === 1 ? "+" : "";

    renderDigitalSlots(pitchDisplay, formatPitchDigits(pitch));

    pitchInput.value = formatPitchDigits(pitch);

  }

  document.getElementById("pitch-hz").textContent = pitchFrequency(settings.pitch).toFixed(1);

  document.getElementById("volume-value").textContent = `${Math.round(settings.volume)}%`;

  for (const key of ["subBass", "warmth", "air", "bass", "mid", "treble"]) document.getElementById(`${key}-value`).textContent = signed(settings[key]);

  document.getElementById("balance-value").textContent = balanceLabel(settings.balance);

  document.getElementById("loop-a-value").textContent = settings.loopA === null ? "--:--" : formatTime(settings.loopA);

  document.getElementById("loop-b-value").textContent = settings.loopB === null ? "--:--" : formatTime(settings.loopB);

  for (const control of document.querySelectorAll('input[type="range"]')) updateRangeFill(control);

  const loop = document.getElementById("toggle-loop");

  const validLoop = settings.loopA !== null && settings.loopB > settings.loopA;

  loop.disabled = !validLoop;

  loop.textContent = validLoop && settings.loopEnabled ? "Pause loop" : "Enable loop";

  loop.setAttribute("aria-pressed", String(validLoop && settings.loopEnabled));

  document.getElementById("repeat-mode").value = settings.repeat;
  TuneShiftDropdowns.syncAll();

  renderCues();

  renderBpm();

}



function nativeControlsOnly() {
  return Boolean(mediaState?.drmProtected || isDrmProtectedHost(activeTab?.host)) && !mediaState?.tabEffects?.active;
}

function renderStatus(audioActive) {
  TuneShiftDropdowns.syncAll();

  const protectedAudio = nativeControlsOnly();

  const tabEffects = mediaState?.tabEffects || {};
  const tabMenu = document.getElementById("tab-effects-menu");
  tabMenu.hidden = !(protectedAudio || tabEffects.active || tabEffects.error);
  if (tabMenu.hidden) tabMenu.open = false;
  document.getElementById("drm-note").hidden = tabMenu.hidden;
  const tabStatus = document.getElementById("tab-effects-status");
  tabStatus.classList.toggle("active", Boolean(tabEffects.active));
  tabStatus.classList.toggle("has-error", Boolean(tabEffects.error));
  const tabLabel = tabEffectsBusy ? "Tab effects: working..." : tabEffects.error
    ? `Tab effects: ${tabEffects.error}` : tabEffects.active
      ? (tabEffects.signalDetected ? "Tab effects active" : "Tab effects active: waiting for audio")
      : "Enable tab effects";
  tabStatus.title = tabLabel;
  tabStatus.setAttribute("aria-label", tabLabel);
  document.getElementById("drm-message").textContent = tabEffects.active
    ? (tabEffects.signalDetected ? "Tab effects active. Audio is processed locally." : "Tab effects active. Checking for audio...")
    : tabEffects.error || (mediaState?.mediaCount
      ? "Protected player. Enable tab effects for pitch, EQ and boost. Chrome may block some streams."
      : "Start playback, or refresh this tab to reconnect to the protected player.");
  const tabButton = document.getElementById("tab-effects-toggle");
  tabButton.textContent = tabEffectsBusy ? "Working..." : tabEffects.active ? "Stop tab effects" : "Enable tab effects";
  tabButton.disabled = tabEffectsBusy || !extensionEnabled || (!tabEffects.active && !mediaState?.mediaCount);
  tabButton.setAttribute("aria-pressed", String(Boolean(tabEffects.active)));

  for (const element of document.querySelectorAll(".transpose-card input,.transpose-card button,.pitch-card input,.pitch-card button,.studio input,#balance")) {

    element.disabled = protectedAudio;

    element.title = protectedAudio ? "Unavailable for protected audio" : "";

  }

  controls.volume.max = protectedAudio ? "100" : "200";

  controls.volume.value = String(Math.min(settings.volume, Number(controls.volume.max)));

  document.getElementById("volume-value").textContent = `${Math.round(Number(controls.volume.value))}%`;

  document.getElementById("volume-max-label").textContent = protectedAudio ? "Max" : "Boost";
  document.getElementById("volume-mid-label").textContent = protectedAudio ? "50%" : "100%";

  updateRangeFill(controls.volume);

  document.querySelectorAll(".preset").forEach(button => {

    button.disabled = protectedAudio && button.dataset.requiresDsp === "true";

  });

  renderActiveProfile();
  const status = document.getElementById("tab-status");

  const siteName = document.getElementById("site-name");
  const siteIcon = document.getElementById("site-icon");
  const favicon = activeTab?.favIconUrl || "";
  const safeFavicon = /^(https?:|data:image\/)/i.test(favicon) ? favicon : "";
  if (siteIcon.getAttribute("src") !== safeFavicon) {
    siteIcon.hidden = !safeFavicon;
    if (safeFavicon) siteIcon.src = safeFavicon;
    else siteIcon.removeAttribute("src");
  }


  status.classList.toggle("ready", extensionEnabled && Boolean(mediaState?.mediaCount));

  const tabTitle = String(activeTab?.title || "").trim();
  const label = tabTitle || activeTab?.host || activeTab?.url || "Current tab";
  const statusText = !extensionEnabled ? "Off" : mediaState?.mediaCount ? "Ready" : "Waiting for media";
  const headerText = `${label} · ${statusText}`;
  if (siteName.textContent !== headerText) siteName.textContent = headerText;
  siteName.title = label;

  const badge = document.getElementById("audio-badge");

  badge.textContent = tabEffects.active ? "Tab DSP" : audioActive ? "Local DSP" : "Native";

  badge.classList.toggle("active", Boolean(audioActive));

}



function renderMedia() {
  renderTransportIndicators();

  const media = mediaState?.media;

  renderBpm();

  const mediaCount = document.getElementById("media-count");
  const sourceCount = Number(mediaState?.mediaCount) || 0;
  mediaCount.hidden = sourceCount <= 1;
  mediaCount.textContent = sourceCount > 1 ? `${sourceCount} media sources` : "";

  if (!isSeeking) {



    progress.value = media?.duration ? String((media.currentTime / media.duration) * 100) : "0";

    updateRangeFill(progress);

  }

  renderPlaybackProgress();

  progress.disabled = !media?.duration;

  document.getElementById("play-toggle").classList.toggle("playing", media ? !media.paused : false);

}



// Indicators describe the selected playback settings, including while paused.
function renderTransportIndicators() {
  const ready = extensionEnabled && Boolean(mediaState?.mediaCount);
  const protectedAudio = nativeControlsOnly();
  const dsp = ready && !protectedAudio;
  const pitch = settings.transpose + settings.pitch;

  const selectedRepeatCount = ({ once: 1, twice: 2, five: 5 })[settings.repeat] || 0;
  document.getElementById("deck-repeat-count").toggleAttribute("hidden", !selectedRepeatCount);
  document.getElementById("deck-repeat-count-value").textContent = selectedRepeatCount ? String(selectedRepeatCount) : "";
  const repeatLabel = selectedRepeatCount ? `Repeat ${selectedRepeatCount} ${selectedRepeatCount === 1 ? "time" : "times"}` : "Repeat";
  const states = {
    loop: [ready && settings.loopEnabled && settings.loopA !== null && settings.loopB > settings.loopA, "A-B loop"],
    repeat: [ready && settings.repeat !== "off", repeatLabel],
    eq: [dsp && [settings.subBass, settings.warmth, settings.air, settings.bass, settings.mid, settings.treble].some(value => value !== 0), "EQ"],
    mono: [dsp && settings.mono, "Mono"]
  };
  for (const [id, [active, label]] of Object.entries(states)) {
    const icon = document.getElementById(`deck-${id}`);
    icon.classList.toggle("active", Boolean(active));
    queuePlaybackTooltip(icon, `${label}: ${active ? "on" : "off"}`);
    icon.setAttribute("aria-label", icon.dataset.tooltip);
  }
  const volume = document.getElementById("deck-max");
  const muted = ready && settings.volume === 0;
  volume.classList.toggle("is-muted", muted);
  volume.classList.toggle("voice-focus", dsp && settings.compressor);
  for (const threshold of [125, 150, 200]) volume.classList.toggle(`boost-${threshold}`, dsp && settings.volume >= threshold);
  queuePlaybackTooltip(volume, muted ? "Muted: output at 0%." : `Output: ${protectedAudio ? Math.min(settings.volume, 100) : settings.volume}%. Voice focus: ${dsp && settings.compressor ? "on" : "off"}. Bars: 125%, 150%, 200%.`);
  volume.setAttribute("aria-label", volume.dataset.tooltip);
  document.getElementById("deck-pitch").classList.toggle("transpose-only", settings.pitch === 0 && settings.transpose !== 0);
  for (const [id, value, available] of [["tempo", settings.speed - 1, ready], ["pitch", pitch, dsp]]) {
    const icon = document.getElementById(`deck-${id}`);
    icon.classList.toggle("lower", available && value < 0);
    icon.classList.toggle("higher", available && value > 0);
    queuePlaybackTooltip(icon, `${id === "tempo" ? "Tempo" : "Pitch"}: ${!available ? "inactive" : value < 0 ? "below original" : value > 0 ? "above original" : "original"}. ${id === "pitch" ? "Bottom: lower. Top: higher." : "Left: lower. Right: higher."}`);
    icon.setAttribute("aria-label", icon.dataset.tooltip);
  }
  const balance = document.getElementById("deck-balance");
  balance.classList.toggle("left-full", dsp && settings.balance === -1);
  balance.classList.toggle("right-full", dsp && settings.balance === 1);
  balance.classList.toggle("swapped", dsp && settings.swapChannels);
  queuePlaybackTooltip(balance, `Balance: ${dsp ? balanceLabel(settings.balance) : "Center"}. Channels swapped: ${dsp && settings.swapChannels ? "on" : "off"}. Arcs light at 100% left or right.`);
  balance.setAttribute("aria-label", balance.dataset.tooltip);
}

function playbackProgress() {
  const media = mediaState?.media;
  const duration = Number(media?.duration);
  const valid = Number.isFinite(duration) && duration > 0;
  const current = valid ? clamp(isSeeking ? duration * Number(progress.value) / 100 : Number(media?.currentTime) || 0, 0, duration) : 0;
  const percent = valid ? current / duration * 100 : 0;
  return { duration: valid ? duration : 0, current, percent, valid };
}

function formatDecimalTime(seconds) {
  const valid = Number.isFinite(seconds) && seconds >= 0;
  const unit = valid && seconds >= 3600 ? "hours" : "mins";
  const value = valid ? (seconds / (unit === "hours" ? 3600 : 60)).toFixed(2) : "--.--";
  return { value, unit, shadow: "8".repeat(Math.max(2, value.split(".")[0].length)) + ".88" };
}

function formatProgressPercent(percent, duration) {
  if (percent >= 100) return "100";
  // Truncate so only a completed track shows 100%.
  const places = duration > 3600 ? (percent < 10 ? 2 : 1) : 0;
  const scale = 10 ** places;
  return (Math.floor(percent * scale + 1e-9) / scale).toFixed(places);
}

// Snapshot native tooltip text on entry, not on each playback poll.
function queuePlaybackTooltip(element, text) {
  if (element.dataset.tooltip === undefined) element.title = text;
  if (element.dataset.tooltip !== text) element.dataset.tooltip = text;
}

function renderPlaybackProgress() {
  const { duration, current, percent, valid } = playbackProgress();
  const percentage = valid ? `${formatProgressPercent(percent, duration)}%` : "--%";
  const elapsed = `${formatTime(current)} / ${formatTime(duration)}`;
  const display = document.getElementById("time-display");
  display.classList.toggle("decimal-mode", decimalTime);
  display.classList.toggle("hours-mode", duration >= 3600);
  const decimal = formatDecimalTime(valid ? current : NaN);
  const decimalDisplay = document.getElementById("time-decimal");
  decimalDisplay.hidden = !decimalTime;
  const decimalDigits = document.getElementById("time-decimal-digits");
  decimalDigits.dataset.shadow = decimal.shadow;
  renderDigitalSlots(decimalDigits, decimal.value);
  document.getElementById("time-decimal-unit").textContent = decimal.unit;
  const decimalLabel = `${decimal.value} ${decimal.unit}`;
  queuePlaybackTooltip(display, valid ? (decimalTime ? elapsed : `${decimalLabel} elapsed`) : "Playback progress unavailable");
  display.setAttribute("aria-label", `${valid ? (decimalTime ? decimalLabel + " elapsed" : elapsed) : "Playback progress unavailable"}. Click to show ${decimalTime ? "elapsed and total time" : "decimal elapsed time"}.`);
  renderSegmentedTime(document.getElementById("current-time"), current, true);
  renderSegmentedTime(document.getElementById("duration"), duration, false);
  const indicator = document.getElementById("deck-progress");
  document.getElementById("deck-progress-value").textContent = `${valid ? Math.floor(percent) : 0}%`;
  indicator.querySelector(".progress-fill").setAttribute("stroke-dashoffset", String(100 - percent));
  indicator.querySelector(".progress-fill").style.visibility = valid && percent > 0 ? "visible" : "hidden";
  indicator.classList.toggle("active", extensionEnabled && valid && percent > 0);
  queuePlaybackTooltip(indicator, valid ? `${percentage} completed. ${elapsed}` : "Playback progress unavailable");
  indicator.setAttribute("aria-label", indicator.dataset.tooltip);
}

function renderBpm() {

  const bpm = mediaState?.bpm || {};

  const indicator = document.getElementById("bpm-indicator");

  const output = document.getElementById("bpm-value");

  const sourceBpm = Number(bpm.value);

  const effectiveBpm = Number.isFinite(sourceBpm) && sourceBpm > 0

    ? Math.round(sourceBpm * settings.speed)

    : null;

  if (document.activeElement !== output)

    output.value = effectiveBpm ? String(effectiveBpm) : "---";

  output.setAttribute("aria-label", effectiveBpm ? `${effectiveBpm} BPM at ${settings.speed.toFixed(2)} times speed` : "BPM unavailable");

  const preview = document.getElementById("speed-bpm-preview");
  preview.textContent = effectiveBpm ? String(effectiveBpm) : "---";
  preview.setAttribute("aria-label", effectiveBpm ? effectiveBpm + " BPM at " + settings.speed.toFixed(2) + " times speed" : "BPM unavailable");

  const statusText = document.getElementById("bpm-status-text");
  const detecting = bpm.status === "detecting" && document.activeElement !== output;
  const tapping = bpm.status === "tapping" && document.activeElement !== output;
  indicator.classList.toggle("detecting", detecting);
  const waiting = (!bpm.status || bpm.status === "idle") && !effectiveBpm && document.activeElement !== output;
  const failed = bpm.status === "failed" && document.activeElement !== output;
  indicator.classList.toggle("bpm-status-visible", detecting || tapping || waiting || failed);
  statusText.hidden = !detecting && !tapping && !waiting && !failed;
  statusText.textContent = tapping ? "Tap again" : waiting ? "Waiting..." : failed ? "Set BPM" : "Detecting...";

  document.getElementById("bpm-half").disabled = !Number.isFinite(sourceBpm) || sourceBpm < 60;
  document.getElementById("bpm-double").disabled = !Number.isFinite(sourceBpm) || sourceBpm > 150 || sourceBpm <= 0;

  indicator.title = bpm.status === "automatic"

    ? `Detected ${Math.round(sourceBpm)} BPM automatically. Current tempo is ${effectiveBpm} BPM${bpm.confidence ? ` at ${Math.round(bpm.confidence * 100)}% confidence` : ""}.`

    : bpm.status === "manual"

      ? `${bpm.source === "entry" ? "Manually entered tempo" : "Tap tempo"}. Current tempo is ${effectiveBpm} BPM.`

      : bpm.status === "failed"

        ? bpm.reason || "Automatic detection failed. Tap along with the beat."

        : bpm.status === "detecting"

          ? "Listening for the song tempo"

          : "Play a song to detect its tempo";

}



async function correctBpm(factor) {
  const current = Number(mediaState?.bpm?.value);
  const next = round(current * factor, 2);
  if (!Number.isFinite(next) || next < 30 || next > 300) return;
  const response = await send({ type: "SET_MANUAL_BPM", bpm: next, source: "entry" });
  if (!response?.ok) return showToast(response?.error || "Could not correct BPM.", true);
  tapTimes = [];
  mediaState = { ...mediaState, bpm: { value: next, status: "manual", source: "entry", confidence: 1 } };
  renderBpm();
  showToast(`Source BPM set to ${next}.`);
}

async function commitExactBpm() {

  const effectiveBpm = Number(String(bpmInput.value).trim().replace(",", "."));

  if (!Number.isFinite(effectiveBpm) || effectiveBpm < 20 || effectiveBpm > 600) {

    bpmInput.title = "Enter a BPM value from 20 to 600.";

    renderBpm();

    return;

  }

  const sourceBpm = round(clamp(effectiveBpm / settings.speed, 30, 300), 2);

  tapTimes = [];

  mediaState = { ...mediaState, bpm: { value: sourceBpm, status: "manual", source: "entry", confidence: 1 } };

  renderBpm();

  const response = await send({ type: "SET_MANUAL_BPM", bpm: sourceBpm, source: "entry" });

  bpmInput.title = response?.ok

    ? `${Math.round(effectiveBpm)} BPM at ${settings.speed.toFixed(2)} times speed.`

    : response?.error || "Could not set BPM.";

}



async function tapBpm() {

  const now = performance.now();

  if (tapTimes.length && now - tapTimes.at(-1) > 2500) tapTimes = [];

  tapTimes.push(now);

  tapTimes = tapTimes.slice(-9);

  const tapButton = document.getElementById("tap-bpm");

  tapButton.title = `${tapTimes.length} ${tapTimes.length === 1 ? "tap" : "taps"}. Keep tapping with the beat.`;

  if (tapTimes.length === 1) {
    mediaState = { ...mediaState, bpm: { value: null, status: "tapping", source: "tap", confidence: 0 } };
    renderBpm();
    await send({ type: "BEGIN_MANUAL_BPM" });

    return;

  }

  const intervals = tapTimes.slice(1).map((time, index) => time - tapTimes[index]).sort((a, b) => a - b);

  const middle = Math.floor(intervals.length / 2);

  const median = intervals.length % 2 ? intervals[middle] : (intervals[middle - 1] + intervals[middle]) / 2;

  const effectiveBpm = clamp(Math.round(60000 / median), 30, 300);

  const sourceBpm = round(clamp(effectiveBpm / settings.speed, 30, 300), 2);

  mediaState = { ...mediaState, bpm: { value: sourceBpm, status: "manual", source: "tap", confidence: 1 } };

  renderBpm();

  const response = await send({ type: "SET_MANUAL_BPM", bpm: sourceBpm, source: "tap" });

  tapButton.title = response?.ok

    ? `${tapTimes.length} taps. Current tempo is ${effectiveBpm} BPM.`

    : response?.error || "Could not set BPM.";

}



function renderSegmentedTime(element, seconds, highlightFilled) {

  const text = formatTime(seconds);
  const signature = `${text}:${highlightFilled}`;
  if (element.dataset.renderedTime === signature) return;
  element.dataset.renderedTime = signature;
  element.dataset.shadow = text.replace(/[0-9]/g, "8");

  const firstFilled = highlightFilled ? [...text].findIndex((char) => /[1-9]/.test(char)) : -1;

  const fragment = document.createDocumentFragment();

  [...text].forEach((char, index) => {

    const span = document.createElement("span");

    span.className = "time-char";

    if (firstFilled >= 0 && index >= firstFilled) span.classList.add("active");

    span.textContent = char;

    fragment.appendChild(span);

  });

  element.replaceChildren(fragment);

}



const PROFILE_KEYS = ["speed", "transpose", "pitch", "volume", "subBass", "warmth", "air", "swapChannels", "bass", "mid", "treble", "balance", "compressor", "mono"];

function profileSettings(source) {
  const normalized = normalize(source);
  return Object.fromEntries(PROFILE_KEYS.map(key => [key, normalized[key]]));
}

function openProfileDialog(profile = null) {
  editingProfileId = profile?.id || null;
  const dialog = document.getElementById("profile-dialog");
  document.getElementById("profile-dialog-title").textContent = profile ? "Edit Quick profile" : "Save Quick profile";
  document.getElementById("profile-name").value = profile?.name || "";
  document.getElementById("profile-error").textContent = "";
  document.getElementById("profile-delete").hidden = !profile;
  dialog.showModal();
  document.getElementById("profile-name").focus();
}

async function saveCustomProfile() {
  const name = document.getElementById("profile-name").value.trim();
  const error = document.getElementById("profile-error");
  if (!name) { error.textContent = "Enter a profile name."; return; }
  if (!editingProfileId && customPresets.length >= 20) { error.textContent = "You can save up to 20 profiles."; return; }
  const id = editingProfileId || `custom-${crypto.randomUUID()}`;
  const existing = customPresets.find(item => item.id === id);
  const entry = { id, name: name.slice(0, 24), custom: true, settings: existing?.settings || profileSettings(settings) };
  const next = editingProfileId ? customPresets.map(item => item.id === id ? entry : item) : [...customPresets, entry];
  try {
    await chrome.storage.local.set({ customPresets: next });
    customPresets = next;
    profilePage = Math.floor((profileDefinitions.length + (editingProfileId ? -1 : 0)) / 7);
    renderPresets();
    document.getElementById("profile-dialog").close();
    showToast(editingProfileId ? "Profile renamed." : "Quick profile saved.");
  } catch (_) { error.textContent = "Could not save this profile."; }
}

async function deleteCustomProfile() {
  const next = customPresets.filter(item => item.id !== editingProfileId);
  try {
    await chrome.storage.local.set({ customPresets: next });
    customPresets = next;
    renderPresets();
    document.getElementById("profile-dialog").close();
    showToast("Quick profile deleted.");
  } catch (_) { document.getElementById("profile-error").textContent = "Could not delete this profile."; }
}

async function pasteTuning() {
  try {
    const parsed = JSON.parse(await navigator.clipboard.readText());
    if (!parsed || !parsed.settings || typeof parsed.settings !== "object" || Array.isArray(parsed.settings)) throw new Error();
    const incoming = parsed.settings;
    if (!Object.keys(DEFAULTS).some(key => Object.hasOwn(incoming, key))) throw new Error();
    for (const key of Object.keys(DEFAULTS).filter(key => typeof DEFAULTS[key] === "number")) {
      if (Object.hasOwn(incoming, key) && !Number.isFinite(Number(incoming[key]))) throw new Error();
    }
    for (const key of ["loopA", "loopB"]) {
      if (incoming[key] !== undefined && incoming[key] !== null && (!Number.isFinite(Number(incoming[key])) || Number(incoming[key]) < 0)) throw new Error();
    }
    const merged = normalize({ ...settings, ...incoming });
    const duration = Number(mediaState?.media?.duration);
    if (merged.loopA !== null && merged.loopB !== null &&
        (merged.loopB <= merged.loopA || (Number.isFinite(duration) && duration > 0 && merged.loopB > duration))) throw new Error();
    settings = merged;
    renderAll(false);
    flushApply(true);
    showToast("Tuning pasted.");
  } catch (_) { showToast("Clipboard has no valid TuneShift tuning.", true); }
}

function formatExactLoop(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "";
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${(seconds % 60).toFixed(2).padStart(5, "0")}`;
}

function parseExactLoop(text) {
  const parts = String(text).trim().split(":");
  if (parts.length > 3 || !parts.length || parts.some(part => !/^\d+(?:\.\d+)?$/.test(part))) return NaN;
  return parts.reduce((total, part) => total * 60 + Number(part), 0);
}

function openLoopDialog() {
  const current = Number(mediaState?.media?.currentTime) || 0;
  document.getElementById("loop-edit-a").value = formatExactLoop(settings.loopA ?? current);
  document.getElementById("loop-edit-b").value = formatExactLoop(settings.loopB ?? current + 10);
  document.getElementById("loop-error").textContent = "";
  document.getElementById("loop-dialog").showModal();
  document.getElementById("loop-edit-a").focus();
}

function nudgeLoopInput(event) {
  if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
  event.preventDefault();
  const current = parseExactLoop(event.currentTarget.value);
  const next = Math.max(0, (Number.isFinite(current) ? current : 0) + (event.key === "ArrowUp" ? .1 : -.1));
  event.currentTarget.value = formatExactLoop(round(next, 2));
}

async function saveExactLoop() {
  const a = parseExactLoop(document.getElementById("loop-edit-a").value);
  const b = parseExactLoop(document.getElementById("loop-edit-b").value);
  const duration = Number(mediaState?.media?.duration);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b <= a || (Number.isFinite(duration) && duration > 0 && b > duration)) {
    document.getElementById("loop-error").textContent = "Enter A before B, within this track.";
    return;
  }
  const response = await send({ type: "SET_LOOP_TIMES", a: round(a, 2), b: round(b, 2) });
  if (!response?.ok) { document.getElementById("loop-error").textContent = response?.error || "Could not set loop points."; return; }
  settings = normalize({ ...settings, ...response.settings });
  document.getElementById("loop-dialog").close();
  renderValues();
  await applySettings(true);
}

function renderPresets() {
  profileDefinitions = [{ id: "neutral", name: "Neutral", settings: DEFAULTS }, ...builtInPresets, ...customPresets];
  profilePage = Math.min(profilePage, Math.max(0, Math.ceil(profileDefinitions.length / 7) - 1));
  renderPresetPage();
}

function renderPresetPage() {
  const row = document.getElementById("preset-row");
  row.replaceChildren();
  const icons = { neutral: "smile", lecture: "graduation-cap", podcast: "mic", deep: "moon-star", bright: "sun", dreamy: "cloud-moon", practice: "turtle", velvet: "cloud-moon", sparkle: "sun", cinema: "audio-lines", lofi: "moon-star", radio: "mic", night: "sliders-horizontal", mirror: "repeat" };
  for (const preset of profileDefinitions.slice(profilePage * 7, profilePage * 7 + 7)) {
    const button = document.createElement("button");
    button.className = "preset";
    button.dataset.profile = preset.id;
    button.append(makeIcon(icons[preset.id] || "smile"), document.createTextNode(preset.name));
    button.dataset.requiresDsp = String(Boolean(preset.requiresDsp || preset.settings.transpose || preset.settings.pitch));
    button.disabled = Boolean(nativeControlsOnly() && button.dataset.requiresDsp === "true");
    button.addEventListener("click", () => applyPreset(preset.settings));
    if (preset.custom) {
      const wrap = document.createElement("div");
      wrap.className = "preset-wrap";
      const edit = document.createElement("button");
      edit.className = "preset-edit";
      edit.type = "button";
      edit.title = `Edit ${preset.name}`;
      edit.setAttribute("aria-label", edit.title);
      edit.textContent = "✎";
      edit.addEventListener("click", () => openProfileDialog(preset));
      wrap.append(button, edit);
      row.appendChild(wrap);
    } else row.appendChild(button);
  }
  const pages = Math.max(1, Math.ceil(profileDefinitions.length / 7));
  document.getElementById("profile-page").textContent = `${profilePage + 1}/${pages}`;
  document.getElementById("profiles-prev").disabled = profilePage === 0;
  document.getElementById("profiles-next").disabled = profilePage >= pages - 1;
  renderActiveProfile();
}

function profileValues(preset) {
  const native = nativeControlsOnly();
  return normalize({ ...DEFAULTS, ...preset, ...(native ? { transpose: 0, pitch: 0, subBass: 0, warmth: 0, air: 0, swapChannels: false, bass: 0, mid: 0, treble: 0, balance: 0, mono: false, compressor: false, volume: Math.min(preset.volume ?? 100, 100) } : {}) });
}

function renderActiveProfile() {
  const keys = ["speed", "transpose", "pitch", "volume", "subBass", "warmth", "air", "swapChannels", "bass", "mid", "treble", "balance", "compressor", "mono"];
  let matched = false;
  for (const button of document.querySelectorAll(".preset[data-profile]")) {
    const profile = profileDefinitions.find(item => item.id === button.dataset.profile);
    const values = profile ? profileValues(profile.settings) : null;
    const active = !matched && !button.disabled && values && keys.every(key => typeof values[key] === "boolean" ? values[key] === settings[key] : Math.abs(values[key] - settings[key]) < 0.0001);
    button.classList.toggle("is-active", Boolean(active));
    button.setAttribute("aria-pressed", String(Boolean(active)));
    if (active) matched = true;
  }
}

function applyPreset(preset) {
  const values = profileValues(preset);
  settings = normalize({ ...DEFAULTS, ...values, loopA: settings.loopA, loopB: settings.loopB, loopEnabled: settings.loopEnabled, repeat: settings.repeat, cues: settings.cues, overlay: settings.overlay });

  renderAll(false);

  flushApply(true);

}



function showBlocked(error) {

  document.querySelector(".app").classList.add("page-blocked");

  const view = document.getElementById("blocked-view");

  view.hidden = false;

  if (error) view.querySelector("p").textContent = error;

}



let toastTimer;

function showToast(message, isError = false, action = null) {

  const toast = document.getElementById("toast");

  document.getElementById("toast-message").textContent = message;

  const actionButton = document.getElementById("toast-action");

  actionButton.hidden = !action;

  actionButton.textContent = action?.label || "";

  actionButton.onclick = action?.handler || null;

  toast.classList.toggle("error", isError);

  toast.classList.add("visible");

  clearTimeout(toastTimer);

  toastTimer = setTimeout(() => toast.classList.remove("visible"), action ? 9000 : 3200);

}



async function reloadActiveTab() {

  await send({ type: "RELOAD_ACTIVE_TAB" });

  window.close();

}



async function send(message) {

  try { return await chrome.runtime.sendMessage({ ...message, windowId: controllerWindowId, expectedTabId: activeTab?.id }); }

  catch (error) { return { ok: false, error: error?.message || String(error) }; }

}



function updateRangeFill(control) {

  const min = Number(control.min);

  const max = Number(control.max);

  const value = Number(control.value);

  const percent = ((value - min) / (max - min)) * 100;

  control.style.setProperty("--fill", `${percent}%`);

}



function normalize(input = {}) {

  const legacyPitch = input.transpose === undefined ? number(input.pitch, 0) : 0;

  const rawPitch = input.transpose === undefined ? 0 : number(input.pitch, 0);

  return {

    speed: clamp(number(input.speed, 1), 0.25, 4),

    transpose: clamp(Math.round(input.transpose === undefined ? legacyPitch : number(input.transpose, 0)), -12, 12),

    pitch: clamp(Math.abs(rawPitch) > 1 ? rawPitch / 100 : rawPitch, -1, 1),

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

    loopA: input.loopA === null || input.loopA === undefined ? null : Number(input.loopA),

    loopB: input.loopB === null || input.loopB === undefined ? null : Number(input.loopB),

    repeat: ["off", "track", "once", "twice", "five"].includes(input.repeat) ? input.repeat : "off",

    loopEnabled: input.loopEnabled !== false,

    cues: Array.isArray(input.cues) ? input.cues.filter(c => Number.isFinite(c?.time) && c.time >= 0).slice(0, 9).map(c => ({ time: c.time, name: String(c.name || "Cue").slice(0, 40) })) : [],

    overlay: Boolean(input.overlay)

  };

}



function balanceLabel(value) {

  if (Math.abs(value) < 0.01) return "Center";

  return `${value < 0 ? "L" : "R"} ${Math.round(Math.abs(value) * 100)}`;

}



function isDrmProtectedHost(hostname = "") {

  return /(^|\.)spotify\.com$/.test(hostname);

}



function signed(value) {

  return `${value > 0 ? "+" : ""}${value}`;

}



function formatTranspose(value) {

  const rounded = Math.round(value);

  return `${rounded >= 0 ? "+" : "−"}${Math.abs(rounded)}`;

}



function formatPitch(value) {

  const rounded = clamp(round(value, 2), -1, 1);

  if (Math.abs(rounded) === 1) return `${rounded > 0 ? "+" : "-"}1.00`;

  const fraction = String(Math.round(Math.abs(rounded) * 100)).padStart(2, "0");

  return `${rounded < 0 ? "-" : ""}.${fraction}`;

}



function formatPitchDigits(value) {

  const rounded = clamp(round(Math.abs(value), 2), 0, 1);

  if (rounded === 1) return "1.00";

  return `.${String(Math.round(rounded * 100)).padStart(2, "0")}`;

}



function pitchFrequency(value) {

  return 440 * (2 ** (clamp(number(value, 0), -1, 1) / 12));

}



function renderDigitalSlots(element, value) {

  const shadow = element.dataset.shadow || "";

  const live = String(value).padStart(shadow.length, " ").slice(-shadow.length);

  if (element.children.length !== shadow.length) {

    element.replaceChildren(...[...shadow].map((ghost) => {

      const slot = document.createElement("span");

      slot.className = "segment-slot";

      slot.dataset.ghost = ghost;

      slot.setAttribute("aria-hidden", "true");

      return slot;

    }));

  }

  [...element.children].forEach((slot, index) => {

    slot.dataset.live = live[index] === " " ? "" : live[index];

  });

  element.dataset.value = String(value);

}



function formatTime(seconds) {

  if (!Number.isFinite(seconds) || seconds < 0) return "00:00";

  const rounded = Math.floor(seconds);

  const hours = Math.floor(rounded / 3600);

  const minutes = Math.floor((rounded % 3600) / 60);

  const secs = rounded % 60;

  return hours

    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`

    : `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;

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



function makeIcon(name) {

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");

  svg.classList.add("ui-icon");

  svg.setAttribute("aria-hidden", "true");

  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");

  use.setAttribute("href", `#icon-${name}`);

  svg.append(use);

  return svg;

}



function renderCues() {

  const list = document.getElementById("cue-list");
  document.getElementById("add-cue").disabled = settings.cues.length >= 9;
  if (editingCue !== null && document.getElementById("cue-dialog").open) return;
  editingCue = null;
  const signature = JSON.stringify(settings.cues);
  if (list.dataset.cues === signature) return;
  list.dataset.cues = signature;
  list.replaceChildren();

  if (!settings.cues.length) {

    const hint = document.createElement("small");

    hint.textContent = "Save a moment, then jump back to it.";

    list.append(hint);

  }

  settings.cues.forEach((cue, index) => {

    const row = document.createElement("div");

    row.className = "cue-item";

    const jump = document.createElement("button");

    jump.className = "cue-jump";
    const name = document.createElement("span"); name.className = "cue-name"; name.textContent = cue.name;
    const time = document.createElement("span"); time.className = "cue-time"; time.textContent = formatTime(cue.time);
    jump.append(name, time);
    jump.setAttribute("aria-label", `${cue.name}, jump to ${formatTime(cue.time)}`);

    jump.title = `Jump to ${formatTime(cue.time)}`;

    jump.addEventListener("click", async () => {
      const cue = settings.cues[index];

      // A cue outside the loop must stay at its requested timestamp.

      if (settings.loopEnabled && settings.loopA !== null && settings.loopB > settings.loopA && (cue.time < settings.loopA || cue.time >= settings.loopB)) {

        settings.loopEnabled = false;

        await applySettings(true);

        renderValues();

      }

      await mediaAction("seekTo", 0, cue.time);

    });

    const edit = document.createElement("button");
    edit.append(makeIcon("pencil"));
    edit.setAttribute("aria-label", `Edit ${cue.name}`);
    edit.addEventListener("click", () => {
      const cue = settings.cues[index];
      editingCue = cue;
      openCueDialog(cue);
    });
    const remove = document.createElement("button");
    remove.append(makeIcon("x"));

    remove.setAttribute("aria-label", `Remove ${cue.name}`);

    remove.addEventListener("click", () => {

      settings.cues.splice(index, 1);

      renderCues();

      flushApply(true);

    });

    row.append(jump, edit, remove);

    list.append(row);

  });

}


function parseCueTime(text) {
  const value = text.trim();
  if (!/^\d+(?::[0-5]?\d){0,2}(?:\.\d{1,3})?$/.test(value)) return NaN;
  return value.split(":").reduce((total, part) => total * 60 + Number(part), 0);
}
function openCueDialog(cue) {
  editingCue = cue;
  document.getElementById("cue-edit-name").value = cue.name;
  document.getElementById("cue-edit-time").value = formatExactLoop(cue.time);
  document.getElementById("cue-error").textContent = "";
  document.getElementById("cue-dialog").showModal();
  document.getElementById("cue-edit-name").focus();
  document.getElementById("cue-edit-name").select();
}

function saveCueDialog() {
  const name = document.getElementById("cue-edit-name");
  const time = document.getElementById("cue-edit-time");
  const error = document.getElementById("cue-error");
  const seconds = parseCueTime(time.value);
  const duration = Number(mediaState?.media?.duration);
  if (!name.value.trim()) { error.textContent = "Enter a cue name."; name.focus(); return; }
  if (!Number.isFinite(seconds) || seconds < 0 || (Number.isFinite(duration) && duration > 0 && seconds > duration)) {
    error.textContent = "Enter a timestamp within this track."; time.focus(); return;
  }
  const index = settings.cues.indexOf(editingCue);
  if (index < 0) { document.getElementById("cue-dialog").close(); return; }
  settings.cues[index] = { name: name.value.trim(), time: round(seconds, 3) };
  settings.cues.sort((a, b) => a.time - b.time);
  document.getElementById("cue-dialog").close();
  flushApply(true);
}


async function toggleSidebar(event) {
  const input = event.target;
  const enabled = input.checked;
  input.disabled = true;
  try {
    // Call open before any await so Chrome retains this click's user gesture.
    if (enabled) await chrome.sidePanel.open({ windowId: controllerWindowId });
    const response = await send({ type: "SET_SIDEBAR_MODE", enabled });
    if (!response?.ok) throw new Error(response?.error || "Could not change sidebar mode.");
    preferences.sidebarMode = enabled;
    renderFooterPreferences();
    if (enabled && !sidebarView) window.close();
    if (!enabled && sidebarView) {
      if (chrome.sidePanel.close) await chrome.sidePanel.close({ windowId: controllerWindowId });
      else window.close();
    }
  } catch (error) {
    input.checked = preferences.sidebarMode === true;
    showToast(error.message || "Could not change sidebar mode.", true);
  } finally { input.disabled = false; }
}
