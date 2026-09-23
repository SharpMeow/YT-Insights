/**
 * Compact “Why is this viral?” line under metadata.
 * Single muted sentence: views/day + plain-language velocity (no likes %).
 * Stays in the description/info area — never title, never actions row.
 */
(function (global) {
  'use strict';

  const YTI = (global.YTI = global.YTI || {});
  const U = () => YTI.utils;

  const STRIP_ID = 'yti-viral-strip';
  let lastVideoId = null;
  let lastHtml = null;

  function getPublishDate(pr) {
    try {
      const mf = pr?.microformat?.playerMicroformatRenderer;
      const iso = mf?.publishDate || mf?.uploadDate;
      if (iso) return new Date(iso);
    } catch (_) {}
    // DOM: "Premiered …" / "Started streaming …" / absolute date in tooltip
    const sels = [
      '#info-strings yt-formatted-string',
      'ytd-watch-info-text #tooltip',
      'ytd-watch-info-text',
      '#description-inner #info-container',
      'meta[itemprop="datePublished"]',
      'meta[itemprop="uploadDate"]',
    ];
    for (const sel of sels) {
      const el = document.querySelector(sel);
      if (!el) continue;
      if (el.tagName === 'META') {
        const d = new Date(el.getAttribute('content'));
        if (!Number.isNaN(d.getTime())) return d;
      }
      const t = el.getAttribute?.('content') || el.textContent || '';
      const iso = t.match(/\d{4}-\d{2}-\d{2}/);
      if (iso) {
        const d = new Date(iso[0]);
        if (!Number.isNaN(d.getTime())) return d;
      }
      // "Oct 12, 2023" / "12 Oct 2023"
      const parsed = Date.parse(t.replace(/^\s*(Premiered|Uploaded|Streamed live on|Started streaming on)\s*/i, ''));
      if (!Number.isNaN(parsed)) return new Date(parsed);
    }
    return null;
  }

  function getLikeCount(pr) {
    // Rarely in videoDetails; often in buttons / initial data
    try {
      let likes = null;
      const walk = (node, seen = new WeakSet()) => {
        if (!node || typeof node !== 'object' || seen.has(node) || likes != null) return;
        seen.add(node);
        if (node.likeCount != null && likes == null) {
          const n = parseInt(String(node.likeCount).replace(/\D/g, ''), 10);
          if (n > 0) likes = n;
        }
        // defaultText accessibility on like button
        if (node.accessibilityText && /like/i.test(node.accessibilityText) && /[\d,]+/.test(node.accessibilityText)) {
          const m = node.accessibilityText.match(/([\d,]+)/);
          if (m && likes == null) likes = parseInt(m[1].replace(/,/g, ''), 10);
        }
        if (Array.isArray(node)) node.forEach((x) => walk(x, seen));
        else Object.keys(node).forEach((k) => walk(node[k], seen));
      };
      walk(pr);
      walk(U().getInitialData());
      if (likes) return likes;
    } catch (_) {}

    // DOM like button label
    const btn =
      document.querySelector('like-button-view-model button[aria-label]') ||
      document.querySelector('#top-level-buttons-computed button[aria-label*="like" i]') ||
      document.querySelector('ytd-toggle-button-renderer button[aria-label*="like" i]');
    if (btn) {
      const label = btn.getAttribute('aria-label') || '';
      const m = label.match(/([\d,.]+)\s*[KMB]?/i) || label.match(/([\d,]+)/);
      if (m) {
        const n = U().parseViewCount(m[0] + (label.match(/[KMB]/i)?.[0] || ''));
        // parseViewCount needs suffix attached — try full match
        const full = label.match(/([\d,.]+)\s*([KMB])?/i);
        if (full) return U().parseViewCount(full[1] + (full[2] || ''));
        if (n) return n;
      }
    }
    return null;
  }

  function daysSince(date) {
    if (!date) return null;
    const ms = Date.now() - date.getTime();
    if (ms < 0) return 0;
    return Math.max(ms / (1000 * 60 * 60 * 24), 1 / 24); // min ~1 hour
  }

  function formatViewsPerDay(vpd) {
    if (vpd >= 1e6) return (vpd / 1e6).toFixed(1) + 'M';
    if (vpd >= 1e3) return (vpd / 1e3).toFixed(vpd >= 10000 ? 0 : 1) + 'K';
    if (vpd >= 100) return String(Math.round(vpd));
    if (vpd >= 10) return vpd.toFixed(0);
    return vpd.toFixed(1);
  }

  function buildBlurb({ days, vpd }) {
    // Views/day once + short velocity phrase only (no likes %)
    if (vpd == null || days == null) return 'Not enough metadata for a velocity read';

    const vpdStr = formatViewsPerDay(vpd);
    let phrase;
    if (days < 3 && vpd >= 50000) phrase = 'High velocity for its age';
    else if (days < 14 && vpd >= 20000) phrase = 'Rising fast for its age';
    else if (days > 180 && vpd >= 5000) phrase = 'Steady evergreen pace';
    else if (days > 365 && vpd < 500) phrase = 'Long-tail pace';
    else if (vpd >= 10000) phrase = 'Strong pace for its age';
    else phrase = 'Typical pace for its age';

    return `~${vpdStr} views/day · ${phrase}`;
  }

  function removeStrip() {
    clearTimeout(retryTimer);
    retryTimer = null;
    retryCount = 0;
    document.getElementById(STRIP_ID)?.remove();
  }

  /**
   * Metadata / description area only — never #title, never actions row.
   * Prefer watch-info / info-container; fall back under revenue wrap's
   * metadata siblings if needed (not inside the wrap itself).
   */
  function findAnchor() {
    const candidates = [
      () => document.querySelector('ytd-watch-info-text'),
      () => document.querySelector('#description-inner #info-container'),
      () => document.querySelector('ytd-watch-metadata #info-container'),
      () => document.querySelector('#info-container'),
      () => document.querySelector('#description-inner'),
      () => document.querySelector('ytd-watch-metadata #description'),
      () => document.querySelector('ytd-video-primary-info-renderer #info'),
      () => document.querySelector('ytd-watch-metadata #bottom-row'),
      () => document.querySelector('ytd-watch-metadata'),
    ];
    for (const fn of candidates) {
      const el = fn();
      if (!el || !el.isConnected) continue;
      // Never title; never actions / likes column
      if (el.id === 'title' || el.closest?.('#title')) continue;
      if (el.closest?.('#actions, #menu-container, #top-level-buttons-computed, #actions-inner')) {
        continue;
      }
      return el;
    }
    return null;
  }

  function inject(stats) {
    removeStrip();
    const anchor = findAnchor();
    if (!anchor) return false;

    const strip = document.createElement('div');
    strip.id = STRIP_ID;
    strip.className = 'yti-viral-strip';
    strip.setAttribute('title', 'Heuristic only — not an official virality score');

    strip.innerHTML = `<span class="yti-viral-blurb">${escapeHtml(stats.blurb)}</span>`;

    // Quiet line in metadata/description area — after info row when possible
    const info =
      document.querySelector('ytd-watch-info-text') ||
      document.querySelector('#description-inner #info-container') ||
      document.querySelector('#info-container');

    if (info && info.parentNode && info.isConnected) {
      info.parentNode.insertBefore(strip, info.nextSibling);
    } else if (anchor.parentNode) {
      anchor.parentNode.insertBefore(strip, anchor.nextSibling);
    } else {
      anchor.appendChild(strip);
    }

    lastHtml = strip.innerHTML;
    return true;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  let retryTimer = null;

  let retryCount = 0;

  function run(videoId) {
    if (!U().isWatchPage()) {
      removeStrip();
      lastVideoId = null;
      retryCount = 0;
      return;
    }
    const vid = U().getVideoId() || videoId;
    if (!vid) {
      removeStrip();
      return;
    }

    const pr = U().getPlayerResponse();
    // Wait for player response that matches URL — avoid DOM views from previous SPA video
    if (!pr || (pr.videoDetails?.videoId && pr.videoDetails.videoId !== vid)) {
      clearTimeout(retryTimer);
      if (retryCount < 12) {
        retryCount++;
        retryTimer = setTimeout(() => run(vid), 400);
      }
      return;
    }

    const views =
      (YTI.revenue && YTI.revenue.getViewCount(pr)) ||
      U().parseViewCount(pr?.videoDetails?.viewCount) ||
      null;
    const published = getPublishDate(pr);
    const days = daysSince(published);

    if (!views) {
      clearTimeout(retryTimer);
      if (retryCount < 12) {
        retryCount++;
        retryTimer = setTimeout(() => run(vid), 900);
      }
      return;
    }
    retryCount = 0;

    const vpd = days ? views / days : null;
    const blurb = buildBlurb({ days, vpd });

    const ok = inject({ views, days, vpd, blurb });
    lastVideoId = vid;
    if (!ok) {
      clearTimeout(retryTimer);
      retryTimer = setTimeout(() => run(vid), 1000);
    }
  }

  function ensurePresent() {
    if (!U().isWatchPage()) return;
    if (!document.getElementById(STRIP_ID) && lastVideoId === U().getVideoId() && lastHtml) {
      run(lastVideoId);
    }
  }

  YTI.viral = { run, ensurePresent, removeStrip, getPublishDate, getLikeCount };
})(window);
