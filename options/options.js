const DEFAULT_PREFS = { rememberSites: true, autoApply: true, speedStep: 0.1, seekStep: 10, showBadge: true, themeMode: "dark" };
let saveTimer;
let preferenceSave = Promise.resolve();

document.addEventListener("DOMContentLoaded", async () => {
  const back = document.getElementById("settings-back");
  back.hidden = !new URLSearchParams(location.search).has("embedded");
  back.addEventListener("click", async () => {
    await preferenceSave;
    sessionStorage.setItem("tuneshift-return-from-settings", "1");
    window.location.href = new URLSearchParams(location.search).has("sidebar") ? "../popup/popup.html?sidebar=1" : "../popup/popup.html";
  });
  const stored = await chrome.storage.local.get("preferences");
  const preferences = { ...DEFAULT_PREFS, ...(stored.preferences || {}) };
  applyTheme(preferences.themeMode);

  for (const id of ["rememberSites", "autoApply", "showBadge"]) {
    const input = document.getElementById(id);
    input.checked = Boolean(preferences[id]);
    input.addEventListener("change", savePreferences);
  }
  for (const id of ["speedStep", "seekStep", "themeMode"]) {
    const select = document.getElementById(id);
    select.value = String(preferences[id]);
    select.addEventListener("change", event => {
      if (id === "themeMode") applyTheme(select.value);
      savePreferences(event);
    });
  }

  document.getElementById("shortcuts").addEventListener("click", () => chrome.tabs.create({ url: "chrome://extensions/shortcuts" }));
  TuneShiftDropdowns.syncAll();
});

async function savePreferences(event) {
  const values = {
    rememberSites: document.getElementById("rememberSites").checked,
    autoApply: document.getElementById("autoApply").checked,
    showBadge: document.getElementById("showBadge").checked,
    themeMode: document.getElementById("themeMode").value,
    speedStep: Number(document.getElementById("speedStep").value),
    seekStep: Number(document.getElementById("seekStep").value)
  };
  const key = event?.target?.id;
  const changes = key && key in values ? { [key]: values[key] } : values;
  preferenceSave = preferenceSave.then(async () => {
    const { preferences = {} } = await chrome.storage.local.get("preferences");
    await chrome.storage.local.set({ preferences: { ...preferences, ...changes } });
    showSaved();
  }).catch(() => {
    const state = document.getElementById("save-state");
    state.textContent = "Could not save settings. Try again.";
    state.classList.add("visible");
  });
  return preferenceSave;
}

function applyTheme(mode) {
  document.documentElement.dataset.theme = mode === "light" ? "light" : "dark";
  sessionStorage.setItem("tuneshift-theme", document.documentElement.dataset.theme);
}

function showSaved() {
  const state = document.getElementById("save-state");
  state.textContent = "Settings saved";
  state.classList.add("visible");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => state.classList.remove("visible"), 1800);
}
