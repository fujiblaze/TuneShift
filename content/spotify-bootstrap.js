(() => {
  if (window.__tuneShiftSpotifyHook) return;
  window.__tuneShiftSpotifyHook = true;
  function adopt(media) {
    if (!(media instanceof HTMLMediaElement) || media.isConnected) return;
    queueMicrotask(() => {
      if (media.isConnected || !document.documentElement) return;
      media.hidden = true;
      media.dataset.tuneshiftAdopted = "true";
      document.documentElement.appendChild(media);
    });
  }
  const create = Document.prototype.createElement;
  Document.prototype.createElement = function () {
    const element = Reflect.apply(create, this, arguments);
    adopt(element);
    return element;
  };
  const NativeAudio = window.Audio;
  window.Audio = new Proxy(NativeAudio, {
    construct(target, args, newTarget) {
      const media = Reflect.construct(target, args, newTarget);
      adopt(media);
      return media;
    }
  });
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    adopt(this);
    return Reflect.apply(play, this, arguments);
  };
})();
