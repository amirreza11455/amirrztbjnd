/* ============================================================================
   TradeMark — Ticker Strip
   ----------------------------------------------------------------------------
   A thin marquee directly under the hero. Pure-CSS animation on a duplicated
   track (translateX 0 → -50%, linear, ~60s). Pauses on hover and focus-within.
   Under prefers-reduced-motion: no animation, horizontally scrollable instead.

   Content:
     - If real analyses exist (store, newest first, max 12):
         "#127  BTC  ▼ BEARISH  4H  ·  OPEN"
       with a colored status chip (OPEN / EXPIRED / CORRECT / PARTIAL / WRONG /
       INVALID). NO prices.
     - If zero real analyses:
         brand words "TRADE · ANALYZE · RECORD · REVIEW · REPEAT"
       Never demo analyses.

   Each analysis item is a link to #/analysis/<id>. The duplicated half is
   aria-hidden and not focusable. The strip has aria-label "Recent analyses".
   Re-renders on store.onChange. DOM builders only — never innerHTML.
   ============================================================================ */

(function () {
  'use strict';

  var TM = (window.TM = window.TM || {});
  var util = TM.util;
  var el = util.el;

  var BRAND_WORDS = ['TRADE', 'ANALYZE', 'RECORD', 'REVIEW', 'REPEAT'];
  var MAX_ITEMS = 12;

  /* ============================================================
     status derivation
     ============================================================ */

  function statusOf(a) {
    if (a.resolution && a.resolution.outcome) {
      /* correct | partial | wrong | invalid */
      return a.resolution.outcome;
    }
    if (a.expiresAt && new Date(a.expiresAt).getTime() <= Date.now()) {
      return 'expired';
    }
    return 'open';
  }

  function chipClass(s) {
    return 'tm-ticker__chip tm-ticker__chip--' + s;
  }

  /* ============================================================
     item builders
     ============================================================ */

  function analysisItem(a, dup) {
    var dir = a.direction === 'bullish' ? '\u25B2'
            : a.direction === 'bearish' ? '\u25BC'
            : '\u25CF';

    var s = statusOf(a);
    var label = s.toUpperCase();

    var attrs = { class: 'tm-ticker__item' };
    if (dup) {
      attrs['aria-hidden'] = 'true';
      attrs.tabindex = '-1';
    } else {
      attrs.href = '#/analysis/' + a.id;
    }

    var node = dup ? el('span', attrs) : el('a', attrs);

    node.appendChild(el('span', { text: '#' + a.number }));
    node.appendChild(el('span', { text: a.primaryAsset }));
    node.appendChild(el('span', { text: dir }));
    node.appendChild(el('span', { text: a.direction.toUpperCase() }));
    node.appendChild(el('span', { text: a.timeframe }));
    node.appendChild(el('span', { text: '\u00B7' }));
    node.appendChild(el('span', { class: chipClass(s), text: label }));

    return node;
  }

  function brandItem(dup) {
    var attrs = { class: 'tm-ticker__brand' };
    if (dup) attrs['aria-hidden'] = 'true';
    return el('span', attrs, BRAND_WORDS.join('  \u00B7  '));
  }

  function buildAnalysisList(items, isDup) {
    var list = el('div', {
      class: 'tm-ticker__list',
      'aria-hidden': isDup ? 'true' : null
    });
    for (var i = 0; i < items.length; i++) {
      list.appendChild(analysisItem(items[i], isDup));
    }
    return list;
  }

  function buildBrandList(isDup) {
    var list = el('div', {
      class: 'tm-ticker__list',
      'aria-hidden': isDup ? 'true' : null
    });
    list.appendChild(brandItem(isDup));
    return list;
  }

  /* ============================================================
     render
     ============================================================ */

  function render(container, analyses) {
    while (container.firstChild) container.removeChild(container.firstChild);

    var track = el('div', { class: 'tm-ticker__track' });
    container.appendChild(track);

    if (!analyses.length) {
      track.appendChild(buildBrandList(false));
      track.appendChild(buildBrandList(true));
      return;
    }

    track.appendChild(buildAnalysisList(analyses, false));
    track.appendChild(buildAnalysisList(analyses, true));
  }

  /* ============================================================
     public
     ============================================================ */

  TM.ticker = {
    /* mount(container) -> unsubscribe
       Loads analyses once, then again on every store change. */
    mount: function (container) {
      var unsub = null;

      function refresh() {
        TM.store.listAnalyses({ limit: MAX_ITEMS, order: 'desc' })
          .then(function (items) { render(container, items); })
          .catch(function (err) {
            console.error('[ticker] load failed', err);
            render(container, []);
          });
      }

      refresh();
      unsub = TM.store.onChange(refresh);

      return function () {
        if (unsub) unsub();
      };
    },

    /* exposed for tests */
    _render:   render,
    _statusOf: statusOf
  };
})();