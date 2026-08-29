/**
 * app.js — Orbify Application Bootstrap
 * Wires OrbifyAPI, OrbifyPlayer, VinylVisualizer, and OrbifyUI together.
 */

(function () {
  'use strict';

  // ─── State ────────────────────────────────────────────────────
  let searchDebounce = null;
  let currentResults = [];
  let currentTrackIdx = -1;
  let failStreak = 0;
  // True when the user explicitly chose this track (click/prev/next). When a
  // manually picked song fails to load we STOP instead of silently jumping to a
  // different random song — that random-skip behaviour was confusing.
  let manualSelection = false;

  // ─── Elements ─────────────────────────────────────────────────
  const searchInput  = document.getElementById('search-input');
  const searchClear  = document.getElementById('search-clear');
  const searchWrap   = document.getElementById('search-wrap');
  const navHome      = document.getElementById('nav-home');
  const navSearchBtn = document.getElementById('nav-search-btn');
  const navLiked     = document.getElementById('nav-liked');
  const drawerClose  = document.getElementById('drawer-close');

  // ─── Search ───────────────────────────────────────────────────
  function handleSearch(query) {
    if (!query || !query.trim()) {
      searchClear.classList.remove('vis');
      OrbifyUI.closeDrawer();
      return;
    }

    searchClear.classList.add('vis');
    OrbifyUI.showLoading(query);

    OrbifyAPI.searchTracks(query, 12)
      .then(result => {
        const tracks = result.tracks || [];
        currentResults = tracks;
        OrbifyUI.renderResults(tracks, query, result.source || tracks[0]?.streamType || 'itunes');
        attachRowListeners();
      })
      .catch(err => {
        console.error('[Search]', err);
        OrbifyUI.showSearchError(`Search failed: ${err.message}`);
      });
  }

  searchInput.addEventListener('input', e => {
    clearTimeout(searchDebounce);
    const q = e.target.value;
    searchDebounce = setTimeout(() => handleSearch(q), 500);
  });

  searchInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      clearTimeout(searchDebounce);
      handleSearch(searchInput.value);
    }
  });

  searchClear.addEventListener('click', () => {
    searchInput.value = '';
    searchClear.classList.remove('vis');
    currentResults = [];
    OrbifyUI.closeDrawer();
    searchInput.focus();
  });

  // ─── Drawer Close ─────────────────────────────────────────────
  if (drawerClose) {
    drawerClose.addEventListener('click', () => {
      OrbifyUI.closeDrawer();
    });
  }

  // ─── Nav ──────────────────────────────────────────────────────
  navHome.addEventListener('click', () => {
    navHome.classList.add('active');
    navSearchBtn.classList.remove('active');
    navLiked.classList.remove('active');
    OrbifyUI.closeDrawer();
  });

  navSearchBtn.addEventListener('click', () => {
    navSearchBtn.classList.add('active');
    navHome.classList.remove('active');
    navLiked.classList.remove('active');
    searchInput.focus();
    if (currentResults.length > 0) {
      OrbifyUI.openDrawer();
    }
  });

  navLiked.addEventListener('click', () => {
    navLiked.classList.add('active');
    navHome.classList.remove('active');
    navSearchBtn.classList.remove('active');
    
    // Load liked songs from localStorage and render in drawer
    const likedIds = JSON.parse(localStorage.getItem('orbify-liked') || '[]');
    if (likedIds.length === 0) {
      OrbifyUI.showToast('No liked songs yet! ♥');
      OrbifyUI.renderResults([], 'Liked Songs');
      return;
    }

    // Since we only stored IDs, we can filter them from current results or recent tracks
    // For a simple UX, let's treat recent tracks that were liked as the liked songs list
    const recent = JSON.parse(localStorage.getItem('orbify-recent') || '[]');
    const likedTracks = recent.filter(t => likedIds.includes(String(t.id)));

    currentResults = likedTracks;
    OrbifyUI.renderResults(likedTracks, 'Liked Songs', likedTracks[0]?.streamType || 'itunes');
    attachRowListeners();
  });

  // ─── Track Row Listeners ──────────────────────────────────────
  function attachRowListeners() {
    document.querySelectorAll('.track-row').forEach((row, idx) => {
      row.addEventListener('click', () => {
        const track = currentResults[idx];
        if (track) playTrack(track, idx, true);
      });
    });
  }

  // ─── Play Track ───────────────────────────────────────────────
  // isManual = true when the user explicitly chose this track (click, prev,
  // next). A manually chosen track that fails should STOP (show a toast), never
  // silently jump to a different random song.
  async function playTrack(track, idx, isManual = false) {
    currentTrackIdx = idx;
    manualSelection = !!isManual;

    OrbifyUI.updatePlayerTrack(track);
    OrbifyUI.setPlayingCard(track.id);

    try {
      await OrbifyPlayer.play(track);
    } catch (err) {
      console.error('[App] Playback error:', err);
      OrbifyUI.showToast('Could not load stream — trying next track');
      safeSkipNext();
    }
  }

  // Skip to the next track, but stop if too many tracks fail in a row so we
  // don't loop forever on a list of dead links.
  function safeSkipNext() {
    if (currentResults.length === 0) return;
    failStreak++;
    if (failStreak >= currentResults.length) {
      failStreak = 0;
      OrbifyUI.showToast('Could not find a playable track 😕');
      OrbifyUI.setPlayState(false);
      return;
    }
    skipNext();
  }

  // ─── Player Controls ──────────────────────────────────────────

  // Play/Pause
  document.getElementById('btn-play').addEventListener('click', () => {
    if (!OrbifyPlayer.getCurrentTrack()) {
      OrbifyUI.showToast('Search and play a song first 🎵');
      return;
    }
    OrbifyPlayer.togglePlayPause();
  });

  // Previous
  document.getElementById('btn-prev').addEventListener('click', () => {
    if (currentResults.length === 0) return;
    const prevIdx = (currentTrackIdx - 1 + currentResults.length) % currentResults.length;
    playTrack(currentResults[prevIdx], prevIdx, true);
  });

  // Next
  document.getElementById('btn-next').addEventListener('click', () => {
    skipNext(true);
  });

  function skipNext(isManual = false) {
    if (currentResults.length === 0) return;
    let nextIdx;
    if (OrbifyPlayer.getIsShuffle()) {
      nextIdx = Math.floor(Math.random() * currentResults.length);
    } else {
      nextIdx = (currentTrackIdx + 1) % currentResults.length;
    }
    playTrack(currentResults[nextIdx], nextIdx, isManual);
  }

  // Shuffle
  document.getElementById('btn-shuffle').addEventListener('click', () => {
    const on = OrbifyPlayer.toggleShuffle();
    OrbifyUI.setShuffleState(on);
    OrbifyUI.showToast(on ? 'Shuffle enabled' : 'Shuffle disabled');
  });

  // Repeat
  document.getElementById('btn-repeat').addEventListener('click', () => {
    const on = OrbifyPlayer.toggleRepeat();
    OrbifyUI.setRepeatState(on);
    OrbifyUI.showToast(on ? 'Repeat enabled' : 'Repeat disabled');
  });

  // Like
  document.getElementById('btn-like').addEventListener('click', () => {
    const track = OrbifyPlayer.getCurrentTrack();
    if (track) OrbifyUI.toggleLike(track.id, track);
  });

  // Mute
  document.getElementById('btn-mute').addEventListener('click', () => {
    const muted = OrbifyPlayer.toggleMute();
    OrbifyUI.setMuteState(muted);
    const vol = OrbifyPlayer.getVolume();
    OrbifyUI.updateVolume(muted ? 0 : vol);
  });

  // ─── Progress Bar ─────────────────────────────────────────────
  const progressWrap = OrbifyUI.getProgressWrap();
  let isDraggingProgress = false;

  function seekFromEvent(e) {
    const rect = progressWrap.getBoundingClientRect();
    const pct  = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    OrbifyPlayer.seek(pct);
    const track = OrbifyPlayer.getCurrentTrack();
    const total = track?.duration || 180;
    OrbifyUI.updateProgress(pct * total, total, pct);
  }

  progressWrap.addEventListener('mousedown', e => {
    isDraggingProgress = true;
    seekFromEvent(e);
  });

  document.addEventListener('mousemove', e => {
    if (isDraggingProgress) seekFromEvent(e);
  });

  document.addEventListener('mouseup', () => { isDraggingProgress = false; });

  // ─── Volume Bar ───────────────────────────────────────────────
  const volumeWrap = OrbifyUI.getVolumeWrap();
  let isDraggingVolume = false;

  function setVolumeFromEvent(e) {
    const rect = volumeWrap.getBoundingClientRect();
    const vol  = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    OrbifyPlayer.setVolume(vol);
    OrbifyUI.updateVolume(vol);
    if (OrbifyPlayer.getIsMuted() && vol > 0) {
      OrbifyPlayer.toggleMute();
      OrbifyUI.setMuteState(false);
    }
  }

  volumeWrap.addEventListener('mousedown', e => {
    isDraggingVolume = true;
    setVolumeFromEvent(e);
  });

  document.addEventListener('mousemove', e => {
    if (isDraggingVolume) setVolumeFromEvent(e);
  });

  document.addEventListener('mouseup', () => { isDraggingVolume = false; });

  // ─── Player Event Callbacks ───────────────────────────────────
  OrbifyPlayer.on('onLoading', () => {
    OrbifyUI.setLoadingState(true);
  });

  OrbifyPlayer.on('onPlay', track => {
    failStreak = 0; // a track actually started → clear the failure streak
    OrbifyUI.setLoadingState(false);
    OrbifyUI.setPlayState(true);
    OrbifyUI.showToast(`▶ Playing: ${track.title}`);
  });

  OrbifyPlayer.on('onPause', () => {
    OrbifyUI.setLoadingState(false);
    OrbifyUI.setPlayState(false);
  });

  OrbifyPlayer.on('onTimeUpdate', (current, total, pct) => {
    if (!isDraggingProgress) {
      OrbifyUI.updateProgress(current, total, pct);
    }
  });

  OrbifyPlayer.on('onEnd', track => {
    OrbifyUI.setLoadingState(false);
    OrbifyUI.setPlayState(false);
    failStreak = 0;
    if (OrbifyPlayer.getIsRepeat()) {
      OrbifyPlayer.play(track);
    } else {
      skipNext();
    }
  });

  OrbifyPlayer.on('onError', msg => {
    OrbifyUI.setLoadingState(false);
    OrbifyUI.showToast(`⚠️ ${msg}`);
    OrbifyUI.setPlayState(false);
    // If the user explicitly picked this track, don't silently jump to a random
    // different song — that's confusing. Only auto-skip dead links when we were
    // already auto-playing (ended → next). 
    if (manualSelection) {
      manualSelection = false;
      return;
    }
    // Archive items occasionally have dead/restricted files — auto-skip to the
    // next playable track instead of stopping on a broken one.
    safeSkipNext();
  });

  OrbifyPlayer.on('onLoaded', track => {
    OrbifyPlayer.setVolume(OrbifyPlayer.getVolume());
  });

  // ─── Recent List Click ────────────────────────────────────────
  OrbifyUI.renderRecentList(track => {
    // When recent track is clicked, make it the single currentResults or search results
    currentResults = [track];
    playTrack(track, 0, true);
  });

  // ─── Keyboard Shortcuts ───────────────────────────────────────
  document.addEventListener('keydown', e => {
    // Don't intercept key inputs when typing in search
    if (document.activeElement === searchInput) {
      if (e.key === 'Escape') {
        searchInput.blur();
        OrbifyUI.closeDrawer();
      }
      return;
    }

    switch (e.code) {
      case 'Space':
        e.preventDefault();
        if (OrbifyPlayer.getCurrentTrack()) OrbifyPlayer.togglePlayPause();
        break;
      case 'ArrowRight':
        skipNext(true);
        break;
      case 'ArrowLeft':
        document.getElementById('btn-prev').click();
        break;
      case 'KeyM':
        document.getElementById('btn-mute').click();
        break;
      case 'KeyL':
        document.getElementById('btn-like').click();
        break;
      case 'Slash':
        e.preventDefault();
        searchInput.focus();
        break;
      case 'Escape':
        OrbifyUI.closeDrawer();
        break;
    }
  });

  // ─── Init Volume ──────────────────────────────────────────────
  OrbifyUI.updateVolume(0.8);

  // ─── Ready ────────────────────────────────────────────────────
  console.log('🎵 Orbify application initialized! Press / to search.');

})();
