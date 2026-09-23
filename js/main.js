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

  function tearDown() {
    YTI.revenue?.removeChip?.();
    YTI.chapters?.removePanel?.();
    YTI.heatmap?.removeOverlay?.();
    YTI.spam?.reset?.();
    YTI.viral?.removeStrip?.();
    YTI.transcript?.removeBox?.();
  }

  /**
   * Run feature modules for the current watch page.
   * Stagger slightly so DOM anchors exist (revenue → viral → chapters → transcript → heatmap → spam).
   */
  async function activate(videoId) {
    if (!U.isWatchPage() && !U.isShortsPage()) {
      tearDown();
      activeVideoId = null;
      return;
    }

    const vid = videoId || U.getVideoId();
    if (!vid) {
      tearDown();
      activeVideoId = null;
      return;
    }

    // New video → full refresh
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

    // Viral strip depends on view count / chip placement
    setTimeout(() => YTI.viral?.run?.(vid), 200);

    setTimeout(() => YTI.chapters?.run?.(vid), 300);

    setTimeout(() => YTI.transcript?.run?.(vid), 600);

    setTimeout(() => YTI.heatmap?.run?.(vid), 400);

    setTimeout(() => YTI.spam?.run?.(vid), 800);
  }

  function setupReinjectObserver() {
    reinjectObs?.disconnect();
    reinjectObs = new MutationObserver(
      U.debounce(() => {
        if (!activeVideoId || (!U.isWatchPage() && !U.isShortsPage())) return;
        if (U.getVideoId() !== activeVideoId) return;
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

  function boot() {
    console.info('[YTI] YT Insights content script ready');
    setupReinjectObserver();
    U.onNavigate((videoId) => {
      // Small delay: yt-navigate-finish often fires before player response swaps
      setTimeout(() => activate(videoId), 150);
      setTimeout(() => activate(videoId), 1200);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);
