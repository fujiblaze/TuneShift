# Changelog

## Version 1.20.3

- Center the forward seek duration under its icon.
- Keep the compact BPM readout beside Speed's reset button. Clicking Speed opens the larger tempo display, tap tempo, and half/double corrections on a second page with one BPM unit label.
- Edit cues in a popup dialog with exact time entry and arrow-key nudging.

## Version 1.20.2

- Place seek durations below their arrow icons with a fixed gap.
- Register the bundled DSEG font with the document and share its load across floating-controller openings.
- Align ghost segments directly behind the floating digits, excluding the unit label.

## Version 1.20.1

- Skip full popup control rendering when a playback poll reports unchanged settings.
- Update only floating progress on media time events, and redraw the play icon when playback state changes.
- Scan DOM mutation records for new media without creating a temporary array for each record.

## Version 1.20.0

- Save up to 20 custom Quick profiles from the current audio controls. Rename or delete them from the profile tile. Copy and paste tuning from the header.
- Correct a detected or manual source BPM with half and double buttons. The effective BPM display still follows playback speed.
- Edit exact A-B times in mm:ss.xx form and nudge by 0.1 seconds with the arrow keys.
- Use This track to keep tuning separate from the page profile when a stable track identity is available. Track profiles are capped at 200, and clearing history removes them.
- The floating controller has a compact progress bar, backward and forward seek, and a digital value with ghost digits. The playback balance icon shows a red center line while channels are swapped.

## Version 1.19.0

- Tab capture is an optional permission requested when tab effects are enabled.
- Remember each page now controls BPM persistence and restoration as well as page profiles.
- Clear history removes page profiles and BPM records; removing one page removes its BPM records.
- Saved BPM entries expire after 90 days and are capped at 300 tracks.
- Settings now explains the Spotify page-start hook and links to the bundled privacy policy. The layout and controls remain the same.
- The Chrome Web Store submission copy and reviewer steps are in `docs/chrome-web-store.md`. Host `options/privacy.html` on a public HTTPS URL before submitting the listing.

## Version 1.18.3

- Hidden the scrollbar in the controller, history, and embedded Settings while preserving scrolling.
- Shared the fixed popup dimensions across all three views to prevent resizing on Settings navigation.
- Kept sidebar views sized to the available panel height.

### Decimal time counter

Click the timer to switch between elapsed/total time and decimal elapsed time. The alternate view shows two decimal places in minutes below one hour and hours from one hour onward, with digital digits, an `88.88` segment shadow, and Sora unit labels. This replaces the timer's percentage view.

### Settings cleanup

Saved audio pages are managed in the dedicated history view. Removed the duplicate list from Settings and replaced the keyboard-shortcuts text arrow with an SVG external-link icon.

## Version 1.18.2

- Settings now opens inside the popup or sidebar, with a back button and compact layout.
- Preserved every existing settings control and saved-page management action.
- Preference edits preserve sidebar mode and other saved preferences.
- Updated the privacy text to describe optional local tab-audio effects.

### Repeat correction

Repeat track now uses native media looping. Counted repeats intercept the end event before the player's playlist handler advances. Turning repeat off or bypassing TuneShift restores the player's previous native loop setting. Refresh existing media tabs after updating to replace the old repeat handler.

## Version 1.18.1

- Added a persistent Sidebar footer switch and native Chrome side panel.
- Adapted the controller and saved-page history to narrow panel widths.
- Kept panel commands scoped to their browser window and guarded against stale tab edits.

## Version 1.18

- Keep the selected speed when a player resets its playback rate. Turning TuneShift off restores player control.

- Start playback on a protected player, open TuneShift, click the tab-effects button in the header, then choose **Enable tab effects**. The button lights up while tab effects are active; click it for status and refresh controls. Use **Stop tab effects** to return to the normal audio path. Enabling is a per-session choice and is never automatic.
- Tab effects share the existing pitch, EQ, balance, mono, channel-swap, voice compression and output-volume processing. The page continues to control playback speed and seeking.
- Capture stops on navigation, tab closure or global bypass. A failed capture or 15 seconds without an initial audio signal releases capture and restores the page audio path. Silent introductions longer than this may require enabling again after sound begins.
- This mode processes all audio in the selected tab. Chrome or a protected player may prevent capture; Spotify DRM playback has not been verified live. Native playback controls remain available where the player supports them.
- Voice focus lights the output speaker indicator in pastel green. Muting keeps its red indicator.
- The header follows the tab title, including song-title changes on the same URL, and falls back to the site address when no title is available.
- Reload the extension and refresh existing media tabs after installing this update. The visible header and manifest both use `1.18`.

