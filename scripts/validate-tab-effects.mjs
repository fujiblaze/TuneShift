import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

function fixture() {
  const local = { extensionEnabled: true }, saved = {}, captures = new Map(), intervals = new Set(), timeouts = new Set();
  const events = {}, routes = new Map(), contexts = [], applications = [];
  let documentOpen = false, listener, now = 0, denied = false, empty = false, paused = false, signal = true, moved = false;
  const tab = id => ({ id, url: moved ? 'https://example.com/changed' : 'https://example.com/song' });
  let manager;
  const runtime = {
    getURL: path => `chrome-extension://test/${path}`,
    getContexts: async () => documentOpen ? [{}] : [],
    onMessage: { addListener: callback => { listener = callback; } },
    sendMessage: async message => {
      if (message.type === 'TAB_EFFECTS_ENDED') return manager.stop(message.tabId, message.error);
      return new Promise(resolve => listener(message, {}, resolve));
    }
  };
  class Context {
    constructor() { this.state = 'suspended'; this.audioWorklet = { addModule: async () => {} }; contexts.push(this); }
    createMediaStreamSource() { return { connect() {} }; }
    createAnalyser() { return { fftSize: 2048, disconnect() {}, getFloatTimeDomainData(samples) { samples.fill(signal ? 0.1 : 0); } }; }
    async resume() { this.state = 'running'; }
    async close() { this.state = 'closed'; }
  }
  const offscreen = { console, Float32Array, Date: { now: () => now }, AudioContext: Context, chrome: { runtime },
    navigator: { mediaDevices: { getUserMedia: async options => {
      if (denied) throw new Error('Capture denied');
      const id = Number(options.audio.mandatory.chromeMediaSourceId);
      const track = { stopped: false, stop() { this.stopped = true; }, addEventListener(_event, callback) { this.ended = callback; } };
      captures.set(id, track);
      return { getTracks: () => [track], getAudioTracks: () => empty ? [] : [track] };
    } } },
    setTimeout: callback => { timeouts.add(callback); return callback; }, clearTimeout: callback => timeouts.delete(callback),
    setInterval: callback => { intervals.add(callback); return callback; }, clearInterval: callback => intervals.delete(callback),
    TuneShiftAudioGraph: { create: () => ({}), apply: (_graph, _context, settings) => applications.push(settings), disconnect() {} }
  };
  vm.runInNewContext(fs.readFileSync('audio/tab-effects.js', 'utf8'), offscreen);
  const chrome = { runtime, storage: {
    session: { get: async key => ({ [key]: saved[key] }), set: async value => Object.assign(saved, value), remove: async key => { delete saved[key]; } },
    local: { get: async () => local }
  }, offscreen: { createDocument: async () => { documentOpen = true; }, closeDocument: async () => { documentOpen = false; } },
    tabCapture: { getMediaStreamId: async ({ targetTabId }) => String(targetTabId) },
    tabs: { get: async id => tab(id), sendMessage: async (id, message) => { routes.set(id, message.active); return { media: { paused } }; },
      onRemoved: { addListener: callback => { events.removed = callback; } }, onUpdated: { addListener: callback => { events.updated = callback; } } }
  };
  const env = { chrome };
  vm.runInNewContext(fs.readFileSync('audio/tab-effects-background.js', 'utf8'), env);
  manager = env.TuneShiftTabEffects;
  return { manager, captures, contexts, applications, routes, local, events, saved, tab,
    deny: () => { denied = true; }, empty: () => { empty = true; }, pause: () => { paused = true; }, move: () => { moved = true; },
    silence: () => { signal = false; }, tick: ms => { now += ms; for (const callback of intervals) callback(); },
    open: () => documentOpen, clean: () => { assert.equal(intervals.size, 0); assert.equal(timeouts.size, 0); for (const context of contexts) assert.equal(context.state, 'closed'); for (const track of captures.values()) assert.equal(track.stopped, true); }
  };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
{
  const f = fixture();
  assert.equal((await f.manager.start(f.tab(1), { pitch: 0.5 })).active, true);
  assert.equal(f.routes.get(1), true);
  f.tick(250);
  assert.equal((await f.manager.status(1)).signalDetected, true);
  await f.manager.start(f.tab(1), {});
  assert.equal(f.contexts.length, 1, 'duplicate start does not create another graph');
  await f.manager.apply(1, { volume: 150 });
  assert.equal(f.applications.at(-1).volume, 150);
  await f.manager.start(f.tab(2), {});
  await f.manager.stop(1);
  assert.equal(f.open(), true, 'other captured tab keeps offscreen document alive');
  assert.equal(f.routes.get(1), false);
  await f.manager.stopAll();
  assert.equal(f.open(), false);
  assert.equal((await f.manager.status(2)).active, false);
  f.clean();
}
for (const mode of ['deny', 'empty', 'pause', 'move', 'disabled']) {
  const f = fixture(), originalTab = f.tab(1);
  if (mode === 'disabled') f.local.extensionEnabled = false; else f[mode]();
  await assert.rejects(f.manager.start(originalTab, {}));
  assert.equal(f.routes.get(1), false, `${mode} restores page route`);
  assert.equal((await f.manager.status(1)).active, false);
  assert.ok((await f.manager.status(1)).error);
  assert.equal(f.open(), false);
  f.clean();
}
for (const mode of ['silence', 'ended', 'navigation', 'closed']) {
  const f = fixture();
  if (mode === 'silence') f.silence();
  await f.manager.start(f.tab(1), {});
  if (mode === 'silence') f.tick(16000);
  if (mode === 'ended') await f.captures.get(1).ended();
  if (mode === 'navigation') f.events.updated(1, { url: 'https://example.com/next' });
  if (mode === 'closed') f.events.removed(1);
  await flush();
  assert.equal((await f.manager.status(1)).active, false, mode);
  assert.equal(f.routes.get(1), false, mode);
  assert.equal(f.open(), false, mode);
  f.clean();
}
console.log('Tab effects checks passed: shared offscreen lifecycle, settings, duplicate starts, multiple tabs, denied/empty/paused capture, startup cancellation, silent audio, ended streams, navigation and tab closure.');
