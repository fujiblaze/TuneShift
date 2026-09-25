import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import vm from "node:vm";

const root = resolve(import.meta.dirname, "..");
const required = [
  "audio/effects-graph.js",
  "audio/tab-effects.html",
  "audio/tab-effects.js",
  "audio/tab-effects-background.js",
  "audio/realtime-bpm-processor.js",
  "audio/BPM-ANALYZER-LICENSE.txt",
  "assets/ui/dropdowns.js",
  "assets/ui/dropdowns.css",
  "assets/ui/viewport.css",
  "assets/fujimori-avatar.jpeg",
  "manifest.json",
  "background.js",
  "popup/popup.html",
  "popup/popup.css",
  "popup/popup.js",
  "popup/appearance.js",
  "popup/history.html",
  "popup/history.css",
  "popup/history.js",
  "content/content.js",
  "content/spotify-bootstrap.js",
  "audio/soundtouch-processor.js",
  "audio/SOUNDTOUCH-LICENSE.txt",
  "options/options.html",
  "options/privacy.html",
  "options/options.css",
  "options/options.js",
  "assets/fonts/Sora-Variable.ttf",
  "assets/fonts/DSEG7Classic-Bold.woff2",
  "assets/icons/icon-16.png",
  "assets/icons/icon-32.png",
  "assets/icons/icon-48.png",
  "assets/icons/icon-128.png",
  "assets/icons/lucide-ui.svg",
  "assets/icons/LUCIDE-LICENSE.txt",
];

const manifest = JSON.parse(
  await readFile(resolve(root, "manifest.json"), "utf8"),
);
if (manifest.manifest_version !== 3)
  throw new Error("manifest_version must be 3");
if (!/^\d+\.\d+(?:\.\d+){0,2}$/.test(manifest.version))
  throw new Error("Manifest version must have two to four numeric components");
if (manifest.version !== "1.20.3")
  throw new Error("TuneShift release version must be 1.20.3");
if (
  manifest.permissions?.includes("tabCapture") ||
  !manifest.optional_permissions?.includes("tabCapture") ||
  !manifest.permissions?.includes("offscreen")
) {
  throw new Error("Tab capture must be optional and offscreen must be available");
}
const exposedAudio =
  manifest.web_accessible_resources?.flatMap(
    (entry) => entry.resources || [],
  ) || [];
if (!exposedAudio.includes("audio/soundtouch-processor.js")) {
  throw new Error("The local SoundTouch worklet is not web-accessible");
}
if (exposedAudio.some((resource) => /phase-vocoder/i.test(resource))) {
  throw new Error("Retired phase-vocoder resources must not remain exposed");
}

for (const file of required) {
  const info = await stat(resolve(root, file));
  if (!info.isFile() || info.size === 0)
    throw new Error(`Missing or empty required file: ${file}`);
}

const scripts = [
  "audio/effects-graph.js",
  "audio/tab-effects.js",
  "audio/tab-effects-background.js",
  "assets/ui/dropdowns.js",
  "background.js",
  "popup/popup.js",
  "popup/appearance.js",
  "popup/history.js",
  "content/content.js",
  "content/spotify-bootstrap.js",
  "options/options.js",
];
for (const file of scripts) {
  const source = await readFile(resolve(root, file), "utf8");
  new vm.Script(source, { filename: file });
}

