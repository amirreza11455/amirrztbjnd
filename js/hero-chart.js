/* ============================================================================
   TradeMark — Hero Chart ("Ledger Terminal")
   ----------------------------------------------------------------------------
   Decorative animated Bitcoin price chart rendered on <canvas>. Two layers:
     - chart canvas  : grid + candles
     - overlay canvas: reserved for TM.AnalysisStory (Part 3)
   The chart never dominates: soft alpha, no price labels, subtle drift.

   Includes:
     - Static, deterministic series generator with regimes and waypoints
     - DPR-capped-at-2 rendering, ResizeObserver, 30fps rAF cap
     - Pauses when tab is hidden or hero is out of viewport (IntersectionObserver)
     - Reduced-motion: one static frame, no loop
     - Pre-rendered grid layer, no shadowBlur, no per-frame allocations
     - Optional dev perf overlay when the hash contains `perf`
     - Graceful CSS-gradient fallback when canvas is unavailable

   Part 3 additions (used by TM.AnalysisStory):
     - setScenario(seed, waypoints)  : regenerate series with waypoints
     - setDriftEnabled(bool)         : freeze drift while the story narrates
     - setDriftPeriod(ms)            : override the drift interval

   Part 7 changes (visual only):
     - Candle colors retuned to the "Ledger Terminal" palette:
         success  #7fb685  ->  rgba(127, 182, 133, 0.34)
         danger   #d4604f  ->  rgba(212, 96, 79, 0.34)
         grid     warm off-white hairline rgba(255, 244, 224, 0.06)
     - No logic, API, timings, or behavior changes.
   ============================================================================ */

