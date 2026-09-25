import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const state = { preferences: { themeMode: 'light', sidebarMode: true } };
const calls = [];
let failSave = false;
const context = vm.createContext({ console, URL, chrome: {
 runtime: { getURL: p => `chrome-extension://test/${p}`, onInstalled: { addListener() {} }, onStartup: { addListener() {} }, onMessage: { addListener() {} } },
 commands: { onCommand: { addListener() {} } },
 storage: { local: { get: async () => structuredClone(state), set: async value => { if (failSave) throw new Error('disk full'); Object.assign(state, value); } } },
 sidePanel: { setPanelBehavior: async value => calls.push(['behavior', value.openPanelOnActionClick]) },
 action: { setPopup: async value => calls.push(['popup', value.popup]) },
 tabs: { query: async query => { assert.equal(query.windowId, 7); return [{ id: 42 }]; } }
} });
vm.runInContext(fs.readFileSync('background.js', 'utf8'), context);
await context.restoreSidebar();
assert.deepEqual(calls.slice(-2), [['behavior', true], ['popup', '']]);
const sender = { url: 'chrome-extension://test/popup/popup.html?sidebar=1' };
await context.handleMessage({ type: 'SET_SIDEBAR_MODE', enabled: false }, sender);
assert.equal(state.preferences.sidebarMode, false);
assert.equal(state.preferences.themeMode, 'light');
assert.deepEqual(calls.slice(-2), [['behavior', false], ['popup', 'popup/popup.html']]);
failSave = true;
await assert.rejects(context.handleMessage({ type: 'SET_SIDEBAR_MODE', enabled: true }, sender), /disk full/);
assert.deepEqual(calls.slice(-2), [['behavior', false], ['popup', 'popup/popup.html']]);
await assert.rejects(context.handleMessage({ type: 'SET_SIDEBAR_MODE', enabled: true }, { tab: { id: 42 } }), /TuneShift/);
assert.equal((await context.getActiveTab(7, 42)).id, 42);
await assert.rejects(context.getActiveTab(7, 41), /active tab changed/);
const popup = fs.readFileSync('popup/popup.js', 'utf8');
const toggleCode = popup.slice(popup.indexOf('async function toggleSidebar('));
for (const sidebarView of [false, true]) {
 const order = [];
 const input = { checked: !sidebarView };
 const ui = vm.createContext({ sidebarView, controllerWindowId: 7, preferences: { sidebarMode: sidebarView },
 chrome: { sidePanel: { open: () => { order.push('open'); return Promise.resolve(); }, close: async () => order.push('close-panel') } },
 send: async () => { order.push('save'); return { ok: true }; }, renderFooterPreferences() {}, showToast() {}, window: { close: () => order.push('close-window') }
 });
 vm.runInContext(toggleCode, ui);
 await ui.toggleSidebar({ target: input });
 assert.deepEqual(order, sidebarView ? ['save', 'close-panel'] : ['open', 'save', 'close-window']);
 assert.equal(input.disabled, false);
}
console.log('Sidebar checks passed: saved toolbar mode, preference preservation, rollback, sender validation, window targeting, stale-tab guard and switch ordering.');
