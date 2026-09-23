/**
 * Transcript search: find caption phrases, list matches with timestamps, seek on click/Enter.
 * Placed near the chapters panel. Graceful “No transcript available”.
 */
(function (global) {
  'use strict';

  const YTI = (global.YTI = global.YTI || {});
  const U = () => YTI.utils;

  const BOX_ID = 'yti-transcript-box';
  let cuesCache = null;
  let cuesVideoId = null;
  let lastVideoId = null;
  let status = 'idle'; // idle | loading | ready | missing

  function removeBox() {
    runToken++;
    document.getElementById(BOX_ID)?.remove();
  }

  function findAnchor() {
    return (
      document.getElementById('yti-chapters-panel') ||
      document.querySelector('#description-inline-expander') ||
      document.querySelector('ytd-watch-metadata #description') ||
      document.querySelector('ytd-watch-metadata') ||
      document.querySelector('#bottom-row')
    );
  }

  function ensureBox() {
    let box = document.getElementById(BOX_ID);
    if (box) return box;

    const anchor = findAnchor();
    if (!anchor) return null;

    box = document.createElement('div');
    box.id = BOX_ID;
    box.className = 'yti-transcript-box';
    box.innerHTML = `
      <form class="yti-transcript-form" autocomplete="off">
        <label class="yti-transcript-label" for="yti-transcript-input">Search transcript</label>
        <div class="yti-transcript-row">
          <input id="yti-transcript-input" class="yti-transcript-input" type="search"
            placeholder="Search captions…" disabled />
          <button type="submit" class="yti-transcript-go" disabled>Find</button>
        </div>
      </form>
      <div class="yti-transcript-status" role="status"></div>
      <ul class="yti-transcript-results" hidden></ul>
    `;

    if (anchor.id === 'yti-chapters-panel') {
      anchor.parentNode?.insertBefore(box, anchor.nextSibling);
    } else if (anchor.id === 'description-inline-expander') {
      anchor.parentNode?.insertBefore(box, anchor.nextSibling);
    } else {
      anchor.appendChild(box);
    }

    const form = box.querySelector('form');
    const input = box.querySelector('input');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      e.stopPropagation();
      doSearch(input.value);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        doSearch(input.value);
      }
    });

    return box;
  }

  function setStatus(msg, kind) {
    const box = document.getElementById(BOX_ID);
    if (!box) return;
    const el = box.querySelector('.yti-transcript-status');
    el.textContent = msg || '';
    el.dataset.kind = kind || '';
    const input = box.querySelector('input');
    const btn = box.querySelector('.yti-transcript-go');
    const ready = kind === 'ready';
    input.disabled = !ready;
    btn.disabled = !ready;
    if (!ready) {
      box.querySelector('.yti-transcript-results').hidden = true;
      box.querySelector('.yti-transcript-results').innerHTML = '';
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function highlight(text, query) {
    const q = query.trim();
    if (!q) return escapeHtml(text);
    try {
      const re = new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig');
      return escapeHtml(text).replace(re, '<mark>$1</mark>');
    } catch {
      return escapeHtml(text);
    }
  }

  function doSearch(query) {
    const box = document.getElementById(BOX_ID);
    if (!box || !cuesCache) return;
    const q = String(query || '').trim();
    const list = box.querySelector('.yti-transcript-results');
    list.innerHTML = '';

    if (!q) {
      list.hidden = true;
      setStatus('Type a phrase to search the transcript.', 'ready');
      return;
    }

    const lower = q.toLowerCase();
    const matches = [];
    for (const c of cuesCache) {
      if ((c.text || '').toLowerCase().includes(lower)) {
        matches.push(c);
        if (matches.length >= 40) break;
      }
    }

    if (!matches.length) {
      list.hidden = true;
      setStatus(`No matches for “${q}”.`, 'ready');
      return;
    }

    setStatus(`${matches.length} match${matches.length === 1 ? '' : 'es'}`, 'ready');
    list.hidden = false;
    for (const c of matches) {
      const li = document.createElement('li');
      li.className = 'yti-transcript-hit';
      li.innerHTML = `
        <button type="button" class="yti-transcript-hit-btn">
          <span class="yti-transcript-time">${U().formatDuration(Math.floor(c.start))}</span>
          <span class="yti-transcript-text">${highlight(c.text, q)}</span>
        </button>
      `;
      li.querySelector('button').addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        U().seekTo(c.start);
      });
      list.appendChild(li);
    }
  }

  async function loadCues(vid) {
    if (cuesVideoId === vid && cuesCache) {
      status = 'ready';
      return cuesCache;
    }
    status = 'loading';
    setStatus('Loading transcript…', 'loading');
    const chapters = YTI.chapters;
    if (!chapters?.fetchCaptions) {
      status = 'missing';
      cuesCache = null;
      setStatus('No transcript available', 'missing');
      return null;
    }
    // Wait for a player response that matches the URL video (SPA leaves stale JSON)
    let pr = U().getPlayerResponse();
    if (!pr || (pr.videoDetails?.videoId && pr.videoDetails.videoId !== vid)) {
      for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 300));
        if (U().getVideoId() !== vid) return null;
        pr = U().getPlayerResponse();
        if (pr && (!pr.videoDetails?.videoId || pr.videoDetails.videoId === vid)) break;
      }
      if (!pr || (pr.videoDetails?.videoId && pr.videoDetails.videoId !== vid)) {
        status = 'missing';
        cuesCache = null;
        setStatus('No transcript available', 'missing');
        return null;
      }
    }
    const cues = await chapters.fetchCaptions(pr);
    if (U().getVideoId() !== vid) return null;
    if (!cues?.length) {
      status = 'missing';
      cuesCache = null;
      cuesVideoId = vid;
      setStatus('No transcript available', 'missing');
      return null;
    }
    cuesCache = cues;
    cuesVideoId = vid;
    status = 'ready';
    setStatus('Search captions — Enter seeks to first match click any row.', 'ready');
    return cues;
  }

  let runToken = 0;

  async function run(videoId) {
    if (!U().isWatchPage()) {
      removeBox();
      cuesCache = null;
      cuesVideoId = null;
      lastVideoId = null;
      return;
    }
    const vid = U().getVideoId() || videoId;
    if (!vid) {
      removeBox();
      return;
    }

    const token = ++runToken;
    // Allow chapters panel a moment to appear so we can sit next to it
    await U().waitFor(
      () => document.getElementById('yti-chapters-panel') || document.querySelector('ytd-watch-metadata'),
      { timeout: 10000 }
    );
    if (token !== runToken) return;

    const box = ensureBox();
    if (!box) {
      setTimeout(() => run(vid), 1000);
      return;
    }

    lastVideoId = vid;
    if (cuesVideoId !== vid) {
      cuesCache = null;
    }
    await loadCues(vid);
  }

  function ensurePresent() {
    if (!U().isWatchPage()) return;
    if (!document.getElementById(BOX_ID) && lastVideoId === U().getVideoId()) {
      run(lastVideoId);
    }
  }

  YTI.transcript = { run, ensurePresent, removeBox, doSearch };
})(window);
