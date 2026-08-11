/**
 * app.js — Orbify Application Bootstrap
 * Wires OrbifyAPI, OrbifyPlayer, OrbVisualizer, and OrbifyUI together.
 */

(function () {
  'use strict';

  // ─── State ────────────────────────────────────────────────────
  let searchDebounce = null;
  let currentResults = [];
  let currentTrackIdx = -1;

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
        OrbifyUI.renderResults(tracks, query, result.source || tracks[0]?.streamType || 'youtube');
        if (result.fallback) {
          OrbifyUI.showToast('⚠️ YouTube search failed — showing 30s previews', 6000);
        }
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
    OrbifyUI.renderResults(likedTracks, 'Liked Songs', likedTracks[0]?.streamType || 'youtube');
    attachRowListeners();
  });

  // ─── Track Row Listeners ──────────────────────────────────────
  function attachRowListeners() {
    document.querySelectorAll('.track-row').forEach((row, idx) => {
      row.addEventListener('click', () => {
        const track = currentResults[idx];
        if (track) playTrack(track, idx);
      });
    });
  }

  // ─── Play Track ───────────────────────────────────────────────
  async function playTrack(track, idx) {
    currentTrackIdx = idx;

    OrbifyUI.updatePlayerTrack(track);
    OrbifyUI.setPlayingCard(track.id);

    try {
      await OrbifyPlayer.play(track);
    } catch (err) {
      console.error('[App] Playback error:', err);
      OrbifyUI.showToast('Could not load stream — trying next track');
      skipNext();
    }
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
    playTrack(currentResults[prevIdx], prevIdx);
  });

  // Next
  document.getElementById('btn-next').addEventListener('click', () => {
    skipNext();
  });

  function skipNext() {
    if (currentResults.length === 0) return;
    let nextIdx;
    if (OrbifyPlayer.getIsShuffle()) {
      nextIdx = Math.floor(Math.random() * currentResults.length);
    } else {
      nextIdx = (currentTrackIdx + 1) % currentResults.length;
    }
    playTrack(currentResults[nextIdx], nextIdx);
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
  OrbifyPlayer.on('onPlay', track => {
    OrbifyUI.setPlayState(true);
    OrbifyUI.showToast(`▶ Playing: ${track.title}`);
  });

  OrbifyPlayer.on('onPause', () => {
    OrbifyUI.setPlayState(false);
  });

  OrbifyPlayer.on('onTimeUpdate', (current, total, pct) => {
    if (!isDraggingProgress) {
      OrbifyUI.updateProgress(current, total, pct);
    }
  });

  OrbifyPlayer.on('onEnd', track => {
    OrbifyUI.setPlayState(false);
    if (OrbifyPlayer.getIsRepeat()) {
      OrbifyPlayer.play(track);
    } else {
      skipNext();
    }
  });

  OrbifyPlayer.on('onError', msg => {
    OrbifyUI.showToast(`⚠️ ${msg}`);
    OrbifyUI.setPlayState(false);
  });

  OrbifyPlayer.on('onLoaded', track => {
    OrbifyPlayer.setVolume(OrbifyPlayer.getVolume());
  });

  // ─── Recent List Click ────────────────────────────────────────
  OrbifyUI.renderRecentList(track => {
    // When recent track is clicked, make it the single currentResults or search results
    currentResults = [track];
    playTrack(track, 0);
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
        skipNext();
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
