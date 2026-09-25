import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const page = "https://example.com/listen";
const key = `bpm:${page}|https://example.com/audio.mp3`;
const store = {
  preferences: { rememberSites: true, autoApply: true },
  pageProfiles: { [page]: { url: page, settings: { speed: 1.25 } } },
  trackProfiles: {},
};
const tab = { id: 1, url: page, title: "Listen" };
const state = { ok: true, enabled: true, mediaCount: 1, media: { title: "Track", duration: 90 }, trackKey: key, settings: { speed: 1 } };
const sent = [];
const chrome = {
  runtime: { getURL: path => `chrome-extension://test/${path}`, onInstalled: { addListener() {} }, onMessage: { addListener() {} } },
  commands: { onCommand: { addListener() {} } },
  storage: { local: {
    async get(keys) {
      if (keys === null) return structuredClone(store);
      const names = typeof keys === "string" ? [keys] : keys;
      return Object.fromEntries(names.filter(name => name in store).map(name => [name, structuredClone(store[name])]));
    },
    async set(data) { Object.assign(store, structuredClone(data)); },
    async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete store[key]; }
  } },
  tabs: {
    async query() { return [tab]; },
    async get() { return tab; },
    async sendMessage(_tabId, message) {
      sent.push(message);
      if (message.type === "PING") return { ok: true };
      if (message.type === "GET_STATE") return { ...state };
      if (message.type === "SET_TRACK_SCOPE") return { ok: true };
      if (message.type === "SET_LOOP_TIMES") return { ok: true, settings: { loopA: message.a, loopB: message.b } };
      return { ok: true };
    }
  }
};
const context = vm.createContext({ chrome, URL, console, Date });
vm.runInContext(fs.readFileSync("background.js", "utf8"), context);
const send = (message, sender) => context.handleMessage(message, sender);
const content = { tab: { url: page } };
const popup = { url: chrome.runtime.getURL("popup/popup.html") };
const history = { url: chrome.runtime.getURL("popup/history.html") };

assert.equal((await send({ type: "GET_SAVED_SETTINGS", trackKey: key }, content)).settings.speed, 1.25);
assert.equal((await send({ type: "SET_TRACK_PROFILE", enabled: true, settings: { speed: 1.5 }, expectedTabId: 1 }, popup)).active, true);
assert.equal(store.trackProfiles[key].settings.speed, 1.5);
assert.equal(sent.at(-1).type, "SET_TRACK_SCOPE");
assert.equal((await send({ type: "GET_SAVED_SETTINGS", trackKey: key }, content)).scope, "track");
await context.persistSettings(tab, { speed: 1.75 }, key);
assert.equal(store.trackProfiles[key].settings.speed, 1.75);
assert.equal(store.pageProfiles[page].settings.speed, 1.25);
assert.equal((await send({ type: "SET_LOOP_TIMES", a: 12.3, b: 15.7, expectedTabId: 1 }, popup)).settings.loopB, 15.7);
store.preferences.autoApply = false;
assert.equal((await send({ type: "GET_SAVED_SETTINGS", trackKey: key }, content)).settings, null);
store.preferences.autoApply = true;
assert.equal((await send({ type: "SET_TRACK_PROFILE", enabled: false, expectedTabId: 1 }, popup)).active, false);
assert.equal(store.trackProfiles[key], undefined);
assert.equal((await send({ type: "GET_SAVED_SETTINGS", trackKey: key }, content)).scope, "page");
await send({ type: "SET_TRACK_PROFILE", enabled: true, settings: { speed: 1.5 }, expectedTabId: 1 }, popup);
assert.equal((await send({ type: "DELETE_SAVED_PAGE", url: page }, history)).ok, true);
assert.equal(store.trackProfiles[key], undefined);
assert.equal(store.pageProfiles[page], undefined);

const popupSource = fs.readFileSync("popup/popup.js", "utf8");
const contentSource = fs.readFileSync("content/content.js", "utf8");
const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
assert.ok(manifest.web_accessible_resources.some(entry => entry.resources.includes("assets/fonts/DSEG7Classic-Bold.woff2")));
for (const id of ["paste-tuning", "bpm-half", "bpm-double", "save-profile", "edit-loop", "footer-track"]) {
  assert.ok(fs.readFileSync("popup/popup.html", "utf8").includes(`id="${id}"`), `Missing ${id}`);
}
const parseSource = popupSource.match(/function parseExactLoop\(text\) \{[\s\S]*?\n\}/)?.[0];
assert.ok(parseSource, "Exact loop parser is available");
const parse = vm.runInNewContext(`${parseSource}; parseExactLoop`);
assert.equal(parse("01:12.34"), 72.34);
assert.equal(parse("1:02:03.5"), 3723.5);
assert.ok(Number.isNaN(parse("bad")));
const loopSource = contentSource.match(/function setLoopTimes\(a, b\) \{[\s\S]*?\n  \}/)?.[0];
assert.ok(loopSource, "Exact loop handler is available");
const loopContext = { activeMedia: { duration: 60 }, findActiveMedia() { return this.activeMedia; },
  settings: {}, updateOverlay() {} };
loopContext.state = () => ({ ok: true, settings: loopContext.settings });
vm.runInNewContext(`${loopSource}; this.setLoopTimes = setLoopTimes`, loopContext);
assert.equal(loopContext.setLoopTimes(12.3, 11).ok, false);
assert.equal(loopContext.setLoopTimes(12.3, 61).ok, false);
assert.equal(loopContext.setLoopTimes(12.3, 15.7).settings.loopB, 15.7);
const correctionSource = popupSource.match(/async function correctBpm\(factor\) \{[\s\S]*?\n\}/)?.[0];
assert.ok(correctionSource, "Source BPM correction is available");
const bpmMessages = [];
const bpmContext = { mediaState: { bpm: { value: 120 } }, tapTimes: [1, 2],
  round: (value, places) => Number(value.toFixed(places)),
  async send(message) { bpmMessages.push(message); return { ok: true }; },
  renderBpm() {}, showToast() {} };
vm.runInNewContext(`${correctionSource}; this.correctBpm = correctBpm`, bpmContext);
await bpmContext.correctBpm(0.5);
assert.equal(bpmMessages.at(-1).bpm, 60);
assert.equal(bpmContext.mediaState.bpm.value, 60);
await bpmContext.correctBpm(2);
assert.equal(bpmMessages.at(-1).bpm, 120);
assert.match(popupSource, /balance\.classList\.toggle\("swapped", dsp && settings\.swapChannels\)/);
assert.match(contentSource, /data-action="back"/);
assert.match(contentSource, /class="progress"/);
console.log("v1.20 checks passed: track save precedence and routing, page fallback, clearing, exact-loop message, and new control wiring.");