## Version 1.17.1

- Fixed the blank-area jump when toggling Floating controls. Hidden checkbox focus stays inside its label, and both popup views use an explicit 600-pixel height. The popup does not depend on viewport-relative or percentage heights during Chrome auto-sizing.
- Replaced pagination characters with centered SVG chevrons. Increased the spacing between Output/Balance values and their reset buttons to 8 pixels.
- Restored the media-source count to 9 pixels. Replaced Set cue and Reset tuning with Remember and Auto-apply switches that use the existing preferences and preserve other settings.
- Reuse unchanged cue rows and timer digits during polling, and avoid rewriting unchanged tooltip data. Cue actions resolve the current saved items after a refresh.

## Version 1.17

- Added Velvet, Sparkle, Cinema, Lo-fi, Radio, Night, and Mirror profiles using the expanded studio controls. Fourteen profiles occupy two pages of seven, with navigation next to Quick profiles and distinct pastel accents.
- Voice focus, Mono, and Swap channels now share one row.
- Added Set cue and Reset tuning after Floating controls. Set cue saves the current position; Reset tuning uses the existing Reset all action, including clearing loop markers and cues.
- Added Copy tuning at the top right. It copies the current settings as JSON.
- Added individual reset buttons beside Output and Balance, restoring 100% and Center respectively.
- Both popup views use a fixed 520 by 600 pixel viewport with internal scrolling. The cached theme loads before rendering, avoiding content-driven resizing and theme flashes when opening Saved tuning.
- Release metadata and the visible header use 1.17, without a trailing .0.

## Version 1.16.1

- Expanded Studio controls to six sliders in frequency order: Sub bass at 60 Hz, Bass at 180 Hz, Warmth at 350 Hz, Voice at 1.2 kHz, Clarity at 4.8 kHz, and Air at 10 kHz. Each ranges from -12 to +12 dB.
- Added Swap channels beneath Voice focus and Mono. It reverses left and right before the balance control, with a short crossfade when toggled. Mono still merges both channels.
- New settings are saved per audio page, reset with the other controls, included in profile matching and the EQ indicator, and disabled on protected audio. Existing saved profiles default to neutral values for the new controls.

## Version 1.16.0

- All status glyphs fade between muted and active colors, with stable hover tooltips. The progress digits use the normal cursor.
- Output lights the speaker and first bar at 125%, the second bar at 150%, and the final bar at 200%. Protected audio has no boost bars. At 0%, a red muted-speaker icon replaces the bars.
- Pitch uses purple when only transpose is changed. Fine-pitch changes take color priority and use blue. The highlighted section follows the combined pitch offset.
- Added Repeat once, Repeat twice, and Repeat 5 times. Each counts extra plays after the current play, then switches Off. A-B looping takes priority and does not consume the repeat count.
- Cues use three columns, up to nine per audio, with the name on the left and a digital timestamp on the right. Existing lists retain their first nine cues.
- Detected, entered, and tapped source BPM values are saved locally and restored after page reloads. Playback speed scales the display without changing the saved original tempo. YouTube video IDs survive changes to stream URLs. Other tracks use their media URL, a Spotify track URL, or available media-session metadata for blob streams. Anonymous blob streams without track metadata keep the existing session cache.

## Version 1.15.0

- Combined tempo and pitch direction pairs into split symbols. Tempo lights on the left for lower values and right for higher. Pitch uses a musical note with a lower section for lower values and an upper section for higher values. Tempo stays pink and pitch blue.
- Click the timer to switch between elapsed/total time and percentage completed. Its tooltip shows the other format. Tracks over an hour show two decimal places below 10% and one from 10% to completion.
- Added small digital progress numbers after Mono, with a tooltip showing percentage and elapsed/total time. Seeking previews both progress displays.
- Added the active tab's favicon between the status dot and site name. Missing or unavailable favicons are hidden.

