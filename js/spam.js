/**
 * Soft-hide spam / bot comments on watch pages.
 * MutationObserver on comment threads; recoverable "N spam hidden — show" toggle.
 * No external API. Does not permanently remove YouTube UI.
 */
(function (global) {
  'use strict';

  const YTI = (global.YTI = global.YTI || {});
  const U = () => YTI.utils;

  const TOGGLE_ID = 'yti-spam-toggle';
  const HIDDEN_CLASS = 'yti-spam-hidden';
  const MARK_ATTR = 'data-yti-spam';

  let showSpam = false;
  let observer = null;
  let seenTexts = new Map(); // normalized text -> count
  let hiddenCount = 0;

  const SPAM_PATTERNS = [
    /check\s+(my|out\s+my|the)\s+(profile|channel|bio|page)/i,
    /subscribe\s+to\s+my/i,
    /follow\s+me\s+on/i,
    /follow\s*[\s&/]+follow|f4f|s4s|sub4sub/i,
    /(telegram|whatsapp|t\.me\/|wa\.me\/)/i,
    /(crypto|bitcoin|btc|eth|nft|airdrop|forex|binary\s*options)/i,
    /(make\s+\$?\d|earn\s+\$?\d|from\s+home|passive\s+income|double\s+your)/i,
    /(free\s+nitro|discord\.gg|bit\.ly|tinyurl|cutt\.ly)/i,
    /(onlyfans|fansly|link\s+in\s+(bio|my\s+profile))/i,
    /(dm\s+me|message\s+me\s+on|contact\s+me\s+on)/i,
    /(click\s+here|visit\s+my|check\s+this\s+out\s*:)/i,
    /(i\s+will\s+(never|not)\s+ask|giveaway|congratulations.*won)/i,
  ];

  const CHANNEL_SPAM = [
    /^[a-z]*\d{4,}$/i, // random letters + digits
    /(official|support|helpdesk).*(youtube|yt|google)/i,
    /^[_.\-]*[A-Z0-9]{10,}[_.\-]*$/,
    /(crypto|airdrop|giveaway|nft)[_\-.]?(bot|team|official)?$/i,
  ];

  function normalizeText(t) {
    return String(t || '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/[^\p{L}\p{N}\s]/gu, '')
      .trim();
  }

  function emojiRatio(text) {
    const chars = [...text];
    if (!chars.length) return 0;
    // Rough emoji / symbol detection
    let emo = 0;
    for (const ch of chars) {
      const cp = ch.codePointAt(0);
      if (
        (cp >= 0x1f300 && cp <= 0x1faff) ||
        (cp >= 0x2600 && cp <= 0x27bf) ||
        (cp >= 0x1f600 && cp <= 0x1f64f) ||
        ch === '❤' ||
        ch === '✨'
      ) {
        emo++;
      }
    }
    return emo / chars.length;
  }

  function isAllCapsBait(text) {
    const letters = text.replace(/[^a-zA-Z]/g, '');
    if (letters.length < 12) return false;
    const upper = letters.replace(/[^A-Z]/g, '').length;
    return upper / letters.length > 0.85;
  }

  function countLinks(text) {
    const m = text.match(/https?:\/\/|www\.|\.(com|net|org|io|gg)\b/gi);
    return m ? m.length : 0;
  }

  function scoreComment(text, author) {
    const reasons = [];
    let score = 0;
    const t = text || '';
    const norm = normalizeText(t);

    if (!norm && emojiRatio(t) > 0.5 && t.length > 8) {
      score += 3;
      reasons.push('emoji dump');
    } else if (emojiRatio(t) > 0.45 && norm.length < 20) {
      score += 2;
      reasons.push('emoji-heavy');
    }

    for (const re of SPAM_PATTERNS) {
      if (re.test(t)) {
        score += 3;
        reasons.push('promo/bait phrase');
        break;
      }
    }

    if (isAllCapsBait(t)) {
      score += 2;
      reasons.push('all-caps bait');
    }

    const links = countLinks(t);
    if (links >= 1 && norm.length < 40) {
      score += 2;
      reasons.push('low-signal link');
    }
    if (links >= 2) {
      score += 2;
      reasons.push('multi-link');
    }

    // Near-duplicates
    if (norm.length >= 12) {
      const prev = seenTexts.get(norm) || 0;
      if (prev >= 1) {
        score += 2 + Math.min(prev, 3);
        reasons.push('near-duplicate');
      }
    }

    // Suspicious channel name
    const name = (author || '').trim();
    for (const re of CHANNEL_SPAM) {
      if (re.test(name)) {
        score += 2;
        reasons.push('suspicious name');
        break;
      }
    }

    // Repeated character spam
    if (/(.)\1{7,}/.test(t) || /(\p{Emoji_Presentation})\1{4,}/u.test(t)) {
      score += 2;
      reasons.push('repeated chars');
    }

    return { score, reasons, norm };
  }

  function getCommentNodes(root = document) {
    return root.querySelectorAll(
      'ytd-comment-thread-renderer, ytd-comment-view-model, ytd-comment-renderer'
    );
  }

  function extractCommentData(node) {
    // Prefer top-level thread body, not nested replies for thread renderer
    let textEl =
      node.querySelector('#content-text') ||
      node.querySelector('yt-formatted-string#content-text') ||
      node.querySelector('#comment-content #content-text') ||
      node.querySelector('.yt-core-attributed-string');
    // For thread renderer, first content-text is usually top-level
    if (node.tagName === 'YTD-COMMENT-THREAD-RENDERER') {
      textEl =
        node.querySelector('ytd-comment-view-model #content-text') ||
        node.querySelector('ytd-comment-renderer #content-text') ||
        textEl;
    }
    const authorEl =
      node.querySelector('#author-text') ||
      node.querySelector('a#author-text') ||
      node.querySelector('#author-name') ||
      node.querySelector('yt-formatted-string.ytd-channel-name');
    const text = (textEl?.textContent || '').trim();
    const author = (authorEl?.textContent || '').trim();
    return { text, author, textEl };
  }

  function hideNode(node, reasons) {
    if (node.getAttribute(MARK_ATTR) === '1') return;
    node.setAttribute(MARK_ATTR, '1');
    node.setAttribute('data-yti-spam-reasons', reasons.join(','));
    if (!showSpam) node.classList.add(HIDDEN_CLASS);
    hiddenCount++;
  }

  function unhideAll() {
    document.querySelectorAll(`[${MARK_ATTR}="1"]`).forEach((n) => {
      n.classList.remove(HIDDEN_CLASS);
    });
  }

  function rehideAll() {
    document.querySelectorAll(`[${MARK_ATTR}="1"]`).forEach((n) => {
      n.classList.add(HIDDEN_CLASS);
    });
  }

  function processNode(node) {
    if (!node || node.nodeType !== 1) return;
    if (node.getAttribute?.(MARK_ATTR) === '1') return;
    // Skip if not a comment-like host
    const tag = node.tagName || '';
    if (
      !/COMMENT/.test(tag) &&
      !node.querySelector?.('#content-text')
    ) {
      return;
    }

    const { text, author, textEl } = extractCommentData(node);
    if (!text && !author) return;
    // Avoid scoring empty shells
    if (!textEl && !text) return;

    const { score, reasons, norm } = scoreComment(text, author);
    if (norm.length >= 12) {
      seenTexts.set(norm, (seenTexts.get(norm) || 0) + 1);
    }

    // Threshold
    if (score >= 3) {
      // Prefer hiding the thread renderer wrapper
      const wrap =
        node.closest?.('ytd-comment-thread-renderer') ||
        (tag === 'YTD-COMMENT-THREAD-RENDERER' ? node : node);
      hideNode(wrap, reasons);
      updateToggle();
    }
  }

  function scanAll() {
    getCommentNodes().forEach((n) => processNode(n));
    updateToggle();
  }

  function updateToggle() {
    const count = document.querySelectorAll(`[${MARK_ATTR}="1"]`).length;
    hiddenCount = count;
    let bar = document.getElementById(TOGGLE_ID);

    if (count === 0) {
      bar?.remove();
      return;
    }

    const sections =
      document.querySelector('ytd-comments#comments') ||
      document.querySelector('#comments') ||
      document.querySelector('ytd-item-section-renderer#sections');

    if (!bar) {
      bar = document.createElement('div');
      bar.id = TOGGLE_ID;
      bar.className = 'yti-spam-toggle';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'yti-spam-toggle-btn';
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        showSpam = !showSpam;
        if (showSpam) unhideAll();
        else rehideAll();
        updateToggle();
      });
      bar.appendChild(btn);
      if (sections) {
        sections.insertBefore(bar, sections.firstChild);
      } else {
        document.querySelector('#below')?.prepend(bar);
      }
    }

    // Re-attach if YouTube wiped placement
    if (!bar.isConnected) {
      const host = document.querySelector('ytd-comments#comments, #comments');
      host?.insertBefore(bar, host.firstChild);
    }

    const btn = bar.querySelector('button');
    if (showSpam) {
      btn.textContent = `Hide ${count} spam comment${count === 1 ? '' : 's'} again`;
    } else {
      btn.textContent = `${count} spam hidden — show`;
    }
  }

  function startObserver() {
    stopObserver();
    const root =
      document.querySelector('ytd-comments#comments') ||
      document.querySelector('#comments') ||
      document.body;

    observer = new MutationObserver(
      U().debounce((mutations) => {
        if (!U().isWatchPage()) return;
        for (const m of mutations) {
          for (const n of m.addedNodes) {
            if (n.nodeType !== 1) continue;
            if (/COMMENT/.test(n.tagName || '')) processNode(n);
            n.querySelectorAll?.('ytd-comment-thread-renderer, ytd-comment-view-model, ytd-comment-renderer').forEach(
              processNode
            );
          }
        }
        updateToggle();
      }, 200)
    );

    observer.observe(root, { childList: true, subtree: true });
  }

  function stopObserver() {
    observer?.disconnect();
    observer = null;
  }

  function reset() {
    showSpam = false;
    seenTexts = new Map();
    hiddenCount = 0;
    document.querySelectorAll(`[${MARK_ATTR}="1"]`).forEach((n) => {
      n.classList.remove(HIDDEN_CLASS);
      n.removeAttribute(MARK_ATTR);
      n.removeAttribute('data-yti-spam-reasons');
    });
    document.getElementById(TOGGLE_ID)?.remove();
  }

  function run(videoId) {
    if (!U().isWatchPage()) {
      stopObserver();
      reset();
      return;
    }
    reset();
    startObserver();
    // Comments load lazily
    U().waitFor('ytd-comment-thread-renderer, ytd-comments#comments', { timeout: 20000 }).then(() => {
      if (U().getVideoId() !== (videoId || U().getVideoId())) return;
      scanAll();
    });
    // Periodic light rescan while on page
    scanAll();
  }

  function ensurePresent() {
    if (!U().isWatchPage()) return;
    if (!observer) startObserver();
    updateToggle();
  }

  YTI.spam = { run, ensurePresent, reset, scoreComment };
})(window);
