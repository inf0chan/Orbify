/**
 * api.js — API client for Orbify
 * Handles all server communication for search and streaming URLs
 */

const OrbifyAPI = (() => {
  const BASE_URL = '/api';

  /**
    * Search for tracks via the backend (iTunes).
   * @param {string} query - Search term
   * @param {number} limit - Max results
   * @returns {Promise<Array>} - Array of normalized track objects
   */
  async function searchTracks(query, limit = 20) {
    if (!query || !query.trim()) return [];

    const url = `${BASE_URL}/search?q=${encodeURIComponent(query.trim())}&limit=${limit}`;

    const res = await fetch(url);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    const data = await res.json();
    return { tracks: data.tracks || [], source: data.source, fallback: !!data.fallback };
  }

  /**
   * Get the audio streaming URL for a track
   * @param {Object} track - The normalized track object
   * @returns {string} - URL to use as the src of the audio element
   */
  function getAudioUrl(track) {
    // iTunes previews are piped through the server proxy so the Web Audio
    // analyser (CORS) works.
    return track && track.previewUrl
      ? `${BASE_URL}/preview?url=${encodeURIComponent(track.previewUrl)}`
      : '';
  }

  return { searchTracks, getAudioUrl };
})();
