/* ============================================================================
   TradeMark — Analysis Story ("Ledger Terminal")
   ----------------------------------------------------------------------------
   Draws the product's core narrative on the overlay canvas:
     ANALYSIS  ->  LOCK  ->  WAIT  ->  RESOLVE
   Three scenarios rotate in order:
     A) bearish, resistance rejection -> target hit -> CORRECT
     B) bullish, support break -> invalidation hit first -> WRONG
     C) bearish, reaches ~halfway to target then stalls -> PARTIAL

   Timeline is a deterministic state machine advanced by accumulated dt
   (not setTimeout), pausable:
     0 drift          (1.2s)
     1 key level line (0.8s)
     2 price reaction (3.0s)
     3 pin card       (0.6s)
     4 target/invalid (0.8s)
     5 LOCK badge     (0.7s)
     6 WAIT label     (2.5s)
     7 RESOLVE stamp  (0.9s)
     8 hold           (2.5s)
     9 fade           (0.6s)
   Whole loop ~14-16s.

   Part 7 changes:
     - readTokens reads --tm-font-display and updates all fallback colors
       to the "Ledger Terminal" palette (warm black, amber accent).
     - fonts: all stamps now use mono (rubber-stamp look).
     - annotationZone is now just the frame interior with a small pad —
       no more desktop/mobile branching, because the canvas lives inside
       its own terminal frame.
     - LOCK and OUTCOME draw a short press animation: 1.08 -> 1.0 scale
       over ~160ms (transform only). Disabled under reduced motion by the
       global CSS rule (no JS change needed).

   Exports pure helpers for tests:
     TM.AnalysisStory.SCENARIOS
     TM.AnalysisStory.PHASE_MS
     TM.AnalysisStory.advance(state, dt)
     TM.AnalysisStory.flipLabel(anchorX, textW, zone)
     TM.AnalysisStory.lockedText(date)
     TM.AnalysisStory.annotationZone(w, h)
   ============================================================================ */

