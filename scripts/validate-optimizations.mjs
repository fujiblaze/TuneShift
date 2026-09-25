import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const popup = fs.readFileSync("popup/popup.js", "utf8");
const content = fs.readFileSync("content/content.js", "utf8");
const pollingCode = popup.slice(popup.indexOf("function sameSettings("), popup.indexOf("async function mediaAction("));
assert.match(pollingCode, /function sameSettings/);
const counts = { full: 0, media: 0 };
const response = { ok: true, tab: { id: 1, url: "https://example.com/one" },
  pageState: { settings: { speed: 1, cues: [] }, mediaCount: 1 }, trackProfile: null, extensionEnabled: true };
const popupContext = vm.createContext({
  DEFAULTS: { speed: 1, cues: [] }, settings: { speed: 1, cues: [] },
  activeTab: { id: 1, url: "https://example.com/one" }, mediaState: null,
  applySequence: 0, pendingApplies: 0, applyTimer: null, editingCue: null,
  extensionEnabled: true, trackProfileActive: false,
  send: async () => structuredClone(response),
  normalize: value => structuredClone(value),
  renderAll: () => { counts.full++; }, renderMedia: () => { counts.media++; },
  renderTrackPreference() {}, renderEnabled() {}, renderStatus() {}, showBlocked() {},
  document: {
    querySelector(selector) { return selector === ".app" ? { classList: { remove() {} } } : null; },
    getElementById() { return { hidden: false }; }
  }
});
vm.runInContext(`${pollingCode}; this.refreshPageState = refreshPageState`, popupContext);
await popupContext.refreshPageState();
await popupContext.refreshPageState();
assert.deepEqual(counts, { full: 0, media: 2 }, "unchanged polls update playback without rebuilding controls");
response.pageState.settings.speed = 1.5;
await popupContext.refreshPageState();
assert.equal(counts.full, 1, "changed settings rebuild controls once");
await popupContext.refreshPageState();
assert.equal(counts.full, 1, "next unchanged poll skips the rebuild");
response.tab.url = "https://example.com/two";
await popupContext.refreshPageState();
assert.equal(counts.full, 2, "page changes still rebuild controls");

const overlayCode = content.slice(content.indexOf("function clearOverlaySeekTime()"), content.indexOf("function hideOverlay()"));
assert.match(overlayCode, /function updateOverlayProgress/);
let iconWrites = 0;
let timerId = 0;
const seekTimers = new Map();
const progress = { disabled: false, value: "0", style: { setProperty() {} }, title: "" };
const toggle = { dataset: {}, set innerHTML(value) { iconWrites++; this.html = value; }, get innerHTML() { return this.html; } };
const value = { dataset: {}, querySelector(selector) { return selector === ".digits" ? this.digits : this.unit; },
  digits: { textContent: "", dataset: {} }, unit: { textContent: "" } };
const button = () => ({ title: "", setAttribute() {} });
const nodes = { ".progress": progress, ".value": value, ".bar": { dataset: {} },
  '[data-action="mode"]': button(), '[data-action="down"]': button(),
  '[data-action="up"]': button(), '[data-action="toggle"]': toggle,
  '[data-action="back"]': button(), '[data-action="forward"]': button() };
