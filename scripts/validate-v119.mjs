import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const pageA = "https://example.com/album";
const pageB = "https://example.com/other";
const keyA = `bpm:${pageA}|https://example.com/a.mp3`;
const keyB = `bpm:${pageB}|https://example.com/b.mp3`;
const store = {
  preferences: { rememberSites: true },
  defaults: { speed: 1 },
  pageProfiles: { [pageA]: { url: pageA }, [pageB]: { url: pageB } },
};
const local = {
  async get(keys) {
    if (keys === null) return structuredClone(store);
    const selected = typeof keys === "string" ? [keys] : keys;
    return Object.fromEntries(selected.filter(key => key in store).map(key => [key, structuredClone(store[key])]));
  },
  async set(values) { Object.assign(store, structuredClone(values)); },
  async remove(keys) { for (const key of (Array.isArray(keys) ? keys : [keys])) delete store[key]; }
};
const extensionUrl = path => `chrome-extension://test/${path}`;
const chrome = {
  runtime: { getURL: extensionUrl, onInstalled: { addListener() {} }, onMessage: { addListener() {} } },
  commands: { onCommand: { addListener() {} } },
  storage: { local },
};
const context = vm.createContext({ chrome, URL, console, Date });
vm.runInContext(fs.readFileSync("background.js", "utf8"), context);
const tab = url => ({ tab: { url } });
const history = { url: extensionUrl("popup/history.html") };
const bpm = { value: 128, status: "manual", source: "entry", confidence: 1 };
const send = (message, sender) => context.handleMessage(message, sender);

assert.equal((await send({ type: "SAVE_BPM", key: keyA, bpm }, tab(pageA))).saved, true);
assert.equal(store[keyA].value, 128);
assert.equal((await send({ type: "LOAD_BPM", key: keyA }, tab(pageA))).bpm.value, 128);
assert.equal((await send({ type: "LOAD_BPM", key: keyA }, tab(pageB))).ok, false);

store.preferences.rememberSites = false;
assert.equal((await send({ type: "SAVE_BPM", key: keyB, bpm }, tab(pageB))).saved, false);
assert.equal(store[keyB], undefined);
assert.equal((await send({ type: "LOAD_BPM", key: keyA }, tab(pageA))).bpm, null);
store.preferences.rememberSites = true;

store[keyB] = { ...bpm, updatedAt: Date.now() };
assert.equal((await send({ type: "DELETE_SAVED_PAGE", url: pageA }, {})).ok, false);
assert.equal((await send({ type: "DELETE_SAVED_PAGE", url: pageA }, history)).ok, true);
assert.equal(store[keyA], undefined);
assert.equal(store.pageProfiles[pageA], undefined);
assert.ok(store[keyB]);
assert.ok(store.pageProfiles[pageB]);

const old = Date.now() - 91 * 24 * 60 * 60 * 1000;
store[keyA] = { ...bpm, updatedAt: old };
assert.equal((await send({ type: "LOAD_BPM", key: keyA }, tab(pageA))).bpm, null);
assert.equal(store[keyA], undefined);

const now = Date.now();
for (let i = 0; i < 303; i++) store[`bpm:${pageB}|track-${i}`] = { ...bpm, updatedAt: now };
const newest = `bpm:${pageB}|newest`;
assert.equal((await send({ type: "SAVE_BPM", key: newest, bpm }, tab(pageB))).saved, true);
const bpmKeys = Object.keys(store).filter(key => key.startsWith("bpm:"));
assert.equal(bpmKeys.length, 300);
assert.ok(newest in store, "the just-saved track survives timestamp ties");

assert.equal((await send({ type: "CLEAR_SAVED_HISTORY" }, history)).ok, true);
assert.equal(Object.keys(store).filter(key => key.startsWith("bpm:")).length, 0);
assert.equal(Object.keys(store.pageProfiles).length, 0);
assert.equal(store.defaults.speed, 1);
assert.equal(store.preferences.rememberSites, true);
console.log("v1.19 privacy checks passed: BPM preference gating, page deletion, full clearing, expiry, 300-entry cap and fresh-entry retention.");
