/* ============================================================================
   TradeMark — Utilities
   ----------------------------------------------------------------------------
   Date helpers (LOCAL time only), string helpers, DOM builder, math, PRNG,
   easings, debounce, reduced-motion detection.

   Hard rules:
     - Never use toISOString() for date logic. Local time everywhere.
     - el() writes text via textContent only. Never innerHTML.
     - escapeHtml handles & < > " ' ` (quotes AND backticks).
     - No loose globals. Everything is exposed on TM.util.
   ============================================================================ */

(function () {
  'use strict';

  var TM = (window.TM = window.TM || {});

  var MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /* ============================================================
     date helpers — ALL LOCAL TIME
     ============================================================ */

  function pad2(n) {
    return n < 10 ? '0' + n : '' + n;
  }

  /* "2026-10-05" — a stable key for a local calendar day. */
  function localDateKey(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  /* Local midnight of the same day. */
  function startOfLocalDay(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  /* True iff both Dates fall on the same local calendar day. */
  function isSameLocalDay(a, b) {
    return a.getFullYear() === b.getFullYear()
        && a.getMonth()    === b.getMonth()
        && a.getDate()     === b.getDate();
  }

  /* True iff `date` is on the local calendar day immediately before `now`. */
  function isYesterday(date, now) {
    var y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    return isSameLocalDay(date, y);
  }

  /* "14:32" in local time. */
  function formatTime(d) {
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  /* "Oct 5, 2026" in local time. */
  function formatShortDate(d) {
    return MONTHS_SHORT[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
  }

  /* "Mon 16:44" — local weekday + time. */
  function formatWeekdayTime(d) {
    var WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return WEEKDAYS[d.getDay()] + ' ' + formatTime(d);
  }


  /* Axis-aligned rectangle intersection.
     rect = { x, y, w, h } in any consistent unit (px or fractional). */
  function rectsIntersect(a, b) {
    if (!a || !b) return false;
    return !(
      a.x + a.w <= b.x ||
      b.x + b.w <= a.x ||
      a.y + a.h <= b.y ||
      b.y + b.h <= a.y
    );
  }

  /* Human relative label: "just now", "15m ago", "4h ago", "yesterday",
     "4d ago", "3w ago", or falls back to formatShortDate. */
  function relativeTime(date, now) {
    now = now || new Date();
    var diff = now.getTime() - date.getTime();
    if (diff < 0) return formatShortDate(date);

    var sec = Math.floor(diff / 1000);
    if (sec < 45) return 'just now';

    var min = Math.floor(sec / 60);
    if (min < 60) return min + 'm ago';

    if (isSameLocalDay(date, now)) {
      var hr = Math.floor(min / 60);
      return hr < 1 ? 'just now' : hr + 'h ago';
    }
    if (isYesterday(date, now)) return 'yesterday';

    var days = Math.floor((now - startOfLocalDay(date)) / 86400000);
    if (days < 7)  return days + 'd ago';
    if (days < 30) return Math.floor(days / 7) + 'w ago';
    return formatShortDate(date);
  }

  /* Local ISO 8601 with numeric offset, e.g. "2026-10-05T14:32:00+03:30".
     This is the ONLY date serialisation format the app stores. */
  function localIso(d) {
    var off = -d.getTimezoneOffset();
    var sign = off >= 0 ? '+' : '-';
    var a = Math.abs(off);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
      + 'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds())
      + sign + pad2(Math.floor(a / 60)) + ':' + pad2(a % 60);
  }

  /* ============================================================
     string helpers
     ============================================================ */

  /* Escapes & < > " ' ` — the last being essential for template-literal
     safety in future code. Never feed user text through innerHTML anyway. */
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g,  '&amp;')
      .replace(/</g,  '&lt;')
      .replace(/>/g,  '&gt;')
      .replace(/"/g,  '&quot;')
      .replace(/'/g,  '&#39;')
      .replace(/`/g,  '&#96;');
  }

  /* ============================================================
     DOM builder — textContent only, no innerHTML
     ============================================================

     el(tag, attrs?, children?)

       attrs keys:
         class / className   -> node.className
         text                -> node.textContent
         dataset             -> node.dataset.* (object)
         style               -> node.style.* (object of camelCase)
         on<Event>           -> addEventListener(<event>, handler)
                               (e.g. onClick, onInput, onKeyDown)
         anything else       -> setAttribute (true => empty attr)

       children: string | Node | array of those.
       null / false entries are skipped (allows `cond && node`). */
  function el(tag, attrs, children) {
    var node = document.createElement(tag);

    if (attrs) {
      for (var k in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
        var v = attrs[k];
        if (v == null || v === false) continue;

        if (k === 'class' || k === 'className') {
          node.className = v;
        } else if (k === 'text') {
          node.textContent = v;
        } else if (k === 'dataset') {
          for (var dk in v) {
            if (Object.prototype.hasOwnProperty.call(v, dk)) {
              node.dataset[dk] = v[dk];
            }
          }
        } else if (k === 'style' && typeof v === 'object') {
          for (var sk in v) {
            if (Object.prototype.hasOwnProperty.call(v, sk)) {
              node.style[sk] = v[sk];
            }
          }
        } else if (
          k.charCodeAt(0) === 111 /* 'o' */ &&
          k.charCodeAt(1) === 110 /* 'n' */ &&
          typeof v === 'function'
        ) {
          node.addEventListener(k.slice(2).toLowerCase(), v);
        } else {
          node.setAttribute(k, v === true ? '' : v);
        }
      }
    }

    if (children != null) {
      var arr = Array.isArray(children) ? children : [children];
      for (var i = 0; i < arr.length; i++) {
        var c = arr[i];
        if (c == null || c === false) continue;
        if (c instanceof Node) node.appendChild(c);
        else node.appendChild(document.createTextNode(String(c)));
      }
    }

    return node;
  }

  /* ============================================================
     math / misc
     ============================================================ */

  function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
  }

  /* Deterministic 32-bit PRNG. Same seed -> same sequence, forever. */
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function easeOutQuad(t) {
    return 1 - (1 - t) * (1 - t);
  }

  function debounce(fn, ms) {
    var t = null;
    return function () {
      var ctx = this, args = arguments;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(ctx, args); }, ms);
    };
  }

  function prefersReducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /* ============================================================
     exports
     ============================================================ */

  TM.util = {
    // dates
    localDateKey:        localDateKey,
    startOfLocalDay:     startOfLocalDay,
    isSameLocalDay:      isSameLocalDay,
    isYesterday:         isYesterday,
    formatTime:          formatTime,
    formatShortDate:     formatShortDate,
    formatWeekdayTime:   formatWeekdayTime,
    relativeTime:        relativeTime,
    localIso:            localIso,
    // strings
    escapeHtml:          escapeHtml,
    // dom
    el:                  el,
    // math
    clamp:               clamp,
    mulberry32:          mulberry32,
    easeInOutCubic:      easeInOutCubic,
    easeOutQuad:         easeOutQuad,
    // timing
    debounce:            debounce,
    prefersReducedMotion: prefersReducedMotion
  };
})();