- Progress digits sit directly beside Mono. Time and percentage tooltips keep their hover-entry values until the next hover, avoiding playback-update flicker.
- Seek button numbers, tooltips, accessible labels, and actions follow the configured seek distance, including changes made while the popup is open.

## Version 1.14.0

- Added compact indicators before the timer for A-B looping, tempo up/down, pitch up/down, maximum output volume, stereo balance, repeat, EQ, and mono.
- Tempo arrows compare playback speed with the original track. Pitch arrows use the combined transpose and fine-pitch offset.
- Separate left and right balance arcs light at 100% left or right. Maximum volume lights at 200%, or 100% for protected audio.
- Indicators include state tooltips and accessible labels, with colors for dark and light themes. They stay muted when no media is available or TuneShift is off. Unavailable DSP settings stay muted on protected audio.

## Version 1.13.1

- Wait up to 15 seconds for playable audio during track startup. Empty capture streams and temporary capture errors no longer immediately fail detection.
- Resume after a startup timeout when the player emits playing or canplay. Startup failures are not cached as permanent track results. Successful and manual BPM results remain stable.
- Cancel pending startup when switching tracks, disabling TuneShift, or entering/tapping BPM manually.
- Show Waiting... before playback and Set BPM when automatic analysis is unavailable. The tooltip gives the failure reason. Click the status to enter BPM.
- Validated delayed video audio with regression fixtures. Live YouTube Music playback has not been verified.

## Version 1.13.0

- Replaced the polling-based spectral-flux estimator with Realtime BPM Analyzer 5.0.15, bundled as a local AudioWorklet under Apache-2.0. See `audio/BPM-ANALYZER-LICENSE.txt` and https://github.com/dlepaux/realtime-bpm-analyzer.
- Automatic and manual BPM results are retained for the track. Page title updates, changing duration estimates, and repeated metadata events no longer discard them. Up to 30 track results remain cached for the page controller's lifetime.
- A changed track starts fresh analysis. Seeking or changing speed during analysis clears the in-progress sample; changing speed after a result scales its display without redetecting. Manual tapping cancels the automatic detector immediately.
- Failed analysis stops after 35 seconds of playback instead of retrying repeatedly. Tap tempo and direct numeric entry remain available. Beat estimates can still be ambiguous, especially with quiet music or half/double-time rhythms.
- The BPM header shows Detecting... during analysis, Tap again after the first tap, and BPM digits after detection or further taps. Click the status text to enter a BPM manually.
- Quick profiles highlight when their audio settings match the current controls, including restored settings. Loop markers, cues and repeat mode do not affect matching. Custom audio settings clear the highlight.
- Permissions and DRM restrictions are unchanged.

## Version 1.12.0

- Edit any cue name and timestamp using the pencil button. Enter seconds, m:ss, or h:mm:ss. Save applies the changes; Cancel or Escape discards the draft.
- Stereo balance now sits beneath Output, with matching slider widths and spacing. It uses the existing balance setting and remains unavailable on protected audio.
- Centered the waveform around the middle of the rounded icon and regenerated all toolbar sizes.
- DRM handling and permissions are unchanged in this release. Tab-audio processing is a separate proposal pending permission approval.

## Version 1.11.1

- Shared themed dropdowns in the popup and settings, with animated menus, keyboard controls, and reduced-motion support.
- Saved audio URLs use Sora instead of the digital display font.
- Corrected the manifest name and replaced the green toolbar icons with the pink and lavender palette at every icon size.

## Version 1.11.0

- Added Dreamy, a slower low-pitch profile, and Practice, a pitch-preserving 0.75× profile. All seven quick profiles use bundled Lucide icons.
- Output, A–B loop and Repeat sit side by side. Set A, then B at a later timestamp. Pause the loop without clearing the markers.
- Repeat offers Off and This track. An enabled A–B loop takes priority.
- Add up to 30 cues per saved page. Click a cue to seek, or its remove button to delete it. Jumping outside an active loop pauses the loop. Cues follow the existing Remember each page preference.
- Protected tracks use native volume up to 100%. Unavailable pitch controls and pitch profiles are disabled. Lecture and Podcast retain their speed setting without applying their audio effects.
- Spotify's hook now loads at document start and adopts detached players when created or played. The popup includes a direct Refresh tab action.
