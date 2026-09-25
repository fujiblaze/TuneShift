(() => {
  function create(context, source) {
      const soundtouch = new AudioWorkletNode(context, "soundtouch-processor", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        processorOptions: {
          sampleBufferType: "circular",
          interpolationStrategy: "lanczos",
        },
      });
      const subBass = new BiquadFilterNode(context, { type: "lowshelf", frequency: 60 });
      const warmth = new BiquadFilterNode(context, { type: "peaking", frequency: 350, Q: 0.8 });
      const air = new BiquadFilterNode(context, { type: "highshelf", frequency: 10000 });
      const bass = new BiquadFilterNode(context, {
        type: "lowshelf",
        frequency: 180,
      });
      const mid = new BiquadFilterNode(context, {
        type: "peaking",
        frequency: 1200,
        Q: 0.8,
      });
      const treble = new BiquadFilterNode(context, {
        type: "highshelf",
        frequency: 4800,
      });
      const compressor = new DynamicsCompressorNode(context, {
        threshold: -22,
        knee: 18,
        ratio: 1,
        attack: 0.006,
        release: 0.22,
      });
      const panner = new StereoPannerNode(context);
      const stereoGate = new GainNode(context, { gain: 1 });
      const splitter = new ChannelSplitterNode(context, { numberOfOutputs: 2 });
      const normalGate = new GainNode(context, { gain: 1 });
      const swapGate = new GainNode(context, { gain: 0 });
      const swapMerger = new ChannelMergerNode(context, { numberOfInputs: 2 });
      const monoLeft = new GainNode(context, { gain: 0 });
      const monoRight = new GainNode(context, { gain: 0 });
      const monoSum = new GainNode(context, {
        gain: 1,
        channelCount: 1,
        channelCountMode: "explicit",
      });
      const master = new GainNode(context, { gain: 1 });

      source
        .connect(soundtouch)
        .connect(subBass)
        .connect(bass)
        .connect(warmth)
        .connect(mid)
        .connect(treble)
        .connect(air)
        .connect(compressor);
      compressor.connect(normalGate).connect(panner).connect(stereoGate).connect(master);
      splitter.connect(swapMerger, 0, 1);
      splitter.connect(swapMerger, 1, 0);
      swapMerger.connect(swapGate).connect(panner);
      compressor.connect(splitter);
      splitter.connect(monoLeft, 0).connect(monoSum);
      splitter.connect(monoRight, 1).connect(monoSum);
      monoSum.connect(master).connect(context.destination);

      return {
        source,
        soundtouch,
        subBass, warmth, air, normalGate, swapGate, swapMerger,
        bass,
        mid,
        treble,
        compressor,
        panner,
        stereoGate,
        splitter,
        monoLeft,
        monoRight,
        monoSum,
        master,
        bypassed: false,
        qualityMode: null,
      };
  }
  function apply(graph, context, settings, immediate = false) {
    const now = context.currentTime;
    const smooth = (param, value, time = 0.035) => {
      param.cancelScheduledValues(now);
      if (immediate) param.setValueAtTime(value, now);
      else param.setTargetAtTime(value, now, time);
    };

    // Chrome preserves pitch for playback speed; this processor only applies requested pitch shifts.
    graph.soundtouch.parameters.get("playbackRate").setValueAtTime(1, now);
    smooth(
      graph.soundtouch.parameters.get("pitchSemitones"),
      settings.transpose,
      0.025,
    );
    smooth(
      graph.soundtouch.parameters.get("pitch"),
      2 ** (settings.pitch / 12),
      0.025,
    );
    updateStretchQuality(graph, settings);
    smooth(graph.subBass.gain, settings.subBass);
    smooth(graph.warmth.gain, settings.warmth);
    smooth(graph.air.gain, settings.air);
    smooth(graph.normalGate.gain, settings.swapChannels ? 0 : 1, 0.015);
    smooth(graph.swapGate.gain, settings.swapChannels ? 1 : 0, 0.015);
    smooth(graph.bass.gain, settings.bass);
    smooth(graph.mid.gain, settings.mid);
    smooth(graph.treble.gain, settings.treble);
    smooth(graph.compressor.ratio, settings.compressor ? 3.5 : 1);
    smooth(graph.compressor.threshold, settings.compressor ? -22 : 0);
    smooth(graph.panner.pan, settings.balance);
    smooth(graph.stereoGate.gain, settings.mono ? 0 : 1, 0.015);
    smooth(graph.monoLeft.gain, settings.mono ? 0.5 : 0, 0.015);
    smooth(graph.monoRight.gain, settings.mono ? 0.5 : 0, 0.015);
    smooth(graph.master.gain, settings.volume / 100);

  }
  function updateStretchQuality(graph, settings) {
    const effectiveRatio = 2 ** ((settings.transpose + settings.pitch) / 12);
    const extreme = effectiveRatio <= 0.63 || effectiveRatio >= 1.6;
    // Upward shifts force an anti-alias cutoff at Nyquist/ratio inside the
    // resampler. Keep widening the kernel with the ratio so that cutoff keeps
    // a steep transition instead of dulling treble as the shift climbs.
    const zeroCrossings = Math.min(
      16,
      Math.round(6 * Math.max(1, effectiveRatio)),
    );
    const qualityMode = `${extreme ? "extreme" : "balanced"}:${zeroCrossings}`;
    if (graph.qualityMode === qualityMode) return;
    graph.qualityMode = qualityMode;
    graph.soundtouch.port.postMessage({
      type: "set-stretch-parameters",
      params: extreme
        ? { sequenceMs: 0, seekWindowMs: 0, overlapMs: 14, quickSeek: false }
        : { sequenceMs: 0, seekWindowMs: 0, overlapMs: 10, quickSeek: false },
    });
    const interpolationParams = {
      zeroCrossings,
      normalize: true,
    };
    graph.soundtouch.port.postMessage({
      type: "set-interpolation-strategy-params",
      params: interpolationParams,
    });
  }

  function disconnect(graph) {
    for (const node of Object.values(graph)) { try { node?.disconnect?.(); } catch (_) {} }
  }
  globalThis.TuneShiftAudioGraph = { create, apply, disconnect, updateStretchQuality };
})();
