/**
 * YT Insights — boot + SPA orchestration.
 * Coexists with SponsorBlock / YouTube Premium (no ad-block or sponsor-skip UI).
 */
(function (global) {
  'use strict';

  const YTI = (global.YTI = global.YTI || {});
  const U = YTI.utils;

  if (!U) {
    console.error('[YTI] utils missing — check manifest script order');
    return;
  }

  let activeVideoId = null;
  let reinjectObs = null;
  let navTimers = [];
  let featureTimers = [];

  function clearNavTimers() {
    for (const t of navTimers) clearTimeout(t);
    navTimers = [];
  }

  function clearFeatureTimers() {
    for (const t of featureTimers) clearTimeout(t);
    featureTimers = [];
  }

  function clearActivateTimers() {
    clearNavTimers();
    clearFeatureTimers();
  }

  function tearDown() {
    // Cancel staggered feature runs so they cannot reinject after SPA leave
    clearFeatureTimers();
    YTI.revenue?.removeChip?.();
    YTI.chapters?.removePanel?.();
    YTI.heatmap?.removeOverlay?.();
    YTI.spam?.reset?.();
    YTI.viral?.removeStrip?.();
    YTI.transcript?.removeBox?.();
  }

  /**
   * Run feature modules for the current watch page.
   * Always re-reads URL video id — never trust a closed-over id from navigate.
   * Stagger slightly so DOM anchors exist (revenue → viral → chapters → transcript → heatmap → spam).
   */
  async function activate() {
    if (!U.isWatchPage() && !U.isShortsPage()) {
      tearDown();
      activeVideoId = null;
      return;
    }

    const vid = U.getVideoId();
    if (!vid) {
      tearDown();
      activeVideoId = null;
      return;
    }

    // New video → clear stale UI immediately, then populate for this id only
    if (vid !== activeVideoId) {
      tearDown();
      activeVideoId = vid;
    }

    // Shorts: revenue only (compact); skip heavy watch UI
    if (U.isShortsPage() && !U.isWatchPage()) {
      YTI.revenue?.run?.(vid);
      return;
    }

    YTI.revenue?.run?.(vid);

    // Replace prior staggered runs (e.g. second scheduleActivate tick)
    clearFeatureTimers();

    // Delayed runs re-read getVideoId() so a later SPA nav cannot apply old id
    featureTimers.push(
      setTimeout(() => {
        if (U.getVideoId() !== vid) return;
        YTI.viral?.run?.(U.getVideoId());
      }, 200)
    );

    featureTimers.push(
      setTimeout(() => {
        if (U.getVideoId() !== vid) return;
        YTI.chapters?.run?.(U.getVideoId());
      }, 300)
    );

    featureTimers.push(
      setTimeout(() => {
        if (U.getVideoId() !== vid) return;
        YTI.heatmap?.run?.(U.getVideoId());
      }, 400)
    );

    featureTimers.push(
      setTimeout(() => {
        if (U.getVideoId() !== vid) return;
        YTI.transcript?.run?.(U.getVideoId());
      }, 600)
    );

    featureTimers.push(
      setTimeout(() => {
        if (U.getVideoId() !== vid) return;
        YTI.spam?.run?.(U.getVideoId());
      }, 800)
    );
  }

  function setupReinjectObserver() {
    reinjectObs?.disconnect();
    reinjectObs = new MutationObserver(
      U.debounce(() => {
        if (!activeVideoId || (!U.isWatchPage() && !U.isShortsPage())) return;
        // URL changed under us — force full tearDown + activate, do not reinject stale nodes
        const current = U.getVideoId();
        if (current !== activeVideoId) {
          clearNavTimers();
          tearDown();
          activeVideoId = null;
          activate();
          return;
        }
        YTI.revenue?.ensurePresent?.();
        YTI.viral?.ensurePresent?.();
        YTI.chapters?.ensurePresent?.();
        YTI.transcript?.ensurePresent?.();
        YTI.heatmap?.ensurePresent?.();
        YTI.spam?.ensurePresent?.();
      }, 400)
    );
    reinjectObs.observe(document.documentElement, { childList: true, subtree: true });
  }

  function scheduleActivate() {
    // Clear pending delayed feature runs from a previous navigation
    clearActivateTimers();

    const urlVid = U.getVideoId();
    // Clear UI immediately when the URL video id changed (SPA related-video click)
    if (urlVid !== activeVideoId) {
      tearDown();
      // Keep activeVideoId null until activate assigns the new one
      activeVideoId = null;
    }

    // Small delays: yt-navigate-finish often fires before player response swaps.
    // Re-read getVideoId() inside each timeout — never close over the event id.
    navTimers.push(setTimeout(() => activate(), 150));
    navTimers.push(setTimeout(() => activate(), 1200));
  }

  function boot() {
    console.info('[YTI] YT Insights content script ready');
    setupReinjectObserver();
    U.onNavigate(() => {
      scheduleActivate();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);
