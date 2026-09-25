<p align="center">
  <img src="assets/icons/icon-128.png" alt="TuneShift icon" width="80">
</p>

<h1 align="center">TuneShift</h1>

<p align="center">
  Speed, pitch, and audio controls for media in your current Chrome tab.
  <br>
  <sub>Chrome 116+ · Manifest V3 · Version 1.20.3</sub>
</p>

TuneShift lets you change playback speed without changing pitch, transpose audio, fine tune pitch, and shape the sound. It runs locally in Chrome. Open the popup for a compact controller, or keep it available in the side panel.

## What you can do

| Control | Details |
| --- | --- |
| Speed and tempo | Set speed from 0.25× to 4.00×. Detect BPM, tap a beat, or enter and correct it manually. The displayed BPM follows playback speed. |
| Pitch | Transpose by up to 12 semitones and fine tune by up to 1 semitone independently of speed. |
| Audio | Adjust output up to 200%, six EQ bands, stereo balance, voice focus, mono, and channel swap. |
| Practice | Set A–B loops, repeat a track, save cues, seek, and use built-in or custom Quick profiles. |
| Remember | Save tuning for a page or track when **Remember each page** is on. Manage saved items in History. |
| Access | Use the popup, side panel, optional floating controller, or keyboard shortcuts. Switch TuneShift off to restore the player's original settings. |

The Speed card has a second page for the larger BPM display, tap tempo, and half/double corrections. Cue times can be edited precisely in a popup.

## Install from this repository

1. Download and extract the repository ZIP from GitHub, or clone the repository.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select the folder containing `manifest.json`.
4. Open a regular HTTP or HTTPS page with audio or video, start playback, then open TuneShift.

The bundled runtime files are already in the repository. You do not need `npm install` to load the extension. After updating the files, click **Reload** on the extension card and refresh any open media tabs.

> Chrome restricts extensions on internal pages and the Chrome Web Store. For local files, enable **Allow access to file URLs** in TuneShift's extension details.

## Controls at a glance

| Shortcut | Action |
| --- | --- |
| `Alt+Shift+Up` | Increase speed |
| `Alt+Shift+Down` | Decrease speed |
| `Alt+Shift+Space` | Play or pause |
| `Alt+Shift+R` | Reset controls |

Change shortcuts at `chrome://extensions/shortcuts`.

### When audio cannot be processed

Some protected or cross-origin players block direct audio effects or BPM detection. The optional **Enable tab effects** control can process selected-tab audio when Chrome permits capture. Chrome asks for permission when you enable it and shows a capture indicator while it runs. TuneShift does not bypass DRM. If an effect stops working after an extension update, use **Refresh tab** in the popup.

## Permissions and privacy

| Access | Why TuneShift uses it |
| --- | --- |
| `activeTab` and `scripting` | Find and control media in the tab you select. |
| `storage` | Keep preferences, custom profiles, and optional saved tuning and BPM records on your device. |
| `offscreen` | Process selected-tab audio when tab effects are active. |
| `sidePanel` | Show the controller in Chrome's side panel. |
| Optional `tabCapture` | Capture selected-tab audio only after you choose **Enable tab effects**. |
| `open.spotify.com` page hook | Make detached Spotify media elements available to the controller. |

Audio is processed locally and is not recorded or uploaded. TuneShift has no account or analytics. Read the [full privacy policy](options/privacy.html) for storage and deletion details.

## For contributors

| Path | Purpose |
| --- | --- |
| `popup/` and `options/` | Controller, history, and settings |
| `content/` | Media control and Spotify compatibility hook |
| `background.js` | Tab coordination, storage, shortcuts, and badge |
| `audio/` | Bundled audio processors and tab effects |
| `scripts/` | Validation checks |

Run `npm ci` and `npm run check` to check source structure and audio behavior. These checks do not replace trying the extension in Chrome. See the [changelog](CHANGELOG.md) for release history and [Chrome Web Store notes](docs/chrome-web-store.md) for Store submission details.

TuneShift's own code is [MIT licensed](LICENSE). Bundled SoundTouchJS, Realtime BPM Analyzer, Lucide icons, Sora, and DSEG7 retain their respective licenses in `audio/` and `assets/`.
