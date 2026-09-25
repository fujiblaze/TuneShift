// Audio stays in this extension document. Nothing is recorded or uploaded.
const sessions = new Map();
function state(tabId) {
  const session = sessions.get(tabId);
  return { active: Boolean(session), signalDetected: Boolean(session?.signalDetected) };
}
async function stop(tabId, error = "", notify = false) {
  const session = sessions.get(tabId);
  if (!session) return;
  sessions.delete(tabId);
  clearInterval(session.monitor);
  session.stream.getTracks().forEach(track => track.stop());
  TuneShiftAudioGraph.disconnect(session.graph);
  session.analyser.disconnect();
  await session.context.close().catch(() => undefined);
  if (notify) await chrome.runtime.sendMessage({ type: "TAB_EFFECTS_ENDED", tabId, error }).catch(() => undefined);
}
async function start({ tabId, streamId, settings }) {
  await stop(tabId);
  let stream, context, timer, expired = false;
  try {
    const pending = navigator.mediaDevices.getUserMedia({ audio: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId } }, video: false });
    pending.then(value => { if (expired) value.getTracks().forEach(track => track.stop()); }, () => {});
    stream = await Promise.race([pending, new Promise((_, reject) => { timer = setTimeout(() => { expired = true; reject(new Error("Tab audio did not start. Try again while the tab is playing.")); }, 10000); })]);
    clearTimeout(timer);
    if (!stream.getAudioTracks().length) throw new Error("Chrome did not provide tab audio.");
    context = new AudioContext({ latencyHint: "playback" });
    await context.audioWorklet.addModule(chrome.runtime.getURL("audio/soundtouch-processor.js"));
    const source = context.createMediaStreamSource(stream);
    const graph = TuneShiftAudioGraph.create(context, source);
    TuneShiftAudioGraph.apply(graph, context, settings, true);
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);
    await context.resume();
    if (context.state !== "running") throw new Error("Chrome could not start audio output. Stop tab effects and try again.");
    const session = { stream, context, graph, analyser, signalDetected: false, startedAt: Date.now(), monitor: null };
    sessions.set(tabId, session);
    for (const track of stream.getTracks()) track.addEventListener("ended", () => stop(tabId, "Tab audio capture ended.", true));
    const samples = new Float32Array(analyser.fftSize);
    session.monitor = setInterval(() => {
      analyser.getFloatTimeDomainData(samples);
      if (samples.some(value => Math.abs(value) > 0.00001)) session.signalDetected = true;
      if (!session.signalDetected && Date.now() - session.startedAt > 15000) {
        stop(tabId, "No audio received from this tab. Chrome may block this protected stream. Native playback was restored.", true);
      }
    }, 250);
    return { ok: true, ...state(tabId) };
  } catch (error) {
    clearTimeout(timer);
    expired = true;
    if (sessions.has(tabId)) await stop(tabId);
    else { stream?.getTracks().forEach(track => track.stop()); await context?.close().catch(() => undefined); }
    return { ok: false, error: error.message || String(error) };
  }
}
chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  if (message.target !== "tuneshift-offscreen") return false;
  (async () => {
    switch (message.action) {
      case "start": return start(message);
      case "state": return { ok: true, ...state(message.tabId), tabIds: [...sessions.keys()] };
      case "apply": {
        const session = sessions.get(message.tabId);
        if (!session) return { ok: false, error: "Tab effects are no longer active." };
        TuneShiftAudioGraph.apply(session.graph, session.context, message.settings);
        return { ok: true, ...state(message.tabId) };
      }
      case "stop": await stop(message.tabId); return { ok: true, remaining: sessions.size };
      default: return { ok: false, error: "Unknown audio action." };
    }
  })().then(reply, error => reply({ ok: false, error: error.message || String(error) }));
  return true;
});
