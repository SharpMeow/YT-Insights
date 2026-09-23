/**
 * Shared utilities for YT Insights extension.
 * SPA navigation, DOM helpers, player-response access, formatting.
 */
(function (global) {
  'use strict';

  const YTI = (global.YTI = global.YTI || {});

  /** Current watch video id from URL (null if not on /watch). */
  function getVideoId() {
    try {
      const u = new URL(location.href);
      if (u.pathname === '/watch') return u.searchParams.get('v');
      // Shorts: /shorts/VIDEO_ID
      const m = u.pathname.match(/^\/shorts\/([a-zA-Z0-9_-]{6,})/);
      return m ? m[1] : null;
    } catch {
      return null;
    }
  }

  function isWatchPage() {
    return location.pathname === '/watch' && !!getVideoId();
  }

  function isShortsPage() {
    return /^\/shorts\//.test(location.pathname);
  }

  /** True when player-response videoDetails.videoId matches the URL (or URL has no id yet). */
  function prMatchesCurrentVideo(pr) {
    if (!pr || !pr.videoDetails) return false;
    const want = getVideoId();
    if (!want) return true; // no URL id to compare
    const got = pr.videoDetails.videoId;
    // Require an explicit match — missing videoId is not good enough after SPA
    return !!got && got === want;
  }

  /**
   * Pull ytInitialPlayerResponse from page scripts / player API.
   * Prefer live player when available; fall back to embedded JSON.
   * CRITICAL: never return a response for a different videoId than the URL
   * (SPA leaves window.ytInitialPlayerResponse / inline scripts on the first video).
   */
  function getPlayerResponse() {
    try {
      const players = document.querySelectorAll('#movie_player, .html5-video-player');
      for (const p of players) {
        if (p && typeof p.getPlayerResponse === 'function') {
          const pr = p.getPlayerResponse();
          if (pr && pr.videoDetails && prMatchesCurrentVideo(pr)) return pr;
        }
      }
    } catch (_) {}

    if (global.ytInitialPlayerResponse && global.ytInitialPlayerResponse.videoDetails) {
      const pr = global.ytInitialPlayerResponse;
      if (prMatchesCurrentVideo(pr)) return pr;
      // Stale after related-video SPA — do not fall through to this object
    }

    // Scan inline scripts (SPA may have stale window var AND stale script tags)
    const scripts = document.querySelectorAll('script');
    for (const s of scripts) {
      const t = s.textContent || '';
      if (!t.includes('ytInitialPlayerResponse')) continue;
      const idx = t.indexOf('ytInitialPlayerResponse');
      const eq = t.indexOf('=', idx);
      if (eq < 0) continue;
      try {
        const json = extractJsonObject(t, eq + 1);
        if (json && json.videoDetails && prMatchesCurrentVideo(json)) return json;
      } catch (_) {}
    }
    return null;
  }

  function getInitialData() {
    if (global.ytInitialData) return global.ytInitialData;
    const scripts = document.querySelectorAll('script');
    for (const s of scripts) {
      const t = s.textContent || '';
      if (!t.includes('ytInitialData')) continue;
      const idx = t.indexOf('ytInitialData');
      const eq = t.indexOf('=', idx);
      if (eq < 0) continue;
      try {
        return extractJsonObject(t, eq + 1);
      } catch (_) {}
    }
    return null;
  }

  /** Extract a balanced JSON object starting at/after `start`. */
  function extractJsonObject(text, start) {
    let i = start;
    while (i < text.length && /\s/.test(text[i])) i++;
    if (text[i] !== '{') return null;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let j = i; j < text.length; j++) {
      const c = text[j];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) {
          return JSON.parse(text.slice(i, j + 1));
        }
      }
    }
    return null;
  }

  function parseViewCount(raw) {
    if (raw == null) return null;
    if (typeof raw === 'number' && Number.isFinite(raw)) return Math.max(0, Math.floor(raw));
    const s = String(raw).replace(/,/g, '').trim();
    // "1,234,567 views" / "1.2M views" / "842K views"
    const m = s.match(/([\d.]+)\s*([KMB])?/i);
    if (!m) {
      const digits = s.replace(/[^\d]/g, '');
      return digits ? parseInt(digits, 10) : null;
    }
    let n = parseFloat(m[1]);
    const suf = (m[2] || '').toUpperCase();
    if (suf === 'K') n *= 1e3;
    else if (suf === 'M') n *= 1e6;
    else if (suf === 'B') n *= 1e9;
    return Math.round(n);
  }

  /** Compact money: $420, $1.2K, $6.8K, $1.5M */
  function formatMoney(n) {
    if (!Number.isFinite(n) || n < 0) return '$0';
    if (n < 1000) return '$' + (n < 10 ? n.toFixed(n < 1 ? 2 : 0) : Math.round(n).toLocaleString('en-US'));
    if (n < 1e6) {
      const k = n / 1000;
      return '$' + (k >= 100 ? Math.round(k) : k.toFixed(k >= 10 ? 1 : 1)) + 'K';
    }
    const m = n / 1e6;
    return '$' + (m >= 10 ? m.toFixed(1) : m.toFixed(2)) + 'M';
  }

  function formatDuration(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) return h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    return m + ':' + String(s).padStart(2, '0');
  }

  function parseTimestamp(str) {
    const parts = String(str).trim().split(':').map((x) => parseInt(x, 10));
    if (parts.some((p) => Number.isNaN(p))) return null;
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 1) return parts[0];
    return null;
  }

  function seekTo(seconds) {
    try {
      const video = document.querySelector('video.html5-main-video, #movie_player video');
      if (video) {
        video.currentTime = seconds;
        return;
      }
      const player = document.querySelector('#movie_player');
      if (player && typeof player.seekTo === 'function') player.seekTo(seconds, true);
    } catch (_) {}
  }

  function isDarkTheme() {
    const html = document.documentElement;
    return (
      html.hasAttribute('dark') ||
      html.getAttribute('dark') === 'true' ||
      document.body?.getAttribute('data-system-theme') === 'dark' ||
      getComputedStyle(html).colorScheme === 'dark'
    );
  }

  /**
   * Wait until predicate returns a truthy node, with timeout.
   */
  function waitFor(selectorOrFn, { timeout = 15000, root = document } = {}) {
    return new Promise((resolve) => {
      const check = () => {
        const el = typeof selectorOrFn === 'function' ? selectorOrFn() : root.querySelector(selectorOrFn);
        return el || null;
      };
      const found = check();
      if (found) return resolve(found);
      const obs = new MutationObserver(() => {
        const el = check();
        if (el) {
          obs.disconnect();
          clearTimeout(tid);
          resolve(el);
        }
      });
      obs.observe(root.documentElement || root, { childList: true, subtree: true });
      const tid = setTimeout(() => {
        obs.disconnect();
        resolve(null);
      }, timeout);
    });
  }

  /**
   * Subscribe to YouTube SPA navigations + fallbacks.
   * callback(videoId) when watch/shorts context may have changed.
   */
  function onNavigate(callback) {
    let lastKey = location.href;

    const fire = () => {
      lastKey = location.href;
      try {
        callback(getVideoId());
      } catch (e) {
        console.warn('[YTI] navigate handler error', e);
      }
    };

    document.addEventListener('yt-navigate-finish', () => fire());
    document.addEventListener('yt-page-data-updated', () => fire());
    window.addEventListener('popstate', () => setTimeout(fire, 50));

    // History patch (YouTube uses pushState heavily)
    const wrap = (fn) =>
      function () {
        const r = fn.apply(this, arguments);
        setTimeout(fire, 0);
        return r;
      };
    try {
      history.pushState = wrap(history.pushState);
      history.replaceState = wrap(history.replaceState);
    } catch (_) {}

    // Title / body mutations as last resort when URL changes
    let href = location.href;
    const mo = new MutationObserver(() => {
      if (location.href !== href) {
        href = location.href;
        fire();
      }
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });

    // Initial
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => fire());
    } else {
      fire();
    }

    return () => mo.disconnect();
  }

  /** Debounce helper */
  function debounce(fn, ms) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  YTI.utils = {
    getVideoId,
    isWatchPage,
    isShortsPage,
    getPlayerResponse,
    getInitialData,
    parseViewCount,
    formatMoney,
    formatDuration,
    parseTimestamp,
    seekTo,
    isDarkTheme,
    waitFor,
    onNavigate,
    debounce,
    extractJsonObject,
    prMatchesCurrentVideo,
  };
})(window);
