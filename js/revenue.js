/**
 * Estimated ad revenue — multiple labeled RPM models aggregated client-side.
 * NOT official YouTube Analytics. Renders as plain muted text above the like
 * buttons on the watch-page actions row (right side), with hover breakdown.
 */
(function (global) {
  'use strict';

  const YTI = (global.YTI = global.YTI || {});
  const U = () => YTI.utils;

  const CHIP_ID = 'yti-revenue-chip';
  const WRAP_ID = 'yti-revenue-wrap';
  const TIP_ID = 'yti-revenue-tooltip';

  // RPM bands (USD per 1000 monetized views)
  const MODELS = {
    socialBlade: { label: 'Social Blade band', low: 0.25, high: 4.0 },
    industry: { label: 'Industry mid (long-form)', low: 0.75, high: 5.0 },
    // CPM $2–$12 × 0.55 creator share × ~0.7 monetized playback rate
    cpmProxy: {
      label: 'CPM→RPM proxy',
      low: 2 * 0.55 * 0.7,
      high: 12 * 0.55 * 0.7,
    },
    shorts: { label: 'Shorts RPM', low: 0.02, high: 0.1 },
  };

  function detectShorts(pr) {
    if (U().isShortsPage()) return true;
    try {
      const vd = pr?.videoDetails;
      if (!vd) return false;
      // length under ~60s + shorts-ish signals
      const len = parseInt(vd.lengthSeconds || '0', 10);
      if (len > 0 && len <= 60) {
        const title = (vd.title || '').toLowerCase();
        if (/#shorts?\b/.test(title) || /\/shorts\//.test(location.href)) return true;
      }
      // microformat / player config hints
      const mf = pr?.microformat?.playerMicroformatRenderer;
      if (mf?.isShortsEligible) return true;
    } catch (_) {}
    return false;
  }

  function getViewCount(pr) {
    const fromPr = pr?.videoDetails?.viewCount;
    if (fromPr != null) {
      const n = U().parseViewCount(fromPr);
      if (n != null) return n;
    }
    // DOM fallbacks (YouTube changes these often)
    const selectors = [
      'ytd-watch-info-text #tooltip',
      'ytd-watch-info-text yt-formatted-string',
      '#info-container #count yt-view-count-renderer',
      '#info #count .view-count',
      'ytd-video-primary-info-renderer #count .view-count',
      '.view-count',
      '#count .ytd-video-view-count-renderer',
      'ytd-watch-metadata #info-container span',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const text = (el.textContent || '').trim();
      if (/view/i.test(text) || /[\d,]{3,}/.test(text)) {
        const n = U().parseViewCount(text);
        if (n != null && n > 0) return n;
      }
    }
    // aria / tooltip on engagement row
    const tip = document.querySelector('#description-inner #info-container, ytd-watch-info-text');
    if (tip) {
      const n = U().parseViewCount(tip.textContent);
      if (n != null && n > 0) return n;
    }
    return null;
  }

  function estimate(views, isShorts) {
    const active = isShorts
      ? { shorts: MODELS.shorts }
      : {
          socialBlade: MODELS.socialBlade,
          industry: MODELS.industry,
          cpmProxy: MODELS.cpmProxy,
        };

    const rows = [];
    let lows = [];
    let highs = [];
    let mids = [];

    for (const [key, m] of Object.entries(active)) {
      const low = (views / 1000) * m.low;
      const high = (views / 1000) * m.high;
      const mid = (low + high) / 2;
      rows.push({ key, label: m.label, rpmLow: m.low, rpmHigh: m.high, low, high, mid });
      lows.push(low);
      highs.push(high);
      mids.push(mid);
    }

    const aggLow = Math.min(...lows);
    const aggHigh = Math.max(...highs);
    const aggMid = mids.reduce((a, b) => a + b, 0) / mids.length;

    return { views, isShorts, rows, aggLow, aggHigh, aggMid };
  }

  function chipLabel(est) {
    const lo = U().formatMoney(est.aggLow);
    const hi = U().formatMoney(est.aggHigh);
    return `~${lo}–${hi}`;
  }

  function buildTooltipHtml(est) {
    const mid = U().formatMoney(est.aggMid);
    const rows = est.rows
      .map(
        (r) =>
          `<div class="yti-tip-row">
            <span class="yti-tip-label">${escapeHtml(r.label)}</span>
            <span class="yti-tip-val">${U().formatMoney(r.low)}–${U().formatMoney(r.high)}</span>
            <span class="yti-tip-rpm">RPM $${r.rpmLow.toFixed(2)}–$${r.rpmHigh.toFixed(2)}</span>
          </div>`
      )
      .join('');
    return `
      <div class="yti-tip-title">Estimated ad revenue <span class="yti-badge">estimate</span></div>
      <div class="yti-tip-meta">${est.views.toLocaleString()} views · mid ≈ ${mid}${est.isShorts ? ' · Shorts rates' : ''}</div>
      <div class="yti-tip-rows">${rows}</div>
      <div class="yti-tip-foot">Formula: (views/1000)×RPM. Not YouTube Analytics. Client-side models only.</div>
    `;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&')
      .replace(/</g, '<')
      .replace(/>/g, '>')
      .replace(/"/g, '"');
  }

  /** True if node is (or lives under) the video title — never inject there. */
  function isTitleNode(el) {
    if (!el || !el.closest) return false;
    if (el.id === 'title' || el.tagName === 'H1') return true;
    return !!el.closest('#title, ytd-watch-metadata #title, h1.ytd-video-primary-info-renderer, h1.ytd-watch-metadata');
  }

  /**
   * Actions / likes row on the watch page (right side). Never title / views.
   * Prefer first connected match from the ordered list.
   */
  function findActionsAnchor() {
    const selectors = [
      'ytd-watch-metadata #actions',
      '#actions',
      '#menu-container',
      '#top-level-buttons-computed',
      'ytd-watch-metadata #actions-inner',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.isConnected && !isTitleNode(el)) return el;
    }

    // Parent of like / segmented like-dislike controls
    const likeHost =
      document.querySelector('like-button-view-model') ||
      document.querySelector('segmented-like-dislike-button-view-model') ||
      document.querySelector('#top-level-buttons-computed');
    if (likeHost && likeHost.isConnected) {
      const parent = likeHost.parentElement;
      if (parent && parent.isConnected && !isTitleNode(parent)) return parent;
      if (!isTitleNode(likeHost)) return likeHost;
    }

    // Shorts / sparse DOM: safe non-title fallback under actions area only
    if (U().isShortsPage()) {
      const shortsActions =
        document.querySelector('ytd-reel-video-renderer #actions') ||
        document.querySelector('ytd-shorts #actions') ||
        document.querySelector('#actions');
      if (shortsActions && shortsActions.isConnected && !isTitleNode(shortsActions)) {
        return shortsActions;
      }
      return null; // skip inject rather than touch title
    }

    return null;
  }

  function removeChip() {
    document.getElementById(WRAP_ID)?.remove();
    document.getElementById(CHIP_ID)?.remove();
    document.getElementById(TIP_ID)?.remove();
  }

  function injectChip(est) {
    removeChip();
    const anchor = findActionsAnchor();
    if (!anchor || isTitleNode(anchor)) return false;

    const wrap = document.createElement('div');
    wrap.id = WRAP_ID;
    wrap.className = 'yti-revenue-wrap';

    const chip = document.createElement('span');
    chip.id = CHIP_ID;
    chip.className = 'yti-revenue-chip';
    chip.setAttribute('role', 'button');
    chip.setAttribute('tabindex', '0');
    chip.setAttribute('aria-label', 'Estimated ad revenue (estimate only)');
    // Plain muted text; · between range and “est.” — no trailing separator for views
    chip.innerHTML = `<span class="yti-rev-text">${chipLabel(est)} · est.</span>`;

    wrap.appendChild(chip);

    const tip = document.createElement('div');
    tip.id = TIP_ID;
    tip.className = 'yti-revenue-tooltip';
    tip.hidden = true;
    tip.innerHTML = buildTooltipHtml(est);
    document.body.appendChild(tip);

    const showTip = () => {
      tip.hidden = false;
      tip.classList.add('yti-visible');
      positionTip(chip, tip);
    };
    const hideTip = () => {
      tip.classList.remove('yti-visible');
      tip.hidden = true;
    };

    chip.addEventListener('mouseenter', showTip);
    chip.addEventListener('mouseleave', hideTip);
    chip.addEventListener('focus', showTip);
    chip.addEventListener('blur', hideTip);
    chip.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (tip.hidden) showTip();
      else hideTip();
    });

    // First child of actions column → visually above like buttons, right-aligned via CSS
    if (anchor.firstChild) {
      anchor.insertBefore(wrap, anchor.firstChild);
    } else {
      anchor.appendChild(wrap);
    }

    return true;
  }

  function positionTip(chip, tip) {
    const r = chip.getBoundingClientRect();
    const pad = 8;
    tip.style.left = Math.min(r.left, window.innerWidth - tip.offsetWidth - pad) + 'px';
    tip.style.top = Math.min(r.bottom + 6, window.innerHeight - tip.offsetHeight - pad) + 'px';
  }

  let lastVideoId = null;
  let retryTimer = null;

  function run(videoId) {
    if (!U().isWatchPage() && !U().isShortsPage()) {
      removeChip();
      lastVideoId = null;
      return;
    }
    const vid = videoId || U().getVideoId();
    if (!vid) {
      removeChip();
      return;
    }

    const pr = U().getPlayerResponse();
    // Ensure PR matches current video when possible
    if (pr?.videoDetails?.videoId && pr.videoDetails.videoId !== vid) {
      // stale — still try DOM views
    }

    const views = getViewCount(pr);
    if (!views || views <= 0) {
      // Retry shortly while metadata loads
      clearTimeout(retryTimer);
      retryTimer = setTimeout(() => run(vid), 800);
      return;
    }

    const isShorts = detectShorts(pr);
    const est = estimate(views, isShorts);
    const ok = injectChip(est);
    lastVideoId = vid;

    if (!ok) {
      clearTimeout(retryTimer);
      retryTimer = setTimeout(() => run(vid), 1000);
    }
  }

  /** Re-inject if YouTube wiped our node. */
  function ensurePresent() {
    if (!U().isWatchPage() && !U().isShortsPage()) return;
    if (!document.getElementById(CHIP_ID) && !document.getElementById(WRAP_ID) && lastVideoId) {
      run(lastVideoId);
    }
  }

  YTI.revenue = { run, ensurePresent, removeChip, estimate, getViewCount };
})(window);