const popupSource = await readFile(resolve(root, "popup/popup.js"), "utf8");
const popupHtml = await readFile(resolve(root, "popup/popup.html"), "utf8");
const popupCss = await readFile(resolve(root, "popup/popup.css"), "utf8");
if (!popupHtml.includes(`<span class="version">v${manifest.version}</span>`)) {
  throw new Error("Popup version label must match the manifest");
}
if (!/chrome\.permissions\.request\(\{ permissions: \["tabCapture"\] \}\)/.test(popupSource)) {
  throw new Error("Tab capture must be requested from the existing enable button");
}
const historySource = await readFile(resolve(root, "popup/history.js"), "utf8");
const optionsSource = await readFile(resolve(root, "options/options.js"), "utf8");
const optionsHtml = await readFile(resolve(root, "options/options.html"), "utf8");
const optionsCss = await readFile(resolve(root, "options/options.css"), "utf8");
const compactPopupCss = popupCss.replace(/\s+/g, "");
const compactOptionsCss = optionsCss.replace(/\s+/g, "");
for (const color of ["#cdb4db", "#ffc8dd", "#ffafcc", "#bde0fe", "#a2d2ff"]) {
  if (!popupCss.toLowerCase().includes(color) || !optionsCss.toLowerCase().includes(color)) {
    throw new Error(`Pastel Dreamland color ${color} is missing from a theme surface`);
  }
}
if (!/:root\[data-theme="light"\]/.test(popupCss) || !/:root\[data-theme="light"\]/.test(optionsCss) ||
    !/id="themeMode"[\s\S]*?value="dark"[\s\S]*?value="light"/.test(optionsHtml) ||
    !/function applyTheme\(mode\)/.test(popupSource) || !/function applyTheme\(mode\)/.test(optionsSource) ||
    !/preferences\?\.themeMode === "light"/.test(historySource)) {
  throw new Error("Persistent light and dark theme wiring is incomplete");
}
if (!/body\{font-size:16px\}/.test(compactOptionsCss) ||
    !/\.settingstrong,\.select-settingstrong\{font-size:14px\}/.test(compactOptionsCss) ||
    !/\.settingsmall,\.select-settingsmall\{font-size:12px\}/.test(compactOptionsCss)) {
  throw new Error("Settings typography was not enlarged to the readable scale");
}
if (!/id="transpose-sign"[\s\S]*?data-shadow="18"/.test(popupHtml)) {
  throw new Error("Transpose sign must precede the compact 18 ghost display");
}
if (!/id="pitch-sign"[\s\S]*?data-shadow="1\.88"/.test(popupHtml)) {
  throw new Error("Pitch sign must precede the compact 1.88 ghost display");
}
if (
  !/id="speed-value" data-shadow="8\.88"/.test(popupHtml) ||
  !/id="transpose-display" data-shadow="18"/.test(popupHtml) ||
  !/id="pitch-display" data-shadow="1\.88"/.test(popupHtml)
) {
  throw new Error("Digital counters must declare their fixed segment slots");
}
if (
  !/\.digital-row\{[^}]*display:grid;grid-template-columns:24pxminmax\(0,1fr\)24px/.test(
    compactPopupCss,
  ) ||
  !/\.step-button\{[^}]*z-index:2;[^}]*width:24px;height:24px/.test(
    compactPopupCss,
  )
) {
  throw new Error(
    "Primary step buttons must own isolated, clickable grid columns",
  );
}
if (!/\.speed-digits\{[^}]*overflow:hidden;[^}]*font-size:17px/.test(compactPopupCss)) {
  throw new Error("Speed glyphs must stay contained inside their center column");
}
if (
  !/\.transpose-card\s+\.editable-digits,\s*\.transpose-card\s+\.editable-digits>\.segment-display\s*\{[^}]*--digit-color:\s*var\(--violet\)/.test(popupCss) ||
  !/\.pitch-card\s+\.editable-digits,\s*\.pitch-card\s+\.editable-digits>\.segment-display\s*\{[^}]*--digit-color:\s*var\(--pitch\)/.test(popupCss)
) {
  throw new Error("Transpose and pitch digits must match their slider colors");
}
if (!/\.transport\s*\{[^}]*background:\s*var\(--panel\)/s.test(popupCss)) {
  throw new Error("Playback panel must follow the active light or dark surface theme");
}
if (
  !/data-step="speed" data-delta="-0\.01"/.test(popupHtml) ||
  !/data-step="speed" data-delta="0\.01"/.test(popupHtml) ||
  !/id="speed" type="range" min="0\.25" max="4" step="0\.01"/.test(popupHtml) ||
  !/<div class="range-labels"><span>0\.25<\/span><span>2\.00<\/span><span>4\.00<\/span><\/div>/.test(popupHtml)
) {
  throw new Error("Speed controls must use hundredth increments and a 2.00 midpoint label");
}
if (
  !/\.segment-slot::before,\.segment-slot::after\{[^}]*position:absolute;inset:0;display:grid;place-items:center;font:inherit;line-height:1/.test(
    compactPopupCss,
  )
) {
  throw new Error(
    "Live and ghost glyphs must share the exact same segment slot",
  );
}
if (
  !/id="open-history"/.test(popupHtml) ||
  !/id="pitch-hz">440\.0/.test(popupHtml) ||
  /pitch-display[\s\S]*?<\/span><span class="digital-unit">st<\/span>/.test(
    popupHtml,
  )
) {
  throw new Error(
    "History navigation, pitch Hz readout, or unit-free pitch row is incorrect",
  );
}
if (
  !/id="speed-main-page"/.test(popupHtml) ||
  !/id="open-bpm-panel"[^>]*aria-controls="speed-bpm-page"/.test(popupHtml) ||
  !/id="speed-bpm-page" hidden/.test(popupHtml) ||
  !/id="bpm-indicator"[\s\S]*?id="bpm-value"[\s\S]*?<small>BPM<\/small>/.test(popupHtml) ||
  !/id="tap-bpm"/.test(popupHtml) ||
  !/id="bpm-half"/.test(popupHtml) ||
  !/id="bpm-double"/.test(popupHtml) ||
  !/function tapBpm\(\)/.test(popupSource) ||
  !/function commitExactBpm\(\)/.test(popupSource) ||
  !/type: "SET_MANUAL_BPM"/.test(popupSource)
) {
  throw new Error("Speed and BPM pages or tap-tempo controls are incomplete");
}
if (!/\.speed-page\[hidden\] \{ display: none; \}/.test(popupCss)) {
  throw new Error("Inactive speed page must be hidden");
}
const tapBpmSource = popupSource.match(
  /async function tapBpm\(\) \{[\s\S]*?\n\}/,
)?.[0];
if (!tapBpmSource || /showToast\(/.test(tapBpmSource)) {
  throw new Error("Tap tempo must remain clickable without a toast covering it");
}
if (!/effectiveBpm \/ settings\.speed/.test(tapBpmSource)) {
  throw new Error("Tap tempo must store source BPM independently of playback speed");
}
const exactBpmSource = popupSource.match(
  /async function commitExactBpm\(\) \{[\s\S]*?\n\}/,
)?.[0];
if (
  !exactBpmSource ||
  !/effectiveBpm \/ settings\.speed/.test(exactBpmSource) ||
  !/source: "entry"/.test(exactBpmSource)
) {
  throw new Error("Exact BPM entry must preserve the source tempo at changed speeds");
}
const renderBpmSource = popupSource.match(
  /function renderBpm\(\) \{[\s\S]*?\n\}/,
)?.[0];
if (!renderBpmSource) throw new Error("Effective BPM renderer was not found");
const bpmOutput = { value: "", setAttribute() {} };
const bpmPreview = { textContent: "", setAttribute() {} };
const bpmIndicator = { title: "", classList: { toggle() {} } };
vm.runInNewContext(
  `${renderBpmSource}; renderBpm(); result = outputValue();`,
  {
    mediaState: { bpm: { value: 120, status: "automatic", confidence: 0.8 } },
    settings: { speed: 1.25 },
    document: { getElementById(id) { return id === "bpm-value" ? bpmOutput : id === "speed-bpm-preview" ? bpmPreview : bpmIndicator; } },
    outputValue() { return bpmOutput.value; },
  },
);
if (bpmOutput.value !== "150" || bpmPreview.textContent !== "150") {
  throw new Error("Both BPM readouts must scale with playback speed");
}
const parserSource = popupSource.match(
  /function parseTransposeValue\(value\) \{[\s\S]*?\n\}/,
)?.[0];
if (!parserSource) throw new Error("Exact transpose parser was not found");
const parserContext = {};
vm.runInNewContext(
  `${parserSource}; result = parseTransposeValue("−0.31");`,
  parserContext,
);
if (parserContext.result !== -0.31)
  throw new Error("Typographic negative transpose was not parsed correctly");

const contentSource = await readFile(
  resolve(root, "content/content.js"),
  "utf8",
);
if (
  !/media\.captureStream \|\| media\.mozCaptureStream/.test(contentSource) ||
  !/status: "automatic"/.test(contentSource) ||
  !/case "SET_MANUAL_BPM"/.test(contentSource)
) {
  throw new Error("Page-local BPM detection and manual tempo routing are incomplete");
}
if (
  !/data-action="mode"/.test(contentSource) ||
  !/const modes = isProtectedMedia\(activeMedia\) && !tabEffectsActive \? \["speed"\] : \["speed", "transpose", "pitch"\]/.test(contentSource) ||
  !/settings\[overlayMode\]/.test(contentSource) ||
  !/\.bar\[data-mode="transpose"\][^\n]*#cdb4db/.test(contentSource) ||
  !/\.bar\[data-mode="pitch"\][^\n]*#a2d2ff/.test(contentSource)
) {
  throw new Error("Floating controls must cycle through speed, transpose, and pitch");
}
if (/phase-vocoder|phaseVocoder|crossfadePitchProcessor/.test(contentSource)) {
  throw new Error(
    "Speed and transpose must not route through the retired phase-vocoder path",
  );
}
const effectsSource = await readFile(resolve(root, "audio/effects-graph.js"), "utf8");
const stretchQualitySource = effectsSource.match(
  /function updateStretchQuality\(graph, settings\) \{[\s\S]*?\n  \}/,
)?.[0];
if (!stretchQualitySource)
  throw new Error("High-quality Lanczos routing was not found");
const stretchQualityContext = {};
vm.runInNewContext(
  `${stretchQualitySource};
  let settings = { transpose: 0, pitch: 0 };
  function routeQuality(transpose) {
    settings.transpose = transpose;
    const messages = [];
    updateStretchQuality({
      qualityMode: null,
      soundtouch: { port: { postMessage: (message) => messages.push(message) } },
    }, settings);
    return messages.find(
      (message) => message.type === "set-interpolation-strategy-params",
    )?.params;
  }`,
  stretchQualityContext,
);
const neutralKernel = stretchQualityContext.routeQuality(0);
const octaveUpKernel = stretchQualityContext.routeQuality(12);
const octaveDownKernel = stretchQualityContext.routeQuality(-12);
if (
  !neutralKernel ||
  neutralKernel.normalize !== true ||
  neutralKernel.zeroCrossings !== 6
) {
  throw new Error("Normalized Lanczos routing was not found near unity");
}
if (!octaveUpKernel || octaveUpKernel.zeroCrossings < 10) {
  throw new Error("Octave-up shifts must widen the resampling kernel");
}
if (!octaveDownKernel || octaveDownKernel.zeroCrossings < 6) {
  throw new Error("Octave-down shifts lost their resampling kernel size");
}
if (
  !/parameters\.get\("playbackRate"\)\.setValueAtTime\(1, now\)/.test(
    effectsSource,
  ) ||
  !/media\.preservesPitch = true/.test(contentSource)
) {
  throw new Error(
    "Playback speed must use native pitch preservation instead of DSP compensation",
  );
}
const pipelineSource = contentSource.match(
  /function needsAudioPipeline\(value\) \{[\s\S]*?\n  \}/,
)?.[0];
if (!pipelineSource || /value\.speed/.test(pipelineSource)) {
  throw new Error("Speed-only playback must bypass the audio worklet");
}
const pipelineContext = {};
vm.runInNewContext(
  `${pipelineSource};
  const base = { speed: .25, transpose: 0, pitch: 0, volume: 100, bass: 0, mid: 0, treble: 0, balance: 0, compressor: false, mono: false };
  speedOnly = needsAudioPipeline(base);
  pitchShift = needsAudioPipeline({ ...base, transpose: 12 });`,
  pipelineContext,
);
if (
  pipelineContext.speedOnly !== false ||
  pipelineContext.pitchShift !== true
) {
  throw new Error(
    "Speed-only and pitch-shift audio routing did not separate correctly",
  );
}
const conflictSource = contentSource.match(
  /function isMediaSourceConflict\(error\) \{[\s\S]*?\n  \}/,
)?.[0];
if (!conflictSource)
  throw new Error("Media source conflict classifier was not found");
const conflictContext = {};
vm.runInNewContext(
  `${conflictSource}; result = isMediaSourceConflict(new Error("Failed to execute 'createMediaElementSource' on 'AudioContext': HTMLMediaElement already connected previously to a different MediaElementSourceNode."));`,
  conflictContext,
);
if (!conflictContext.result)
  throw new Error(
    "Stale MediaElementAudioSourceNode conflict was not classified correctly",
  );
const volumeScaleSource = contentSource.match(
  /function scaledMediaVolume\(baseVolume, outputPercent\) \{[\s\S]*?\n  \}/,
)?.[0];
if (!volumeScaleSource)
  throw new Error("Relative media volume scaler was not found");
const volumeScaleContext = {};
vm.runInNewContext(
  `${volumeScaleSource}; preserved = scaledMediaVolume(0.24, 100); boosted = scaledMediaVolume(0.24, 200);`,
  volumeScaleContext,
);
if (
  volumeScaleContext.preserved !== 0.24 ||
  volumeScaleContext.boosted !== 0.48
) {
  throw new Error(
    "Output volume no longer preserves the player's volume baseline",
  );
}
if (/media\.volume\s*=\s*1\b/.test(contentSource))
  throw new Error("Audio graph must not force media volume to 100%");
if (
  !/GET_SAVED_SETTINGS/.test(contentSource) ||
  !/const nextSettings = response.settings \|\| DEFAULTS;[\s\S]{0,80}?await apply\(nextSettings\)/.test(contentSource) ||
  !/RECORD_PAGE_PROFILE/.test(contentSource) ||
  !/const startingSettings = preferences\.rememberSites !== false && preferences\.autoApply !== false[\s\S]*?response\.trackProfile\?\.settings \|\| response\.pageProfile\?\.settings \|\| DEFAULTS/.test(
    popupSource,
  ) ||
  !/applySettings\(Boolean\(response\.pageState\?\.mediaCount\)\)/.test(popupSource)
) {
  throw new Error(
    "Unknown exact-page URLs must reset every control to neutral",
  );
}

const badgeCalls = [];
const backgroundSource = await readFile(resolve(root, "background.js"), "utf8");
const backgroundStorage = {
  preferences: { rememberSites: true, showBadge: true },
  pageProfiles: {},
};
const backgroundContext = {
  chrome: {
    runtime: {
      onInstalled: { addListener() {} },
      onMessage: { addListener() {} },
    },
    commands: { onCommand: { addListener() {} } },
    storage: {
      local: {
        async get(keys) {
          const selected =
            typeof keys === "string"
              ? [keys]
              : Array.isArray(keys)
                ? keys
                : Object.keys(backgroundStorage);
          return Object.fromEntries(
            selected
              .filter((key) => key in backgroundStorage)
              .map((key) => [key, backgroundStorage[key]]),
          );
        },
        async set(values) {
          Object.assign(backgroundStorage, values);
        },
      },
    },
    tabs: {},
    scripting: {},
    action: {
      async setBadgeText(value) {
        badgeCalls.push(["text", value]);
      },
      async setBadgeBackgroundColor(value) {
        badgeCalls.push(["background", value]);
      },
      async setBadgeTextColor(value) {
        badgeCalls.push(["color", value]);
      },
    },
  },
  console,
  URL,
};
vm.runInNewContext(backgroundSource, backgroundContext, {
  filename: "background.js",
});
await backgroundContext.updateBadge(7, { speed: 1, transpose: -2 }, true);
if (
  !badgeCalls.some(
    ([type, value]) => type === "text" && value.text === "-2",
  ) ||
  !badgeCalls.some(
    ([type, value]) => type === "background" && value.color === "#CDB4DB",
  )
) {
  throw new Error(
    "Transpose badge did not render with purple priority styling",
  );
}
badgeCalls.length = 0;
await backgroundContext.updateBadge(7, { speed: 1.2, transpose: -2 }, true);
if (
  !badgeCalls.some(
    ([type, value]) => type === "text" && value.text === "1.2×",
  ) ||
  !badgeCalls.some(
    ([type, value]) => type === "background" && value.color === "#FFAFCC",
  )
) {
  throw new Error("Speed badge did not take priority over transpose");
}
badgeCalls.length = 0;
await backgroundContext.updateBadge(
  7,
  { speed: 1, transpose: 0, pitch: 0.31, volume: 100, bass: 0, mid: 0, treble: 0, balance: 0, compressor: false, mono: false },
  true,
);
if (
  !badgeCalls.some(([type, value]) => type === "text" && value.text === "FX") ||
  !badgeCalls.some(([type, value]) => type === "background" && value.color === "#A2D2FF")
) {
  throw new Error("Pitch-only badge did not use the pitch-blue styling");
}
const migratedSettings = backgroundContext.migrateSettings(
  { speed: 1, transpose: 4, pitch: 64, volume: 100 },
  true,
);
if (migratedSettings.transpose !== 4 || migratedSettings.pitch !== 0.64) {
  throw new Error(
    "Legacy fine-pitch cents were not migrated to fractional semitones",
  );
}
const sanitizedSettings = backgroundContext.sanitizeSettings({
  transpose: 4.7,
  pitch: -0.64,
});
if (sanitizedSettings.transpose !== 5 || sanitizedSettings.pitch !== -0.64) {
  throw new Error(
    "Whole transpose and fractional pitch ranges were not sanitized correctly",
  );
}
await backgroundContext.persistSettings(
  { url: "https://music.example/watch?v=first#t=20", title: "First audio" },
  { speed: 1.25, transpose: 4, pitch: -0.31 },
);
await backgroundContext.persistSettings(
  { url: "https://music.example/watch?v=second", title: "Second audio" },
  { speed: 0.75, transpose: -2, pitch: 0.2 },
);
const firstPageProfile =
  backgroundStorage.pageProfiles["https://music.example/watch?v=first"];
const secondPageProfile =
  backgroundStorage.pageProfiles["https://music.example/watch?v=second"];
if (
  !firstPageProfile ||
  !secondPageProfile ||
  firstPageProfile.settings.pitch !== -0.31 ||
  secondPageProfile.settings.speed !== 0.75
) {
  throw new Error("Exact-page audio profiles were not stored independently");
}
if (
  backgroundContext.pageKey("https://music.example/watch?v=first#later") !==
  "https://music.example/watch?v=first"
) {
  throw new Error("Page profile keys must ignore playback-only URL fragments");
}

const formatPitchSource = popupSource.match(
  /function formatPitch\(value\) \{[\s\S]*?\n\}/,
)?.[0];
const formatPitchDigitsSource = popupSource.match(
  /function formatPitchDigits\(value\) \{[\s\S]*?\n\}/,
)?.[0];
const roundSource = popupSource.match(
  /function round\(value, digits\) \{[\s\S]*?\n\}/,
)?.[0];
const clampSource = popupSource.match(
  /function clamp\(value, min, max\) \{[\s\S]*?\n\}/,
)?.[0];
if (
  !formatPitchSource ||
  !formatPitchDigitsSource ||
  !roundSource ||
  !clampSource
)
  throw new Error("Compact pitch formatter was not found");
const pitchFormatContext = {};
vm.runInNewContext(
  `${roundSource}; ${clampSource}; ${formatPitchSource}; ${formatPitchDigitsSource}; positive = formatPitch(.64); negative = formatPitch(-.64); edge = formatPitch(1); digits = formatPitchDigits(-.64); edgeDigits = formatPitchDigits(1);`,
  pitchFormatContext,
);
if (
  pitchFormatContext.positive !== ".64" ||
  pitchFormatContext.negative !== "-.64" ||
  pitchFormatContext.edge !== "+1.00" ||
  pitchFormatContext.digits !== ".64" ||
  pitchFormatContext.edgeDigits !== "1.00"
) {
  throw new Error("Compact fractional pitch values were formatted incorrectly");
}
const slotRendererSource = popupSource.match(
  /function renderDigitalSlots\(element, value\) \{[\s\S]*?\n\}/,
)?.[0];
if (!slotRendererSource)
  throw new Error("Fixed-slot digital renderer was not found");
const slotContext = {
  document: {
    createElement() {
      return { dataset: {}, className: "", setAttribute() {} };
    },
  },
  element: {
    dataset: { shadow: "1.88" },
    children: [],
    replaceChildren(...children) {
      this.children = children;
    },
  },
};
vm.runInNewContext(
  `${slotRendererSource}; renderDigitalSlots(element, ".10"); lives = element.children.map((slot) => slot.dataset.live);`,
  slotContext,
);
if (JSON.stringify(slotContext.lives) !== JSON.stringify(["", ".", "1", "0"])) {
  throw new Error(
    "Pitch digits were not mapped into the fixed 1.88 segment slots",
  );
}
const pitchFrequencySource = popupSource.match(
  /function pitchFrequency\(value\) \{[\s\S]*?\n\}/,
)?.[0];
const numberSource = popupSource.match(
  /function number\(value, fallback\) \{[\s\S]*?\n\}/,
)?.[0];
if (!pitchFrequencySource || !numberSource)
  throw new Error("Pitch frequency formatter was not found");
const frequencyContext = {};
vm.runInNewContext(
  `${numberSource}; ${clampSource}; ${pitchFrequencySource}; neutral = pitchFrequency(0); down = pitchFrequency(-1); up = pitchFrequency(1);`,
  frequencyContext,
);
if (
  frequencyContext.neutral !== 440 ||
  Math.abs(frequencyContext.down - 415.3047) > 0.001 ||
  Math.abs(frequencyContext.up - 466.1638) > 0.001
) {
  throw new Error("Pitch-to-frequency conversion is incorrect");
}

const worklet = await readFile(
  resolve(root, "audio/soundtouch-processor.js"),
  "utf8",
);
new vm.Script(worklet, { filename: "audio/soundtouch-processor.js" });
if (
  !/cutoff \* normalizedSinc\(cutoff \* distance\)/.test(worklet) ||
  !/historyFrames/.test(worklet)
) {
  throw new Error("Band-limited streaming Lanczos safeguards were not found");
}
if (
  /if \(this\._rate > 1\)/.test(worklet) ||
  !/process\(\) \{\s*this\.stretch\.process\(\);\s*this\.transposer\.process\(\);\s*\}/.test(
    worklet,
  )
) {
  throw new Error(
    "Pitch processing must retain one stable DSP topology across unity",
  );
}

let WorkletProcessor;
class MockAudioWorkletProcessor {
  constructor() {
    this.port = { postMessage() {}, onmessage: null };
  }
}
vm.runInNewContext(worklet, {
  AudioWorkletProcessor: MockAudioWorkletProcessor,
  registerProcessor(_name, Processor) {
    WorkletProcessor = Processor;
  },
  sampleRate: 48000,
  console,
  performance,
});
if (!WorkletProcessor) throw new Error("SoundTouch worklet did not register");

const processor = new WorkletProcessor({
  processorOptions: {
    sampleBufferType: "circular",
    interpolationStrategy: "lanczos",
  },
});
processor.port.onmessage({
  data: {
    type: "set-stretch-parameters",
    params: { sequenceMs: 0, seekWindowMs: 0, overlapMs: 12, quickSeek: false },
  },
});
let outputEnergy = 0;
let nonSilentBlocks = 0;
let outputStarted = false;
let silentBlocksAfterStart = 0;
for (let block = 0; block < 500; block += 1) {
  const left = new Float32Array(128);
  const right = new Float32Array(128);
  for (let frame = 0; frame < 128; frame += 1) {
    const sample =
      Math.sin(((block * 128 + frame) / 48000) * Math.PI * 2 * 330) * 0.4;
    left[frame] = sample;
    right[frame] = sample;
  }
  const outputLeft = new Float32Array(128);
  const outputRight = new Float32Array(128);
  const sweep = block / 499;
  const playbackRate = 1;
  const pitchSemitones = -4.83 + sweep * 9.66;
  const fractionalPitch = -0.64 + sweep * 1.28;
  processor.process([[left, right]], [[outputLeft, outputRight]], {
    playbackRate: Float32Array.of(playbackRate),
    pitchSemitones: Float32Array.of(pitchSemitones),
    pitch: Float32Array.of(2 ** (fractionalPitch / 12)),
  });
  const energy = outputLeft.reduce((sum, value) => sum + Math.abs(value), 0);
  if (!Number.isFinite(energy))
    throw new Error("SoundTouch worklet produced non-finite output");
  if (energy > 0.001) {
    nonSilentBlocks += 1;
    outputStarted = true;
  } else if (outputStarted) silentBlocksAfterStart += 1;
  outputEnergy += energy;
}
if (outputEnergy <= 0 || nonSilentBlocks < 100) {
  throw new Error(
    `SoundTouch worklet output was unstable (${nonSilentBlocks} non-silent blocks)`,
  );
}
if (silentBlocksAfterStart > 1)
  throw new Error(
    `SoundTouch worklet dropped ${silentBlocksAfterStart} blocks after startup`,
  );

const octaveWsola = new WorkletProcessor({
  processorOptions: {
    sampleBufferType: "circular",
    interpolationStrategy: "lanczos",
  },
});
octaveWsola.port.onmessage({
  data: {
    type: "set-interpolation-strategy-params",
    params: { zeroCrossings: 8, normalize: true },
  },
});
let wsolaLowSquare = 0;
let wsolaLowSamples = 0;
let wsolaHighSquare = 0;
let wsolaHighSamples = 0;
let lowPositiveCrossings = 0;
let highPositiveCrossings = 0;
let previousLowSample = null;
let previousHighSample = null;
let octaveStarted = false;
let octaveGaps = 0;
let octaveActiveBlocks = 0;
const octaveGapDetails = [];
for (let block = 0; block < 700; block += 1) {
  const left = new Float32Array(128);
  const right = new Float32Array(128);
  for (let frame = 0; frame < 128; frame += 1) {
    const sample =
      Math.sin(((block * 128 + frame) / 48000) * Math.PI * 2 * 330) * 0.4;
    left[frame] = sample;
    right[frame] = sample;
  }
  const outputLeft = new Float32Array(128);
  octaveWsola.process([[left, right]], [[outputLeft, new Float32Array(128)]], {
    playbackRate: Float32Array.of(1),
    pitchSemitones: Float32Array.of(block < 350 ? -12 : 12),
    pitch: Float32Array.of(1),
  });
  const energy = outputLeft.reduce((sum, value) => sum + Math.abs(value), 0);
  if (energy > 0.001) {
    octaveStarted = true;
    octaveActiveBlocks += 1;
  } else if (octaveStarted) {
    octaveGaps += 1;
    octaveGapDetails.push(
      `${block}:${octaveWsola._pipe.outputBuffer.frameCount}`,
    );
  }
  if (block >= 100 && block < 330) {
    wsolaLowSquare += outputLeft.reduce((sum, value) => sum + value * value, 0);
    wsolaLowSamples += outputLeft.length;
    for (const sample of outputLeft) {
      if (previousLowSample !== null && previousLowSample <= 0 && sample > 0)
        lowPositiveCrossings += 1;
      previousLowSample = sample;
    }
  }
  if (block >= 390 && block < 680) {
    wsolaHighSquare += outputLeft.reduce(
      (sum, value) => sum + value * value,
      0,
    );
    wsolaHighSamples += outputLeft.length;
    for (const sample of outputLeft) {
      if (previousHighSample !== null && previousHighSample <= 0 && sample > 0)
        highPositiveCrossings += 1;
      previousHighSample = sample;
    }
  }
}
const expectedRms = 0.4 / Math.sqrt(2);
const lowOctaveRms = Math.sqrt(wsolaLowSquare / wsolaLowSamples);
const highOctaveRms = Math.sqrt(wsolaHighSquare / wsolaHighSamples);
const lowOctaveHz = lowPositiveCrossings / (wsolaLowSamples / 48000);
const highOctaveHz = highPositiveCrossings / (wsolaHighSamples / 48000);
if (octaveGaps > 0 || octaveActiveBlocks < 600) {
  throw new Error(
    `Octave sweep was unstable (${octaveActiveBlocks}/700 active blocks, ${octaveGaps} gaps; block:buffer ${octaveGapDetails.join(", ")})`,
  );
}
if (
  Math.abs(lowOctaveRms - expectedRms) > 0.02 ||
  Math.abs(highOctaveRms - expectedRms) > 0.02 ||
  Math.abs(lowOctaveRms - highOctaveRms) > 0.01
) {
  throw new Error(
    `Octave gain drifted (input ${expectedRms.toFixed(5)}, -12 ${lowOctaveRms.toFixed(5)}, +12 ${highOctaveRms.toFixed(5)})`,
  );
}
if (Math.abs(lowOctaveHz - 165) > 5 || Math.abs(highOctaveHz - 660) > 10) {
  throw new Error(
    `Octave frequencies drifted (-12 ${lowOctaveHz.toFixed(1)} Hz, +12 ${highOctaveHz.toFixed(1)} Hz)`,
  );
}

for (const htmlPath of [
  "popup/popup.html",
  "popup/history.html",
  "options/options.html",
  "options/privacy.html",
]) {
  const html = await readFile(resolve(root, htmlPath), "utf8");
  if (/<script(?![^>]*\bsrc=)/i.test(html))
    throw new Error(`Inline script found in ${htmlPath}`);
  // Outbound navigation links do not load remote assets into the extension.
  const assetMarkup = html.replace(/(<a\b[^>]*?\bhref=)["']https?:\/\/[^"']*["']/gi, '$1""');
  if (/https?:\/\//i.test(assetMarkup))
    throw new Error(`Remote asset found in ${htmlPath}`);
}

console.log(
  `TuneShift validation passed (${required.length} required files, ${scripts.length + 1} scripts parsed, sweep ${nonSilentBlocks}/500 active blocks, octave RMS -12 ${lowOctaveRms.toFixed(5)} / +12 ${highOctaveRms.toFixed(5)}, octave pitch ${lowOctaveHz.toFixed(1)} / ${highOctaveHz.toFixed(1)} Hz, ${silentBlocksAfterStart + octaveGaps} post-start gaps).`,
);