(function () {
  'use strict';

  var TM = (window.TM = window.TM || {});
  var util = TM.util;

  /* ============================================================
     constants
     ============================================================ */

  var PIN_INDEX = 60;
  var PAD       = 6;

  var PHASE_MS = [1200, 800, 3000, 600, 800, 700, 2500, 900, 2500, 600];
  /*   phase 0  drift
       phase 1  key level line
       phase 2  price reaction
       phase 3  pin card
       phase 4  target + invalidation lines
       phase 5  LOCK badge
       phase 6  WAIT label
       phase 7  RESOLVE stamp
       phase 8  hold
       phase 9  fade */

  /* ============================================================
     scenarios
     ============================================================ */

  var SCENARIOS = [
    {
      id: 'A', seed: 0xA001, primaryAsset: 'BTC',
      direction: 'bearish', arrow: '\u25BC',
      timeframe: '4H', confidence: 78,
      outcome: 'CORRECT', tone: 'success', touchedFirst: 'target',
      levelLabel: 'RESISTANCE',
      levels: {
        key:          { price: 72, label: '81.8K' },
        target:       { price: 42, label: '80.2K' },
        invalidation: { price: 80, label: '82.4K' }
      },
      pin: { index: PIN_INDEX, price: 72 },
      hit: { index: 92, price: 42 },
      waypoints: [
        { index: 15,  price: 48 },
        { index: 35,  price: 58 },
        { index: 48,  price: 70 },
        { index: 60,  price: 72 },
        { index: 80,  price: 55 },
        { index: 92,  price: 42 },
        { index: 119, price: 46 }
      ]
    },
    {
      id: 'B', seed: 0xB002, primaryAsset: 'BTC',
      direction: 'bullish', arrow: '\u25B2',
      timeframe: '4H', confidence: 71,
      outcome: 'WRONG', tone: 'danger', touchedFirst: 'invalidation',
      levelLabel: 'SUPPORT',
      levels: {
        key:          { price: 38, label: '67.2K' },
        target:       { price: 68, label: '69.1K' },
        invalidation: { price: 28, label: '66.4K' }
      },
      pin: { index: PIN_INDEX, price: 38 },
      hit: { index: 88, price: 28 },
      waypoints: [
        { index: 15,  price: 52 },
        { index: 35,  price: 42 },
        { index: 48,  price: 38 },
        { index: 60,  price: 38 },
        { index: 72,  price: 32 },
        { index: 88,  price: 28 },
        { index: 119, price: 26 }
      ]
    },
    {
      id: 'C', seed: 0xC003, primaryAsset: 'BTC',
      direction: 'bearish', arrow: '\u25BC',
      timeframe: '1D', confidence: 66,
      outcome: 'PARTIAL', tone: 'warning', touchedFirst: 'neither',
      levelLabel: 'RESISTANCE',
      levels: {
        key:          { price: 70, label: '88.4K' },
        target:       { price: 40, label: '85.2K' },
        invalidation: { price: 78, label: '89.1K' }
      },
      pin: { index: PIN_INDEX, price: 70 },
      hit: { index: 92, price: 55 },
      waypoints: [
        { index: 15,  price: 48 },
        { index: 35,  price: 60 },
        { index: 48,  price: 68 },
        { index: 60,  price: 70 },
        { index: 75,  price: 63 },
        { index: 90,  price: 56 },
        { index: 105, price: 55 },
        { index: 119, price: 55 }
      ]
    }
  ];

  /* ============================================================
     pure helpers (all testable without a canvas)
     ============================================================ */

  /* advance(state, dt) -> newState
     state: { phase, phaseTime, scenarioIndex }
     Walks through PHASE_MS boundaries; rolls to the next scenario when
     the last phase completes. Bounded loop guard for very large dt. */
  function advance(state, dt) {
    var out = {
      phase: state.phase,
      phaseTime: state.phaseTime + dt,
      scenarioIndex: state.scenarioIndex,
      scenarioAdvanced: false
    };
    var guard = 0;
    while (out.phaseTime >= PHASE_MS[out.phase] && guard++ < 1000) {
      out.phaseTime -= PHASE_MS[out.phase];
      out.phase++;
      if (out.phase >= PHASE_MS.length) {
        out.phase = 0;
        out.scenarioIndex = (out.scenarioIndex + 1) % SCENARIOS.length;
        out.scenarioAdvanced = true;
      }
    }
    return out;
  }

  /* flipLabel: if drawing to the right of `anchorX` would overflow the
     annotation zone, draw to the left instead. Returns {x, align}. */
  function flipLabel(anchorX, textW, zone) {
    if (anchorX + PAD + textW > zone.x1) {
      return { x: anchorX - PAD - textW, align: 'right' };
    }
    return { x: anchorX + PAD, align: 'left' };
  }

  /* "LOCKED hh:mm" using the user's current local time. */
  function lockedText(date) {
    return 'LOCKED ' + util.formatTime(date);
  }

  /* Part 7: the canvas lives inside the terminal frame, so the annotation
     zone is simply the frame interior with a small pad. No desktop/mobile
     branching — the frame is always clear of the H1. */
  function annotationZone(w, h) {
    var pad = w < 720 ? 14 : 20;
    return {
      x0: pad,
      y0: pad,
      x1: w - pad,
      y1: h - pad
    };
  }

  /* ============================================================
     token reader — read once at mount
     ============================================================ */

  function readTokens() {
    var cs = getComputedStyle(document.documentElement);
    function v(name, fallback) {
      var val = cs.getPropertyValue(name).trim();
      return val || fallback;
    }
    return {
      text:        v('--tm-text',          '#e9eaec'),
      muted:       v('--tm-text-muted',    '#8e939c'),
      faint:       v('--tm-text-faint',    '#7d828b'),
      accent:      v('--tm-accent',        '#e9eaec'),
      success:     v('--tm-success',       '#4cb487'),
      danger:      v('--tm-danger',        '#d65b52'),
      warning:     v('--tm-warning',       '#9aa3b0'),
      neutral:     v('--tm-neutral',       '#8e939c'),
      surface:     v('--tm-surface',       '#111316'),
      bg:          v('--tm-bg',            '#0d0e10'),
      border:      v('--tm-border',        'rgba(255,255,255,0.09)'),
      fontSans:    v('--tm-font-sans',     'Inter, system-ui, sans-serif'),
      fontMono:    v('--tm-font-mono',     'Inter, system-ui, sans-serif'),
      fontDisplay: v('--tm-font-display',  '"Instrument Serif", Georgia, serif')
    };
  }

  /* ============================================================
     drawing primitives
     ============================================================ */

  /* roundRect fallback for browsers that lack ctx.roundRect */
  function roundRect(ctx, x, y, w, h, r) {
    if (ctx.roundRect) {
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, r);
      return;
    }
    var rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
    ctx.closePath();
  }

  /* subtle backing pill so any label stays legible over the chart */
  function pill(ctx, x, y, w, h, fillColor) {
    roundRect(ctx, x, y, w, h, 4);
    ctx.fillStyle = fillColor;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,244,224,0.10)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  /* ============================================================
     AnalysisStory
     ============================================================ */

  function AnalysisStory() {
    this.chart = null;
    this.canvas = null;
    this.ctx = null;
    this.container = null;

    this.pauseBtn = null;
    this.pauseIcons = null;

    this.tokens = null;
    this.fonts = null;

    this.phase = 0;
    this.phaseTime = 0;
    this.scenarioIndex = 0;
    this.scenario = SCENARIOS[0];

    this.paused = false;
    this.running = false;
    this.reduced = util.prefersReducedMotion();

    this._offFrame = null;
    this._resizeObs = null;
    this._w = 0;
    this._h = 0;

    /* bound handlers */
    this._onFrame      = this._onFrame.bind(this);
    this._resize       = this._resize.bind(this);
    this._onPauseClick = this._onPauseClick.bind(this);
  }

  /* ------------------------------------------------------------
     mount / start / stop / destroy
     ------------------------------------------------------------ */

  AnalysisStory.prototype.mount = function (chart, overlayCanvas, container) {
    this.chart = chart;
    this.canvas = overlayCanvas;
    this.ctx = overlayCanvas && overlayCanvas.getContext
      ? overlayCanvas.getContext('2d')
      : null;
    this.container = container;

    this.tokens = readTokens();

    /* Part 7: all stamps use mono — rubber-stamp look. */
    this.fonts = {
      small: '11px '     + this.tokens.fontMono,
      stamp: '500 15px ' + this.tokens.fontMono,
      mono:  '10px '     + this.tokens.fontMono
    };

    /* pause button */
    this.pauseBtn = container.querySelector('.tm-story__pause');
    if (this.pauseBtn) {
      this.pauseIcons = {
        pause: this.pauseBtn.querySelector('.tm-story__icon--pause'),
        play:  this.pauseBtn.querySelector('.tm-story__icon--play')
      };
      this.pauseBtn.addEventListener('click', this._onPauseClick);
      if (this.reduced) this.pauseBtn.hidden = true;
    }

    if (!this.ctx) return;

    this._resize();

    if (typeof ResizeObserver !== 'undefined') {
      this._resizeObs = new ResizeObserver(this._resize);
      this._resizeObs.observe(overlayCanvas.parentElement);
    } else {
      window.addEventListener('resize', this._resize);
    }
  };

  AnalysisStory.prototype._resize = function () {
    if (!this.canvas) return;
    var parent = this.canvas.parentElement;
    if (!parent) return;
    var rect = parent.getBoundingClientRect();
    this._w = Math.max(1, Math.round(rect.width));
    this._h = Math.max(1, Math.round(rect.height));
    if (this.reduced) this._renderStatic();
  };

  AnalysisStory.prototype.start = function () {
    if (this.running) return;
    this.running = true;
    this._enterScenario(this.scenarioIndex);

    if (this.reduced) {
      this._renderStatic();
      return;
    }
    this._offFrame = this.chart.onFrame(this._onFrame);
  };

  AnalysisStory.prototype.stop = function () {
    this.running = false;
    if (this._offFrame) {
      this._offFrame();
      this._offFrame = null;
    }
  };

  AnalysisStory.prototype.destroy = function () {
    this.stop();
    if (this._resizeObs) {
      this._resizeObs.disconnect();
      this._resizeObs = null;
    }
    if (this.pauseBtn) {
      this.pauseBtn.removeEventListener('click', this._onPauseClick);
    }
  };

  /* ------------------------------------------------------------
     scenario rotation
     ------------------------------------------------------------ */

  AnalysisStory.prototype._enterScenario = function (idx) {
    this.scenarioIndex = idx % SCENARIOS.length;
    this.scenario = SCENARIOS[this.scenarioIndex];
    this.phase = 0;
    this.phaseTime = 0;
    if (this.chart && this.chart.setScenario) {
      this.chart.setScenario(this.scenario.seed, this.scenario.waypoints);
    }
  };

  /* ------------------------------------------------------------
     pause control
     ------------------------------------------------------------ */

  AnalysisStory.prototype._onPauseClick = function () {
    this.paused = !this.paused;
    this.pauseBtn.setAttribute('aria-pressed', this.paused ? 'true' : 'false');
    if (this.pauseIcons) {
      this.pauseIcons.pause.hidden = this.paused;
      this.pauseIcons.play.hidden  = !this.paused;
    }
    if (this.paused) this.chart.stop();
    else             this.chart.start();
  };

  /* ------------------------------------------------------------
     frame driver
     ------------------------------------------------------------ */

  AnalysisStory.prototype._onFrame = function (now, dt) {
    if (!this.ctx || this._w <= 0) return;

    var state = advance({
      phase: this.phase,
      phaseTime: this.phaseTime,
      scenarioIndex: this.scenarioIndex
    }, dt);

    this.phase = state.phase;
    this.phaseTime = state.phaseTime;

    if (state.scenarioAdvanced) this._enterScenario(state.scenarioIndex);

    this._drawFrame(now);
  };

  /* ------------------------------------------------------------
     main render
     ------------------------------------------------------------ */

  AnalysisStory.prototype._drawFrame = function (now) {
    var ctx = this.ctx;
    var w = this._w;
    var h = this._h;
    ctx.clearRect(0, 0, w, h);

    var sc = this.scenario;
    var zone = annotationZone(w, h);
    var p = this.phaseTime / PHASE_MS[this.phase];

    var alpha = 1;
    if (this.phase === 9) alpha = 1 - p;   /* fade out */

    ctx.save();
    ctx.globalAlpha = alpha;

    if (this.phase >= 1) {
      this._drawLevel(ctx, zone, sc, this.phase === 1 ? p : 1);
    }
    if (this.phase >= 3) {
      this._drawPin(ctx, zone, sc, this.phase === 3 ? p : 1);
    }
    if (this.phase >= 4) {
      this._drawBounds(ctx, zone, sc, this.phase === 4 ? p : 1);
    }
    if (this.phase >= 5) {
      this._drawLock(ctx, zone, this.phase === 5 ? p : 1);
    }
    if (this.phase === 6) {
      this._drawTimePasses(ctx, zone, p);
    }
    if (this.phase >= 7) {
      this._drawOutcome(ctx, zone, sc, this.phase === 7 ? p : 1);
    }

    ctx.restore();
  };

  /* One-shot static render for reduced motion: scenario A, all annotations. */
  AnalysisStory.prototype._renderStatic = function () {
    if (!this.ctx || this._w <= 0) return;
    var ctx = this.ctx;
    ctx.clearRect(0, 0, this._w, this._h);

    var sc = SCENARIOS[0];
    var zone = annotationZone(this._w, this._h);

    this._drawLevel(ctx, zone, sc, 1);
    this._drawPin(ctx, zone, sc, 1);
    this._drawBounds(ctx, zone, sc, 1);
    this._drawLock(ctx, zone, 1);
    this._drawOutcome(ctx, zone, sc, 1);
  };

  /* ------------------------------------------------------------
     label helper
     ------------------------------------------------------------ */

  AnalysisStory.prototype._drawLabel = function (ctx, zone, anchorX, y, text, color) {
    ctx.font = this.fonts.small;
    var m = ctx.measureText(text);
    var padX = 6;
    var boxW = m.width + padX * 2;
    var boxH = 18;

    var pos = flipLabel(anchorX, boxW, zone);
    var lx = pos.x;
    var ly = y - boxH / 2;
    if (ly < zone.y0) ly = zone.y0;
    if (ly + boxH > zone.y1) ly = zone.y1 - boxH;

    pill(ctx, lx, ly, boxW, boxH, this.tokens.surface);
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, lx + padX, ly + boxH / 2);
  };

  /* ------------------------------------------------------------
     phase drawings
     ------------------------------------------------------------ */

  AnalysisStory.prototype._drawLevel = function (ctx, zone, sc, p) {
    var y = this.chart.priceToY(sc.levels.key.price);
    var x0 = zone.x0;
    var x1 = zone.x1;
    var xEnd = x0 + (x1 - x0) * p;

    ctx.strokeStyle = this.tokens.accent;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(xEnd, y);
    ctx.stroke();

    if (p >= 1) {
      this._drawLabel(
        ctx, zone, x1, y,
        sc.levelLabel + ' ' + sc.levels.key.label,
        this.tokens.accent
      );
    }
  };

  AnalysisStory.prototype._drawPin = function (ctx, zone, sc, p) {
    var pinX = this.chart.indexToX(sc.pin.index);
    var pinY = this.chart.priceToY(sc.pin.price);

    ctx.globalAlpha *= p;

    /* dot on the pin candle */
    ctx.beginPath();
    ctx.arc(pinX, pinY, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = this.tokens.accent;
    ctx.fill();

    /* card */
    var text = sc.primaryAsset + '  ' + sc.arrow + '  ' + sc.timeframe +
               '  \u00B7  ' + sc.confidence + '%';
    ctx.font = this.fonts.small;
    var m = ctx.measureText(text);
    var padX = 8;
    var padY = 5;
    var cardW = m.width + padX * 2;
    var cardH = 20 + padY * 2;

    var tx = pinX + 12;
    var ty = pinY - cardH - 10;
    tx = util.clamp(tx, zone.x0, zone.x1 - cardW);
    ty = util.clamp(ty, zone.y0, zone.y1 - cardH);

    /* slide-in from the right */
    var slideX = (1 - p) * 60;

    pill(ctx, tx + slideX, ty, cardW, cardH, this.tokens.surface);

    ctx.fillStyle = this.tokens.text;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, tx + slideX + padX, ty + cardH / 2);

    /* thin connector from pin dot to card */
    ctx.strokeStyle = this.tokens.border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pinX, pinY - 2);
    ctx.lineTo(tx + 10, ty + cardH);
    ctx.stroke();

    ctx.globalAlpha /= p;
  };

  AnalysisStory.prototype._drawBounds = function (ctx, zone, sc, p) {
    var tY = this.chart.priceToY(sc.levels.target.price);
    var iY = this.chart.priceToY(sc.levels.invalidation.price);
    var x0 = zone.x0 + (zone.x1 - zone.x0) * 0.25;
    var x1 = zone.x1;
    var xEnd = x0 + (x1 - x0) * p;

    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1.3;

    ctx.strokeStyle = this.tokens.success;
    ctx.beginPath();
    ctx.moveTo(x0, tY);
    ctx.lineTo(xEnd, tY);
    ctx.stroke();

    ctx.strokeStyle = this.tokens.danger;
    ctx.beginPath();
    ctx.moveTo(x0, iY);
    ctx.lineTo(xEnd, iY);
    ctx.stroke();
    ctx.restore();

    if (p >= 1) {
      this._drawLabel(
        ctx, zone, x1, tY,
        'TARGET ' + sc.levels.target.label,
        this.tokens.success
      );
      this._drawLabel(
        ctx, zone, x1, iY,
        'INVALID ' + sc.levels.invalidation.label,
        this.tokens.danger
      );
    }
  };

  /* LOCK badge — Part 7: added a short press animation (1.08 -> 1.0
     over ~160ms) when the badge first appears. Transform only. */
  AnalysisStory.prototype._drawLock = function (ctx, zone, p) {
    var text = lockedText(new Date());

    ctx.globalAlpha *= p;

    /* PHASE_MS[5] = 700ms. Press lasts ~160ms: factor = 700/160 ≈ 4.4 */
    var press = Math.min(1, p * 4.4);
    var scale = 1.08 - 0.08 * util.easeOutQuad(press);

    ctx.font = this.fonts.small;
    var m = ctx.measureText(text);
    var padX = 8;
    var iconW = 14;
    var boxW = m.width + padX * 2 + iconW;
    var boxH = 22;

    var lx = zone.x0 + 4;
    var ly = zone.y0 + 4;
    if (lx + boxW > zone.x1) lx = zone.x1 - boxW;

    /* Scale around the badge center */
    var cx = lx + boxW / 2;
    var cy = ly + boxH / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    ctx.translate(-cx, -cy);

    pill(ctx, lx, ly, boxW, boxH, this.tokens.surface);

    /* tiny lock glyph drawn with paths (no image assets) */
    var icx = lx + padX + 5;
    var icy = ly + boxH / 2;
    ctx.strokeStyle = this.tokens.text;
    ctx.fillStyle = this.tokens.text;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(icx - 2.5, icy + 1);
    ctx.lineTo(icx - 2.5, icy - 2);
    ctx.arc(icx, icy - 2, 2.5, Math.PI, 0, false);
    ctx.lineTo(icx + 2.5, icy + 1);
    ctx.stroke();
    ctx.fillRect(icx - 4, icy + 1, 8, 6);

    ctx.fillStyle = this.tokens.text;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, lx + padX + iconW, ly + boxH / 2);

    ctx.restore();
    ctx.globalAlpha /= p;
  };

  AnalysisStory.prototype._drawTimePasses = function (ctx, zone, p) {
    var a = Math.sin(p * Math.PI);   /* fade in + out */
    ctx.globalAlpha *= a;

    ctx.font = this.fonts.mono;
    ctx.fillStyle = this.tokens.muted;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    var cx = (zone.x0 + zone.x1) / 2;
    ctx.fillText('T I M E   P A S S E S', cx, zone.y0 + 14);

    ctx.globalAlpha /= a;
  };

  /* OUTCOME stamp — Part 7: the scale is now a short press
     (1.08 -> 1.0 over ~160ms) instead of the old grow-in. */
  AnalysisStory.prototype._drawOutcome = function (ctx, zone, sc, p) {
    var hitX = this.chart.indexToX(sc.hit.index);
    var hitY = this.chart.priceToY(sc.hit.price);

    var tone = sc.tone === 'success' ? this.tokens.success
             : sc.tone === 'danger'  ? this.tokens.danger
             : this.tokens.warning;

    /* hit marker: expanding ring on the touched level */
    ctx.strokeStyle = tone;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(hitX, hitY, 3 + 4 * p, 0, Math.PI * 2);
    ctx.stroke();

    /* outcome stamp: rotated rounded rectangle with a press */
    ctx.font = this.fonts.stamp;
    var m = ctx.measureText(sc.outcome);
    var cw = m.width + 28;
    var ch = 30;
    var cx = (zone.x0 + zone.x1) / 2;
    var cy = zone.y1 - 26;

    ctx.globalAlpha *= p;

    /* PHASE_MS[7] = 900ms. Press lasts ~160ms: factor = 900/160 ≈ 5.6 */
    var press = Math.min(1, p * 5.6);
    var s = 1.08 - 0.08 * util.easeOutQuad(press);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-0.06);
    ctx.scale(s, s);

    roundRect(ctx, -cw / 2, -ch / 2, cw, ch, 6);
    ctx.fillStyle = this.tokens.bg;
    ctx.fill();
    ctx.strokeStyle = tone;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = tone;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(sc.outcome, 0, 1);
    ctx.restore();

    ctx.globalAlpha /= p;
  };

  /* ============================================================
     exports
     ============================================================ */

  TM.AnalysisStory = AnalysisStory;

  /* pure helpers for tests */
  TM.AnalysisStory.SCENARIOS      = SCENARIOS;
  TM.AnalysisStory.PHASE_MS       = PHASE_MS;
  TM.AnalysisStory.advance        = advance;
  TM.AnalysisStory.flipLabel      = flipLabel;
  TM.AnalysisStory.lockedText     = lockedText;
  TM.AnalysisStory.annotationZone = annotationZone;
})();