/**
 * Auto timestamps / chapters panel.
 * Priority: 1) native YouTube chapters  2) description timestamps  3) captions auto-split
 */
(function (global) {
  'use strict';

  const YTI = (global.YTI = global.YTI || {});
  const U = () => YTI.utils;

  const PANEL_ID = 'yti-chapters-panel';
  let currentChapters = [];
  let currentSource = '';
  let lastVideoId = null;

  // ─── Native chapters from player response ───────────────────────────
  function getNativeChapters(pr) {
    const out = [];
    try {
      const markers =
        pr?.playerOverlays?.playerOverlayRenderer?.decoratedPlayerBarRenderer
          ?.decoratedPlayerBarRenderer?.playerBar?.multiMarkersPlayerBarRenderer?.markersMap ||
        pr?.markers ||
        null;

      // Common path: heatMarker / chapter markers in markersMap
      const maps = [];
      if (Array.isArray(markers)) maps.push(...markers);
      else if (markers && typeof markers === 'object') maps.push(markers);

      // Also walk known chapter endpoints
      const chaptersFromEngagement = findChapterRenderers(pr);
      for (const ch of chaptersFromEngagement) out.push(ch);

      // markersMap entries
      walk(pr, (obj) => {
        if (obj?.chapterRenderer) {
          const c = obj.chapterRenderer;
          const title = c.title?.simpleText || c.title?.runs?.map((r) => r.text).join('') || 'Chapter';
          const t = Math.floor((c.timeRangeStartMillis || 0) / 1000);
          out.push({ time: t, title: title.trim(), desc: '' });
        }
        if (obj?.macroMarkersListItemRenderer) {
          const c = obj.macroMarkersListItemRenderer;
          const title = c.title?.simpleText || c.title?.runs?.map((r) => r.text).join('') || 'Chapter';
          const t = Math.floor(parseInt(c.onTap?.watchEndpoint?.startTimeSeconds || c.timeRangeStartMillis / 1000 || 0, 10));
          const desc = c.description?.simpleText || c.description?.runs?.map((r) => r.text).join('') || '';
          out.push({ time: t, title: title.trim(), desc: desc.trim() });
        }
      });
    } catch (_) {}

    return dedupeSort(out);
  }

  function findChapterRenderers(root) {
    const out = [];
    walk(root, (obj) => {
      if (obj?.chapterRenderer || obj?.macroMarkersListItemRenderer) {
        /* handled in walk above via shared collector — keep empty */
      }
    });
    return out;
  }

  function walk(node, fn, seen = new WeakSet()) {
    if (!node || typeof node !== 'object') return;
    if (seen.has(node)) return;
    seen.add(node);
    fn(node);
    if (Array.isArray(node)) {
      for (const x of node) walk(x, fn, seen);
    } else {
      for (const k of Object.keys(node)) walk(node[k], fn, seen);
    }
  }

  // ─── Description timestamps ─────────────────────────────────────────
  function getDescriptionText() {
    // Expandable description
    const sels = [
      '#description-inline-expander',
      '#description-inner',
      'ytd-text-inline-expander#description-inline-expander',
      '#meta-contents #description',
      'ytd-expander#description',
      '#description yt-formatted-string',
    ];
    for (const sel of sels) {
      const el = document.querySelector(sel);
      if (el && el.textContent && el.textContent.length > 20) return el.textContent;
    }
    // From player / initial data
    try {
      const pr = U().getPlayerResponse();
      const d =
        pr?.microformat?.playerMicroformatRenderer?.description?.simpleText ||
        pr?.videoDetails?.shortDescription ||
        '';
      if (d) return d;
    } catch (_) {}
    try {
      const data = U().getInitialData();
      let found = '';
      walk(data, (obj) => {
        if (found) return;
        if (obj?.attributedDescriptionBodyText?.content) found = obj.attributedDescriptionBodyText.content;
        if (obj?.description?.simpleText) found = obj.description.simpleText;
      });
      if (found) return found;
    } catch (_) {}
    return '';
  }

  function parseDescriptionChapters(text) {
    if (!text) return [];
    const lines = text.split(/\r?\n/);
    const out = [];
    // 0:00 Title  |  (0:00) Title  |  0:00 - Title
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const m = trimmed.match(/^(\d{1,2}:\d{2}(?::\d{2})?)\s*[-–—:.]?\s*(.*)$/);
      if (!m) continue;
      const time = U().parseTimestamp(m[1]);
      if (time == null) continue;
      let title = (m[2] || '').trim().replace(/^[-–—:.\s]+/, '');
      if (!title) title = 'Section';
      // Avoid matching random times in prose without chapter intent — require short title or list-like
      if (title.length > 120) title = title.slice(0, 117) + '…';
      out.push({ time, title, desc: '' });
    }
    // Need at least 2 timestamps for description chapters
    if (out.length < 2) return [];
    return dedupeSort(out);
  }

  // ─── Captions auto-chapters ─────────────────────────────────────────
  async function fetchCaptions(pr) {
    try {
      const tracks =
        pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks ||
        pr?.captions?.playerCaptionsRenderer?.captionTracks ||
        [];
      if (!tracks.length) return null;

      // Prefer English / default
      const prefer = (t) => {
        const lang = (t.languageCode || '').toLowerCase();
        const name = (t.name?.simpleText || '').toLowerCase();
        if (t.kind === 'asr') return 2;
        if (lang.startsWith('en')) return 0;
        if (name.includes('english')) return 1;
        return 5;
      };
      const sorted = [...tracks].sort((a, b) => prefer(a) - prefer(b));
      const track = sorted[0];
      const rawUrl = track?.baseUrl;
      if (!rawUrl) return null;

      // Defense-in-depth: only fetch YouTube timedtext hosts (player JSON is page-controlled)
      let url;
      try {
        const u = new URL(rawUrl, location.origin);
        const host = u.hostname.toLowerCase();
        const allowedHost =
          host === 'www.youtube.com' ||
          host === 'youtube.com' ||
          host === 'm.youtube.com' ||
          host.endsWith('.youtube.com');
        if (u.protocol !== 'https:' || !allowedHost) {
          console.warn('[YTI] blocked non-YouTube caption URL', host);
          return null;
        }
        // Prefer known timedtext paths; still allow https youtube caption endpoints
        if (u.pathname && !/timedtext|api\/timedtext|\/ccs\//i.test(u.pathname + u.search)) {
          // Some tracks use query-only shapes under /api/timedtext — pathname check soft
          if (!u.pathname.includes('timedtext') && !u.pathname.includes('/api/')) {
            console.warn('[YTI] blocked unexpected caption path', u.pathname);
            return null;
          }
        }
        if (!/[?&]fmt=/.test(u.search)) {
          u.searchParams.set('fmt', 'json3');
        }
        url = u.toString();
      } catch (e) {
        console.warn('[YTI] invalid caption URL', e);
        return null;
      }

      const res = await fetch(url, { credentials: 'same-origin' });
      if (!res.ok) return null;
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('json') || url.includes('fmt=json3')) {
        const data = await res.json();
        return parseJson3Captions(data);
      }
      const xml = await res.text();
      return parseXmlCaptions(xml);
    } catch (e) {
      console.warn('[YTI] captions fetch failed', e);
      return null;
    }
  }

  function parseJson3Captions(data) {
    const events = data?.events || [];
    const cues = [];
    for (const ev of events) {
      if (!ev.segs) continue;
      const text = ev.segs.map((s) => s.utf8 || '').join('').replace(/\n/g, ' ').trim();
      if (!text || text === '\n') continue;
      const start = (ev.tStartMs || 0) / 1000;
      const dur = (ev.dDurationMs || 0) / 1000;
      cues.push({ start, end: start + dur, text });
    }
    return cues;
  }

  function parseXmlCaptions(xml) {
    const cues = [];
    try {
      const doc = new DOMParser().parseFromString(xml, 'text/xml');
      const nodes = [...doc.querySelectorAll('text, p')];
      for (const n of nodes) {
        const start = parseFloat(n.getAttribute('start') || n.getAttribute('t') || '0');
        const dur = parseFloat(n.getAttribute('dur') || n.getAttribute('d') || '2');
        // YouTube sometimes uses ms in t/d
        const startSec = start > 1000 ? start / 1000 : start;
        const durSec = dur > 1000 ? dur / 1000 : dur;
        const text = (n.textContent || '').replace(/\n/g, ' ').trim();
        if (!text) continue;
        cues.push({ start: startSec, end: startSec + durSec, text });
      }
    } catch (_) {}
    return cues;
  }

  function autoChaptersFromCaptions(cues, durationSec) {
    if (!cues?.length) return [];
    const duration =
      durationSec ||
      cues[cues.length - 1].end ||
      parseInt(U().getPlayerResponse()?.videoDetails?.lengthSeconds || '0', 10) ||
      0;
    if (duration < 30) return [];

    // Target 8–15 sections
    const target = Math.min(15, Math.max(8, Math.round(duration / 90)));
    const windowSize = duration / target;

    // Also split on large time gaps in cues (> 8s silence)
    const gapSplits = new Set([0]);
    for (let i = 1; i < cues.length; i++) {
      if (cues[i].start - cues[i - 1].end > 8) gapSplits.add(cues[i].start);
    }

    const boundaries = [0];
    for (let i = 1; i < target; i++) {
      const ideal = i * windowSize;
      // Snap to nearest gap if within 15s, else ideal
      let best = ideal;
      let bestDist = Infinity;
      for (const g of gapSplits) {
        const d = Math.abs(g - ideal);
        if (d < bestDist && d < 15) {
          bestDist = d;
          best = g;
        }
      }
      if (best > boundaries[boundaries.length - 1] + 20) boundaries.push(best);
    }
    boundaries.push(duration);

    const chapters = [];
    for (let i = 0; i < boundaries.length - 1; i++) {
      const t0 = boundaries[i];
      const t1 = boundaries[i + 1];
      const windowCues = cues.filter((c) => c.start >= t0 && c.start < t1);
      const title = extractiveTitle(windowCues, i);
      const desc = shortDesc(windowCues);
      chapters.push({ time: Math.floor(t0), title, desc });
    }
    return dedupeSort(chapters).slice(0, 15);
  }

  function extractiveTitle(cues, index) {
    if (!cues.length) return index === 0 ? 'Intro' : `Section ${index + 1}`;
    // First substantial caption line (skip tiny fillers)
    const fillers = /^(um+|uh+|yeah|okay|ok|so|alright|right|well|and|but)\.?$/i;
    for (const c of cues.slice(0, 12)) {
      let t = c.text.replace(/\[[^\]]*\]/g, '').replace(/\([^)]*\)/g, '').trim();
      t = t.replace(/^[^a-zA-Z0-9]+/, '');
      if (t.length < 8) continue;
      if (fillers.test(t)) continue;
      // Take first clause / ~50 chars
      const cut = t.split(/[.!?]/)[0] || t;
      let title = cut.trim();
      if (title.length > 52) title = title.slice(0, 49).replace(/\s+\S*$/, '') + '…';
      // Capitalize lightly
      return title.charAt(0).toUpperCase() + title.slice(1);
    }
    return index === 0 ? 'Intro' : `Section ${index + 1}`;
  }

  function shortDesc(cues) {
    if (!cues.length) return '';
    const joined = cues
      .slice(0, 6)
      .map((c) => c.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (joined.length <= 90) return joined;
    return joined.slice(0, 87).replace(/\s+\S*$/, '') + '…';
  }

  function dedupeSort(list) {
    const map = new Map();
    for (const c of list) {
      if (c.time == null || c.time < 0) continue;
      const key = c.time;
      if (!map.has(key) || (c.title && c.title.length > (map.get(key).title || '').length)) {
        map.set(key, { time: key, title: c.title || 'Chapter', desc: c.desc || '' });
      }
    }
    return [...map.values()].sort((a, b) => a.time - b.time);
  }

  // ─── UI ─────────────────────────────────────────────────────────────
  function removePanel() {
    runToken++;
    document.getElementById(PANEL_ID)?.remove();
  }

  function findPanelAnchor() {
    const sels = [
      'ytd-watch-metadata #description',
      '#description-inline-expander',
      'ytd-watch-metadata',
      '#bottom-row',
      '#meta-contents',
      '#secondary-inner',
    ];
    for (const sel of sels) {
      const el = document.querySelector(sel);
      if (el && el.isConnected) return el;
    }
    return null;
  }

  function renderPanel(chapters, source) {
    removePanel();
    if (!chapters.length) return false;
    const anchor = findPanelAnchor();
    if (!anchor) return false;

    currentChapters = chapters;
    currentSource = source;

    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.className = 'yti-chapters-panel';
    panel.innerHTML = `
      <div class="yti-chapters-header">
        <button type="button" class="yti-chapters-toggle" aria-expanded="true">
          <span class="yti-chapters-caret" aria-hidden="true">▾</span>
          <span class="yti-chapters-title">Chapters</span>
          <span class="yti-chapters-count">${chapters.length}</span>
          <span class="yti-chapters-source">${escapeHtml(sourceLabel(source))}</span>
        </button>
        <button type="button" class="yti-chapters-copy" title="Copy chapters">Copy chapters</button>
      </div>
      <div class="yti-chapters-list" role="list"></div>
    `;

    const list = panel.querySelector('.yti-chapters-list');
    for (const ch of chapters) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'yti-chapter-row';
      row.setAttribute('role', 'listitem');
      row.innerHTML = `
        <span class="yti-chapter-time">${U().formatDuration(ch.time)}</span>
        <span class="yti-chapter-body">
          <span class="yti-chapter-name">${escapeHtml(ch.title)}</span>
          ${ch.desc ? `<span class="yti-chapter-desc">${escapeHtml(ch.desc)}</span>` : ''}
        </span>
      `;
      row.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        U().seekTo(ch.time);
      });
      list.appendChild(row);
    }

    panel.querySelector('.yti-chapters-toggle').addEventListener('click', () => {
      const collapsed = panel.classList.toggle('yti-collapsed');
      panel.querySelector('.yti-chapters-toggle').setAttribute('aria-expanded', String(!collapsed));
    });

    panel.querySelector('.yti-chapters-copy').addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const text = chapters.map((c) => `${U().formatDuration(c.time)} ${c.title}`).join('\n');
      try {
        await navigator.clipboard.writeText(text);
        const btn = panel.querySelector('.yti-chapters-copy');
        const prev = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => (btn.textContent = prev), 1500);
      } catch (_) {
        // Fallback
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
    });

    // Insert after description expander if possible
    if (anchor.id === 'description-inline-expander' || anchor.tagName?.includes('EXPANDER')) {
      anchor.parentNode?.insertBefore(panel, anchor.nextSibling);
    } else if (anchor.querySelector('#description-inline-expander')) {
      const desc = anchor.querySelector('#description-inline-expander');
      desc.parentNode.insertBefore(panel, desc.nextSibling);
    } else {
      anchor.appendChild(panel);
    }
    return true;
  }

  function sourceLabel(src) {
    if (src === 'native') return 'YouTube';
    if (src === 'description') return 'from description';
    if (src === 'captions') return 'auto from captions';
    return src;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async function resolveChapters(pr) {
    // 1) Native
    let ch = getNativeChapters(pr);
    // Also check engagement panels / initial data
    if (ch.length < 2) {
      try {
        const data = U().getInitialData();
        const extra = [];
        walk(data, (obj) => {
          if (obj?.chapterRenderer) {
            const c = obj.chapterRenderer;
            const title = c.title?.simpleText || c.title?.runs?.map((r) => r.text).join('') || 'Chapter';
            const t = Math.floor((c.timeRangeStartMillis || 0) / 1000);
            extra.push({ time: t, title: title.trim(), desc: '' });
          }
          if (obj?.macroMarkersListItemRenderer) {
            const c = obj.macroMarkersListItemRenderer;
            const title = c.title?.simpleText || c.title?.runs?.map((r) => r.text).join('') || 'Chapter';
            const start =
              parseInt(c.onTap?.watchEndpoint?.startTimeSeconds || '0', 10) ||
              Math.floor((c.timeRangeStartMillis || 0) / 1000);
            const desc = c.description?.simpleText || '';
            extra.push({ time: start, title: title.trim(), desc: (desc || '').trim() });
          }
        });
        ch = dedupeSort([...ch, ...extra]);
      } catch (_) {}
    }
    if (ch.length >= 2) return { chapters: ch, source: 'native' };

    // 2) Description
    const desc = getDescriptionText();
    ch = parseDescriptionChapters(desc);
    if (ch.length >= 2) return { chapters: ch, source: 'description' };

    // 3) Captions
    const cues = await fetchCaptions(pr);
    const duration = parseInt(pr?.videoDetails?.lengthSeconds || '0', 10);
    ch = autoChaptersFromCaptions(cues, duration);
    if (ch.length >= 2) return { chapters: ch, source: 'captions' };

    return { chapters: [], source: 'none' };
  }

  let runToken = 0;

  async function run(videoId) {
    if (!U().isWatchPage()) {
      removePanel();
      lastVideoId = null;
      return;
    }
    const vid = U().getVideoId() || videoId;
    if (!vid) {
      removePanel();
      return;
    }

    const token = ++runToken;
    let pr = U().getPlayerResponse();
    // Wait briefly for matching player response so we do not render previous video chapters
    if (!pr || (pr.videoDetails?.videoId && pr.videoDetails.videoId !== vid)) {
      for (let i = 0; i < 10 && token === runToken; i++) {
        await new Promise((r) => setTimeout(r, 300));
        if (U().getVideoId() !== vid) return;
        pr = U().getPlayerResponse();
        if (pr && (!pr.videoDetails?.videoId || pr.videoDetails.videoId === vid)) break;
      }
      if (token !== runToken) return;
      if (!pr || (pr.videoDetails?.videoId && pr.videoDetails.videoId !== vid)) {
        // Still stale — skip rather than show wrong chapters
        return;
      }
    }

    // Quick path: native/description first so UI appears fast
    let { chapters, source } = await resolveChaptersQuick(pr);
    if (token !== runToken) return;

    if (U().getVideoId() !== vid) return;
    if (chapters.length >= 2) {
      renderPanel(chapters, source);
      lastVideoId = vid;
      // Still try captions only if we had nothing better — already done in full resolve
      return;
    }

    // Full resolve including captions
    const full = await resolveChapters(pr);
    if (token !== runToken) return;
    if (full.chapters.length >= 2) {
      renderPanel(full.chapters, full.source);
      lastVideoId = vid;
    } else {
      removePanel();
    }
  }

  async function resolveChaptersQuick(pr) {
    let ch = getNativeChapters(pr);
    if (ch.length >= 2) return { chapters: ch, source: 'native' };
    try {
      const data = U().getInitialData();
      const extra = [];
      walk(data, (obj) => {
        if (obj?.macroMarkersListItemRenderer) {
          const c = obj.macroMarkersListItemRenderer;
          const title = c.title?.simpleText || c.title?.runs?.map((r) => r.text).join('') || 'Chapter';
          const start =
            parseInt(c.onTap?.watchEndpoint?.startTimeSeconds || '0', 10) ||
            Math.floor((c.timeRangeStartMillis || 0) / 1000);
          extra.push({ time: start, title: title.trim(), desc: '' });
        }
      });
      ch = dedupeSort([...ch, ...extra]);
    } catch (_) {}
    if (ch.length >= 2) return { chapters: ch, source: 'native' };

    const desc = getDescriptionText();
    ch = parseDescriptionChapters(desc);
    if (ch.length >= 2) return { chapters: ch, source: 'description' };
    return { chapters: [], source: 'none' };
  }

  function ensurePresent() {
    if (!U().isWatchPage()) return;
    if (!document.getElementById(PANEL_ID) && currentChapters.length && lastVideoId === U().getVideoId()) {
      renderPanel(currentChapters, currentSource);
    }
  }

  // Expose caption cues for heatmap estimation
  YTI.chapters = {
    run,
    ensurePresent,
    removePanel,
    fetchCaptions,
    parseJson3Captions,
    getDescriptionText,
    parseDescriptionChapters,
  };
})(window);