const media = { duration: 100, currentTime: 10, paused: false };
const overlayContext = vm.createContext({
  overlayHost: { isConnected: true, shadowRoot: { querySelector: selector => nodes[selector] } },
  overlaySeekMedia: null, overlaySeekTimer: null,
  setTimeout(callback, delay) { assert.equal(delay, 3000); seekTimers.set(++timerId, callback); return timerId; },
  clearTimeout(id) { seekTimers.delete(id); },
  activeMedia: media, overlaySeeking: false, overlayMode: "speed", overlaySeekStep: 10,
  settings: { speed: 1, transpose: 0, pitch: 0 }, overlayIcon: name => name
});
vm.runInContext(`${overlayCode}; this.updateOverlay = updateOverlay; this.updateOverlayProgress = updateOverlayProgress`, overlayContext);
overlayContext.updateOverlay();
overlayContext.updateOverlay();
assert.equal(iconWrites, 1, "unchanged play icon is not rebuilt");
media.currentTime = 20;
overlayContext.updateOverlayProgress();
assert.equal(Number(progress.value), 20);
assert.equal(iconWrites, 1, "time updates touch only progress");
media.paused = true;
overlayContext.updateOverlay();
assert.equal(iconWrites, 2, "pause transition refreshes the icon");
assert.match(content, /addEventListener\("timeupdate",[\s\S]*?updateOverlayProgress\(\)/);
assert.match(content, /addEventListener\("pause",[\s\S]*?updateOverlay\(\)/);

for (const [mode, digits, unit] of [["speed", "1.00", "×"], ["transpose", "0", "T"], ["pitch", "0.00", "P"]]) {
  overlayContext.overlayMode = mode;
  media.currentTime = 42.7;
  overlayContext.showOverlaySeekTime(media);
  assert.equal(value.digits.textContent, "42");
  assert.equal(value.unit.textContent, "s");
  media.currentTime = 65;
  overlayContext.showOverlaySeekTime(media);
  assert.equal(seekTimers.size, 1, "another seek replaces the previous timeout");
  assert.equal(value.digits.textContent, "65");
  overlayContext.showOverlaySeekTime({ currentTime: 99 });
  assert.equal(value.digits.textContent, "65", "inactive media cannot replace the display");
  media.currentTime = 66;
  overlayContext.updateOverlay();
  assert.equal(value.digits.textContent, "66", "elapsed seconds keep updating during playback");
  [...seekTimers.values()][0]();
  assert.equal(value.digits.textContent, digits);
  assert.equal(value.unit.textContent, unit);
  assert.equal(seekTimers.size, 0);
}
console.log("Seek display checks passed: seconds, repeated seeks, inactive media, live time, and three-second restoration in all modes.");

const mutationCode = content.match(/function containsNewMedia\(records\) \{[\s\S]*?\n  \}/)?.[0];
assert.ok(mutationCode);
const mutationContext = vm.createContext({ Node: { ELEMENT_NODE: 1 } });
vm.runInContext(`${mutationCode}; this.containsNewMedia = containsNewMedia`, mutationContext);
assert.equal(mutationContext.containsNewMedia([{ addedNodes: [{ nodeType: 3 }] }]), false);
assert.equal(mutationContext.containsNewMedia([{ addedNodes: [{ nodeType: 1, matches: () => true }] }]), true);
assert.equal(mutationContext.containsNewMedia([{ addedNodes: [{ nodeType: 1, matches: () => false, querySelector: () => ({}) }] }]), true);
console.log("Optimization checks passed: unchanged popup polling, progress-only time updates, play icon transitions, and media mutation detection.");

const fontCode = content.slice(content.indexOf("let overlayFontPromise = null;"), content.indexOf("function showOverlay()"));
let fontLoads = 0;
const registeredFonts = new Set();
const fontContext = vm.createContext({
  FontFace: class {
    constructor(family, source, options) { this.family = family; this.source = source; this.weight = options.weight; }
    async load() { fontLoads++; return this; }
  },
  chrome: { runtime: { getURL: path => `chrome-extension://test/${path}` } },
  document: { fonts: registeredFonts }, console
});
vm.runInContext(`${fontCode}; this.loadOverlayFont = loadOverlayFont`, fontContext);
const firstFontLoad = fontContext.loadOverlayFont();
assert.equal(fontContext.loadOverlayFont(), firstFontLoad, "floating font loading is shared");
const loadedFont = await firstFontLoad;
assert.equal(fontLoads, 1);
assert.ok(registeredFonts.has(loadedFont), "loaded font is registered with the document for Shadow DOM use");
assert.equal(loadedFont.weight, "700");
console.log("Floating font checks passed: one shared load and document font registration.");
