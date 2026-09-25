import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";
const source = fs.readFileSync("content/content.js", "utf8");
const settle = () => new Promise(resolve => setImmediate(resolve));
function fixture(store = {}, {url = "https://example.com/list", src = "https://example.com/a.mp3", get} = {}) {
  const listeners = {}, nodes = [], writes = []; let receive, plays = 0;
  class Node { connect(n) { return n; } disconnect() {} }
  class Context { constructor() { this.sampleRate = 48000; this.destination = {}; this.audioWorklet = {addModule: async () => {}}; } createMediaStreamSource() {return new Node();} close() {return Promise.resolve();} resume() {return Promise.resolve();} }
  class Worklet extends Node { constructor() {super(); this.port = {postMessage() {}, onmessage: null}; nodes.push(this);} }
  const media = {src, currentSrc: src, currentTime: 0, duration: 120, readyState: 4, paused: true, isConnected: true, volume: 1, playbackRate: 1, defaultPlaybackRate: 1,
    getBoundingClientRect: () => ({width: 100, height: 100}), getAttribute: () => null, addEventListener: (e, fn) => listeners[e] = fn,
    play() {plays++; return Promise.resolve();}, captureStream: () => ({getAudioTracks: () => [{}], getTracks: () => [{stop() {}}]})};
  const env = {URL, console, location: {href: url, hostname: new URL(url).hostname}, document: {querySelectorAll: () => [media], documentElement: {}, title: "Track"},
    AudioContext: Context, AudioWorkletNode: Worklet, BiquadFilterNode: Node, GainNode: Node, MutationObserver: class {observe() {}}, setInterval: () => 0, clearInterval() {}, requestAnimationFrame() {},
    chrome: {storage: {local: {get: get || (async key => ({[key]: structuredClone(store[key])})), set: async data => {Object.assign(store, structuredClone(data)); writes.push(data);}}},
      runtime: {getURL: p => p, sendMessage: async message => {
        if (message.type === "SAVE_BPM") {
          store[message.key] = structuredClone(message.bpm);
          writes.push({ [message.key]: store[message.key] });
          return { ok: true, saved: true };
        }
        if (message.type === "LOAD_BPM") {
          const saved = await (get || (async key => ({ [key]: structuredClone(store[key]) })))(message.key);
          return { ok: true, bpm: saved[message.key] || null };
        }
        return { ok: true };
      }, onMessage: {addListener: fn => receive = fn}}}};
  vm.runInNewContext(source, env);
  return {media, listeners, nodes, writes, controller: env.__tuneShiftController, plays: () => plays,
    send: msg => {let result; receive(msg, {}, value => result = value); return result;}};
}
const store = {};
const a = fixture(store); await settle();
a.send({type: "SET_MANUAL_BPM", bpm: 128, source: "entry"}); await settle();
assert.equal(Object.values(store)[0].value, 128);
const reopened = fixture(store); await settle(); assert.equal(reopened.controller.state().bpm.value, 128); assert.equal(reopened.nodes.length, 0);
const other = fixture(store, {src: "https://example.com/b.mp3"}); await settle(); assert.equal(other.controller.state().bpm.value, null);
other.media.paused = false; other.media.playbackRate = 1.25; other.controller.refresh(); await settle();
other.nodes.at(-1).port.onmessage({data: {type: "bpmStable", data: {bpm: [{tempo: 150, count: 40, confidence: .9}]}}}); await settle();
assert.equal(other.controller.state().bpm.value, 120);
const autoReload = fixture(store, {src: "https://example.com/b.mp3"}); await settle(); assert.equal(autoReload.controller.state().bpm.value, 120);
const yt = fixture(store, {url: "https://music.youtube.com/watch?v=abcdefghijk&list=test", src: "blob:old"}); await settle();
yt.send({type: "SET_MANUAL_BPM", bpm: 135, source: "tap"}); await settle();
const ytReload = fixture(store, {url: "https://www.youtube.com/watch?v=abcdefghijk", src: "blob:new"}); await settle(); assert.equal(ytReload.controller.state().bpm.value, 135);
let resolveRead;const raced = fixture(store, {get: key => new Promise(resolve => resolveRead = () => resolve({[key]: {value: 90, status: "automatic"}}))});
raced.send({type: "SET_MANUAL_BPM", bpm: 140, source: "entry"}); resolveRead(); await settle(); assert.equal(raced.controller.state().bpm.value, 140);
const reads=[];const switching=fixture({}, {get:key=>new Promise(resolve=>reads.push(()=>resolve({[key]:{value:key.includes('b.mp3')?155:99,status:'manual'}})))});
switching.media.currentSrc='https://example.com/b.mp3';switching.controller.refresh();reads[0]();await settle();assert.notEqual(switching.controller.state().bpm.value,99);reads[1]();await settle();assert.equal(switching.controller.state().bpm.value,155);
for (const [mode, count] of [["once", 1], ["twice", 2], ["five", 5]]) {
  const f = fixture(); await settle(); await f.controller.apply({repeat: mode});
  for (let i = 0; i < count + 2; i++) f.listeners.ended();
  assert.equal(f.plays(), count, mode); assert.equal(f.controller.state().settings.repeat, "off");
}
const loop = fixture(); await settle(); await loop.controller.apply({repeat: "once", loopA: 5, loopB: 10, loopEnabled: true});
loop.listeners.ended();loop.listeners.ended();assert.equal(loop.controller.state().settings.repeat, "once");
await loop.controller.apply({loopEnabled: false});loop.listeners.ended();assert.equal(loop.controller.state().settings.repeat, "off");
await loop.controller.apply({cues: Array.from({length: 12}, (_, i) => ({time: i, name: "Cue"}))});assert.equal(loop.controller.state().settings.cues.length, 9);
console.log("v1.16 checks passed: manual/automatic BPM persistence, original-tempo storage, track isolation, YouTube identity, stale-read protection, counted repeats, loop priority and nine-cue limit.");

const background = {chrome: {runtime: {onInstalled: {addListener() {}}, onMessage: {addListener() {}}}, commands: {onCommand: {addListener() {}}}}};
vm.runInNewContext(fs.readFileSync("background.js", "utf8"), background);
for (const mode of ["once", "twice", "five"]) assert.equal(background.sanitizeSettings({repeat: mode}).repeat, mode);
assert.equal(background.sanitizeSettings({cues: Array.from({length: 12}, (_, i) => ({time: i}))}).cues.length, 9);
