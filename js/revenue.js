/**
 * Estimated ad revenue — multiple labeled RPM models aggregated client-side.
 * NOT official YouTube Analytics. Renders as plain muted text above the like
 * buttons on the watch-page actions column (right side), with hover breakdown.
 */
(function (global) {
  'use strict';

  const YTI = (global.YTI = global.YTI || {});
  const U = () => YTI.utils;

  const CHIP_ID = 'yti-revenue-chip';
  const WRAP_ID = 'yti-revenue-wrap';
  const TIP_ID = 'yti-revenue-tooltip';
  const STACK_ID = 'yti-actions-stack';

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
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** True if node is (or lives under) the video title — never inject there. */
  function isTitleNode(el) {
    if (!el || !el.closest) return false;
    if (el.id === 'title' || el.tagName === 'H1') return true;
    return !!el.closest('#title, ytd-watch-metadata #title, h1.ytd-video-primary-info-renderer, h1.ytd-watch-metadata');
  }

  /** True if node is under channel/subscribe owner row — never inject there. */
  function isOwnerRow(el) {
    if (!el || !el.closest) return false;
    return !!el.closest(
      '#owner, ytd-video-owner-renderer, #upload-info, #meta ytd-video-owner-renderer, ytd-watch-metadata #owner'
    );
  }

  /**
   * Likes / actions cluster on the watch page (right side of top-row).
   * Prefer button-group hosts; never title or owner/subscribe.
   */
  function findActionsAnchor() {
    const selectors = [
      'ytd-watch-metadata #actions',
      'ytd-watch-metadata #actions-inner',
      'ytd-watch-metadata #menu-container',
      'ytd-watch-metadata #top-level-buttons-computed',
      '#actions',
      '#menu-container',
      '#top-level-buttons-computed',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.isConnected && !isTitleNode(el) && !isOwnerRow(el)) return el;
    }

    // Parent of like / segmented like-dislike controls (still under actions, not owner)
    const likeHost =
      document.querySelector('ytd-watch-metadata like-button-view-model') ||
      document.querySelector('ytd-watch-metadata segmented-like-dislike-button-view-model') ||
      document.querySelector('like-button-view-model') ||
      document.querySelector('segmented-like-dislike-button-view-model') ||
      document.querySelector('#top-level-buttons-computed');
    if (likeHost && likeHost.isConnected && !isOwnerRow(likeHost)) {
      // Prefer #actions ancestor so we can column-stack above the whole button group
      const actions = likeHost.closest('#actions, #actions-inner, #menu-container, #menu');
      if (actions && actions.isConnected && !isTitleNode(actions) && !isOwnerRow(actions)) {
        return actions;
      }
      const parent = likeHost.parentElement;
      if (parent && parent.isConnected && !isTitleNode(parent) && !isOwnerRow(parent)) return parent;
      if (!isTitleNode(likeHost)) return likeHost;
    }

    // Shorts / sparse DOM: safe non-title fallback under actions area only
    if (U().isShortsPage()) {
      const shortsActions =
        document.querySelector('ytd-reel-video-renderer #actions') ||
        document.querySelector('ytd-shorts #actions') ||
        document.querySelector('#actions');
      if (
        shortsActions &&
        shortsActions.isConnected &&
        !isTitleNode(shortsActions) &&
        !isOwnerRow(shortsActions)
      ) {
        return shortsActions;
      }
      return null; // skip inject rather than touch title
    }

    return null;
  }

  function removeChip() {
    clearTimeout(retryTimer);
    retryTimer = null;
    retryCount = 0;
    document.getElementById(WRAP_ID)?.remove();
    document.getElementById(CHIP_ID)?.remove();
    document.getElementById(TIP_ID)?.remove();
    // Unwrap stack: move children back to parent, remove stack
    const stack = document.getElementById(STACK_ID);
    if (stack && stack.parentNode) {
      const parent = stack.parentNode;
      while (stack.firstChild) {
        parent.insertBefore(stack.firstChild, stack);
      }
      stack.remove();
    }
  }

  /**
   * Ensure a column stack around the likes/actions cluster so revenue sits
   * above the button group, right-aligned, without stretching #actions into
   * the sidebar via width:100% on a flex row sibling of #owner.
   */
  function ensureActionsStack(anchor) {
    if (!anchor || !anchor.isConnected) return null;

    // Already inside our stack
    const existing = anchor.closest('#' + STACK_ID) || (anchor.id === STACK_ID ? anchor : null);
    if (existing) return existing;

    // Prefer stacking the whole #actions / menu host so likes stay grouped
    let host = anchor;
    if (anchor.id === 'top-level-buttons-computed' || anchor.tagName === 'LIKE-BUTTON-VIEW-MODEL') {
      host =
        anchor.closest('#actions, #actions-inner, #menu-container, #menu') || anchor.parentElement || anchor;
    }

    if (host.id === STACK_ID) return host;
    if (host.parentElement?.id === STACK_ID) return host.parentElement;

    const stack = document.createElement('div');
    stack.id = STACK_ID;
    stack.className = 'yti-actions-stack';

    const parent = host.parentNode;
    if (!parent) return null;
    parent.insertBefore(stack, host);
    stack.appendChild(host);
    return stack;
  }

  function injectChip(est) {
    removeChip();
    const anchor = findActionsAnchor();
    if (!anchor || isTitleNode(anchor) || isOwnerRow(anchor)) return false;

    const stack = ensureActionsStack(anchor);
    if (!stack) return false;

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

    // First child of stack → visually above like buttons; CSS right-aligns
    if (stack.firstChild) {
      stack.insertBefore(wrap, stack.firstChild);
    } else {
      stack.appendChild(wrap);
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
  let retryCount = 0;

  function run(videoId) {
    if (!U().isWatchPage() && !U().isShortsPage()) {
      removeChip();
      lastVideoId = null;
      retryCount = 0;
      return;
    }
    // Prefer live URL id over any closed-over argument
    const vid = U().getVideoId() || videoId;
    if (!vid) {
      removeChip();
      return;
    }
    if (videoId && videoId !== vid) {
      // Caller passed a stale id — ignore and use URL
    }

    const pr = U().getPlayerResponse();
    // getPlayerResponse already rejects mismatched videoIds; if null/mismatch, wait
    if (!pr || (pr.videoDetails?.videoId && pr.videoDetails.videoId !== vid)) {
      clearTimeout(retryTimer);
      if (retryCount < 12) {
        retryCount++;
        retryTimer = setTimeout(() => run(vid), 400);
      }
      return;
    }

    const views = getViewCount(pr);
    if (!views || views <= 0) {
      clearTimeout(retryTimer);
      if (retryCount < 12) {
        retryCount++;
        retryTimer = setTimeout(() => run(vid), 800);
      }
      return;
    }

    retryCount = 0;
    const isShorts = detectShorts(pr);
    const est = estimate(views, isShorts);
    const ok = injectChip(est);
    lastVideoId = vid;

    if (!ok) {
      clearTimeout(retryTimer);
      retryTimer = setTimeout(() => run(vid), 1000);
    }
  }

  /** Re-inject if YouTube wiped our node — only for the current URL video. */
  function ensurePresent() {
    if (!U().isWatchPage() && !U().isShortsPage()) return;
    const current = U().getVideoId();
    if (!current || lastVideoId !== current) return;
    if (!document.getElementById(CHIP_ID) && !document.getElementById(WRAP_ID)) {
      run(current);
    }
  }

  YTI.revenue = { run, ensurePresent, removeChip, estimate, getViewCount };
})(window);
