(() => {
  if (globalThis.__tuneShiftController) {
    globalThis.__tuneShiftController.refresh();
    return;
  }

  const DEFAULTS = {
    speed: 1,
    transpose: 0,
    pitch: 0,
    volume: 100,
    subBass: 0, warmth: 0, air: 0, swapChannels: false, bass: 0,
    mid: 0,
    treble: 0,
    balance: 0,
    compressor: false,
    mono: false,
    loopA: null,
    loopB: null,
    repeat: "off", loopEnabled: true, cues: [],
    overlay: false,
  };

  let settings = { ...DEFAULTS };
  let enabled = true;
  let tabEffectsActive = false;
  let activeMedia = null;
  let overlayHost = null;
  let overlayMode = "speed";
  let overlaySeekMedia = null;
  let overlaySeekTimer = null;
  let refreshQueued = false;
  let audioContext = null;
  let processorReady = null;
  let lastAudioError = null;
  let lastAudioErrorCode = null;
  let currentPageKey = pageKey(location.href);
  let lastProfileIdentity = "";
  let activeTrackProfile = false;
  let profileSyncToken = 0;
  let settingsRevision = 0;
  const encryptedMedia = new WeakSet();
  const knownMedia = new WeakSet();
  const originalMediaState = new WeakMap();
  const controlledVolumes = new WeakMap();
  const graphs = new Map();
  let bpmState = { value: null, status: "idle", source: null, confidence: 0 };
  let bpmTrackKey = "";
  let bpmDetector = null;
  let cancelBpmStartup = null;
  let bpmDetectionToken = 0;
  const bpmResults = new Map();
  const bpmMediaIds = new WeakMap();
  let nextBpmMediaId = 0;
  let bpmRestorePending = null;
  let repeatRemaining = 0;
  let repeatTrackKey = "";
  const repeatLoopOwners = new WeakMap();

  function repeatCount(mode) { return ({ once: 1, twice: 2, five: 5 })[mode] || 0; }


  function allMedia() {
    return [...document.querySelectorAll("video, audio")];
  }

  function scoreMedia(media) {
    const rect = media.getBoundingClientRect();
    const area = Math.max(0, rect.width) * Math.max(0, rect.height);
    return (
      (media.paused ? 0 : 1_000_000_000) +
      area +
      (media.currentTime > 0 ? 1000 : 0)
    );
  }

  function findActiveMedia() {
    const media = allMedia().filter(
      (item) => item.readyState > 0 || item.src || item.currentSrc,
    );
    if (!media.length) return null;
    return media.sort((a, b) => scoreMedia(b) - scoreMedia(a))[0];
  }

  function hasPracticeLoop() {
    return settings.loopEnabled && settings.loopA !== null && settings.loopB > settings.loopA;
  }

  function syncRepeatLoop(media) {
    const controlsLoop = enabled && media === activeMedia && (settings.repeat === "track" || repeatCount(settings.repeat) > 0 || hasPracticeLoop());
    const wantsLoop = settings.repeat === "track" && !hasPracticeLoop();
    if (controlsLoop) {
      if (!repeatLoopOwners.has(media)) repeatLoopOwners.set(media, Boolean(media.loop));
      if (media.loop !== wantsLoop) media.loop = wantsLoop;
    } else if (repeatLoopOwners.has(media)) {
      media.loop = repeatLoopOwners.get(media);
      repeatLoopOwners.delete(media);
    }
  }

  function handleRepeatEnd(media, event) {
    if (!enabled || media !== activeMedia) return;
    const looping = hasPracticeLoop();
    const limited = repeatCount(settings.repeat) > 0 && repeatRemaining > 0;
    if (!looping && settings.repeat !== "track" && !limited) { updateOverlay(); return; }
    // A source/page change is a new track, not an ending to replay.
    if (repeatTrackKey !== bpmKey(media) || currentPageKey !== pageKey(location.href)) return;
    try { media.currentTime = looping ? settings.loopA : 0; }
    catch (_) { return; }
    // ended is not cancelable. Stop propagation before the player's target
    // listeners can advance its playlist, including on the final counted replay.
    event?.stopImmediatePropagation();
    if (!looping && limited && --repeatRemaining === 0) {
      settings.repeat = "off";
      chrome.runtime.sendMessage?.({ type: "RECORD_PAGE_PROFILE", settings, trackKey: activeMedia ? persistentBpmKey(activeMedia) : null }).catch(() => undefined);
    }
    syncRepeatLoop(media);
    media.play().catch(() => undefined);
  }

  document.addEventListener?.("ended", event => handleRepeatEnd(event.target, event), true);

  function registerMedia(media) {
    if (knownMedia.has(media)) return;
    knownMedia.add(media);
    media.addEventListener("encrypted", () => {
      encryptedMedia.add(media);
      failBpmDetection(bpmDetectionToken);
      applyToMedia(media);
    });
    // Capture also covers detached media that cannot reach document.
    media.addEventListener("ended", event => handleRepeatEnd(media, event), true);
    originalMediaState.set(media, {
      defaultPlaybackRate: media.defaultPlaybackRate,
      playbackRate: media.playbackRate,
      preservesPitch: media.preservesPitch,
      webkitPreservesPitch:
        "webkitPreservesPitch" in media
          ? media.webkitPreservesPitch
          : undefined,
      volume: media.volume,
    });
    media.addEventListener("play", async () => {
      const previousMedia = activeMedia;
      activeMedia = media;
      if (previousMedia && previousMedia !== media) syncRepeatLoop(previousMedia);
      syncBpmForMedia(media);
      syncRepeatLoop(media);
      syncStoredProfile();
      if (enabled && needsAudioPipeline(settings) && !isProtectedMedia(media))
        await ensureGraph(media);
      await resumeAudio();
      applyToMedia(media);
      updateOverlay();
    });
    media.addEventListener("loadedmetadata", () => {
      if (media === activeMedia) {
        syncBpmForMedia(media);
        syncStoredProfile();
      }
      applyToMedia(media);
    });
    const retryBpmWhenReady = () => {
      if (media !== activeMedia || !enabled) return;
      if (bpmState.status === "failed" && bpmState.retryable) {
        bpmState = { value: null, status: "idle", source: null, confidence: 0 };
      }
      syncBpmForMedia(media);
    };
    media.addEventListener("playing", retryBpmWhenReady);
    media.addEventListener("canplay", retryBpmWhenReady);
    media.addEventListener("pause", () => { if (media === activeMedia) updateOverlay(); });
    media.addEventListener("seeking", () => showOverlaySeekTime(media));
    media.addEventListener("seeked", () => showOverlaySeekTime(media));
    media.addEventListener("ratechange", () => {
      // Players may reset their native rate after TuneShift applies a setting.
      // Only write changed values so our own ratechange events settle.
      if (enabled) {
        if (Math.abs(media.defaultPlaybackRate - settings.speed) > 0.001)
          media.defaultPlaybackRate = settings.speed;
        if (Math.abs(media.playbackRate - settings.speed) > 0.001)
          media.playbackRate = settings.speed;
      }
      if (bpmDetector?.media === media && Math.abs(media.playbackRate - bpmDetector.rate) > 0.001) {
        stopBpmDetector();
        bpmDetectionToken += 1;
        bpmState = { value: null, status: "idle", source: null, confidence: 0 };
        startBpmDetection(media);
      }
    });
    media.addEventListener("volumechange", () => {
      const expected = controlledVolumes.get(media);
      if (
        expected !== undefined &&
        Math.abs(media.volume - expected) < 0.0001
      ) {
        controlledVolumes.delete(media);
        return;
      }
      const original = originalMediaState.get(media);
      if (original) original.volume = media.volume;
      if (enabled && !tabEffectsActive && !graphs.has(media) && settings.volume !== 100)
        applyMediaVolume(media);
    });
    media.addEventListener("timeupdate", () => {
      syncRepeatLoop(media);
      if (
        enabled &&
        media === activeMedia &&
        settings.loopEnabled &&
        settings.loopA !== null &&
        settings.loopB !== null &&
        settings.loopB > settings.loopA
      ) {
        if (
          media.currentTime >= settings.loopB ||
          media.currentTime < settings.loopA - 0.5
        )
          media.currentTime = settings.loopA;
      }
      if (media === activeMedia) {
        if (overlaySeekMedia === media) updateOverlay();
        else updateOverlayProgress();
      }
    });
    applyToMedia(media);
  }

  function refresh() {
    for (const [media, graph] of graphs) {
      if (!media.isConnected) {
        disconnectGraph(graph);
        graphs.delete(media);
      }
    }
    const previousMedia = activeMedia;
    if (activeMedia && !activeMedia.isConnected) activeMedia = null;
    for (const media of allMedia()) registerMedia(media);
    activeMedia = findActiveMedia() || activeMedia;
    if (previousMedia && previousMedia !== activeMedia) syncRepeatLoop(previousMedia);
    if (activeMedia) { syncBpmForMedia(activeMedia); syncRepeatLoop(activeMedia); }
    syncStoredProfile();
    updateOverlay();
  }

  function queueRefresh() {
    if (refreshQueued) return;
    refreshQueued = true;
    requestAnimationFrame(() => {
      refreshQueued = false;
      refresh();
    });
  }

  function bpmKey(media) {
    if (!bpmMediaIds.has(media)) bpmMediaIds.set(media, ++nextBpmMediaId);
    const source = media.currentSrc || media.src || `element:${bpmMediaIds.get(media)}`;
    return `${pageKey(location.href)}|${source}`;
  }

  function persistentBpmKey(media) {
    const page = pageKey(location.href);
    const url = new URL(page);
    // Video IDs survive signed stream URLs and blob replacement on reload.
    if (youTubeVideoId(url) || /\/track\/[^/]+/.test(url.pathname) && /(^|\.)spotify\.com$/.test(url.hostname)) return `bpm:${page}`;
    const metadata = globalThis.navigator?.mediaSession?.metadata;
    if (metadata?.title) return `bpm:${page}|${JSON.stringify([metadata.title, metadata.artist || "", metadata.album || ""])}`;
    const source = media?.currentSrc || media?.src || "";
    if (source && !/^(blob:|data:)/.test(source)) return `bpm:${page}|${new URL(source, page).href}`;
    return null;
  }

  function validSavedBpm(value) {
    return value && Number.isFinite(value.value) && value.value >= 30 && value.value <= 300 && ["automatic", "manual"].includes(value.status);
  }

  function rememberBpm() {
    if (!bpmTrackKey) return;
    bpmResults.set(bpmTrackKey, { ...bpmState });
    if (bpmResults.size > 30) bpmResults.delete(bpmResults.keys().next().value);
    if (validSavedBpm(bpmState) && activeMedia && bpmKey(activeMedia) === bpmTrackKey) {
      const key = persistentBpmKey(activeMedia);
      if (key && chrome.runtime.sendMessage) chrome.runtime.sendMessage({ type: "SAVE_BPM", key, bpm: { ...bpmState } })
        .catch(error => console.warn("TuneShift could not save BPM", error));
    }
  }

  function resetBpmForMedia(media) {
    stopBpmDetector();
    bpmDetectionToken += 1;
    bpmTrackKey = bpmKey(media);
    bpmState = { ...(bpmResults.get(bpmTrackKey) || { value: null, status: "idle", source: null, confidence: 0 }) };
    bpmRestorePending = null;
    const key = persistentBpmKey(media);
    if (bpmState.status !== "idle" || !key || !chrome.runtime.sendMessage) return;
    const token = bpmDetectionToken;
    const track = bpmTrackKey;
    bpmRestorePending = token;
    chrome.runtime.sendMessage({ type: "LOAD_BPM", key }).then(response => {
      if (token !== bpmDetectionToken || track !== bpmTrackKey || bpmKey(media) !== track || bpmState.status !== "idle") return;
      if (validSavedBpm(response?.bpm)) {
        bpmState = { ...response.bpm };
        bpmResults.set(track, { ...bpmState });
      }
    }).catch(error => console.warn("TuneShift could not restore BPM", error)).finally(() => {
      if (bpmRestorePending !== token) return;
      bpmRestorePending = null;
      if (activeMedia === media && bpmKey(media) === bpmTrackKey) syncBpmForMedia(media);
    });
  }

  function syncBpmForMedia(media) {
    const track = bpmKey(media);
    if (repeatTrackKey !== track) { repeatTrackKey = track; repeatRemaining = repeatCount(settings.repeat); }
    if (bpmKey(media) !== bpmTrackKey) resetBpmForMedia(media);
    if (bpmDetector && bpmDetector.media !== media) {
      stopBpmDetector();
      bpmDetectionToken += 1;
      bpmState = { value: null, status: "idle", source: null, confidence: 0 };
    }
    if (bpmRestorePending !== null) return;
    if (enabled && !media.paused && bpmState.status === "idle") startBpmDetection(media);
  }

  async function startBpmDetection(media) {
    if (!enabled || !media || media.paused || bpmState.status !== "idle") return;
    const token = ++bpmDetectionToken;
    bpmState = { value: null, status: "detecting", source: "audio", confidence: 0 };
    if (isProtectedMedia(media)) { failBpmDetection(token, "Protected audio cannot be analyzed directly. Tap or enter BPM manually."); return; }
    const capture = media.captureStream || media.mozCaptureStream;
    if (typeof capture !== "function") { failBpmDetection(token); return; }
    let stream = null;
    let context = null;
    try {
      stream = await waitForBpmStream(media, capture, token);
      if (!stream || token !== bpmDetectionToken) return;
      context = new AudioContext({ latencyHint: "interactive" });
      await context.audioWorklet.addModule(chrome.runtime.getURL("audio/realtime-bpm-processor.js"));
      if (token !== bpmDetectionToken) {
        stream.getTracks().forEach(track => track.stop());
        await context.close();
        return;
      }
      const source = context.createMediaStreamSource(stream);
      const highpass = new BiquadFilterNode(context, { type: "highpass", frequency: 40, Q: 0.7 });
      const lowpass = new BiquadFilterNode(context, { type: "lowpass", frequency: 150, Q: 1 });
      const analyser = new AudioWorkletNode(context, "realtime-bpm-processor", {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
        processorOptions: { continuousAnalysis: false, muteTimeInIndexes: Math.round(context.sampleRate * 0.2) }
      });
      const silent = new GainNode(context, { gain: 0 });
      source.connect(highpass).connect(lowpass).connect(analyser).connect(silent).connect(context.destination);
      const detector = { token, media, context, stream, source, highpass, lowpass, analyser, silent,
        rate: media.playbackRate || 1, playedSeconds: 0, lastTime: media.currentTime, timer: null };
      bpmDetector = detector;
      analyser.port.onmessage = ({ data }) => {
        if (bpmDetector !== detector || token !== bpmDetectionToken || bpmKey(media) !== bpmTrackKey) return;
        if (data.type === "error") { failBpmDetection(token); return; }
        if (data.type !== "bpmStable") return;
        const candidate = data.data?.bpm?.[0];
        const tempo = Number(candidate?.tempo) / detector.rate;
        if (!Number.isFinite(tempo) || tempo < 30 || tempo > 300 || Number(candidate?.count) < 12) return;
        bpmState = { value: Math.round(tempo * 100) / 100, status: "automatic", source: "audio", confidence: candidate.confidence || 0 };
        rememberBpm();
        stopBpmDetector();
      };
      detector.timer = setInterval(() => {
        if (bpmDetector !== detector) return;
        if (!media.isConnected || bpmKey(media) !== bpmTrackKey) { syncBpmForMedia(activeMedia || media); return; }
        const delta = media.currentTime - detector.lastTime;
        detector.lastTime = media.currentTime;
        if (!media.paused && delta > 0 && delta < 2) detector.playedSeconds += delta / detector.rate;
        if (delta < 0 || delta > 2) analyser.port.postMessage({ type: "reset" });
        if (detector.playedSeconds >= 35) failBpmDetection(token);
      }, 250);
      await context.resume();
    } catch (error) {
      stream?.getTracks().forEach(track => track.stop());
      context?.close().catch(() => undefined);
      failBpmDetection(token);
    }
  }

  function waitForBpmStream(media, capture, token) {
    return new Promise(resolve => {
      let stream = null;
      let polls = 0;
      let done = false;
      let timer;
      const dispose = () => stream?.getTracks().forEach(track => track.stop());
      const finish = (result, reason = null) => {
        if (done) return;
        done = true;
        clearInterval(timer);
        media.removeEventListener?.("playing", check);
        media.removeEventListener?.("canplay", check);
        if (cancelBpmStartup === cancel) cancelBpmStartup = null;
        if (!result) dispose();
        if (reason) failBpmDetection(token, reason, true);
        resolve(result);
      };
      const cancel = () => finish(null);
      const check = () => {
        if (done) return;
        if (token !== bpmDetectionToken || !enabled || !media.isConnected || bpmKey(media) !== bpmTrackKey) { finish(null); return; }
        if (stream?.getAudioTracks().some(track => track.readyState !== "ended")) { finish(stream); return; }
        // captureStream may be empty or throw InvalidStateError during an MSE track switch.
        if (media.readyState >= 2 && !media.paused) {
          try {
            dispose();
            stream = capture.call(media);
            if (stream.getAudioTracks().some(track => track.readyState !== "ended")) { finish(stream); return; }
          } catch (_) { /* retry while the player is becoming ready */ }
        }
      };
      cancelBpmStartup = cancel;
      media.addEventListener("playing", check);
      media.addEventListener("canplay", check);
      timer = setInterval(() => {
        check();
        if (++polls >= 60 && !done) finish(null, "The player did not expose an audio track. Play the track or enter BPM manually.");
      }, 250);
      check();
    });
  }

  function failBpmDetection(token, reason = "No stable beat found. Tap or enter BPM manually.", retryable = false) {
    if (token !== bpmDetectionToken) return;
    stopBpmDetector();
    bpmState = { value: null, status: "failed", source: null, confidence: 0, reason, retryable };
  }

  function beginManualBpm() {
    const media = activeMedia || findActiveMedia();
    if (media && bpmKey(media) !== bpmTrackKey) resetBpmForMedia(media);
    bpmDetectionToken += 1;
    stopBpmDetector();
    bpmState = { value: null, status: "tapping", source: "tap", confidence: 0 };
    rememberBpm();
    return state();
  }

  function setManualBpm(value, source = "tap") {
    const bpm = Math.min(300, Math.max(30, Math.round(Number(value) * 100) / 100));
    if (!Number.isFinite(bpm)) return { ok: false, error: "BPM must be between 30 and 300." };
    const media = activeMedia || findActiveMedia();
    if (media && bpmKey(media) !== bpmTrackKey) resetBpmForMedia(media);
    bpmDetectionToken += 1;
    stopBpmDetector();
    bpmState = { value: bpm, status: "manual", source: source === "entry" ? "entry" : "tap", confidence: 1 };
    rememberBpm();
    return state();
  }

  function stopBpmDetector() {
    cancelBpmStartup?.();
    const detector = bpmDetector;
    bpmDetector = null;
    if (!detector) return;
    clearInterval(detector.timer);
    detector.analyser.port.onmessage = null;
    detector.analyser.port.postMessage({ type: "stop" });
    for (const node of [detector.source, detector.highpass, detector.lowpass, detector.analyser, detector.silent]) {
      try { node.disconnect(); } catch (_) { /* already disconnected */ }
    }
    detector.stream.getTracks().forEach(track => track.stop());
    detector.context.close().catch(() => undefined);
  }

  async function ensureAudioContext() {
    if (audioContext && audioContext.state !== "closed") return audioContext;
    audioContext = new AudioContext({ latencyHint: "playback" });
    const processorUrl = chrome.runtime.getURL("audio/soundtouch-processor.js");
    processorReady = audioContext.audioWorklet.addModule(processorUrl);
    await processorReady;
    return audioContext;
  }

  async function ensureGraph(media) {
    if (tabEffectsActive) return null;
    if (!media || graphs.has(media)) return graphs.get(media) || null;
    if (isProtectedMedia(media)) {
      lastAudioError =
        "Protected audio uses native playback. Pitch, EQ and boost are unavailable.";
      lastAudioErrorCode = "DRM_PROTECTED";
      return null;
    }
    try {
      const context = await ensureAudioContext();
      await processorReady;

      restoreMediaVolume(media);
      if (isProtectedMedia(media) || tabEffectsActive) return null;
      const source = context.createMediaElementSource(media);
      const graph = TuneShiftAudioGraph.create(context, source);
      graphs.set(media, graph);
      lastAudioError = null;
      lastAudioErrorCode = null;
      applyGraph(graph, media, true);
      await resumeAudio();
      return graph;
    } catch (error) {
      lastAudioError = explainAudioError(error);
      lastAudioErrorCode = isMediaSourceConflict(error)
        ? "MEDIA_SOURCE_CONFLICT"
        : "AUDIO_PIPELINE_UNAVAILABLE";
      console.warn("TuneShift page audio unavailable", error);
      return null;
    }
  }

  function applyGraph(graph, media, immediate = false) {
    if (!audioContext) return;
    connectWet(graph);
    TuneShiftAudioGraph.apply(graph, audioContext, settings, immediate);

    media.preservesPitch = true;
    if ("webkitPreservesPitch" in media) media.webkitPreservesPitch = true;
    restoreMediaVolume(media);
    media.defaultPlaybackRate = settings.speed;
    media.playbackRate = settings.speed;
  }

  function applyToMedia(media) {
    syncRepeatLoop(media);
    if (!enabled) {
      const graph = graphs.get(media);
      if (graph) connectDry(graph);
      restoreMedia(media);
      return;
    }
    const graph = graphs.get(media);
    if (!tabEffectsActive && graph && needsAudioPipeline(settings) && !isProtectedMedia(media)) {
      applyGraph(graph, media);
      return;
    }
    if (graph) connectDry(graph);
    media.defaultPlaybackRate = settings.speed;
    media.playbackRate = settings.speed;
    media.preservesPitch = true;
    if ("webkitPreservesPitch" in media) media.webkitPreservesPitch = true;
    if (tabEffectsActive) restoreMediaVolume(media);
    else applyMediaVolume(media);
  }

  async function apply(nextSettings) {
    settingsRevision += 1;
    if (nextSettings.repeat !== undefined && nextSettings.repeat !== settings.repeat) repeatRemaining = repeatCount(nextSettings.repeat);
    settings = { ...settings, ...nextSettings };
    settings.cues = Array.isArray(settings.cues) ? settings.cues.slice(0, 9) : [];
    refresh();

    if (!enabled) return state();

    const media = activeMedia || findActiveMedia();
    if (needsAudioPipeline(settings) && !isProtectedMedia(media)) {
      if (media) await ensureGraph(media);
    } else {
      lastAudioError = null;
      lastAudioErrorCode = null;
    }

    for (const media of allMedia()) applyToMedia(media);
    await resumeAudio();
    settings.overlay ? showOverlay() : hideOverlay();
    return state();
  }

  async function resumeAudio() {
    if (audioContext?.state === "suspended") {
      try {
        await audioContext.resume();
      } catch (_) {
        /* resumes on the next media play gesture */
      }
    }
  }

  async function setEnabled(nextEnabled) {
    enabled = Boolean(nextEnabled);
    if (!enabled) {
      bpmDetectionToken += 1;
      stopBpmDetector();
      if (bpmState.status === "detecting") bpmState = { value: null, status: "idle", source: null, confidence: 0 };
      for (const media of allMedia()) applyToMedia(media);
      hideOverlay();
      await resumeAudio();
      return state();
    }

    refresh();
    const media = activeMedia || findActiveMedia();
    if (media && needsAudioPipeline(settings) && !isProtectedMedia(media))
      await ensureGraph(media);
    for (const item of allMedia()) applyToMedia(item);
    if (settings.overlay) showOverlay();
    await resumeAudio();
    return state();
  }

  function connectWet(graph) {
    if (!graph.bypassed || !audioContext) return;
    graph.source.disconnect();
    graph.source.connect(graph.soundtouch);
    graph.master.connect(audioContext.destination);
    graph.bypassed = false;
  }

  function connectDry(graph) {
    if (graph.bypassed || !audioContext) return;
    graph.source.disconnect();
    graph.master.disconnect();
    graph.source.connect(audioContext.destination);
    graph.bypassed = true;
  }

  function restoreMedia(media) {
    const original = originalMediaState.get(media);
    media.defaultPlaybackRate = original?.defaultPlaybackRate ?? 1;
    media.playbackRate = original?.playbackRate ?? 1;
    media.preservesPitch = original?.preservesPitch ?? true;
    if ("webkitPreservesPitch" in media)
      media.webkitPreservesPitch = original?.webkitPreservesPitch ?? true;
    setControlledVolume(media, original?.volume ?? 1);
  }

  function applyMediaVolume(media) {
    const baseVolume = originalMediaState.get(media)?.volume ?? media.volume;
    setControlledVolume(media, scaledMediaVolume(baseVolume, settings.volume));
  }

  function scaledMediaVolume(baseVolume, outputPercent) {
    return Math.min(1, Math.max(0, baseVolume * (outputPercent / 100)));
  }

  function restoreMediaVolume(media) {
    const baseVolume = originalMediaState.get(media)?.volume;
    if (baseVolume !== undefined) setControlledVolume(media, baseVolume);
  }

  function setControlledVolume(media, value) {
    const next = Math.min(1, Math.max(0, value));
    if (Math.abs(media.volume - next) < 0.0001) return;
    controlledVolumes.set(media, next);
    media.volume = next;
  }

  function mediaAction(action, seconds = 0, time = NaN) {
    const media = activeMedia || findActiveMedia();
    if (!media) return { ok: false, error: "No playable media found." };
    activeMedia = media;
    if (action === "toggle") {
      media.paused ? media.play().catch(() => undefined) : media.pause();
    } else if (action === "seek") {
      media.currentTime = Math.max(
        0,
        Math.min(media.duration || Infinity, media.currentTime + seconds),
      );
    } else if (action === "seekTo" && Number.isFinite(time)) {
      media.currentTime = Math.max(
        0,
        Math.min(media.duration || Infinity, time),
      );
    }
    updateOverlay();
    return { ok: true, media: mediaState(media) };
  }

  function setLoopPoint(point) {
    const media = activeMedia || findActiveMedia();
    if (!media) return { ok: false, error: "No playable media found." };
    if (point === "B" && (settings.loopA === null || media.currentTime <= settings.loopA))
      return { ok: false, error: "Set A first, then set B at a later time." };
    if (point === "A" && settings.loopB !== null && media.currentTime >= settings.loopB) settings.loopB = null;
    settings.loopEnabled = true;
    settings[point === "A" ? "loopA" : "loopB"] = Number(
      media.currentTime.toFixed(2),
    );
    updateOverlay();
    return state();
  }

  function setLoopTimes(a, b) {
    const media = activeMedia || findActiveMedia();
    if (!media) return { ok: false, error: "No playable media found." };
    a = Number(a); b = Number(b);
    if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b <= a || (Number.isFinite(media.duration) && b > media.duration))
      return { ok: false, error: "Loop points must be within this track, with A before B." };
    settings.loopA = a;
    settings.loopB = b;
    settings.loopEnabled = true;
    updateOverlay();
    return state();
  }

  function clearLoop() {
    settings.loopA = null;
    settings.loopB = null;
    return state();
  }

  function state() {
    activeMedia = findActiveMedia() || activeMedia;
    const audioActive =
      enabled && !tabEffectsActive && needsAudioPipeline(settings) && graphs.size > 0;
    return {
      ok: true,
      mediaCount: allMedia().length,
      media: activeMedia ? mediaState(activeMedia) : null,
      settings: { ...settings },
      enabled,
      audioActive,
      drmProtected: isProtectedMedia(activeMedia),
      tabEffectsActive,
      audioError: lastAudioError,
      audioErrorCode: lastAudioErrorCode,
      bpm: { ...bpmState },
      trackKey: activeMedia ? persistentBpmKey(activeMedia) : null,
    };
  }

  function mediaState(media) {
    return {
      paused: media.paused,
      currentTime: finite(media.currentTime),
      duration: finite(media.duration),
      title:
        media.getAttribute("title") ||
        media.getAttribute("aria-label") ||
        document.title ||
        "Media",
    };
  }

  const OVERLAY_ICONS = {"sliders-horizontal": "<path d=\"M10 5H3\" />\n  <path d=\"M12 19H3\" />\n  <path d=\"M14 3v4\" />\n  <path d=\"M16 17v4\" />\n  <path d=\"M21 12h-9\" />\n  <path d=\"M21 19h-5\" />\n  <path d=\"M21 5h-7\" />\n  <path d=\"M8 10v4\" />\n  <path d=\"M8 12H3\" />", "minus": "<path d=\"M5 12h14\" />", "plus": "<path d=\"M5 12h14\" />\n  <path d=\"M12 5v14\" />", "play": "<path d=\"M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z\" />", "pause": "<rect x=\"14\" y=\"3\" width=\"5\" height=\"18\" rx=\"1\" />\n  <rect x=\"5\" y=\"3\" width=\"5\" height=\"18\" rx=\"1\" />", "x": "<path d=\"M18 6 6 18\" />\n  <path d=\"m6 6 12 12\" />"};
  OVERLAY_ICONS.rewind = '<path d="m11 19-9-7 9-7v14Z"/><path d="m22 19-9-7 9-7v14Z"/>';
  OVERLAY_ICONS["fast-forward"] = '<path d="m13 19 9-7-9-7v14Z"/><path d="m2 19 9-7-9-7v14Z"/>';
  function overlayIcon(name) { return `<svg viewBox="0 0 24 24" aria-hidden="true">${OVERLAY_ICONS[name]}</svg>`; }

  let overlaySeeking = false;
  let overlaySeekStep = 10;
  let overlayFontPromise = null;

  function loadOverlayFont() {
    if (!overlayFontPromise) {
      const font = new FontFace("TuneShiftDigital",
        `url("${chrome.runtime.getURL("assets/fonts/DSEG7Classic-Bold.woff2")}")`,
        { weight: "700", style: "normal" });
      overlayFontPromise = font.load().then(loaded => {
        document.fonts.add(loaded);
        return loaded;
      }).catch(error => {
        overlayFontPromise = null;
        console.warn("TuneShift could not load its floating digital font", error);
        return null;
      });
    }
    return overlayFontPromise;
  }

  function showOverlay() {
    if (overlayHost?.isConnected) {
      updateOverlay();
      return;
    }
    loadOverlayFont();
    overlayHost = document.createElement("div");
    overlayHost.id = "tuneshift-overlay-host";
    overlayHost.style.cssText =
      "all:initial;position:fixed;z-index:2147483647;left:50%;bottom:24px;transform:translateX(-50%);";
    const root = overlayHost.attachShadow({ mode: "open" });
    chrome.storage.local.get("preferences").then(({ preferences }) => {
      const step = Number(preferences?.seekStep);
      overlaySeekStep = Number.isFinite(step) && step > 0 ? step : 10;
      updateOverlay();
    }).catch(() => undefined);
    root.innerHTML = `
      <style>
        :host{all:initial}
        .bar{--mode-color:#ffafcc;--mode-rgb:255,175,204;display:flex;flex-direction:column;gap:5px;width:288px;padding:8px 9px;border:1px solid rgba(255,255,255,.14);border-radius:16px;background:rgba(12,16,23,.94);box-shadow:0 18px 50px rgba(0,0,0,.45);backdrop-filter:blur(16px);font-family:Arial,sans-serif;color:#f4f7f1}
        .bar[data-mode="transpose"]{--mode-color:#cdb4db;--mode-rgb:205,180,219}
        .bar[data-mode="pitch"]{--mode-color:#a2d2ff;--mode-rgb:162,210,255}
        .progress{appearance:none;width:100%;height:4px;margin:2px 0 3px;border-radius:8px;background:linear-gradient(to right,var(--mode-color) var(--progress,0%),rgba(255,255,255,.18) var(--progress,0%));cursor:pointer}
        .progress::-webkit-slider-thumb{appearance:none;width:10px;height:10px;border-radius:50%;background:var(--mode-color);box-shadow:0 0 7px rgba(var(--mode-rgb),.5)}
        .progress:disabled{opacity:.4;cursor:default}
        .row{display:flex;align-items:center;justify-content:space-between;width:100%;gap:1px}
        button{display:grid;place-items:center;width:30px;height:30px;padding:0;border:0;border-radius:10px;background:transparent;color:inherit;cursor:pointer;font:600 17px Arial,sans-serif;transition:transform .16s ease,background .16s ease,color .16s ease}
        button:hover{background:rgba(var(--mode-rgb),.12);color:var(--mode-color);transform:translateY(-1px)}
        button:active{transform:translateY(1px) scale(.94)}
        svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
        .value{display:inline-flex;align-items:center;justify-content:center;min-width:65px;color:var(--mode-color);font:700 16px/1 TuneShiftDigital,monospace;letter-spacing:-.5px;white-space:nowrap;text-shadow:0 0 12px rgba(var(--mode-rgb),.2)}
        .digits{position:relative;isolation:isolate}
        .digits::before{content:attr(data-shadow);position:absolute;inset:0;color:rgba(var(--mode-rgb),.14);z-index:-1}
        .unit{font:700 10px Arial,sans-serif;margin-left:2px}
        button:focus-visible,.progress:focus-visible{outline:2px solid var(--mode-color);outline-offset:2px}
        .mode{width:26px;color:var(--mode-color);font-size:15px}
      </style>
      <div class="bar" data-mode="speed" role="toolbar" aria-label="TuneShift media controls">
        <input class="progress" type="range" min="0" max="100" step="0.1" value="0" aria-label="Playback position">
        <div class="row">
          <button class="mode" data-action="mode" title="Adjusting speed. Click to switch control." aria-label="Adjusting speed. Click to switch control.">${overlayIcon("sliders-horizontal")}</button>
          <button data-action="back" title="Seek backward">${overlayIcon("rewind")}</button>
          <button data-action="down" title="Slower">${overlayIcon("minus")}</button>
          <span class="value"><span class="digits" data-shadow="8.88">1.00</span><span class="unit">×</span></span>
          <button data-action="up" title="Faster">${overlayIcon("plus")}</button>
          <button data-action="forward" title="Seek forward">${overlayIcon("fast-forward")}</button>
          <button data-action="toggle" title="Play or pause">${overlayIcon("play")}</button>
          <button data-action="close" title="Hide controller">${overlayIcon("x")}</button>
        </div>
      </div>`;
    const seek = root.querySelector(".progress");
    seek.addEventListener("input", () => {
      overlaySeeking = true;
      seek.style.setProperty("--progress", `${seek.value}%`);
    });
    seek.addEventListener("change", () => {
      const duration = Number(activeMedia?.duration);
      if (Number.isFinite(duration) && duration > 0) mediaAction("seekTo", 0, duration * Number(seek.value) / 100);
      overlaySeeking = false;
      updateOverlay();
    });
    root.addEventListener("click", (event) => {
      const action = event.target?.closest?.("[data-action]")?.dataset.action;
      if (action === "down" || action === "up") {
        clearOverlaySeekTime();
        const controls = {
          speed: { min: 0.25, max: 4, step: 0.1, digits: 2 },
          transpose: { min: -12, max: 12, step: 1, digits: 0 },
          pitch: { min: -1, max: 1, step: 0.05, digits: 2 },
        };
        const control = controls[overlayMode];
        const direction = action === "up" ? 1 : -1;
        const factor = 10 ** control.digits;
        settings[overlayMode] = Math.min(
          control.max,
          Math.max(
            control.min,
            Math.round((settings[overlayMode] + direction * control.step) * factor) / factor,
          ),
        );
        apply({ ...settings })
          .then(() => chrome.runtime.sendMessage({ type: "RECORD_PAGE_PROFILE", settings, trackKey: activeMedia ? persistentBpmKey(activeMedia) : null }))
          .catch((error) => console.warn("TuneShift floating control update failed", error));
        updateOverlay();
      } else if (action === "mode") {
        clearOverlaySeekTime();
        const modes = isProtectedMedia(activeMedia) && !tabEffectsActive ? ["speed"] : ["speed", "transpose", "pitch"];
        overlayMode = modes[(modes.indexOf(overlayMode) + 1) % modes.length];
        updateOverlay();
      } else if (action === "back" || action === "forward") mediaAction("seek", action === "back" ? -overlaySeekStep : overlaySeekStep);
      else if (action === "toggle") mediaAction("toggle");
      else if (action === "close") {
        settings.overlay = false;
        hideOverlay();
      }
    });
    document.documentElement.appendChild(overlayHost);
    updateOverlay();
  }

  function clearOverlaySeekTime() {
    if (overlaySeekTimer !== null) clearTimeout(overlaySeekTimer);
    overlaySeekTimer = null;
    overlaySeekMedia = null;
  }

  function showOverlaySeekTime(media) {
    if (media !== activeMedia || !overlayHost?.isConnected) return;
    clearOverlaySeekTime();
    overlaySeekMedia = media;
    overlaySeekTimer = setTimeout(() => {
      clearOverlaySeekTime();
      updateOverlay();
    }, 3000);
    updateOverlay();
  }

  function updateOverlayProgress() {
    const progress = overlayHost?.shadowRoot?.querySelector(".progress");
    if (!progress) return;
    const duration = Number(activeMedia?.duration);
    const validDuration = Number.isFinite(duration) && duration > 0;
    progress.disabled = !validDuration;
    if (!overlaySeeking) progress.value = validDuration ? String(Math.max(0, Math.min(100, (Number(activeMedia.currentTime) || 0) / duration * 100))) : "0";
    progress.style.setProperty("--progress", `${progress.value}%`);
    progress.title = validDuration ? `${Math.floor(Number(activeMedia.currentTime) || 0)} of ${Math.floor(duration)} seconds` : "Playback position unavailable";
  }

  function updateOverlay() {
    if (!overlayHost?.shadowRoot) return;
    updateOverlayProgress();
    const value = overlayHost.shadowRoot.querySelector(".value");
    const bar = overlayHost.shadowRoot.querySelector(".bar");
    const mode = overlayHost.shadowRoot.querySelector('[data-action="mode"]');
    const down = overlayHost.shadowRoot.querySelector('[data-action="down"]');
    const up = overlayHost.shadowRoot.querySelector('[data-action="up"]');
    const toggle = overlayHost.shadowRoot.querySelector(
      '[data-action="toggle"]',
    );
    if (bar) bar.dataset.mode = overlayMode;
    if (value) {
      const showingTime = overlaySeekMedia !== null && overlaySeekMedia === activeMedia;
      const digits = showingTime ? String(Math.floor(Math.max(0, Number(activeMedia.currentTime) || 0)))
        : overlayMode === "speed" ? settings.speed.toFixed(2)
        : overlayMode === "transpose" ? `${settings.transpose > 0 ? "+" : ""}${Math.round(settings.transpose)}`
          : `${settings.pitch > 0 ? "+" : ""}${settings.pitch.toFixed(2)}`;
      const digitDisplay = value.querySelector(".digits");
      digitDisplay.textContent = digits;
      digitDisplay.dataset.shadow = digits.replace(/\d/g, "8");
      value.querySelector(".unit").textContent = showingTime ? "s" : overlayMode === "speed" ? "×" : overlayMode === "transpose" ? "T" : "P";
    }
    const nextMode = overlayMode === "speed" ? "transpose" : overlayMode === "transpose" ? "pitch" : "speed";
    if (mode) {
      mode.title = `Adjusting ${overlayMode}. Click to switch to ${nextMode}.`;
      mode.setAttribute("aria-label", mode.title);
    }
    if (down) down.title = `Decrease ${overlayMode}`;
    if (up) up.title = `Increase ${overlayMode}`;
    for (const action of ["back", "forward"]) {
      const button = overlayHost.shadowRoot.querySelector(`[data-action="${action}"]`);
      button.title = `${action === "back" ? "Back" : "Forward"} ${overlaySeekStep} seconds`;
      button.setAttribute("aria-label", button.title);
    }
    if (toggle) {
      const icon = activeMedia && !activeMedia.paused ? "pause" : "play";
      if (toggle.dataset.icon !== icon) {
        toggle.innerHTML = overlayIcon(icon);
        toggle.dataset.icon = icon;
      }
    }
  }

  function hideOverlay() {
    clearOverlaySeekTime();
    overlaySeeking = false;
    overlayHost?.remove();
    overlayHost = null;
  }

  function disconnectGraph(graph) {
    for (const node of Object.values(graph)) {
      try {
        node.disconnect?.();
      } catch (_) {
        /* already disconnected */
      }
    }
  }

  function needsAudioPipeline(value) {
    return (
      Math.abs(value.transpose) > 0.001 ||
      Math.abs(value.pitch) > 0.001 ||
      value.volume > 100 ||
      (value.subBass || 0) !== 0 ||
      (value.warmth || 0) !== 0 ||
      (value.air || 0) !== 0 ||
      value.swapChannels ||
      value.bass !== 0 ||
      value.mid !== 0 ||
      value.treble !== 0 ||
      value.balance !== 0 ||
      value.compressor ||
      value.mono
    );
  }

  function explainAudioError(error) {
    const message = error?.message || String(error);
    if (isMediaSourceConflict(error))
      return "Another audio controller is already attached to this player. Turn off the other pitch extension if needed, then refresh this tab once.";
    if (message.includes("AudioWorklet") || message.includes("module"))
      return "The local audio processor could not load on this site.";
    return message;
  }

  function isMediaSourceConflict(error) {
    const message = error?.message || String(error);
    return /createMediaElementSource|HTMLMediaElement.*(?:already connected|connected previously|previously connected)/i.test(
      message,
    );
  }

  function isProtectedMedia(media) {
    return isDrmProtectedHost(location.hostname) || Boolean(media?.mediaKeys) || encryptedMedia.has(media);
  }

  function isDrmProtectedHost(hostname = "") {
    return /(^|\.)spotify\.com$/.test(hostname);
  }

  function finite(value) {
    return Number.isFinite(value) ? value : 0;
  }

  function pageKey(url = "") {
    try {
      const parsed = new URL(url);
      parsed.hash = "";
      const videoId = youTubeVideoId(parsed);
      if (videoId) return `https://www.youtube.com/watch?v=${videoId}`;
      return parsed.href;
    } catch (_) {
      return "";
    }
  }

  function youTubeVideoId(parsed) {
    const host = parsed.hostname.replace(/^(www|m)\./, "");
    let candidate = "";
    if (host === "youtu.be") candidate = parsed.pathname.split("/")[1] || "";
    else if (host === "youtube.com" || host === "music.youtube.com") {
      if (parsed.pathname === "/watch") candidate = parsed.searchParams.get("v") || "";
      else {
        const match = parsed.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/]+)/);
        if (match) candidate = match[1];
      }
    }
    return /^[A-Za-z0-9_-]{11}$/.test(candidate) ? candidate : "";
  }

  function syncStoredProfile(force = false) {
    if (!chrome.runtime.sendMessage) return;
    const trackKey = activeMedia ? persistentBpmKey(activeMedia) : null;
    const identity = trackKey || `page:${pageKey(location.href)}`;
    if (!force && identity === lastProfileIdentity) return;
    const first = !lastProfileIdentity;
    const leavingTrackProfile = activeTrackProfile;
    lastProfileIdentity = identity;
    const token = ++profileSyncToken;
    const revision = settingsRevision;
    chrome.runtime.sendMessage({ type: "GET_SAVED_SETTINGS", trackKey }).then(async response => {
      if (token !== profileSyncToken || !response?.ok || !("settings" in response)) return;
      if (revision !== settingsRevision) return;
      activeTrackProfile = response.scope === "track";
      if (!first && !force && !activeTrackProfile && !leavingTrackProfile) return;
      const nextSettings = response.settings || DEFAULTS;
      await apply(nextSettings);
      if (!response.saved && allMedia().length && (first || force)) {
        await chrome.runtime.sendMessage({ type: "RECORD_PAGE_PROFILE", settings: nextSettings, trackKey });
      }
    }).catch(error => console.warn("TuneShift could not synchronize the track profile", error));
  }

  setInterval(() => {
    const nextKey = pageKey(location.href);
    if (nextKey && nextKey !== currentPageKey) {
      currentPageKey = nextKey;
      syncStoredProfile(true);
    } else syncStoredProfile();
  }, 500);

  function containsNewMedia(records) {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        if (node.matches?.("video, audio") || node.querySelector?.("video, audio")) return true;
      }
    }
    return false;
  }

  const observer = new MutationObserver((records) => {
    if (containsNewMedia(records)) queueRefresh();
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "APPLY_SETTINGS") {
      apply(message.settings)
        .then(sendResponse)
        .catch((error) =>
          sendResponse({ ok: false, error: explainAudioError(error) }),
        );
      return true;
    }
    switch (message.type) {
      case "PING":
        sendResponse({ ok: true });
        break;
      case "GET_STATE":
        sendResponse(state());
        break;
      case "SET_TAB_EFFECTS":
        tabEffectsActive = Boolean(message.active);
        for (const media of allMedia()) applyToMedia(media);
        sendResponse(state());
        break;
      case "SET_ENABLED":
        setEnabled(message.enabled)
          .then(sendResponse)
          .catch((error) =>
            sendResponse({ ok: false, error: explainAudioError(error) }),
          );
        return true;
      case "MEDIA_ACTION":
        sendResponse(
          mediaAction(message.action, message.seconds, message.time),
        );
        break;
      case "BEGIN_MANUAL_BPM":
        sendResponse(beginManualBpm());
        break;
      case "SET_MANUAL_BPM":
        sendResponse(setManualBpm(message.bpm, message.source));
        break;
      case "SET_LOOP_POINT":
        sendResponse(setLoopPoint(message.point));
        break;
      case "SET_TRACK_SCOPE":
        if (message.enabled) activeTrackProfile = true;
        sendResponse({ ok: true });
        break;
      case "SET_LOOP_TIMES":
        sendResponse(setLoopTimes(message.a, message.b));
        break;
      case "CLEAR_LOOP":
        sendResponse(clearLoop());
        break;
      default:
        return false;
    }
    return true;
  });

  globalThis.__tuneShiftController = { refresh, state, apply };
  refresh();
})();