(function () {
  'use strict';

  var TM = (window.TM = window.TM || {});
  var util = TM.util;

  /* ============================================================
     constants
     ============================================================ */

  var C_UP       = 'rgba(76, 180, 135, 0.34)';    /* --tm-success */
  var C_DOWN     = 'rgba(214, 91, 82, 0.34)';     /* --tm-danger  */
  var GRID_COLOR = 'rgba(255, 255, 255, 0.06)';   /* border-alpha */

  var Y_PAD      = 20;
  var PERIOD_MS  = 2200;              /* drift: one new candle every ~2.2s */
  var TARGET_FPS = 30;
  var FRAME_MIN  = 1000 / TARGET_FPS;

  var PERF_RE = /(?:^|[#&?])perf(?:$|[&=])/;

  /* ============================================================
     price series generator
     ============================================================

     generate(seed, opts) -> [{ o, h, l, c }]

     opts:
       count      : number of candles (default 120)
       waypoints  : [{ index, price }] — the path is nudged to pass through
                    these exact prices. Uses a quadratic bump kernel that
                    equals 0 outside its window, so non-overlapping waypoints
                    are matched EXACTLY at their index.
     ============================================================ */

  function bump(d, span) {
    if (d >= span) return 0;
    var x = d / span;
    return 1 - x * x;
  }

  function generate(seed, opts) {
    opts = opts || {};
    var count = opts.count || 120;
    var waypoints = opts.waypoints || [];

    var rng = util.mulberry32((seed >>> 0) ^ 0x9E3779B1);

    /* --- regimes: trend / chop / pullback --- */
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

    /* --- path (close prices) in abstract domain 0..100, soft-clamped 5..95 --- */
    var path = new Array(count);
    path[0] = 40 + rng() * 20;

    var vol = 1.4;                    /* volatility, random-walked (clustering) */
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

      /* volatility clustering with mild mean-reversion */
      vol = vol * 0.92 + (0.6 + rng() * 1.8) * 0.08;

      var drift = 0;
      if (reg.type === 'trend')              drift =  reg.dir * 0.40 * vol;
      else if (reg.type === 'pullback')      drift = -reg.dir * 0.28 * vol;

      var shock = (rng() - 0.5) * 2 * vol;
      var v = path[k - 1] + drift + shock;
      if (v < 5)  v = 5  + (5  - v) * 0.25;
      if (v > 95) v = 95 - (v - 95) * 0.25;
      path[k] = v;
    }

    /* --- waypoints: quadratic bump kernel, exact at waypoint index --- */
    for (var w = 0; w < waypoints.length; w++) {
      var wp = waypoints[w];
      if (!wp || wp.index < 0 || wp.index >= count) continue;
      var diff = wp.price - path[wp.index];
      var span = 8;
      for (var j = 0; j < count; j++) {
        var d = j > wp.index ? j - wp.index : wp.index - j;
        if (d > span) continue;
        path[j] += diff * bump(d, span);
      }
    }

    /* --- OHLC from path --- */
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

      /* clamp to 0..100 then re-enforce OHLC invariants */
      if (open  < 0) open  = 0; else if (open  > 100) open  = 100;
      if (close < 0) close = 0; else if (close > 100) close = 100;
      var top = open > close ? open : close;
      var bot = open < close ? open : close;
      if (hi < top) hi = top;
      if (hi > 100) hi = 100;
      if (lo > bot) lo = bot;
      if (lo < 0)   lo = 0;

      out[m] = { o: open, h: hi, l: lo, c: close };
    }

    return out;
  }

  /* ============================================================
     HeroChart
     ============================================================ */

  function HeroChart() {
    /* canvases */
    this.chartCanvas   = null;
    this.overlayCanvas = null;
    this.chartCtx      = null;
    this.overlayCtx    = null;

    /* series */
    this.seed          = 1;
    this.candleCount   = 120;
    this.candles       = [];

    /* geometry */
    this._candleWidth  = 8;
    this._scrollProgress = 0;
    this.scrollX       = 0;
    this._w = 1;
    this._h = 1;
    this._dpr = 1;
    this._gridLayer    = null;

    /* loop */
    this._mounted      = false;
    this.running       = false;
    this.rafId         = null;
    this._lastFrameTime = 0;
    this._intersecting = true;
    this._reduced      = false;

    /* Part 3 */
    this._driftEnabled = true;
    this._driftPeriod  = PERIOD_MS;

    /* perf overlay */
    this._perfEl       = null;
    this._perfUpdate   = 0;
    this._perfSamples  = [];

    /* callbacks / observers */
    this._frameCbs       = [];
    this._resizeObserver = null;
    this._io             = null;
    this._driftRng       = null;
    this._failed         = false;
    this._onWinResize    = null;
  }

  /* --- static --- */
  HeroChart.generate = generate;

  /* ============================================================
     mount
     ============================================================ */

  HeroChart.prototype.mount = function (chartCanvas, overlayCanvas, opts) {
    if (!chartCanvas || !overlayCanvas) return;

    this.chartCanvas = chartCanvas;
    this.overlayCanvas = overlayCanvas;

    /* Part 6: canvas availability check */
    if (typeof chartCanvas.getContext !== 'function') {
      this._failed = true;
      this._applyFallback();
      return;
    }
    this.chartCtx = chartCanvas.getContext('2d');
    this.overlayCtx = overlayCanvas.getContext('2d');
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

    this._maybePerfEl();
    this._attachObservers();
    this._resize();
    this._mounted = true;
  };

  HeroChart.prototype._pickCandleCount = function () {
    var w = this.chartCanvas.parentElement
      ? this.chartCanvas.parentElement.clientWidth
      : 1024;
    return w < 700 ? 70 : 120;
  };

  HeroChart.prototype._applyFallback = function () {
    var p = this.chartCanvas && this.chartCanvas.parentElement;
    if (!p) return;
    p.classList.add('tm-hero__stage--fallback');
    p.style.background = 'var(--tm-surface)';
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

    var rect = parent.getBoundingClientRect();
    var w = Math.max(1, Math.round(rect.width));
    var h = Math.max(1, Math.round(rect.height));
    var dpr = Math.min(2, window.devicePixelRatio || 1);

    this._w = w;
    this._h = h;
    this._dpr = dpr;

    var canvases = [this.chartCanvas, this.overlayCanvas];
    for (var i = 0; i < canvases.length; i++) {
      var c = canvases[i];
      c.width  = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      c.style.width  = w + 'px';
      c.style.height = h + 'px';
    }
    this.chartCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.overlayCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.overlayCtx.clearRect(0, 0, w, h);   /* overlay stays empty here */

    /* candle count is width-class based */
    var target = this._pickCandleCount();
    if (target !== this.candleCount) {
      this.candleCount = target;
      this.candles = generate(this.seed, { count: target });
      this._driftRng = util.mulberry32((this.seed ^ 0xDEADBEEF) >>> 0);
      this._scrollProgress = 0;
      this.scrollX = 0;
    }
    this._candleWidth = w / Math.max(20, this.candleCount - 1);

    this._renderGrid();

    /* always ensure something is on screen */
    if (!this.running || this._reduced) this._drawFrame(performance.now(), 0);
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

    ctx.strokeStyle = GRID_COLOR;
    ctx.lineWidth = 1;
    var plotH = h - Y_PAD * 2;
    for (var i = 0; i < 5; i++) {
      var y = Y_PAD + (i / 4) * plotH;
      ctx.beginPath();
      ctx.moveTo(0, Math.round(y) + 0.5);
      ctx.lineTo(w, Math.round(y) + 0.5);
      ctx.stroke();
    }

    this._gridLayer = layer;
  };

  /* ============================================================
     drift (shift series left, append a new candle)
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

    arr.push({ o: open, h: hi, l: lo, c: close });
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
    this.scrollX = -cw * util.easeInOutQuad(this._scrollProgress);
  };

  /* ============================================================
     drawing
     ============================================================ */

  HeroChart.prototype._drawFrame = function (now) {
    var ctx = this.chartCtx;
    if (!ctx) return;

    var w = this._w;
    var h = this._h;
    var plotH = h - Y_PAD * 2;
    var baseY = Y_PAD + plotH;
    var cw = this._candleWidth;
    var bodyW = Math.max(1, cw - Math.max(1, cw * 0.22));
    var halfBody = bodyW * 0.5;

    ctx.clearRect(0, 0, w, h);
    if (this._gridLayer) ctx.drawImage(this._gridLayer, 0, 0, w, h);

    var n = this.candles.length;
    var last = n - 1;
    var tick = Math.sin(now / 700) * 0.6;   /* gentle jitter on the live candle */

    ctx.lineWidth = 1;

    for (var i = 0; i < n; i++) {
      var c = this.candles[i];
      var x = i * cw + this.scrollX + cw * 0.5;
      if (x < -cw || x > w + cw) continue;

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
      ctx.strokeStyle = col;
      ctx.fillStyle   = col;

      var yO = baseY - (o  / 100) * plotH;
      var yC = baseY - (cc / 100) * plotH;
      var yH = baseY - (hh / 100) * plotH;
      var yL = baseY - (ll / 100) * plotH;

      /* wick */
      var wx = Math.round(x) + 0.5;
      ctx.beginPath();
      ctx.moveTo(wx, yH);
      ctx.lineTo(wx, yL);
      ctx.stroke();

      /* body */
      var by = yO < yC ? yO : yC;
      var bh = (yO < yC ? yC - yO : yO - yC);
      if (bh < 1) bh = 1;
      ctx.fillRect(x - halfBody, by, bodyW, bh);
    }
  };

  /* ============================================================
     frame callbacks + perf overlay
     ============================================================ */

  HeroChart.prototype._emitFrame = function (now, dt) {
    if (this._perfEl) {
      this._perfSamples.push(dt);
      if (this._perfSamples.length > 30) this._perfSamples.shift();
      if (now - this._perfUpdate > 250 && this._perfSamples.length) {
        var sum = 0;
        for (var s = 0; s < this._perfSamples.length; s++) sum += this._perfSamples[s];
        var avg = sum / this._perfSamples.length;
        this._perfEl.textContent =
          'fps ' + Math.round(1000 / avg) + ' | ' + avg.toFixed(1) + 'ms';
        this._perfUpdate = now;
      }
    }

    var cbs = this._frameCbs;
    for (var i = 0; i < cbs.length; i++) cbs[i](now, dt);
  };

  HeroChart.prototype._maybePerfEl = function () {
    if (this._perfEl) return;
    if (!PERF_RE.test(window.location.hash)) return;

    var el = document.createElement('div');
    el.className = 'tm-perf';
    el.textContent = 'perf…';
    document.body.appendChild(el);
    this._perfEl = el;
  };

  /* ============================================================
     loop
     ============================================================ */

  HeroChart.prototype.start = function () {
    if (!this._mounted || this.running) return;
    this.running = true;

    if (this._reduced) {
      /* one static frame, no loop, no drift */
      this._drawFrame(performance.now(), 0);
      return;
    }

    this._lastFrameTime = performance.now();
    this._perfSamples = [];
    var self = this;

    function loop(now) {
      if (!self.running) return;

      /* pause while offscreen or tab hidden — do not burn frames */
      if (!self._intersecting || document.hidden) {
        self._lastFrameTime = now;
        self.rafId = requestAnimationFrame(loop);
        return;
      }

      var dt = now - self._lastFrameTime;
      if (dt < FRAME_MIN - 1) {   /* 30fps cap with small tolerance */
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
    if (this._perfEl && this._perfEl.parentNode) {
      this._perfEl.parentNode.removeChild(this._perfEl);
    }
    this._perfEl = null;
    this._frameCbs = [];
    this._mounted = false;
  };

  /* ============================================================
     public helpers
     ============================================================ */

  HeroChart.prototype.setSeed = function (seed) {
    this.seed = seed >>> 0;
    this.candles = generate(this.seed, { count: this.candleCount });
    this._driftRng = util.mulberry32((this.seed ^ 0xDEADBEEF) >>> 0);
    this._scrollProgress = 0;
    this.scrollX = 0;
    if (!this.running || this._reduced) this._drawFrame(performance.now(), 0);
  };

  /* Part 3: regenerate the whole series around a set of waypoints.
     Used by TM.AnalysisStory so the price path visually passes through the
     level / target / invalidation prices at the right candle indices. */
  HeroChart.prototype.setScenario = function (seed, waypoints) {
    this.seed = (seed >>> 0);
    this.candles = generate(this.seed, {
      count: this.candleCount,
      waypoints: waypoints || []
    });
    this._driftRng = util.mulberry32((this.seed ^ 0xDEADBEEF) >>> 0);
    this._scrollProgress = 0;
    this.scrollX = 0;
    if (!this.running || this._reduced) this._drawFrame(performance.now(), 0);
  };

  /* Part 3: freeze drift so annotation indices stay aligned to candles. */
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

  HeroChart.prototype.priceToY = function (p) {
    var plotH = this._h - Y_PAD * 2;
    return Y_PAD + (1 - p / 100) * plotH;
  };

  HeroChart.prototype.indexToX = function (i) {
    return i * this._candleWidth + this.scrollX + this._candleWidth * 0.5;
  };

  HeroChart.prototype.visibleRange = function () {
    var n = this.candles.length;
    var cw = this._candleWidth;
    var from = Math.max(0, Math.floor((-this.scrollX) / cw));
    var to   = Math.min(n - 1, Math.ceil((this._w - this.scrollX) / cw));
    return { from: from, to: to };
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