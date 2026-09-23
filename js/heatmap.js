/**
 * Most-replayed heatmap above the progress bar.
 * Prefer native heatMarkerRenderer scores; else estimate from caption density.
 */
(function (global) {
  'use strict';

  const YTI = (global.YTI = global.YTI || {});
  const U = () => YTI.utils;

  const WRAP_ID = 'yti-heatmap-wrap';
  const BADGE_ID = 'yti-heatmap-badge';
  const BUCKETS = 100;

  let lastVideoId = null;
  let lastMode = null; // 'native' | 'estimated'
  let lastIntensities = null;

  function getDuration(pr) {
    const v = document.querySelector('video.html5-main-video, #movie_player video');
    if (v && v.duration && Number.isFinite(v.duration)) return v.duration;
    return parseFloat(pr?.videoDetails?.lengthSeconds || '0') || 0;
  }

  /** Extract heat marker intensities 0–1 over normalized timeline. */
  function getNativeHeat(pr) {
    const intensities = new Array(BUCKETS).fill(0);
    let found = false;

    const applyMarkers = (markers) => {
      if (!Array.isArray(markers) || !markers.length) return;
      found = true;
      const durationMs =
        (parseFloat(pr?.videoDetails?.lengthSeconds || '0') || 0) * 1000 ||
        markers.reduce((m, x) => Math.max(m, (x.timeRangeStartMillis || 0) + (x.markerDurationMillis || 0)), 0);

      for (const mk of markers) {
        const start = mk.timeRangeStartMillis || 0;
        const dur = mk.markerDurationMillis || Math.max(durationMs / BUCKETS, 1);
        const heat = typeof mk.heatMarkerIntensityScoreNormalized === 'number'
          ? mk.heatMarkerIntensityScoreNormalized
          : typeof mk.heatMarkerRenderer?.heatMarkerIntensityScoreNormalized === 'number'
            ? mk.heatMarkerRenderer.heatMarkerIntensityScoreNormalized
            : 0.3;
        const end = start + dur;
        for (let i = 0; i < BUCKETS; i++) {
          const b0 = (i / BUCKETS) * durationMs;
          const b1 = ((i + 1) / BUCKETS) * durationMs;
          if (b1 > start && b0 < end) {
            intensities[i] = Math.max(intensities[i], heat);
          }
        }
      }
    };

    const walk = (node, seen = new WeakSet()) => {
      if (!node || typeof node !== 'object' || seen.has(node)) return;
      seen.add(node);
      if (node.heatMarkers && Array.isArray(node.heatMarkers)) applyMarkers(node.heatMarkers);
      if (node.heatMarkerRenderer) {
        found = true;
        const mk = node.heatMarkerRenderer;
        applyMarkers([mk]);
      }
      // markersMap value path used by multiMarkersPlayerBarRenderer
      if (node.heatMarkerRenderer === undefined && node.markers && Array.isArray(node.markers)) {
        const heats = node.markers
          .map((m) => m.heatMarkerRenderer || m)
          .filter((m) => m && (m.heatMarkerIntensityScoreNormalized != null || m.timeRangeStartMillis != null));
        if (heats.length) applyMarkers(heats);
      }
      if (Array.isArray(node)) node.forEach((x) => walk(x, seen));
      else Object.keys(node).forEach((k) => walk(node[k], seen));
    };

    try {
      walk(pr);
      // Decorated player bar on live player
      const bar = document.querySelector('.ytp-heat-map-container, .ytp-progress-bar-container .ytp-heat-map-chapter');
      if (bar && bar.querySelector('path, svg, .ytp-heat-map-path')) {
        // Native UI already visible — still return data if we have it; else signal native-visible
        if (!found) return { intensities: null, nativeVisible: true };
      }
    } catch (_) {}

    if (!found) return null;
    normalizeInPlace(intensities);
    return { intensities, nativeVisible: false };
  }

  function normalizeInPlace(arr) {
    let max = 0;
    for (const v of arr) if (v > max) max = v;
    if (max <= 0) return;
    for (let i = 0; i < arr.length; i++) arr[i] = arr[i] / max;
  }

  async function estimateHeatFromCaptions(pr) {
    const chapters = YTI.chapters;
    if (!chapters?.fetchCaptions) return null;
    const cues = await chapters.fetchCaptions(pr);
    if (!cues?.length) return null;

    const duration = getDuration(pr) || cues[cues.length - 1].end || 0;
    if (duration < 10) return null;

    const wordCounts = new Array(BUCKETS).fill(0);
    const gapPenalty = new Array(BUCKETS).fill(0);

    for (const c of cues) {
      const words = (c.text || '').trim().split(/\s+/).filter(Boolean).length;
      const i0 = Math.max(0, Math.floor((c.start / duration) * BUCKETS));
      const i1 = Math.min(BUCKETS - 1, Math.floor((c.end / duration) * BUCKETS));
      for (let i = i0; i <= i1; i++) wordCounts[i] += words / Math.max(1, i1 - i0 + 1);
    }

    // Silence gaps → lower heat
    for (let i = 1; i < cues.length; i++) {
      const gap = cues[i].start - cues[i - 1].end;
      if (gap > 3) {
        const mid = (cues[i - 1].end + cues[i].start) / 2;
        const bi = Math.min(BUCKETS - 1, Math.max(0, Math.floor((mid / duration) * BUCKETS)));
        gapPenalty[bi] += Math.min(gap, 20);
      }
    }

    // Soft smoothing + mild intro/outro boost (people rewatch hooks)
    const out = new Array(BUCKETS).fill(0);
    for (let i = 0; i < BUCKETS; i++) {
      const prev = wordCounts[i - 1] || wordCounts[i];
      const next = wordCounts[i + 1] || wordCounts[i];
      let v = wordCounts[i] * 0.5 + prev * 0.25 + next * 0.25;
      v = Math.max(0, v - gapPenalty[i] * 0.15);
      // Slight bump near 5–15% and 85–95% (common rewatch zones) if density exists
      const p = i / BUCKETS;
      if ((p > 0.05 && p < 0.15) || (p > 0.85 && p < 0.95)) v *= 1.15;
      out[i] = v;
    }
    normalizeInPlace(out);
    // Ensure some visual shape
    const sum = out.reduce((a, b) => a + b, 0);
    if (sum < 0.01) return null;
    return out;
  }

  function findProgressContainer() {
    return (
      document.querySelector('.ytp-progress-bar-container') ||
      document.querySelector('.ytp-progress-bar')?.parentElement ||
      document.querySelector('.ytp-chrome-bottom .ytp-progress-bar')?.parentElement ||
      null
    );
  }

  function nativeHeatAlreadyVisible() {
    const el = document.querySelector('.ytp-heat-map-container, .ytp-heat-map-chapter, svg.ytp-heat-map');
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 20 && r.height > 2;
  }

  function removeOverlay() {
    runToken++;
    document.getElementById(WRAP_ID)?.remove();
    document.getElementById(BADGE_ID)?.remove();
  }

  function renderOverlay(intensities, mode) {
    const container = findProgressContainer();
    if (!container) return false;

    removeOverlay();

    // If native visible and we have native data, skip fighting — optional thin enhance only when estimated
    if (mode === 'native' && nativeHeatAlreadyVisible()) {
      lastMode = 'native';
      lastIntensities = intensities;
      return true;
    }

    const wrap = document.createElement('div');
    wrap.id = WRAP_ID;
    wrap.className = 'yti-heatmap-wrap' + (mode === 'estimated' ? ' yti-heatmap-est' : '');
    wrap.setAttribute('aria-hidden', 'true');

    const canvas = document.createElement('canvas');
    canvas.className = 'yti-heatmap-canvas';
    canvas.width = BUCKETS * 4;
    canvas.height = 40;
    wrap.appendChild(canvas);

    // Position above progress bar scrubber area
    container.style.position = container.style.position || 'relative';
    wrap.style.left = '0';
    wrap.style.right = '0';
    wrap.style.bottom = '100%';
    wrap.style.height = '3px';
    wrap.style.pointerEvents = 'none';
    wrap.style.zIndex = '35';
    wrap.style.position = 'absolute';
    container.appendChild(wrap);

    // Draw
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    // Grey most-watched look similar to YouTube
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(0, 0, w, h);

    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let i = 0; i < intensities.length; i++) {
      const x = (i / (intensities.length - 1)) * w;
      const y = h - intensities[i] * (h * 0.92);
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fillStyle = mode === 'estimated' ? 'rgba(180,180,180,0.45)' : 'rgba(200,200,200,0.55)';
    ctx.fill();

    // Soft stroke
    ctx.beginPath();
    for (let i = 0; i < intensities.length; i++) {
      const x = (i / (intensities.length - 1)) * w;
      const y = h - intensities[i] * (h * 0.92);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1;
    ctx.stroke();

    if (mode === 'estimated') {
      const badge = document.createElement('div');
      badge.id = BADGE_ID;
      badge.className = 'yti-heatmap-badge';
      badge.textContent = 'heatmap est.';
      badge.title = 'Estimated most-replayed from caption pacing — not YouTube official heat markers';
      container.appendChild(badge);
    }

    // Stretch canvas visually
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';

    lastMode = mode;
    lastIntensities = intensities;
    return true;
  }

  let runToken = 0;

  async function run(videoId) {
    if (!U().isWatchPage()) {
      removeOverlay();
      lastVideoId = null;
      return;
    }
    const vid = U().getVideoId() || videoId;
    if (!vid) {
      removeOverlay();
      return;
    }

    const token = ++runToken;
    let pr = U().getPlayerResponse();
    if (!pr || (pr.videoDetails?.videoId && pr.videoDetails.videoId !== vid)) {
      for (let i = 0; i < 10 && token === runToken; i++) {
        await new Promise((r) => setTimeout(r, 300));
        if (U().getVideoId() !== vid) return;
        pr = U().getPlayerResponse();
        if (pr && (!pr.videoDetails?.videoId || pr.videoDetails.videoId === vid)) break;
      }
      if (token !== runToken) return;
      if (!pr || (pr.videoDetails?.videoId && pr.videoDetails.videoId !== vid)) return;
    }

    // Wait briefly for player chrome
    await U().waitFor(() => findProgressContainer(), { timeout: 8000 });
    if (token !== runToken || U().getVideoId() !== vid) return;

    const native = getNativeHeat(pr);
    if (native?.nativeVisible && !native.intensities) {
      // Don't overlay — native already shown
      removeOverlay();
      lastVideoId = vid;
      lastMode = 'native';
      return;
    }
    if (native?.intensities) {
      renderOverlay(native.intensities, 'native');
      lastVideoId = vid;
      // If native UI also present, remove our overlay to avoid double
      if (nativeHeatAlreadyVisible()) removeOverlay();
      return;
    }

    const est = await estimateHeatFromCaptions(pr);
    if (token !== runToken) return;
    if (est) {
      renderOverlay(est, 'estimated');
      lastVideoId = vid;
    } else {
      removeOverlay();
      lastVideoId = vid;
    }
  }

  function ensurePresent() {
    if (!U().isWatchPage()) return;
    if (!findProgressContainer()) return;
    if (lastMode === 'native' && nativeHeatAlreadyVisible()) return;
    if (!document.getElementById(WRAP_ID) && lastIntensities && lastVideoId === U().getVideoId()) {
      if (!(lastMode === 'native' && nativeHeatAlreadyVisible())) {
        renderOverlay(lastIntensities, lastMode || 'estimated');
      }
    }
  }

  YTI.heatmap = { run, ensurePresent, removeOverlay, getNativeHeat };
})(window);
