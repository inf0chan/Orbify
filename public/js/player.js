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
    onLoading: null,   // fired when a new track starts buffering
  };

  // ─── State ────────────────────────────────────────────────────
  // Bump this token every time we start loading a track. Any async work or a
  // trailing audio event from a previous source is stale and must NOT touch the
  // audio element or callbacks once a newer track has been selected.
  let loadToken = 0;
  let activeLoadToken = 0; // token of the source currently wired into <audio>
  let isLoading = false;
  let isPlayingOptimistic = false; // true between optimistic onPlay and real 'playing'
  let errorToken = -1; // last load token for which we already reported onError

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
  async function loadTrack(track) {
    const token = ++loadToken; // invalidate any in-flight load
    isLoading = true;
    callbacks.onLoading?.(track);

    const url = OrbifyAPI.getAudioUrl(track);
    if (!url) {
      if (token !== loadToken) return false;
      fireError('This track is no longer available');
      return false;
    }

    currentTrack = track;
    activeLoadToken = token; // guard: only events for THIS loaded source count
    audioEl.src = url;
    audioEl.volume = isMuted ? 0 : volume;
    audioEl.load();
    return true;
  }

  async function play(track) {
    // Resume or init context (browsers need user gesture)
    initAudioContext();
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }

    if (track && track.id !== currentTrack?.id) {
      const ok = await loadTrack(track);
      // A newer track may have been selected while we resolved — bail quietly.
      if (track.id !== currentTrack?.id || !ok) return;
    }

    try {
      // Optimistically mark as playing (new track) right away. audioEl.play()
      // resolves only after real buffering starts, so we set the play button
      // state immediately and refine it when the 'playing' event fires.
      if (track && !isPlaying) {
        isPlaying = true;
        isPlayingOptimistic = true;
        callbacks.onPlay?.(currentTrack);
      }
      const p = audioEl.play();
      if (p !== undefined) await p;
    } catch (err) {
      console.error('[Player] Play error:', err);
      fireError('Failed to load audio preview');
    }
  }

  function pause() {
    audioEl.pause();
    isPlaying = false;
    isPlayingOptimistic = false;
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
  // The <audio> element is shared for every track. When we switch to a new song,
  // the old source can still emit a trailing ended/error/waiting event that must
  // NOT trigger skipping or toasts for the new track. We guard every event with
  // the active load token; stale events (from a source we already replaced) are
  // ignored.
  function isCurrentLoad() { return loadToken === activeLoadToken; }

  // Report an error once per loaded track — an <audio> error can surface both as
  // a DOM 'error' event AND as a rejected play() promise, and double-reporting
  // would trigger the app's skip logic twice (once as manual, once as auto).
  function fireError(msg) {
    if (errorToken === activeLoadToken) return;
    errorToken = activeLoadToken;
    isLoading = false;
    callbacks.onError?.(msg);
  }

  audioEl.addEventListener('timeupdate', () => {
    const current = audioEl.currentTime;
    const total   = audioEl.duration && !isNaN(audioEl.duration) ? audioEl.duration : (currentTrack?.duration || 30);
    const pct     = total > 0 ? (current / total) : 0;
    callbacks.onTimeUpdate?.(current, total, pct);
  });

  audioEl.addEventListener('ended', () => {
    if (!isCurrentLoad()) return; // superseded by a newer track
    isPlaying = false;
    callbacks.onEnd?.(currentTrack);
  });

  // Buffering finished and real audio is about to start → clear loading state.
  audioEl.addEventListener('canplay', () => {
    if (!isCurrentLoad()) return;
    if (isLoading) {
      isLoading = false;
      callbacks.onLoaded?.(currentTrack);
    }
  });

  // Actual playback began → make sure playing state + UI are accurate.
  audioEl.addEventListener('playing', () => {
    if (!isCurrentLoad()) return;
    isLoading = false;
    callbacks.onLoaded?.(currentTrack);
    // Only fire onPlay if we didn't already go optimistic (avoids double toasts
    // when switching tracks); still fires for a plain resume of the same track.
    if (!isPlayingOptimistic) {
      isPlaying = true;
      callbacks.onPlay?.(currentTrack);
    }
    isPlayingOptimistic = false;
  });

  audioEl.addEventListener('waiting', () => {
    if (!isCurrentLoad() || !isPlaying) return;
    // Buffering for more data (stall) — surface it so the UI can show a spinner.
    isLoading = true;
    callbacks.onLoading?.(currentTrack);
  });

  audioEl.addEventListener('error', (e) => {
    if (!isCurrentLoad()) return; // stale error from a source we've replaced
    console.error('[Player] Audio error:', e);
    fireError('Failed to load audio preview');
  });

  // ─── Getters ──────────────────────────────────────────────────
  function getCurrentTrack()  { return currentTrack; }
  function getIsPlaying()     { return isPlaying; }
  function getIsLoading()     { return isLoading; }
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
    getIsLoading,
    getVolume,
    getIsMuted,
    getIsRepeat,
    getIsShuffle,
    isInitialized,
    on(event, cb) { callbacks[event] = cb; },
  };
})();
