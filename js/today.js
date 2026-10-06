/* ============================================================================
   Tamga — TODAY (R7)
   ----------------------------------------------------------------------------
   Pure compute helpers for the "Waiting on you" rows. No carousel.
   ============================================================================ */

(function () {
  'use strict';

  var TM = (window.TM = window.TM || {});
  var util = TM.util;
  var el = util.el;

  var WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June',
                     'July', 'August', 'September', 'October', 'November', 'December'];

  var SNIPPET_MAX = 40;

  /* ============================================================
     small helpers
     ============================================================ */

  function longDate(d) {
    return WEEKDAYS[d.getDay()] + ', ' + MONTHS_LONG[d.getMonth()] + ' ' + d.getDate();
  }

  function snippet(t, max) {
    if (!t) return '';
    var s = String(t).replace(/\s+/g, ' ').trim();
    if (s.length > max) s = s.slice(0, max - 1) + '\u2026';
    return s;
  }

  /* ============================================================
     pure compute — `now` is always a parameter
     ============================================================ */

  function computeYesterday(analyses, reviews, now) {
    var y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime();
    var yEnd = y + 86400000;

    var reviewByAnalysis = Object.create(null);
    (reviews || []).forEach(function (r) { reviewByAnalysis[r.analysisId] = r; });

    var created = [];
    var resolved = [];
    var reviewsDone = 0;

    (analyses || []).forEach(function (a) {
      var c = new Date(a.createdAt).getTime();
      if (c >= y && c < yEnd) created.push(a);
      if (a.resolution && a.resolution.resolvedAt) {
        var r = new Date(a.resolution.resolvedAt).getTime();
        if (r >= y && r < yEnd) resolved.push(a);
      }
    });

    (reviews || []).forEach(function (r) {
      var rt = new Date(r.createdAt).getTime();
      if (rt >= y && rt < yEnd) reviewsDone++;
    });

    var seen = Object.create(null);
    var items = [];
    var ordered = created.concat(resolved);
    for (var i = 0; i < ordered.length && items.length < 3; i++) {
      var a = ordered[i];
      if (seen[a.id]) continue;
      seen[a.id] = true;

      var status;
      if (!a.resolution)                       status = 'Unresolved';
      else if (reviewByAnalysis[a.id])         status = 'Resolved';
      else                                     status = 'Review Needed';

      items.push({
        id: a.id, number: a.number, asset: a.primaryAsset,
        text: snippet(a.text, SNIPPET_MAX), status: status
      });
    }

    return {
      created: created.length,
      resolved: resolved.length,
      reviewsCompleted: reviewsDone,
      items: items
    };
  }

  function computeNeedsResolution(analyses, now) {
    var open = (analyses || []).filter(function (a) {
      return !a.resolution && a.expiresAt &&
             new Date(a.expiresAt).getTime() <= now.getTime();
    });
    open.sort(function (a, b) {
      return new Date(a.expiresAt) - new Date(b.expiresAt);
    });
    return {
      count: open.length,
      items: open.slice(0, 3).map(function (a) {
        return {
          id: a.id, number: a.number, asset: a.primaryAsset,
          text: snippet(a.text, SNIPPET_MAX)
        };
      })
    };
  }

  function computeReviewsNeeded(analyses) {
    var need = (analyses || []).filter(function (a) {
      return a.resolution && !a.reviewId;
    });
    need.sort(function (a, b) {
      return new Date(a.resolution.resolvedAt) - new Date(b.resolution.resolvedAt);
    });
    return {
      count: need.length,
      items: need.slice(0, 3).map(function (a) {
        return {
          id: a.id, number: a.number, asset: a.primaryAsset,
          text: snippet(a.text, SNIPPET_MAX)
        };
      })
    };
  }

  /* Kept for future use (R7 does not render these). */
  function computeLast(analyses) {
    if (!analyses || !analyses.length) return null;
    var sorted = analyses.slice().sort(function (a, b) {
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
    var a = sorted[0];
    return {
      id: a.id, number: a.number, asset: a.primaryAsset,
      direction: a.direction, target: a.target, invalidation: a.invalidation,
      confidence: a.confidence, createdAt: a.createdAt,
      status: a.resolution ? a.resolution.outcome : 'open'
    };
  }

  /* Kept for future use (R7 does not render these). */
  function computeArchiveStats(analyses) {
    if (!analyses || !analyses.length) {
      return { total: 0, resolved: 0, unresolved: 0, activeDays: 0, firstDate: null };
    }
    var days = Object.create(null);
    var first = null;
    var resolved = 0;

    analyses.forEach(function (a) {
      var d = new Date(a.createdAt);
      days[util.localDateKey(d)] = true;
      if (!first || d < first) first = d;
      if (a.resolution) resolved++;
    });

    return {
      total: analyses.length,
      resolved: resolved,
      unresolved: analyses.length - resolved,
      activeDays: Object.keys(days).length,
      firstDate: util.localIso(first)
    };
  }

  /* Internal: analyses created on the previous LOCAL calendar day,
     newest-first, capped at 3. */
  function _yesterdayCreated(analyses, now) {
    var y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime();
    var yEnd = y + 86400000;
    var items = [];
    (analyses || []).forEach(function (a) {
      if (!a || typeof a !== 'object') return;
      if (typeof a.createdAt !== 'string') return;
      var t = new Date(a.createdAt).getTime();
      if (isNaN(t)) return;
      if (t >= y && t < yEnd) {
        items.push({ id: a.id, number: a.number, asset: a.primaryAsset, t: t });
      }
    });
    items.sort(function (x, y2) { return y2.t - x.t; });
    return items.slice(0, 3);
  }

  /* Pure row model for the "Waiting on you" section. */
  function computeWaitingRows(analyses, reviews, now) {
    var needsResolve = computeNeedsResolution(analyses, now);
    var needsReview = computeReviewsNeeded(analyses);
    var yItems = _yesterdayCreated(analyses, now);

    return [
      {
        key: 'resolve',
        count: needsResolve.count,
        title: 'need resolving',
        help: 'The deadline passed. Say what the market did.',
        href: '#/analyses',
        items: needsResolve.items.map(function (i) {
          return { id: i.id, number: i.number, asset: i.asset };
        })
      },
      {
        key: 'review',
        count: needsReview.count,
        title: 'need a review',
        help: 'Thirty seconds each, while you still remember.',
        href: '#/reviews',
        items: needsReview.items.map(function (i) {
          return { id: i.id, number: i.number, asset: i.asset };
        })
      },
      {
        key: 'yesterday',
        count: yItems.length,
        title: 'written yesterday',
        help: 'Locked and waiting for their outcome.',
        href: '#/archive',
        items: yItems.map(function (i) {
          return { id: i.id, number: i.number, asset: i.asset };
        })
      }
    ];
  }

  /* ============================================================
     render
     ============================================================ */

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function renderRow(row) {
    var r = el('div', { class: 'tm-waiting__row', 'data-key': row.key });

    r.appendChild(el('div', {
      class: 'tm-waiting__count',
      'aria-hidden': 'true',
      text: String(row.count)
    }));

    var body = el('div', { class: 'tm-waiting__body' });

    body.appendChild(el('a', {
      class: 'tm-waiting__title-link',
      href: row.href,
      'aria-label': row.count + ' ' + row.title,
      text: row.title
    }));

    body.appendChild(el('p', { class: 'tm-waiting__help', text: row.help }));

    if (row.items.length) {
      var items = el('div', { class: 'tm-waiting__items' });
      row.items.forEach(function (i) {
        items.appendChild(el('a', {
          class: 'tm-waiting__item',
          href: '#/analysis/' + i.id,
          text: '#' + i.number + ' ' + i.asset
        }));
      });
      body.appendChild(items);
    }

    r.appendChild(body);
    return r;
  }

  function renderRows(container, rows) {
    clear(container);
    rows.forEach(function (row) {
      if (row.count === 0) return;   /* row hidden when count is 0 */
      container.appendChild(renderRow(row));
    });
  }

  function renderHowItWorks(container) {
    clear(container);
    var ol = el('ol', { class: 'tm-waiting__how' });
    [
      'Write it down.',
      'Lock it, with a time.',
      'Let the market answer.',
      'Review what happened.'
    ].forEach(function (line) {
      ol.appendChild(el('li', { text: line }));
    });
    container.appendChild(ol);
  }

  function render(container, analyses, reviews, now) {
    if (!container) return;
    analyses = analyses || [];
    reviews = reviews || [];
    now = now || new Date();

    if (analyses.length === 0) {
      renderHowItWorks(container);
      return;
    }
    renderRows(container, computeWaitingRows(analyses, reviews, now));
  }

  /* ============================================================
     exports
     ============================================================ */

  TM.today = {
    render: render,
    longDate: longDate,
    computeYesterday: computeYesterday,
    computeNeedsResolution: computeNeedsResolution,
    computeReviewsNeeded: computeReviewsNeeded,
    computeLast: computeLast,
    computeArchiveStats: computeArchiveStats,
    computeWaitingRows: computeWaitingRows
  };
})();