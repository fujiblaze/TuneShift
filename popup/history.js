let pageProfiles = {};
let activeTab = null;
let savedBpmCount = 0;
let savedTrackCount = 0;

document.addEventListener("DOMContentLoaded", initializeHistory);

async function initializeHistory() {
  const stored = await chrome.storage.local.get(null);
  pageProfiles = stored.pageProfiles || {};
  savedBpmCount = Object.keys(stored).filter(key => key.startsWith("bpm:")).length;
  savedTrackCount = Object.keys(stored.trackProfiles || {}).length;
  document.documentElement.dataset.theme = stored.preferences?.themeMode === "light" ? "light" : "dark";
  sessionStorage.setItem("tuneshift-theme", document.documentElement.dataset.theme);
  [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  document.getElementById("history-back").addEventListener("click", () => {
    window.location.href = new URLSearchParams(location.search).has("sidebar") ? "popup.html?sidebar=1" : "popup.html";
  });
  document.getElementById("clear-history").addEventListener("click", clearHistory);
  renderHistory();
}

function renderHistory() {
  const list = document.getElementById("history-list");
  const entries = Object.entries(pageProfiles)
    .filter(([, profile]) => profile?.url)
    .sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0));
  document.getElementById("history-count").textContent = String(entries.length).padStart(2, "0");
  document.getElementById("clear-history").hidden = entries.length === 0 && savedBpmCount === 0 && savedTrackCount === 0;
  list.replaceChildren();

  if (!entries.length) {
    const empty = document.createElement("div");
    empty.className = "history-empty";
    const icon = document.createElement("span");
    icon.innerHTML = '<svg aria-hidden="true"><use href="#icon-list-music"></use></svg>';
    const title = document.createElement("h2");
    title.textContent = "No saved audio pages";
    const copy = document.createElement("p");
    copy.textContent = "Adjust TuneShift on a page with media and its tuning will appear here.";
    empty.append(icon, title, copy);
    list.appendChild(empty);
    return;
  }

  const currentKey = pageKey(activeTab?.url);
  for (const [key, profile] of entries) list.appendChild(createHistoryItem(key, profile, key === currentKey));
}

function createHistoryItem(key, profile, isCurrent) {
  const item = document.createElement("article");
  item.className = `history-item${isCurrent ? " current" : ""}`;
  const open = document.createElement("button");
  open.className = "history-open";
  open.type = "button";
  open.title = `Open ${profile.title || profile.url}`;

  const titleRow = document.createElement("span");
  titleRow.className = "history-title-row";
  const title = document.createElement("span");
  title.className = "history-title";
  title.textContent = profile.title || profile.host || "Audio page";
  const external = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  external.classList.add("history-open-icon");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", "#icon-external-link");
  external.appendChild(use);
  titleRow.append(title, external);

  const url = document.createElement("span");
  url.className = "history-url";
  url.textContent = compactUrl(profile.url);

  const values = document.createElement("span");
  values.className = "history-values";
  const settings = profile.settings || profile;
  values.append(
    createValue("Speed", `${Number(settings.speed || 1).toFixed(2)}×`, "speed"),
    createValue("Transpose", signedInteger(settings.transpose), "transpose"),
    createValue("Pitch", formatPitch(settings.pitch), "pitch")
  );
  open.append(titleRow, url, values);
  open.addEventListener("click", async () => {
    if (activeTab?.id) await chrome.tabs.update(activeTab.id, { url: profile.url });
    else await chrome.tabs.create({ url: profile.url });
    window.close();
  });

  const remove = document.createElement("button");
  remove.className = "history-remove";
  remove.type = "button";
  remove.title = `Remove ${profile.title || profile.url}`;
  remove.setAttribute("aria-label", remove.title);
  remove.innerHTML = '<svg aria-hidden="true"><use href="#icon-trash"></use></svg>';
  remove.addEventListener("click", async () => {
    const result = await chrome.runtime.sendMessage({ type: "DELETE_SAVED_PAGE", url: key });
    if (!result?.ok) return;
    delete pageProfiles[key];
    const stored = await chrome.storage.local.get(null);
    savedBpmCount = Object.keys(stored).filter(item => item.startsWith("bpm:")).length;
    savedTrackCount = Object.keys(stored.trackProfiles || {}).length;
    renderHistory();
  });

  item.append(open, remove);
  return item;
}

function createValue(label, value, className) {
  const cell = document.createElement("span");
  cell.className = `history-value ${className}`;
  const name = document.createElement("small");
  name.textContent = label;
  const display = document.createElement("b");
  display.textContent = value;
  cell.append(name, display);
  return cell;
}

async function clearHistory() {
  const result = await chrome.runtime.sendMessage({ type: "CLEAR_SAVED_HISTORY" });
  if (!result?.ok) return;
  pageProfiles = {};
  savedBpmCount = 0;
  savedTrackCount = 0;
  renderHistory();
}

function pageKey(url = "") {
  try {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol) && parsed.protocol !== "file:") return "";
    parsed.hash = "";
    return parsed.href;
  } catch (_) {
    return "";
  }
}

function compactUrl(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname || "local file"}${parsed.pathname === "/" ? "" : parsed.pathname}${parsed.search}`;
  } catch (_) {
    return url;
  }
}

function signedInteger(value) {
  const rounded = Math.round(Number(value) || 0);
  return `${rounded > 0 ? "+" : rounded < 0 ? "−" : ""}${Math.abs(rounded)}`;
}

function formatPitch(value) {
  const rounded = Math.max(-1, Math.min(1, Math.round((Number(value) || 0) * 100) / 100));
  if (Math.abs(rounded) === 1) return `${rounded > 0 ? "+" : "−"}1.00`;
  return `${rounded < 0 ? "−" : ""}.${String(Math.round(Math.abs(rounded) * 100)).padStart(2, "0")}`;
}
