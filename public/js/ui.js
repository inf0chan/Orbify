/**
 * ui.js — UI Rendering & State Management for Orbify (Centered-Orb Layout)
 * Handles all DOM updates, drawer animations, track row rendering, and player bar updates.
 */

const OrbifyUI = (() => {
  // ─── Elements ─────────────────────────────────────────────────
  const els = {
    // Search & Drawer
    resultsDrawer:  document.getElementById('results-drawer'),
    resultsList:    document.getElementById('results-list'),
    drawerTitle:    document.getElementById('drawer-title'),
    drawerCount:    document.getElementById('drawer-count'),
    drawerClose:    document.getElementById('drawer-close'),
    drawerLoading:  document.getElementById('drawer-loading'),
    drawerEmpty:    document.getElementById('drawer-empty'),
    floatSearch:    document.getElementById('float-search'),
    searchClear:    document.getElementById('search-clear'),
    searchInput:    document.getElementById('search-input'),
    sourceBadge:    document.getElementById('source-badge'),

    // Navigation buttons
    navHome:        document.getElementById('nav-home'),
    navSearchBtn:   document.getElementById('nav-search-btn'),
    navLiked:       document.getElementById('nav-liked'),

    // Player bar
    playerArtwork:  document.getElementById('player-artwork'),
    playerTitle:    document.getElementById('player-title'),
    playerArtist:   document.getElementById('player-artist'),
    playerLikeBtn:  document.getElementById('btn-like'),
    btnPlayPause:   document.getElementById('btn-play'),
    btnShuffle:     document.getElementById('btn-shuffle'),
    btnRepeat:      document.getElementById('btn-repeat'),
    iconPlay:       document.querySelector('.icon-play'),
    iconPause:      document.querySelector('.icon-pause'),
    waveform:       document.getElementById('waveform'),
    progressWrap:   document.getElementById('progress-track'),
    timeCurrent:    document.getElementById('time-cur'),
    timeTotal:      document.getElementById('time-tot'),
    volumeFill:     document.getElementById('vol-fill'),
    volumeThumb:    document.getElementById('vol-thumb'),
    volumeWrap:     document.getElementById('vol-track'),
    btnMute:        document.getElementById('btn-mute'),
    iconVol:        document.querySelector('.icon-vol'),
    iconMute:       document.querySelector('.icon-mute'),

    // Now playing overlay (on top of canvas)
    nowPlayingOverlay: document.getElementById('now-playing-overlay'),
    npArtwork:         document.getElementById('np-artwork'),
    npTitle:           document.getElementById('np-title'),
    npArtist:          document.getElementById('np-artist'),

    // Idle hint
    idleHint:          document.getElementById('idle-hint'),

    // Sidebar
    recentList:        document.getElementById('recent-list'),

    // Toast
    toast:             document.getElementById('toast'),
  };

  let toastTimeout = null;
  let currentPlayingId = null;
  let likedSet = new Set(JSON.parse(localStorage.getItem('orbify-liked') || '[]'));
  let recentTracks = JSON.parse(localStorage.getItem('orbify-recent') || '[]');
  const WAVE_BARS_COUNT = 45;

  // ─── Drawer Actions ───────────────────────────────────────────
  function openDrawer() {
    els.resultsDrawer.classList.add('open');
    els.floatSearch.classList.add('drawer-open');
  }

  function closeDrawer() {
    els.resultsDrawer.classList.remove('open');
    els.floatSearch.classList.remove('drawer-open');
  }

  // ─── Toast ────────────────────────────────────────────────────
  function showToast(message, duration = 2500) {
    if (toastTimeout) clearTimeout(toastTimeout);
    els.toast.textContent = message;
    els.toast.classList.add('show');
    toastTimeout = setTimeout(() => els.toast.classList.remove('show'), duration);
  }

  // ─── Time Formatting ──────────────────────────────────────────
  function formatTime(seconds) {
    if (seconds === undefined || seconds === null || isNaN(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  // ─── Render Track Rows ────────────────────────────────────────
  function renderResults(tracks, query, source = 'youtube') {
    els.drawerLoading.classList.remove('vis');
    els.drawerEmpty.style.display = 'none';
    els.resultsList.innerHTML = '';

    // Show source badge (e.g. YouTube or iTunes)
    if (tracks && tracks.length > 0) {
      els.sourceBadge.textContent = source === 'youtube' ? 'Sourced from YouTube' : 'Sourced from iTunes Previews';
      els.sourceBadge.style.display = 'block';
    } else {
      els.sourceBadge.style.display = 'none';
    }

    if (!tracks || tracks.length === 0) {
      els.drawerEmpty.style.display = 'block';
      els.drawerTitle.textContent = `No results`;
      els.drawerCount.textContent = '';
      return;
    }

    els.drawerTitle.textContent = `Results for "${query}"`;
    els.drawerCount.textContent = `${tracks.length}`;

    tracks.forEach((track, idx) => {
      const row = buildTrackRow(track, idx);
      els.resultsList.appendChild(row);
    });

    openDrawer();
  }

  function buildTrackRow(track, idx) {
    const row = document.createElement('div');
    row.className = 'track-row';
    row.dataset.trackId = track.id;
    row.style.animationDelay = `${idx * 0.03}s`;

    const isPlaying = currentPlayingId === track.id;
    const durStr = track.duration ? formatTime(track.duration) : '3:00';

    row.innerHTML = `
      <div class="track-row-thumb">
        <img
          src="${track.artworkSmall || track.artwork || ''}"
          alt="${escapeHtml(track.title)}"
          loading="lazy"
          onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22100%22 height=%22100%22><rect width=%22100%22 height=%22100%22 fill=%22%231a1a2e%22/><text x=%2250%%22 y=%2250%%22 text-anchor=%22middle%22 dominant-baseline=%22middle%22 font-size=%2224%22>🎵</text></svg>'"
        />
        <div class="track-row-play">
          <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
        </div>
        ${isPlaying ? `
          <div class="eq-bars">
            <div class="eq-bar"></div>
            <div class="eq-bar"></div>
            <div class="eq-bar"></div>
          </div>
        ` : ''}
      </div>
      <div class="track-row-info">
        <div class="track-row-title" title="${escapeHtml(track.title)}">${escapeHtml(track.title)}</div>
        <div class="track-row-artist" title="${escapeHtml(track.artist)}">${escapeHtml(track.artist)}</div>
      </div>
      <div class="track-row-duration">${durStr}</div>
    `;

    if (isPlaying) row.classList.add('playing');

    return row;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ─── Mark Playing Track ───────────────────────────────────────
  function setPlayingCard(trackId) {
    currentPlayingId = trackId;

    // Remove active styles from all rows
    document.querySelectorAll('.track-row').forEach(row => {
      row.classList.remove('playing');
      const eq = row.querySelector('.eq-bars');
      if (eq) eq.remove();
    });

    // Add active styles to playing row
    const activeRow = document.querySelector(`.track-row[data-track-id="${trackId}"]`);
    if (activeRow) {
      activeRow.classList.add('playing');
      const thumb = activeRow.querySelector('.track-row-thumb');
      if (thumb && !thumb.querySelector('.eq-bars')) {
        const eq = document.createElement('div');
        eq.className = 'eq-bars';
        eq.innerHTML = '<div class="eq-bar"></div><div class="eq-bar"></div><div class="eq-bar"></div>';
        thumb.appendChild(eq);
      }
    }
  }

  // ─── Player Bar & Overlay Updates ─────────────────────────────
  function updatePlayerTrack(track) {
    els.playerArtwork.src = track.artworkSmall || track.artwork || '';
    els.playerArtwork.alt = track.title;
    els.playerTitle.textContent = track.title;
    els.playerArtist.textContent = track.artist;

    els.playerArtwork.classList.add('active');

    // Update Like button state
    const liked = likedSet.has(String(track.id));
    els.playerLikeBtn.classList.toggle('liked', liked);

    // Update Now Playing overlay on canvas
    els.npArtwork.src = track.artworkSmall || track.artwork || '';
    els.npTitle.textContent = track.title;
    els.npArtist.textContent = track.artist;
    els.nowPlayingOverlay.classList.add('visible');
    els.idleHint.classList.add('hidden');

    // Save in history
    addToRecent(track);
  }

  function setPlayState(playing) {
    els.iconPlay.style.display  = playing ? 'none'  : 'block';
    els.iconPause.style.display = playing ? 'block' : 'none';
  }

  function initWaveform() {
    if (!els.waveform) return;
    els.waveform.innerHTML = '';
    for (let i = 0; i < WAVE_BARS_COUNT; i++) {
      const bar = document.createElement('div');
      bar.className = 'wave-bar';
      const centerFactor = 1.0 - Math.abs(i - WAVE_BARS_COUNT / 2) / (WAVE_BARS_COUNT / 2);
      const heightPercent = Math.max(15, Math.round((Math.sin(centerFactor * Math.PI) * 70) + (Math.random() * 20)));
      bar.style.height = `${heightPercent}%`;
      els.waveform.appendChild(bar);
    }
  }

  function updateProgress(current, total, pct) {
    const activeCount = Math.round(pct * WAVE_BARS_COUNT);
    if (els.waveform) {
      const bars = els.waveform.querySelectorAll('.wave-bar');
      // If waveform has not been populated yet, populate it now
      if (bars.length === 0) {
        initWaveform();
        return;
      }
      bars.forEach((bar, idx) => {
        if (idx < activeCount) {
          bar.classList.add('active');
        } else {
          bar.classList.remove('active');
        }
      });
    }
    els.timeCurrent.textContent = formatTime(current);
    els.timeTotal.textContent = formatTime(total);
  }

  function updateVolume(vol) {
    const pctStr = `${(vol * 100).toFixed(0)}%`;
    els.volumeFill.style.width = pctStr;
    els.volumeThumb.style.left = pctStr;
  }

  function setMuteState(muted) {
    els.iconVol.style.display  = muted ? 'none'  : 'block';
    els.iconMute.style.display = muted ? 'block' : 'none';
  }

  function setShuffleState(on) {
    els.btnShuffle.classList.toggle('active', on);
  }

  // Shuffle button state
  function setRepeatState(on) {
    els.btnRepeat.classList.toggle('active', on);
  }

  // ─── Loading State ────────────────────────────────────────────
  function showLoading(query) {
    openDrawer();
    els.drawerLoading.classList.add('vis');
    els.resultsList.innerHTML = '';
    els.drawerEmpty.style.display = 'none';
    els.drawerTitle.textContent = `Searching...`;
    els.drawerCount.textContent = '';
  }

  function showSearchError(message) {
    els.drawerLoading.classList.remove('vis');
    els.resultsList.innerHTML = '';
    els.sourceBadge.style.display = 'none';
    els.drawerTitle.textContent = 'Search failed';
    els.drawerCount.textContent = '';
    const empty = els.drawerEmpty;
    empty.style.display = 'block';
    empty.querySelector('p').textContent = message || 'Could not load results';
    empty.querySelector('small').textContent = 'Check your connection and try again';
    openDrawer();
  }

  // ─── Liked Songs ─────────────────────────────────────────────
  function toggleLike(trackId, track) {
    const id = String(trackId);
    if (likedSet.has(id)) {
      likedSet.delete(id);
      showToast('Removed from Liked Songs');
    } else {
      likedSet.add(id);
      showToast('Added to Liked Songs ♥');
    }
    localStorage.setItem('orbify-liked', JSON.stringify([...likedSet]));

    const liked = likedSet.has(id);
    els.playerLikeBtn.classList.toggle('liked', liked);
    return liked;
  }

  // ─── Recent Tracks ────────────────────────────────────────────
  function addToRecent(track) {
    recentTracks = recentTracks.filter(t => t.id !== track.id);
    recentTracks.unshift(track);
    recentTracks = recentTracks.slice(0, 10);
    localStorage.setItem('orbify-recent', JSON.stringify(recentTracks));
    renderRecentList();
  }

  function renderRecentList(onClickCallback) {
    if (recentTracks.length === 0) {
      els.recentList.innerHTML = '<li class="recent-empty">Search a song!</li>';
      return;
    }

    els.recentList.innerHTML = recentTracks.map(track => `
      <li class="recent-item" data-track-id="${track.id}" title="${escapeHtml(track.title)}">
        <img src="${track.artworkSmall || track.artwork || ''}" alt="" onerror="this.style.background='#1a1a2e'" />
      </li>
    `).join('');

    if (onClickCallback) {
      els.recentList.querySelectorAll('.recent-item').forEach(item => {
        item.addEventListener('click', () => {
          const id = item.dataset.trackId;
          const track = recentTracks.find(t => String(t.id) === String(id));
          if (track) onClickCallback(track);
        });
      });
    }
  }

  function getRecentTracks() { return recentTracks; }
  function getProgressWrap() { return els.progressWrap; }
  function getVolumeWrap()   { return els.volumeWrap; }

  // ─── Public API ───────────────────────────────────────────────
  return {
    openDrawer,
    closeDrawer,
    showToast,
    showLoading,
    showSearchError,
    renderResults,
    setPlayingCard,
    updatePlayerTrack,
    setPlayState,
    updateProgress,
    updateVolume,
    setMuteState,
    setShuffleState,
    setRepeatState,
    toggleLike,
    renderRecentList,
    getRecentTracks,
    getProgressWrap,
    getVolumeWrap,
    formatTime,
    els,
  };
})();
