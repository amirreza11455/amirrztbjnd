/* ============================================================================
   Tamga — Timeline (R4)
   ----------------------------------------------------------------------------
   A horizontal timeline of the user's own analyses: one bar per analysis from
   the moment it was locked until it resolved or expires, with a "Now" line.

   Exports:
     TM.timeline.layout(analyses, now, opts) -> data
     TM.timeline.render(container, analyses, now, handlers)
     TM.timeline._statusOf(analysis, now) -> string
     TM.timeline._labelPlacement(barWidth, labelText, x0, x1, svgWidth, charW)
   ============================================================================ */

(function () {
  'use strict';

  var TM = (window.TM = window.TM || {});
  var util = TM.util;

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  /* module-level filter state — persists across re-renders */
  var _assetFilter = 'all';
  var _selectedId = null;

  /* ============================================================
     pure helpers
     ============================================================ */

  function statusOf(a, now) {
    if (!a) return 'open';
    if (a.resolution && a.resolution.outcome) return a.resolution.outcome;
    if (a.expiresAt && new Date(a.expiresAt).getTime() <= now.getTime()) return 'expired';
    return 'open';
  }

  function arrowFor(direction) {
    if (direction === 'bullish') return '\u25B2';
    if (direction === 'bearish') return '\u25BC';
    return '\u25CF';
  }

  function labelTextFor(a) {
    return '#' + a.number + '  ' + a.primaryAsset + '  ' + arrowFor(a.direction);
  }

  /* Pure: label side rule.
     barWidth > 200 -> inside + confidence
     barWidth > 150 -> inside
     else -> right if it fits, else left, else inside (fallback) */
  function labelPlacement(barWidth, labelText, x0, x1, svgWidth, charW) {
    charW = charW || 7;
    var labelW = labelText.length * charW + 16;
    if (barWidth > 200) return { side: 'inside', showConfidence: true,  x: x0 + 8, anchor: 'start' };
    if (barWidth > 150) return { side: 'inside', showConfidence: false, x: x0 + 8, anchor: 'start' };
    if (x1 + 8 + labelW <= svgWidth) return { side: 'right',  showConfidence: false, x: x1 + 8, anchor: 'start' };
    if (x0 - 8 - labelW >= 0)        return { side: 'left',   showConfidence: false, x: x0 - 8, anchor: 'end' };
    return { side: 'inside', showConfidence: false, x: x0 + 8, anchor: 'start' };
  }

  /* ============================================================
     layout (pure)
     ============================================================ */

  function layout(analyses, now, opts) {
    opts = opts || {};
    var hoursBefore = opts.hoursBefore == null ? 72 : opts.hoursBefore;
    var hoursAfter  = opts.hoursAfter  == null ? 48 : opts.hoursAfter;
    var maxLanes    = opts.maxLanes    == null ? 7  : opts.maxLanes;
    var width       = opts.width       == null ? 1200 : opts.width;
    var laneTop     = opts.laneTop     == null ? 46 : opts.laneTop;
    var laneHeight  = opts.laneHeight  == null ? 34 : opts.laneHeight;
    var barHeight   = opts.barHeight   == null ? 20 : opts.barHeight;

    var nowMs = now.getTime();
    var windowStart = nowMs - hoursBefore * 3600000;
    var windowEnd   = nowMs + hoursAfter  * 3600000;
    var windowSpan  = windowEnd - windowStart;

    /* ---- valid records, filtered by window ---- */
    var valid = [];
    var list = analyses || [];
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      if (!a || typeof a !== 'object') continue;
      if (typeof a.createdAt !== 'string') continue;
      var startMs = new Date(a.createdAt).getTime();
      if (isNaN(startMs)) continue;

      var status = statusOf(a, now);
      var endMs;
      var resolvedMs = null;
      if (a.resolution && a.resolution.resolvedAt) {
        resolvedMs = new Date(a.resolution.resolvedAt).getTime();
        if (isNaN(resolvedMs)) resolvedMs = startMs;
        endMs = resolvedMs;
      } else if (a.expiresAt) {
        var ex = new Date(a.expiresAt).getTime();
        endMs = isNaN(ex) ? nowMs : ex;
      } else {
        endMs = nowMs;
      }

      if (endMs < windowStart) continue;
      if (startMs > windowEnd) continue;

      valid.push({ a: a, startMs: startMs, endMs: endMs, resolvedMs: resolvedMs, status: status });
    }

    /* ---- sort newest-first, cap to maxLanes ---- */
    valid.sort(function (x, y) { return y.startMs - x.startMs; });
    valid = valid.slice(0, maxLanes);

    /* ---- bars ---- */
    var bars = [];
    for (var b = 0; b < valid.length; b++) {
      var v = valid[b];
      var x0raw = (v.startMs - windowStart) / windowSpan * width;
      var x1raw = (v.endMs   - windowStart) / windowSpan * width;
      var clippedLeft  = x0raw < 0;
      var clippedRight = x1raw > width;
      var x0 = Math.max(0, Math.min(width, x0raw));
      var x1 = Math.max(0, Math.min(width, x1raw));
      var barW = x1 - x0;

      var lbl = labelTextFor(v.a);
      var placement = labelPlacement(barW, lbl, x0, x1, width);

      bars.push({
        id: v.a.id,
        number: v.a.number,
        asset: v.a.primaryAsset,
        direction: v.a.direction,
        status: v.status,
        confidence: v.a.confidence,
        lane: b,
        x0: x0,
        x1: x1,
        width: barW,
        clippedLeft: clippedLeft,
        clippedRight: clippedRight,
        labelText: lbl,
        labelSide: placement.side,
        labelX: placement.x,
        labelAnchor: placement.anchor,
        showConfidence: placement.showConfidence,
        createdMs: v.startMs,
        expiresMs: v.a.expiresAt ? new Date(v.a.expiresAt).getTime() : null,
        resolvedMs: v.resolvedMs,
        raw: v.a
      });
    }

    /* ---- ticks: every 12h at local 00:00 and 12:00 ---- */
    var cursor = new Date(windowStart);
    cursor.setMinutes(0, 0, 0);
    if (cursor.getTime() < windowStart) cursor.setHours(cursor.getHours() + 1);
    var hh = cursor.getHours();
    if (hh !== 0 && hh !== 12) {
      if (hh < 12) cursor.setHours(12);
      else { cursor.setDate(cursor.getDate() + 1); cursor.setHours(0); }
    }

    var ticks = [];
    var guard = 0;
    while (cursor.getTime() <= windowEnd && guard++ < 500) {
      var d = new Date(cursor.getTime());
      var isMid = d.getHours() === 0;
      var label = isMid ? (WEEKDAYS[d.getDay()] + ' ' + d.getDate()) : '12:00';
      ticks.push({
        t: d.getTime(),
        x: (d.getTime() - windowStart) / windowSpan * width,
        label: label,
        bold: isMid
      });
      cursor = new Date(cursor.getTime() + 12 * 3600000);
    }

    /* ---- geometry ---- */
    var lanes = Math.max(bars.length, 3);
    var axisY = laneTop + lanes * laneHeight + 14;
    var height = axisY + 24;

    var assets = [];
    bars.forEach(function (bb) {
      if (assets.indexOf(bb.asset) === -1) assets.push(bb.asset);
    });

    var example = bars.length === 0;

    return {
      bars: bars,
      ticks: ticks,
      nowX: (nowMs - windowStart) / windowSpan * width,
      windowStart: windowStart,
      windowEnd: windowEnd,
      width: width,
      height: height,
      axisY: axisY,
      laneTop: laneTop,
      laneHeight: laneHeight,
      barHeight: barHeight,
      lanes: lanes,
      assets: assets,
      example: example
    };
  }

  /* ============================================================
     render
     ============================================================ */

  function elSVG(tag, attrs) {
    var n = document.createElementNS(SVG_NS, tag);
    if (attrs) {
      for (var k in attrs) {
        if (Object.prototype.hasOwnProperty.call(attrs, k) && attrs[k] != null) {
          n.setAttribute(k, String(attrs[k]));
        }
      }
    }
    return n;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function renderFilters(host, data) {
    if (!host) return;
    clear(host);

    if (data.example) return;   /* no filter chips in empty state */

    var options = [{ key: 'all', label: 'All' }].concat(
      data.assets.map(function (a) { return { key: a, label: a }; })
    );

    options.forEach(function (opt) {
      var pressed = (_assetFilter === opt.key) ? 'true' : 'false';
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tm-timeline__filter';
      btn.setAttribute('data-asset', opt.key);
      btn.setAttribute('aria-pressed', pressed);
      btn.textContent = opt.label;
      btn.addEventListener('click', function () {
        _assetFilter = opt.key;
        /* re-render via handler if provided */
        if (host._onFilterChange) host._onFilterChange();
      });
      host.appendChild(btn);
    });
  }

  function drawTick(g, t, data) {
    var line = elSVG('line', {
      x1: t.x, y1: data.axisY - 4,
      x2: t.x, y2: data.axisY,
      stroke: 'var(--tm-border-strong)',
      'stroke-width': 1
    });
    g.appendChild(line);

    var text = elSVG('text', {
      x: t.x, y: data.axisY + 16,
      'text-anchor': 'middle',
      'font-size': '11',
      'font-family': 'var(--tm-font-sans)',
      'font-weight': t.bold ? '600' : '400',
      fill: t.bold ? 'var(--tm-text-muted)' : 'var(--tm-text-faint)'
    });
    text.textContent = t.label;
    g.appendChild(text);
  }

  function drawBar(g, bar, data, handlers, selected) {
    var y = data.laneTop + bar.lane * data.laneHeight +
            (data.laneHeight - data.barHeight) / 2;
    var h = data.barHeight;
    var group = elSVG('g', {
      'role': 'button',
      'tabindex': '0',
      'aria-label': 'Analysis ' + bar.number + ', ' + bar.asset + ', ' + bar.status,
      'data-id': bar.id,
      'class': 'tm-timeline__bar' + (selected ? ' is-selected' : '')
    });

    var status = bar.status;

    if (status === 'open') {
      var nowX = data.nowX;
      var solidW = Math.max(0, nowX - bar.x0);
      if (solidW > 0) {
        group.appendChild(elSVG('rect', {
          x: bar.x0, y: y, width: solidW, height: h,
          fill: 'var(--tm-lock)', 'fill-opacity': 0.55,
          stroke: 'var(--tm-lock)', 'stroke-opacity': 0.9, 'stroke-width': 1
        }));
      }
      var dashEnd = bar.x1 > nowX ? bar.x1 : nowX + 24;
      var dashW = dashEnd - nowX;
      if (dashW > 0) {
        group.appendChild(elSVG('rect', {
          x: nowX, y: y, width: dashW, height: h,
          fill: 'none',
          stroke: 'var(--tm-lock)', 'stroke-opacity': 0.7,
          'stroke-width': 1, 'stroke-dasharray': '3 3'
        }));
      }
    } else if (status === 'expired') {
      group.appendChild(elSVG('rect', {
        x: bar.x0, y: y, width: bar.width, height: h,
        fill: 'var(--tm-bar)', 'fill-opacity': 0.5,
        stroke: 'var(--tm-text-muted)', 'stroke-opacity': 0.5, 'stroke-width': 1
      }));
      var ring = elSVG('circle', {
        cx: bar.x1, cy: y + h / 2, r: 5,
        fill: 'none',
        stroke: 'var(--tm-text-muted)', 'stroke-opacity': 0.7, 'stroke-width': 1.4
      });
      group.appendChild(ring);
    } else if (status === 'correct' || status === 'wrong') {
      var col = status === 'correct' ? 'var(--tm-success)' : 'var(--tm-danger)';
      group.appendChild(elSVG('rect', {
        x: bar.x0, y: y, width: bar.width, height: h,
        fill: col, 'fill-opacity': 0.28,
        stroke: col, 'stroke-opacity': 0.7, 'stroke-width': 1
      }));
      group.appendChild(elSVG('rect', {
        x: Math.max(bar.x0, bar.x1 - 4), y: y, width: 4, height: h,
        fill: col
      }));
    } else if (status === 'partial') {
      group.appendChild(elSVG('rect', {
        x: bar.x0, y: y, width: bar.width, height: h,
        fill: 'url(#tm-partial-stripes)',
        stroke: 'var(--tm-text-muted)', 'stroke-opacity': 0.7, 'stroke-width': 1
      }));
    } else if (status === 'invalid') {
      group.appendChild(elSVG('rect', {
        x: bar.x0, y: y, width: bar.width, height: h,
        fill: 'none',
        stroke: 'var(--tm-text-muted)', 'stroke-opacity': 0.6,
        'stroke-width': 1, 'stroke-dasharray': '3 3'
      }));
    }

    /* selection outline */
    if (selected) {
      group.appendChild(elSVG('rect', {
        x: bar.x0 - 2, y: y - 2, width: bar.width + 4, height: h + 4,
        fill: 'none',
        stroke: 'var(--tm-text)', 'stroke-width': 1.5
      }));
    }

    /* label */
    var labelY = y + h / 2 + 4;
    var label = elSVG('text', {
      x: bar.labelX, y: labelY,
      'text-anchor': bar.labelAnchor,
      'font-size': '13',
      'font-family': 'var(--tm-font-sans)',
      'font-weight': '500',
      fill: 'var(--tm-text)',
      'pointer-events': 'none'
    });
    label.textContent = bar.labelText;
    group.appendChild(label);

    if (bar.showConfidence) {
      var conf = elSVG('text', {
        x: bar.x1 - 8, y: labelY,
        'text-anchor': 'end',
        'font-size': '12',
        'font-family': 'var(--tm-font-sans)',
        'font-weight': '400',
        fill: 'var(--tm-text-muted)',
        'pointer-events': 'none'
      });
      conf.textContent = bar.confidence + '% sure';
      group.appendChild(conf);
    }

    /* interaction */
    function onActivate(e) {
      if (e && e.preventDefault) e.preventDefault();
      if (handlers && handlers.onSelect) handlers.onSelect(bar.raw);
      else window.location.hash = '#/analysis/' + bar.id;
    }
    group.addEventListener('click', onActivate);
    group.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') onActivate(e);
    });

    g.appendChild(group);
  }

  function drawExampleBar(g, lane, data) {
    var y = data.laneTop + lane * data.laneHeight +
            (data.laneHeight - data.barHeight) / 2;
    var x0 = 80 + lane * 40;
    var x1 = 280 + lane * 40;

    var grp = elSVG('g', { 'class': 'tm-timeline__bar tm-timeline__bar--example' });
    grp.appendChild(elSVG('rect', {
      x: x0, y: y, width: x1 - x0, height: data.barHeight,
      fill: 'none',
      stroke: 'var(--tm-text-faint)', 'stroke-opacity': 0.6,
      'stroke-width': 1, 'stroke-dasharray': '3 3'
    }));
    var lbl = elSVG('text', {
      x: (x0 + x1) / 2, y: y + data.barHeight / 2 + 4,
      'text-anchor': 'middle',
      'font-size': '12',
      'font-family': 'var(--tm-font-sans)',
      'font-weight': '400',
      fill: 'var(--tm-text-faint)'
    });
    lbl.textContent = 'Example';
    grp.appendChild(lbl);
    g.appendChild(grp);
  }

  function render(container, analyses, now, handlers) {
    try {
      handlers = handlers || {};
      var data = layout(analyses, now);

      var caption = container.querySelector('[data-timeline="caption"]');
      if (caption) {
        caption.textContent = data.example
          ? 'Your analyses appear here as bars, from the moment you lock them until the market answers.'
          : 'Your last three days, and what is still open.';
      }

      var filtersHost = container.querySelector('[data-timeline="filters"]');
      var scrollHost  = container.querySelector('[data-timeline="scroll"]');
      if (!scrollHost) return;

      /* filter chips */
      renderFilters(filtersHost, data);
      if (filtersHost) {
        filtersHost._onFilterChange = function () {
          render(container, analyses, now, handlers);
        };
      }

      /* SVG */
      clear(scrollHost);

      var svg = elSVG('svg', {
        viewBox: '0 0 ' + data.width + ' ' + data.height,
        width: '100%',
        height: String(data.height),
        preserveAspectRatio: 'xMidYMid meet',
        style: 'min-width: 960px; display: block;'
      });

      /* defs: partial stripes */
      var defs = elSVG('defs');
      var pat = elSVG('pattern', {
        id: 'tm-partial-stripes',
        patternUnits: 'userSpaceOnUse',
        width: 6, height: 6,
        patternTransform: 'rotate(45)'
      });
      pat.appendChild(elSVG('line', {
        x1: 0, y1: 0, x2: 0, y2: 6,
        stroke: 'var(--tm-text-muted)', 'stroke-opacity': 0.5, 'stroke-width': 2
      }));
      defs.appendChild(pat);
      svg.appendChild(defs);

      /* ticks */
      var gTicks = elSVG('g', { 'class': 'tm-timeline__ticks' });
      data.ticks.forEach(function (t) { drawTick(gTicks, t, data); });
      svg.appendChild(gTicks);

      /* "Now" line + pill */
      var gNow = elSVG('g', { 'class': 'tm-timeline__now' });
      gNow.appendChild(elSVG('line', {
        x1: data.nowX, y1: 24,
        x2: data.nowX, y2: data.axisY,
        stroke: 'var(--tm-text)', 'stroke-width': 1
      }));
      gNow.appendChild(elSVG('rect', {
        x: data.nowX - 18, y: 4, width: 36, height: 16,
        rx: 3, fill: 'var(--tm-text)'
      }));
      var nowLbl = elSVG('text', {
        x: data.nowX, y: 15,
        'text-anchor': 'middle',
        'font-size': '10',
        'font-family': 'var(--tm-font-sans)',
        'font-weight': '600',
        fill: 'var(--tm-bg)'
      });
      nowLbl.textContent = 'Now';
      gNow.appendChild(nowLbl);
      svg.appendChild(gNow);

      /* bars */
      var gBars = elSVG('g', { 'class': 'tm-timeline__bars' });
      if (data.example) {
        for (var e = 0; e < 3; e++) drawExampleBar(gBars, e, data);
      } else {
        var selectedId = handlers.selectedId || _selectedId;
        data.bars.forEach(function (bar) {
          var matches = (_assetFilter === 'all') || (bar.asset === _assetFilter);
          var node = (function () {
            var wrapper = elSVG('g');
            drawBar(wrapper, bar, data, handlers, bar.id === selectedId);
            return wrapper;
          })();
          var inner = node.firstChild;
          if (!matches && inner) inner.setAttribute('opacity', '0.2');
          gBars.appendChild(inner);
        });
      }
      svg.appendChild(gBars);

      scrollHost.appendChild(svg);

      /* scroll so "Now" is visible */
      requestAnimationFrame(function () {
        var svgW = svg.clientWidth || data.width;
        var target = data.nowX * svgW / data.width - scrollHost.clientWidth / 2;
        scrollHost.scrollLeft = Math.max(0, target);
      });
    } catch (err) {
      console.error('[timeline] render failed', err);
      /* fall back to empty state */
      try {
        clear(container.querySelector('[data-timeline="scroll"]') || container);
        var msg = document.createElement('p');
        msg.className = 'tm-timeline__empty';
        msg.textContent = 'Your analyses appear here as bars.';
        container.appendChild(msg);
      } catch (_) {}
    }
  }

  /* ============================================================
     exports
     ============================================================ */

  TM.timeline = {
    layout: layout,
    render: render,
    _statusOf: statusOf,
    _labelPlacement: labelPlacement,
    _setSelectedId: function (id) { _selectedId = id; },
    _getAssetFilter: function () { return _assetFilter; }
  };
})();