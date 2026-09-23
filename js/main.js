/**
 * YT Insights — boot + SPA orchestration.
 * Coexists with SponsorBlock / YouTube Premium (no ad-block or sponsor-skip UI).
 * Theater: reinject after layout flip. Fullscreen: hide / tear down UI until exit.
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
  let layoutObs = null;
  let fsPaused = false;
  let lastTheater = null;

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
    clearFeatureTimers();
    YTI.revenue?.removeChip?.();
    YTI.chapters?.removePanel?.();
    YTI.heatmap?.removeOverlay?.();
    YTI.spam?.reset?.();
    YTI.viral?.removeStrip?.();
    YTI.transcript?.removeBox?.();
  }

  function setFullscreenPaused(paused) {
    const next = !!paused;
    if (next === fsPaused) {
      document.documentElement.classList.toggle('yti-fs-paused', next);
      return;
    }
    fsPaused = next;
    document.documentElement.classList.toggle('yti-fs-paused', next);
    if (next) {
      clearActivateTimers();
      tearDown();
    } else if (U.isWatchPage() || U.isShortsPage()) {
      scheduleActivate();
    }
  }

  function syncFullscreenState() {
    setFullscreenPaused(U.isFullscreen());
  }

  /**
   * Run feature modules for the current watch page.
   * Always re-reads URL video id — never trust a closed-over id from navigate.
   */
  async function activate() {
    syncFullscreenState();
    if (fsPaused) return;

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

    if (vid !== activeVideoId) {
      tearDown();
      activeVideoId = vid;
    }

    if (U.isShortsPage() && !U.isWatchPage()) {
      YTI.revenue?.run?.(vid);
      return;
    }

    YTI.revenue?.run?.(vid);
    clearFeatureTimers();

    featureTimers.push(
      setTimeout(() => {
        if (fsPaused || U.getVideoId() !== vid) return;
        YTI.viral?.run?.(U.getVideoId());
      }, 200)
    );
    featureTimers.push(
      setTimeout(() => {
        if (fsPaused || U.getVideoId() !== vid) return;
        YTI.chapters?.run?.(U.getVideoId());
      }, 300)
    );
    featureTimers.push(
      setTimeout(() => {
        if (fsPaused || U.getVideoId() !== vid) return;
        YTI.heatmap?.run?.(U.getVideoId());
      }, 400)
    );
    featureTimers.push(
      setTimeout(() => {
        if (fsPaused || U.getVideoId() !== vid) return;
        YTI.transcript?.run?.(U.getVideoId());
      }, 600)
    );
    featureTimers.push(
      setTimeout(() => {
        if (fsPaused || U.getVideoId() !== vid) return;
        YTI.spam?.run?.(U.getVideoId());
      }, 800)
    );
  }

  function ensureAllPresent() {
    if (fsPaused || U.isFullscreen()) return;
    if (!activeVideoId || (!U.isWatchPage() && !U.isShortsPage())) return;
    YTI.revenue?.ensurePresent?.();
    YTI.viral?.ensurePresent?.();
    YTI.chapters?.ensurePresent?.();
    YTI.transcript?.ensurePresent?.();
    YTI.heatmap?.ensurePresent?.();
    YTI.spam?.ensurePresent?.();
  }

  function setupReinjectObserver() {
    reinjectObs?.disconnect();
    reinjectObs = new MutationObserver(
      U.debounce(() => {
        if (fsPaused || U.isFullscreen()) {
          syncFullscreenState();
          return;
        }
        if (!activeVideoId || (!U.isWatchPage() && !U.isShortsPage())) return;
        const current = U.getVideoId();
        if (current !== activeVideoId) {
          clearNavTimers();
          tearDown();
          activeVideoId = null;
          activate();
          return;
        }
        // Theater toggle rearranges #primary / player chrome — rebind if detached
        const theater = U.isTheaterMode();
        if (lastTheater === null) lastTheater = theater;
        if (theater !== lastTheater) {
          lastTheater = theater;
          scheduleActivate();
          return;
        }
        ensureAllPresent();
      }, 400)
    );
    reinjectObs.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['theater', 'theater-requested_', 'fullscreen', 'class'],
    });
  }

  function setupFullscreenListeners() {
    const onFs = () => syncFullscreenState();
    document.addEventListener('fullscreenchange', onFs);
    document.addEventListener('webkitfullscreenchange', onFs);
    // YouTube player button / 'f' key often uses class toggles before Fullscreen API
    window.addEventListener('yt-fullscreen-change', onFs);
    document.addEventListener('yt-action', (ev) => {
      const name = ev?.detail?.actionName || '';
      if (/fullscreen|theater/i.test(name)) {
        setTimeout(() => {
          syncFullscreenState();
          if (!fsPaused) scheduleActivate();
        }, 50);
      }
    });
  }

  function setupTheaterListener() {
    // Attribute changes on ytd-watch-flexy are covered by reinjectObs; also poll lightly
    // after known theater key 't' via yt-action above.
    lastTheater = U.isTheaterMode();
  }

  function scheduleActivate() {
    clearActivateTimers();
    syncFullscreenState();
    if (fsPaused) return;

    const urlVid = U.getVideoId();
    if (urlVid !== activeVideoId) {
      tearDown();
      activeVideoId = null;
    }

    navTimers.push(setTimeout(() => activate(), 150));
    navTimers.push(setTimeout(() => activate(), 1200));
  }

  function boot() {
    console.info('[YTI] YT Insights content script ready');
    setupFullscreenListeners();
    setupTheaterListener();
    setupReinjectObserver();
    syncFullscreenState();
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
