/* ============================================================================
   Tamga — Paper Slip (R5)
   ----------------------------------------------------------------------------
   The selected analysis, printed as a light paper slip.

   Exports:
     TM.slip.model(analysis, now) -> data
     TM.slip.render(container, analysis, now, { onAction })
   ============================================================================ */

(function () {
  'use strict';

  var TM = (window.TM = window.TM || {});
  var util = TM.util;
  var el = util.el;

  /* ============================================================
     status helpers
     ============================================================ */

  function statusOf(a, now) {
    if (!a) return 'open';
    if (a.resolution && a.resolution.outcome) return a.resolution.outcome;
    if (a.expiresAt && new Date(a.expiresAt).getTime() <= now.getTime()) return 'expired';
    return 'open';
  }

  function statusLabelFor(status) {
    switch (status) {
      case 'open':     return 'Locked';
      case 'expired':  return 'Needs resolving';
      case 'correct':  return 'Correct';
      case 'partial':  return 'Partial';
      case 'wrong':    return 'Wrong';
      case 'invalid':  return 'No setup';
      default:         return 'Locked';
    }
  }

  function toneFor(status) {
    if (status === 'correct') return 'correct';
    if (status === 'wrong')   return 'wrong';
    if (status === 'partial') return 'partial';
    if (status === 'invalid') return 'invalid';
    if (status === 'expired') return 'expired';
    return 'open';
  }

  function actionsFor(a, status) {
    if (status === 'open' || status === 'expired') return ['Resolve'];
    if (a && a.resolution && !a.reviewId) return ['Add review'];
    return [];
  }

  function sentenceFor(a) {
    if (!a) return 'Your first analysis will be printed here and locked with a time.';
    var dir = (a.direction || 'neutral');
    var dirWord = dir.charAt(0).toUpperCase() + dir.slice(1);
    var asset = a.primaryAsset || '—';
    var tf = a.timeframe || '—';
    var conf = (typeof a.confidence === 'number') ? a.confidence : null;

    if (dir === 'neutral' || a.target == null || a.invalidation == null) {
      return dirWord + ' on ' + asset + ', ' + tf + '.' +
             (conf != null ? ' Confidence ' + conf + '%.' : '');
    }

    var side = (dir === 'bearish') ? 'above' : 'below';
    return dirWord + ' on ' + asset + ', ' + tf + '. Target ' + a.target +
           ', invalidated ' + side + ' ' + a.invalidation + '.' +
           (conf != null ? ' Confidence ' + conf + '%.' : '');
  }

  function footerFor(a, status, now) {
    if (!a) return 'Locked —';
    var locked = new Date(a.createdAt);
    var lockedStr = util.formatWeekdayTime(locked);

    if (status === 'open') {
      if (a.expiresAt) {
        return 'Locked ' + lockedStr + '. Expires ' +
               util.formatWeekdayTime(new Date(a.expiresAt)) + '.';
      }
      return 'Locked ' + lockedStr + '.';
    }
    if (status === 'expired') {
      return 'Expired ' + util.formatWeekdayTime(new Date(a.expiresAt)) + '.';
    }
    if (a.resolution && a.resolution.resolvedAt) {
      return 'Resolved ' + util.formatWeekdayTime(new Date(a.resolution.resolvedAt)) + '.';
    }
    return 'Locked ' + lockedStr + '.';
  }

  /* ============================================================
     model (pure)
     ============================================================ */

  function model(analysis, now) {
    now = now || new Date();

    if (!analysis) {
      return {
        empty: true,
        numberLabel: 'No. —',
        sentence: sentenceFor(null),
        statusLabel: 'Locked',
        tone: 'open',
        stampText: 'Locked',
        footerText: 'Locked —',
        actions: [],
        levels: null
      };
    }

    var status = statusOf(analysis, now);
    var levels = null;
    if (analysis.target != null && analysis.invalidation != null) {
      levels = {
        target: analysis.target,
        invalidation: analysis.invalidation,
        direction: analysis.direction
      };
    }

    return {
      empty: false,
      id: analysis.id,
      numberLabel: 'No. ' + analysis.number,
      sentence: sentenceFor(analysis),
      statusLabel: statusLabelFor(status),
      tone: toneFor(status),
      stampText: statusLabelFor(status),
      footerText: footerFor(analysis, status, now),
      actions: actionsFor(analysis, status),
      levels: levels,
      text: analysis.text || ''
    };
  }

  /* ============================================================
     render
     ============================================================ */

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function drawLadder(levels) {
    /* Level ladder — real data only. */
    var NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'tm-slip__ladder');
    svg.setAttribute('viewBox', '0 0 400 96');
    svg.setAttribute('preserveAspectRatio', 'none');

    var hi = Math.max(levels.target, levels.invalidation);
    var lo = Math.min(levels.target, levels.invalidation);
    var range = (hi - lo) || 1;
    var pad = range * 0.15;
    var top = hi + pad;
    var bot = lo - pad;
    var span = top - bot || 1;

    function yFor(v) { return 20 + (1 - (v - bot) / span) * 56; }

    /* target line */
    var tY = yFor(levels.target);
    svg.appendChild(line(NS, 8, tY, 300, tY, 'var(--tm-success)', '3 3'));
    svg.appendChild(text(NS, 308, tY + 4, String(levels.target), 'var(--tm-success)'));
    svg.appendChild(text(NS, 8, tY - 4, 'Target', 'var(--tm-success)'));

    /* invalidation line */
    var iY = yFor(levels.invalidation);
    svg.appendChild(line(NS, 8, iY, 300, iY, 'var(--tm-danger)', '3 3'));
    svg.appendChild(text(NS, 308, iY + 4, String(levels.invalidation), 'var(--tm-danger)'));
    svg.appendChild(text(NS, 8, iY - 4, 'Invalidation', 'var(--tm-danger)'));

    /* locked vertical marker */
    var mx = 200;
    svg.appendChild(line(NS, mx, tY, mx, iY, 'var(--tm-ink)', '2 3'));
    svg.appendChild(text(NS, mx, tY - 10, 'Locked', 'var(--tm-ink)'));

    return svg;
  }

  function line(NS, x1, y1, x2, y2, stroke, dash) {
    var l = document.createElementNS(NS, 'line');
    l.setAttribute('x1', x1); l.setAttribute('y1', y1);
    l.setAttribute('x2', x2); l.setAttribute('y2', y2);
    l.setAttribute('stroke', stroke);
    l.setAttribute('stroke-width', '1');
    if (dash) l.setAttribute('stroke-dasharray', dash);
    return l;
  }

  function text(NS, x, y, str, fill) {
    var t = document.createElementNS(NS, 'text');
    t.setAttribute('x', x); t.setAttribute('y', y);
    t.setAttribute('font-size', '11');
    t.setAttribute('font-family', 'var(--tm-font-sans)');
    t.setAttribute('fill', fill);
    t.textContent = str;
    return t;
  }

  function drawStamp(m) {
    var stamp = el('div', {
      class: 'tm-slip__stamp tm-slip__stamp--' + m.tone,
      text: m.stampText
    });
    if (m.empty) stamp.classList.add('tm-slip__stamp--ghost');
    return stamp;
  }

  function drawSnapshot(m, analysis) {
    var wrap = el('div', { class: 'tm-slip__snapshot' });

    /* integration point: if a screenshot URL is available, show it. */
    if (analysis && analysis.screenshotId &&
        TM.store && typeof TM.store.getScreenshotUrl === 'function') {
      var url = TM.store.getScreenshotUrl(analysis.screenshotId);
      if (url) {
        var img = el('img', {
          class: 'tm-slip__snapshot-img',
          src: url, alt: 'Market snapshot'
        });
        wrap.appendChild(img);
        return wrap;
      }
    }

    /* else: level ladder from real data */
    if (m.levels) {
      wrap.appendChild(drawLadder(m.levels));
    } else {
      wrap.appendChild(el('p', { class: 'tm-slip__snapshot-empty',
        text: 'No levels recorded.' }));
    }
    return wrap;
  }

  function render(container, analysis, now, opts) {
    opts = opts || {};
    var m = model(analysis, now);

    clear(container);

    var slip = el('div', { class: 'tm-slip' + (m.empty ? ' tm-slip--empty' : '') });

    slip.appendChild(drawStamp(m));

    slip.appendChild(el('p', { class: 'tm-slip__label', text: 'Analysis' }));
    slip.appendChild(el('h2', { class: 'tm-slip__number', text: m.numberLabel }));
    slip.appendChild(el('p', { class: 'tm-slip__sentence', text: m.sentence }));

    if (m.text) {
      slip.appendChild(el('p', { class: 'tm-slip__body', text: m.text }));
      if (m.id) {
        slip.appendChild(el('a', {
          class: 'tm-slip__read', href: '#/analysis/' + m.id,
          text: 'Read in full'
        }));
      }
    }

    slip.appendChild(drawSnapshot(m, analysis));

    /* actions */
    if (m.actions.length) {
      var actions = el('div', { class: 'tm-slip__actions' });
      m.actions.forEach(function (label) {
        var b = el('button', {
          type: 'button', class: 'tm-slip__action',
          text: label,
          onClick: function () {
            if (opts.onAction) opts.onAction(label, analysis);
            else if (TM.shell && TM.shell.modal) {
              TM.shell.modal({
                title: label,
                body: 'Coming in Phase 1.',
                actions: [{ label: 'OK', variant: 'primary' }]
              });
            }
          }
        });
        actions.appendChild(b);
      });
      slip.appendChild(actions);
    } else if (analysis && analysis.resolution) {
      slip.appendChild(el('p', { class: 'tm-slip__note',
        text: 'Resolved. The original analysis can no longer be changed.' }));
    }

    slip.appendChild(el('hr', { class: 'tm-slip__rule' }));
    slip.appendChild(el('p', { class: 'tm-slip__footer', text: m.footerText }));
    slip.appendChild(el('div', { class: 'tm-slip__serial' }));

    container.appendChild(slip);

    /* stamp press animation, once per analysis */
    if (!m.empty && !util.prefersReducedMotion()) {
      var stamp = slip.querySelector('.tm-slip__stamp');
      if (stamp && container._lastStampedId !== m.id) {
        container._lastStampedId = m.id;
        stamp.classList.add('is-pressing');
        setTimeout(function () { stamp.classList.remove('is-pressing'); }, 200);
      }
    }
  }

  /* ============================================================
     exports
     ============================================================ */

  TM.slip = {
    model: model,
    render: render
  };
})();