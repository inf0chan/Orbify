/**
 * player.js — Web Audio API engine for Orbify
 * Manages audio playback, analysis, and frequency data for the orb
 */

const OrbifyPlayer = (() => {
  // ─── State ────────────────────────────────────────────────────
  let audioCtx = null;
  let analyser = null;
  let source = null;
  let dataArray = null;
  let bufferLength = 0;
  let currentTrack = null;
  let isPlaying = false;
  let volume = 0.8;
  let isMuted = false;
  let isRepeat = false;
  let isShuffle = false;

  const audioEl = document.getElementById('audio-el');

  // ─── Callbacks ────────────────────────────────────────────────
  const callbacks = {
    onPlay: null,
    onPause: null,
    onEnd: null,
    onTimeUpdate: null,
    onError: null,
    onLoaded: null,
  };

  // ─── Init AudioContext ─────────────────────────────────────────
  function initAudioContext() {
    if (audioCtx) return;

    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioCtx.createAnalyser();

    // FFT for particle viz: 2048 gives good frequency resolution
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.82;

    bufferLength = analyser.frequencyBinCount; // 1024
    dataArray = new Uint8Array(bufferLength);

    // Connect audio element → analyser → speakers
    source = audioCtx.createMediaElementSource(audioEl);
    source.connect(analyser);
    analyser.connect(audioCtx.destination);
  }

  // ─── Load & Play Track ────────────────────────────────────────
  function loadTrack(track) {
    currentTrack = track;
    audioEl.src = OrbifyAPI.getAudioUrl(track);
    audioEl.volume = isMuted ? 0 : volume;
    audioEl.load();
  }

  async function play(track) {
    // Resume or init context (browsers need user gesture)
    initAudioContext();
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }

    if (track && track.id !== currentTrack?.id) {
      loadTrack(track);
    }

    try {
      await audioEl.play();
      isPlaying = true;
      callbacks.onPlay?.(currentTrack);
    } catch (err) {
      console.error('[Player] Play error:', err);
      callbacks.onError?.(err.message);
    }
  }

  function pause() {
    audioEl.pause();
    isPlaying = false;
    callbacks.onPause?.();
  }

  function togglePlayPause() {
    if (isPlaying) pause();
    else play(currentTrack);
  }

  function seek(pct) {
    if (!audioEl.duration) return;
    audioEl.currentTime = pct * audioEl.duration;
  }

  function setVolume(val) {
    volume = Math.max(0, Math.min(1, val));
    if (!isMuted) audioEl.volume = volume;
  }

  function toggleMute() {
    isMuted = !isMuted;
    audioEl.volume = isMuted ? 0 : volume;
    return isMuted;
  }

  function toggleRepeat() {
    isRepeat = !isRepeat;
    audioEl.loop = isRepeat;
    return isRepeat;
  }

  function toggleShuffle() {
    isShuffle = !isShuffle;
    return isShuffle;
  }

  // ─── Frequency Data ───────────────────────────────────────────
  /**
   * Returns the latest frequency data array (Uint8Array, 0–255 each).
   * Call this every animation frame.
   */
  function getFrequencyData() {
    if (!analyser || !dataArray) return null;
    analyser.getByteFrequencyData(dataArray);
    return dataArray;
  }

  /**
   * Returns aggregated audio metrics for the orb:
   * { bass, mid, high, overall } — all in range [0, 1]
   */
  function getAudioMetrics() {
    if (!analyser || !dataArray) {
      return { bass: 0, mid: 0, high: 0, overall: 0 };
    }

    analyser.getByteFrequencyData(dataArray);

    // Split frequency array into bands
    // bufferLength = 1024, representing 0–22050 Hz
    const bassEnd  = Math.floor(bufferLength * 0.04);  // ~0–880 Hz
    const midEnd   = Math.floor(bufferLength * 0.25);  // ~880–5500 Hz
    // high: midEnd → bufferLength

    let bassSum = 0, midSum = 0, highSum = 0;

    for (let i = 0; i < bassEnd; i++) bassSum += dataArray[i];
    for (let i = bassEnd; i < midEnd; i++) midSum += dataArray[i];
    for (let i = midEnd; i < bufferLength; i++) highSum += dataArray[i];

    const bass    = bassSum / (bassEnd * 255);
    const mid     = midSum  / ((midEnd - bassEnd) * 255);
    const high    = highSum / ((bufferLength - midEnd) * 255);
    const overall = (bassSum + midSum + highSum) / (bufferLength * 255);

    return { bass, mid, high, overall };
  }

  // ─── Audio Element Events ─────────────────────────────────────
  audioEl.addEventListener('timeupdate', () => {
    const current = audioEl.currentTime;
    const total   = audioEl.duration && !isNaN(audioEl.duration) ? audioEl.duration : (currentTrack?.duration || 30);
    const pct     = total > 0 ? (current / total) : 0;
    callbacks.onTimeUpdate?.(current, total, pct);
  });

  audioEl.addEventListener('ended', () => {
    isPlaying = false;
    callbacks.onEnd?.(currentTrack);
  });

  audioEl.addEventListener('canplay', () => {
    callbacks.onLoaded?.(currentTrack);
  });

  audioEl.addEventListener('error', (e) => {
    console.error('[Player] Audio error:', e);
    callbacks.onError?.('Failed to load audio preview');
  });

  // ─── Getters ──────────────────────────────────────────────────
  function getCurrentTrack()  { return currentTrack; }
  function getIsPlaying()     { return isPlaying; }
  function getVolume()        { return volume; }
  function getIsMuted()       { return isMuted; }
  function getIsRepeat()      { return isRepeat; }
  function getIsShuffle()     { return isShuffle; }
  function isInitialized()    { return !!audioCtx; }

  // ─── Public API ───────────────────────────────────────────────
  return {
    play,
    pause,
    togglePlayPause,
    seek,
    setVolume,
    toggleMute,
    toggleRepeat,
    toggleShuffle,
    getFrequencyData,
    getAudioMetrics,
    getCurrentTrack,
    getIsPlaying,
    getVolume,
    getIsMuted,
    getIsRepeat,
    getIsShuffle,
    isInitialized,
    on(event, cb) { callbacks[event] = cb; },
  };
})();
