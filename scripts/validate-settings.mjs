import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync('options/options.js', 'utf8');
for (const sidebar of [false, true]) {
 const values = { rememberSites: true, autoApply: false, showBadge: true, themeMode: 'dark', speedStep: 0.1, seekStep: 10 };
 const storage = { preferences: { ...values, sidebarMode: sidebar, futurePreference: 42 }, pageProfiles: {} };
 const elements = new Map();
 const element = id => {
  if (!elements.has(id)) elements.set(id, { value: String(values[id]), checked: values[id], classList: { add() {}, remove() {} }, addEventListener(type, fn) { this[type] = fn; }, replaceChildren() {}, appendChild() {} });
  return elements.get(id);
 };
 let initialize;
 const session = new Map();
 const context = vm.createContext({ URLSearchParams, URL, console, setTimeout: () => 1, clearTimeout() {},
 location: { search: sidebar ? '?embedded=1&sidebar=1' : '?embedded=1' }, window: { location: {} },
 sessionStorage: { setItem: (key, value) => session.set(key, value) },
 document: { addEventListener: (_, fn) => { initialize = fn; }, getElementById: element, documentElement: { dataset: {} }, createElement: () => ({}) },
 TuneShiftDropdowns: { syncAll() {} },
 chrome: { storage: { local: { get: async () => structuredClone(storage), set: async next => Object.assign(storage, next) } }, tabs: { create() {} } }
 });
 vm.runInContext(source, context);
 await initialize();
 assert.equal(element('settings-back').hidden, false);
 element('themeMode').value = 'light';
 element('themeMode').change({ target: { id: 'themeMode' } });
 element('seekStep').value = '30';
 await context.savePreferences({ target: { id: 'seekStep' } });
 assert.equal(storage.preferences.themeMode, 'light');
 assert.equal(storage.preferences.seekStep, 30);
 assert.equal(storage.preferences.sidebarMode, sidebar);
 assert.equal(storage.preferences.futurePreference, 42);
 assert.equal(storage.preferences.autoApply, false);
 await element('settings-back').click();
 assert.equal(context.window.location.href, sidebar ? '../popup/popup.html?sidebar=1' : '../popup/popup.html');
 assert.equal(session.get('tuneshift-return-from-settings'), '1');
 assert.equal(session.get('tuneshift-theme'), 'light');
}
console.log('Embedded settings checks passed: queued saves, retained sidebar/unknown preferences, theme persistence and back navigation in both modes.');
