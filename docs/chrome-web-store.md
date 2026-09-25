# Chrome Web Store submission notes for TuneShift 1.20.3

Publish `options/privacy.html` at a public HTTPS URL and enter that URL in the Chrome Web Store Privacy practices tab before submission. The extension's Settings link opens the bundled copy. Keep the public copy identical to the bundled one.

## Single purpose

TuneShift controls and locally processes audio and video playback in the tab selected by the user, including speed, pitch, transpose, volume, EQ, loops, and BPM tools.

## Permission explanations

- `activeTab`: Temporarily accesses the selected tab so TuneShift can locate and control its media elements.
- `scripting`: Injects the bundled media controller after the user invokes TuneShift.
- `storage`: Saves preferences, presets, optional page profiles, and optional BPM records locally.
- `tabCapture` (optional): Captures selected-tab audio only when the user presses Enable tab effects. Audio is processed in memory and played locally.
- `offscreen`: Hosts local audio processing while tab effects are active.
- `sidePanel`: Opens the optional persistent controller in Chrome's side panel.
- Spotify site access: Runs a bundled page-start compatibility hook on open.spotify.com to expose detached media elements. The hook does not transmit data.

## Privacy practices

Disclose page URLs, titles, media URLs or media-session metadata, and tab audio processed locally for playback control. State that page and track profiles, custom Quick profiles, and BPM records are optional local storage and that audio is not recorded or uploaded. Declare no analytics, advertising, sale, or third-party transfer. Match the dashboard selections to the current package and the published privacy policy.

## Reviewer test instructions

1. Open a regular HTTPS page with an HTML5 audio or video element and start playback.
2. Open TuneShift. Change speed and pitch or transpose and confirm playback changes.
3. Test volume, EQ, balance, looping, and BPM controls.
4. Press Enable tab effects during playback. Grant the optional capture permission and confirm that effects work. Press Stop tab effects to end capture.
5. On open.spotify.com, the bundled page-start hook exposes detached media elements to TuneShift. Some protected streams may prevent processing; TuneShift does not bypass DRM.
6. In Settings, turn off Remember each page. New page profiles and BPM records will not be saved. In History, Clear history removes both kinds of saved records.

Capture Store screenshots from the actual v1.20.3 Chrome UI. Suggested subjects are the main controller, pitch and EQ, loop and presets, and Settings or History. Do not use generated mockups as screenshots.
