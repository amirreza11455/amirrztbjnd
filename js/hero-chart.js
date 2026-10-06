/* ============================================================================
   Tamga — Hero Chart (Candlestick Terminal)
   ----------------------------------------------------------------------------
   A real, vivid candlestick chart rendered on <canvas>. Features:
     - Solid candle bodies with wicks (green/red, full opacity)
     - Price axis labels on the right
     - Time axis labels on the bottom
     - Grid lines (horizontal + vertical)
     - Volume bars at the bottom
     - Live drift: new candle every ~2.5s, smooth scroll
     - DPR-capped-at-2 rendering, ResizeObserver, 30fps rAF cap
     - Pauses when tab is hidden or hero is out of viewport
     - Reduced-motion: one static frame
   ============================================================================ */

(function () {
  'use strict';

  var TM = (window.TM = window.TM || {});
  var util = TM.util;

  /* ============================================================
     constants
     ============================================================ */

  var C_UP        = '#26a26a';   /* vivid green */
  var C_UP_WICK   = '#2ec47e';
  var C_DOWN      = '#e0453b';   /* vivid red */
  var C_DOWN_WICK = '#ff5a4e';
  var C_WICK_NEUTRAL = '#5a5f6a';

  var GRID_COLOR     = 'rgba(255, 255, 255, 0.05)';
  var AXIS_COLOR     = 'rgba(255, 255, 255, 0.35)';
  var AXIS_BG_COLOR  = 'rgba(13, 14, 16, 0.85)';
  var VOL_COLOR_UP   = 'rgba(38, 162, 106, 0.25)';
  var VOL_COLOR_DOWN = 'rgba(224, 69, 59, 0.25)';

  var Y_PAD_TOP    = 16;
  var Y_PAD_BOTTOM = 44;   /* space for time axis */
  var VOL_HEIGHT   = 48;   /* volume bar area height */
  var PRICE_AXIS_W = 64;   /* right-side price label width */
  var PERIOD_MS    = 2500;
  var TARGET_FPS   = 30;
  var FRAME_MIN    = 1000 / TARGET_FPS;

  /* ============================================================
     price series generator — same logic as before but returns
     OHLCV (adds volume)
     ============================================================ */

  function bump(d, span) {
    if (d >= span) return 0;
    var x = d / span;
    return 1 - x * x;
  }

  function generate(seed, opts) {
    opts = opts || {};
    var count = opts.count || 120;

    var rng = util.mulberry32((seed >>> 0) ^ 0x9E3779B1);

    var regimes = [];
    var i = 0;
    while (i < count) {
      var t = rng();
      var type = t < 0.45 ? 'trend' : (t < 0.80 ? 'chop' : 'pullback');
      var dir  = rng() < 0.5 ? 1 : -1;
      var len  = 12 + Math.floor(rng() * 24);
      if (i + len > count) len = count - i;
      regimes.push({ type: type, dir: dir, len: len });
      i += len;
    }

    var path = new Array(count);
    path[0] = 40 + rng() * 20;

    var vol = 1.4;
    var ri = 0;
    var rleft = regimes[0].len;
    var reg = regimes[0];

    for (var k = 1; k < count; k++) {
      if (rleft === 0) {
        ri++;
        reg = regimes[ri];
        rleft = reg.len;
      }
      rleft--;

      vol = vol * 0.92 + (0.6 + rng() * 1.8) * 0.08;

      var drift = 0;
      if (reg.type === 'trend')         drift =  reg.dir * 0.40 * vol;
      else if (reg.type === 'pullback') drift = -reg.dir * 0.28 * vol;

      var shock = (rng() - 0.5) * 2 * vol;
      var v = path[k - 1] + drift + shock;
      if (v < 5)  v = 5  + (5  - v) * 0.25;
      if (v > 95) v = 95 - (v - 95) * 0.25;
      path[k] = v;
    }

    /* --- OHLCV from path --- */
    var out = new Array(count);
    for (var m = 0; m < count; m++) {
      var close = path[m];
      var open = m === 0
        ? close - (rng() - 0.5) * 1.2
        : out[m - 1].c;

      var wick = (0.3 + rng() * vol) * 0.6;
      var hi = (open > close ? open : close) + wick;
      var lo = (open < close ? open : close) - wick;
      if (rng() < 0.20) hi += rng() * vol * 0.5;
      if (rng() < 0.20) lo -= rng() * vol * 0.5;

      if (open  < 0) open  = 0; else if (open  > 100) open  = 100;
      if (close < 0) close = 0; else if (close > 100) close = 100;
      var top = open > close ? open : close;
      var bot = open < close ? open : close;
      if (hi < top) hi = top;
      if (hi > 100) hi = 100;
      if (lo > bot) lo = bot;
      if (lo < 0)   lo = 0;

      /* volume: bigger on bigger moves */
      var bodySize = Math.abs(close - open);
      var volume = 0.3 + bodySize * 0.5 + rng() * 0.3;

      out[m] = { o: open, h: hi, l: lo, c: close, v: volume };
    }

    return out;
  }

  /* ============================================================
     HeroChart
     ============================================================ */

  function HeroChart() {
    this.chartCanvas   = null;
    this.chartCtx      = null;

    this.seed          = 1;
    this.candleCount   = 120;
    this.candles       = [];

    this._candleWidth  = 8;
    this._scrollProgress = 0;
    this.scrollX       = 0;
    this._w = 1;
    this._h = 1;
    this._dpr = 1;
    this._gridLayer    = null;

    this._mounted      = false;
    this.running       = false;
    this.rafId         = null;
    this._lastFrameTime = 0;
    this._intersecting = true;
    this._reduced      = false;

    this._driftEnabled = true;
    this._driftPeriod  = PERIOD_MS;

    this._frameCbs       = [];
    this._resizeObserver = null;
    this._io             = null;
    this._driftRng       = null;
    this._failed         = false;
    this._onWinResize    = null;
  }

  HeroChart.generate = generate;

  /* ============================================================
     mount
     ============================================================ */

  HeroChart.prototype.mount = function (chartCanvas, opts) {
    if (!chartCanvas) return;

    this.chartCanvas = chartCanvas;

    if (typeof chartCanvas.getContext !== 'function') {
      this._failed = true;
      this._applyFallback();
      return;
    }
    this.chartCtx = chartCanvas.getContext('2d');
    if (!this.chartCtx) {
      this._failed = true;
      this._applyFallback();
      return;
    }

    opts = opts || {};
    this.seed = (opts.seed == null ? 1 : opts.seed) >>> 0;
    this._reduced = util.prefersReducedMotion();

    this.candleCount = this._pickCandleCount();
    this.candles = generate(this.seed, { count: this.candleCount });
    this._driftRng = util.mulberry32((this.seed ^ 0xDEADBEEF) >>> 0);
    this._scrollProgress = 0;
    this.scrollX = 0;

    this._attachObservers();
    this._resize();
    this._mounted = true;
  };

  HeroChart.prototype._pickCandleCount = function () {
    var w = this.chartCanvas.parentElement
      ? this.chartCanvas.parentElement.clientWidth
      : 1024;
    return w < 700 ? 60 : 100;
  };

  HeroChart.prototype._applyFallback = function () {
    var p = this.chartCanvas && this.chartCanvas.parentElement;
    if (!p) return;
    p.classList.add('tm-hero__chart--fallback');
  };

  /* ============================================================
     observers
     ============================================================ */

  HeroChart.prototype._attachObservers = function () {
    var self = this;

    if (typeof ResizeObserver !== 'undefined') {
      this._resizeObserver = new ResizeObserver(function () { self._resize(); });
      this._resizeObserver.observe(this.chartCanvas.parentElement);
    } else {
      this._onWinResize = function () { self._resize(); };
      window.addEventListener('resize', this._onWinResize);
    }

    if (typeof IntersectionObserver !== 'undefined') {
      this._io = new IntersectionObserver(function (entries) {
        self._intersecting = !!entries[0].isIntersecting;
      }, { threshold: 0 });
      this._io.observe(this.chartCanvas.parentElement);
    }
  };

  /* ============================================================
     sizing + grid
     ============================================================ */

  HeroChart.prototype._resize = function () {
    if (!this.chartCanvas) return;
    var parent = this.chartCanvas.parentElement;
    if (!parent) return;

    /* Use the canvas's own CSS size, not the parent rect, to avoid
       circular sizing (parent height depends on canvas height). */
    var cs = window.getComputedStyle(this.chartCanvas);
    var w = Math.max(1, Math.round(parseFloat(cs.width) || parent.clientWidth));
    var h = Math.max(1, Math.round(parseFloat(cs.height) || 360));
    var dpr = Math.min(2, window.devicePixelRatio || 1);

    this._w = w;
    this._h = h;
    this._dpr = dpr;

    this.chartCanvas.width  = Math.round(w * dpr);
    this.chartCanvas.height = Math.round(h * dpr);
    this.chartCanvas.style.width  = w + 'px';
    this.chartCanvas.style.height = h + 'px';
    this.chartCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    var target = this._pickCandleCount();
    if (target !== this.candleCount) {
      this.candleCount = target;
      this.candles = generate(this.seed, { count: target });
      this._driftRng = util.mulberry32((this.seed ^ 0xDEADBEEF) >>> 0);
      this._scrollProgress = 0;
      this.scrollX = 0;
    }
    this._candleWidth = (w - PRICE_AXIS_W) / Math.max(20, this.candleCount - 1);

    this._renderGrid();

    if (!this.running || this._reduced) this._drawFrame(performance.now());
  };

  HeroChart.prototype._renderGrid = function () {
    var w = this._w;
    var h = this._h;
    var dpr = this._dpr;

    var layer = document.createElement('canvas');
    layer.width  = Math.round(w * dpr);
    layer.height = Math.round(h * dpr);
    var ctx = layer.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    var plotW = w - PRICE_AXIS_W;
    var plotH = h - Y_PAD_TOP - Y_PAD_BOTTOM;
    var volTop = Y_PAD_TOP + plotH + 4;

    /* horizontal grid lines (price) */
    ctx.strokeStyle = GRID_COLOR;
    ctx.lineWidth = 1;
    for (var i = 0; i <= 5; i++) {
      var y = Y_PAD_TOP + (i / 5) * plotH;
      ctx.beginPath();
      ctx.moveTo(0, Math.round(y) + 0.5);
      ctx.lineTo(plotW, Math.round(y) + 0.5);
      ctx.stroke();
    }

    /* vertical grid lines (time) */
    var n = this.candleCount;
    var step = Math.max(1, Math.floor(n / 6));
    for (var j = 0; j < n; j += step) {
      var x = j * this._candleWidth + this._candleWidth * 0.5;
      if (x > plotW) continue;
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, Y_PAD_TOP);
      ctx.lineTo(Math.round(x) + 0.5, Y_PAD_TOP + plotH + VOL_HEIGHT);
      ctx.stroke();
    }

    /* separator line between price and volume */
    ctx.beginPath();
    ctx.moveTo(0, Math.round(volTop) + 0.5);
    ctx.lineTo(plotW, Math.round(volTop) + 0.5);
    ctx.stroke();

    this._gridLayer = layer;
  };

  /* ============================================================
     drift
     ============================================================ */

  HeroChart.prototype._shiftSeries = function () {
    var arr = this.candles;
    arr.shift();

    var last = arr[arr.length - 1];
    var rng = this._driftRng;
    var vol = 1.2;

    var open = last.c;
    var close = open + (rng() - 0.5) * 2 * vol;
    if (close < 0) close = 0; else if (close > 100) close = 100;

    var top = open > close ? open : close;
    var bot = open < close ? open : close;
    var hi = top + (0.3 + rng() * vol) * 0.6;
    var lo = bot - (0.3 + rng() * vol) * 0.6;
    if (hi > 100) hi = 100;
    if (lo < 0)   lo = 0;

    var bodySize = Math.abs(close - open);
    var volume = 0.3 + bodySize * 0.5 + rng() * 0.3;

    arr.push({ o: open, h: hi, l: lo, c: close, v: volume });
    if (arr.length > this.candleCount) arr.shift();
  };

  HeroChart.prototype._tick = function (dt) {
    if (this._driftEnabled === false) return;
    var cw = this._candleWidth;
    var period = this._driftPeriod || PERIOD_MS;

    this._scrollProgress += dt / period;
    if (this._scrollProgress >= 1) {
      this._scrollProgress -= 1;
      this._shiftSeries();
    }
    this.scrollX = -cw * (this._scrollProgress);
  };

  /* ============================================================
     drawing
     ============================================================ */

  HeroChart.prototype._drawFrame = function (now) {
    var ctx = this.chartCtx;
    if (!ctx) return;

    var w = this._w;
    var h = this._h;
    var plotW = w - PRICE_AXIS_W;
    var plotH = h - Y_PAD_TOP - Y_PAD_BOTTOM - VOL_HEIGHT - 4;
    var volTop = Y_PAD_TOP + plotH + 4;
    var volBottom = volTop + VOL_HEIGHT;
    var baseY = Y_PAD_TOP + plotH;
    var cw = this._candleWidth;
    var bodyW = Math.max(1, cw * 0.7);
    var halfBody = bodyW * 0.5;

    ctx.clearRect(0, 0, w, h);
    if (this._gridLayer) ctx.drawImage(this._gridLayer, 0, 0, w, h);

    var n = this.candles.length;
    var last = n - 1;
    var tick = Math.sin(now / 700) * 0.6;

    /* --- find min/max for auto-scaling price axis --- */
    var minP = 100, maxP = 0;
    for (var s = 0; s < n; s++) {
      if (this.candles[s].l < minP) minP = this.candles[s].l;
      if (this.candles[s].h > maxP) maxP = this.candles[s].h;
    }
    var range = maxP - minP || 1;
    var pad = range * 0.08;
    minP -= pad;
    maxP += pad;
    range = maxP - minP;

    /* --- max volume for scaling volume bars --- */
    var maxVol = 0;
    for (var sv = 0; sv < n; sv++) {
      if (this.candles[sv].v > maxVol) maxVol = this.candles[sv].v;
    }
    if (maxVol === 0) maxVol = 1;

    /* map price to Y */
    function p2y(p) { return baseY - ((p - minP) / range) * plotH; }

    ctx.lineWidth = 1;
    ctx.font = '11px ' + (getComputedStyle(document.body).fontFamily || 'monospace');
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';

    /* --- price axis labels --- */
    ctx.fillStyle = AXIS_COLOR;
    for (var p = 0; p <= 5; p++) {
      var price = maxP - (p / 5) * range;
      var yLabel = Y_PAD_TOP + (p / 5) * plotH;
      ctx.fillText(price.toFixed(1), w - 6, Math.round(yLabel));
    }

    /* --- candles --- */
    for (var i = 0; i < n; i++) {
      var c = this.candles[i];
      var x = i * cw + this.scrollX + cw * 0.5;
      if (x < -cw || x > plotW + cw) continue;

      var o = c.o;
      var hh = c.h;
      var ll = c.l;
      var cc = c.c;
      var isUp = cc >= o;

      if (i === last) {
        cc = c.c + tick;
        if (cc > 100) cc = 100; else if (cc < 0) cc = 0;
        hh = c.h > cc ? c.h : cc;
        ll = c.l < cc ? c.l : cc;
      }

      var col = isUp ? C_UP : C_DOWN;
      var wickCol = isUp ? C_UP_WICK : C_DOWN_WICK;
      ctx.strokeStyle = wickCol;
      ctx.fillStyle   = col;

      var yO = p2y(o);
      var yC = p2y(cc);
      var yH = p2y(hh);
      var yL = p2y(ll);

      /* wick */
      var wx = Math.round(x) + 0.5;
      ctx.beginPath();
      ctx.moveTo(wx, yH);
      ctx.lineTo(wx, yL);
      ctx.stroke();

      /* body */
      var by = yO < yC ? yO : yC;
      var bh = (yO < yC ? yC - yO : yO - yC);
      if (bh < 1.5) bh = 1.5;
      ctx.fillRect(x - halfBody, by, bodyW, bh);

      /* volume bar */
      var vBarH = (c.v / maxVol) * VOL_HEIGHT;
      ctx.fillStyle = isUp ? VOL_COLOR_UP : VOL_COLOR_DOWN;
      ctx.fillRect(x - halfBody, volBottom - vBarH, bodyW, vBarH);
    }

    /* --- current price line --- */
    var lastC = this.candles[last];
    var lastPrice = lastC.c + tick;
    if (lastPrice > 100) lastPrice = 100; else if (lastPrice < 0) lastPrice = 0;
    var yPrice = p2y(lastPrice);

    var lastIsUp = lastC.c >= lastC.o;
    ctx.strokeStyle = lastIsUp ? C_UP_WICK : C_DOWN_WICK;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, Math.round(yPrice) + 0.5);
    ctx.lineTo(plotW, Math.round(yPrice) + 0.5);
    ctx.stroke();
    ctx.setLineDash([]);

    /* current price tag on axis */
    ctx.fillStyle = lastIsUp ? C_UP : C_DOWN;
    ctx.fillRect(plotW, Math.round(yPrice) - 9, PRICE_AXIS_W, 18);
    ctx.fillStyle = '#fff';
    ctx.fillText(lastPrice.toFixed(1), w - 6, Math.round(yPrice));

    /* --- time axis labels --- */
    ctx.fillStyle = AXIS_COLOR;
    ctx.textAlign = 'center';
    var timeStep = Math.max(1, Math.floor(n / 6));
    for (var t = 0; t < n; t += timeStep) {
      var tx = t * cw + this.scrollX + cw * 0.5;
      if (tx < 0 || tx > plotW) continue;
      var label = '-' + Math.floor((n - t) * 4 / 24 * 10) / 10 + 'd';
      if (t === last) label = 'now';
      ctx.fillText(label, Math.round(tx), h - 14);
    }
  };

  /* ============================================================
     loop
     ============================================================ */

  HeroChart.prototype.start = function () {
    if (!this._mounted || this.running) return;
    this.running = true;

    if (this._reduced) {
      this._drawFrame(performance.now());
      return;
    }

    this._lastFrameTime = performance.now();
    var self = this;

    function loop(now) {
      if (!self.running) return;

      if (!self._intersecting || document.hidden) {
        self._lastFrameTime = now;
        self.rafId = requestAnimationFrame(loop);
        return;
      }

      var dt = now - self._lastFrameTime;
      if (dt < FRAME_MIN - 1) {
        self.rafId = requestAnimationFrame(loop);
        return;
      }

      self._lastFrameTime = now;
      self._tick(dt);
      self._drawFrame(now);
      self._emitFrame(now, dt);
      self.rafId = requestAnimationFrame(loop);
    }

    this.rafId = requestAnimationFrame(loop);
  };

  /* ============================================================
     frame callbacks
     ============================================================ */

  HeroChart.prototype._emitFrame = function (now, dt) {
    var cbs = this._frameCbs;
    for (var i = 0; i < cbs.length; i++) cbs[i](now, dt);
  };

  HeroChart.prototype.stop = function () {
    this.running = false;
    if (this.rafId != null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  };

  HeroChart.prototype.destroy = function () {
    this.stop();
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
    if (this._io) {
      this._io.disconnect();
      this._io = null;
    }
    if (this._onWinResize) {
      window.removeEventListener('resize', this._onWinResize);
      this._onWinResize = null;
    }
    this._frameCbs = [];
    this._mounted = false;
  };

  /* ============================================================
     public helpers (kept for compatibility)
     ============================================================ */

  HeroChart.prototype.setSeed = function (seed) {
    this.seed = seed >>> 0;
    this.candles = generate(this.seed, { count: this.candleCount });
    this._driftRng = util.mulberry32((this.seed ^ 0xDEADBEEF) >>> 0);
    this._scrollProgress = 0;
    this.scrollX = 0;
    if (!this.running || this._reduced) this._drawFrame(performance.now());
  };

  HeroChart.prototype.setScenario = function (seed, waypoints) {
    this.seed = (seed >>> 0);
    this.candles = generate(this.seed, {
      count: this.candleCount,
      waypoints: waypoints || []
    });
    this._driftRng = util.mulberry32((this.seed ^ 0xDEADBEEF) >>> 0);
    this._scrollProgress = 0;
    this.scrollX = 0;
    if (!this.running || this._reduced) this._drawFrame(performance.now());
  };

  HeroChart.prototype.setDriftEnabled = function (enabled) {
    this._driftEnabled = enabled !== false;
    if (!this._driftEnabled) {
      this._scrollProgress = 0;
      this.scrollX = 0;
    }
  };

  HeroChart.prototype.setDriftPeriod = function (ms) {
    this._driftPeriod = Math.max(200, ms) || PERIOD_MS;
  };

  HeroChart.prototype.onFrame = function (cb) {
    if (typeof cb !== 'function') return function () {};
    this._frameCbs.push(cb);
    var self = this;
    return function off() {
      var i = self._frameCbs.indexOf(cb);
      if (i >= 0) self._frameCbs.splice(i, 1);
    };
  };

  /* ============================================================
     export
     ============================================================ */

  TM.HeroChart = HeroChart;
})();
