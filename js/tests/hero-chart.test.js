/* ============================================================================
   TradeMark — Hero Chart tests
   ----------------------------------------------------------------------------
   Zero-dependency tests for TM.HeroChart.generate (the pure series generator).
   No canvas is touched here — everything is pure data.

   Coverage:
     - Same seed -> identical series (deep equality on OHLC)
     - Different seeds diverge
     - OHLC invariants: h >= max(o,c), l <= min(o,c), all in [0, 100]
     - Waypoints respected exactly at their index (non-overlapping)
     - Waypoint determinism across runs
     - Out-of-range waypoint indices are silently ignored
     - Candle count is honoured
     - Empty/short series still produce valid output
   ============================================================================ */

(function () {
  'use strict';

  var TM = window.TM;
  var test = TM.tests.test;
  var generate = TM.HeroChart.generate;

  function T(name, fn) {
    test(name, function (helpers) {
      fn(helpers.eq, helpers.ok);
    });
  }

  /* ============================================================
     determinism
     ============================================================ */

  T('generate: same seed -> identical series (deep)', function (eq) {
    var a = generate(42, { count: 120 });
    var b = generate(42, { count: 120 });
    eq(a.length, b.length);
    for (var i = 0; i < a.length; i++) {
      eq(a[i].o, b[i].o);
      eq(a[i].h, b[i].h);
      eq(a[i].l, b[i].l);
      eq(a[i].c, b[i].c);
    }
  });

  T('generate: different seed -> different series', function (ok) {
    var a = generate(1, { count: 60 });
    var b = generate(2, { count: 60 });
    var diff = 0;
    for (var i = 0; i < a.length; i++) {
      if (a[i].c !== b[i].c) diff++;
    }
    ok(diff > 30, 'seeds should diverge on most candles, diverged on ' + diff);
  });

  T('generate: same seed produces same series twice in a row', function (eq) {
    var a = generate(7, { count: 40 });
    var b = generate(7, { count: 40 });
    eq(a[0].c, b[0].c);
    eq(a[39].c, b[39].c);
    eq(a[20].h, b[20].h);
  });

  /* ============================================================
     constants
     ============================================================ */

  var C_UP       = 'rgba(127, 182, 133, 0.34)';   /* success green — muted */
  var C_DOWN     = 'rgba(212, 96, 79, 0.34)';     /* danger red  — muted */
  var GRID_COLOR = 'rgba(255, 244, 224, 0.06)';   /* hairline */

  /* ============================================================
     OHLC invariants
     ============================================================ */

  T('generate: OHLC invariants hold on every candle', function (ok) {
    var a = generate(7, { count: 200 });
    for (var i = 0; i < a.length; i++) {
      var c = a[i];
      if (!(c.h >= Math.max(c.o, c.c))) {
        throw new Error('h < max(o,c) at ' + i);
      }
      if (!(c.l <= Math.min(c.o, c.c))) {
        throw new Error('l > min(o,c) at ' + i);
      }
      if (!(c.o >= 0 && c.o <= 100 &&
            c.c >= 0 && c.c <= 100 &&
            c.h >= 0 && c.h <= 100 &&
            c.l >= 0 && c.l <= 100)) {
        throw new Error('out of 0-100 at ' + i);
      }
    }
    ok(true);
  });

  T('generate: many seeds keep OHLC invariants', function (ok) {
    for (var s = 1; s <= 20; s++) {
      var a = generate(s * 13, { count: 80 });
      for (var i = 0; i < a.length; i++) {
        var c = a[i];
        if (!(c.h >= Math.max(c.o, c.c) && c.l <= Math.min(c.o, c.c))) {
          throw new Error('seed ' + s + ' broke invariants at index ' + i);
        }
      }
    }
    ok(true);
  });

  /* ============================================================
     waypoints
     ============================================================ */

  T('generate: waypoints respected exactly (non-overlapping)', function (eq) {
    var wps = [
      { index: 20,  price: 30 },
      { index: 60,  price: 70 },
      { index: 100, price: 20 }
    ];
    var a = generate(99, { count: 120, waypoints: wps });
    eq(Math.round(a[20].c  * 1e6) / 1e6, 30);
    eq(Math.round(a[60].c  * 1e6) / 1e6, 70);
    eq(Math.round(a[100].c * 1e6) / 1e6, 20);
  });

  T('generate: waypoints are deterministic across runs', function (eq) {
    var wps = [{ index: 30, price: 80 }];
    var a = generate(5, { count: 90, waypoints: wps });
    var b = generate(5, { count: 90, waypoints: wps });
    eq(a[30].c, b[30].c);
    eq(a[30].h, b[30].h);
    eq(a[30].l, b[30].l);
  });

  T('generate: single waypoint at index 0 works', function (eq) {
    var a = generate(3, { count: 30, waypoints: [{ index: 0, price: 55 }] });
    /* index 0's close is set by the bump kernel; equals price exactly */
    eq(Math.round(a[0].c * 1e6) / 1e6, 55);
  });

  T('generate: waypoint indices out of range are ignored silently', function (eq) {
    var a = generate(3, {
      count: 50,
      waypoints: [{ index: -1, price: 10 }, { index: 999, price: 90 }]
    });
    eq(a.length, 50);
  });

  T('generate: empty waypoints array is a no-op', function (eq) {
    var a = generate(11, { count: 40, waypoints: [] });
    var b = generate(11, { count: 40 });
    for (var i = 0; i < a.length; i++) eq(a[i].c, b[i].c);
  });

  T('generate: two waypoints close together (within span) still produce valid OHLC', function (ok) {
    /* span is 8; waypoints at 40 and 42 overlap — later one wins locally
       but OHLC invariants must still hold everywhere. */
    var wps = [
      { index: 40, price: 70 },
      { index: 42, price: 30 }
    ];
    var a = generate(2, { count: 100, waypoints: wps });
    for (var i = 0; i < a.length; i++) {
      var c = a[i];
      if (!(c.h >= Math.max(c.o, c.c) && c.l <= Math.min(c.o, c.c))) {
        throw new Error('overlapping waypoints broke invariants at ' + i);
      }
      if (c.o < 0 || c.o > 100 || c.c < 0 || c.c > 100 ||
          c.h < 0 || c.h > 100 || c.l < 0 || c.l > 100) {
        throw new Error('out of range at ' + i);
      }
    }
    ok(true);
  });

  /* ============================================================
     shape / count
     ============================================================ */

  T('generate: count is honoured for typical sizes', function (eq) {
    eq(generate(1, { count: 5 }).length,   5);
    eq(generate(1, { count: 70 }).length,  70);
    eq(generate(1, { count: 120 }).length, 120);
    eq(generate(1, { count: 200 }).length, 200);
  });

  T('generate: default count is 120 when opts omitted', function (eq) {
    eq(generate(1, {}).length, 120);
    eq(generate(1).length, 120);
  });

  T('generate: very short series (count=1) produces one valid candle', function (eq, ok) {
    var a = generate(9, { count: 1 });
    eq(a.length, 1);
    ok(a[0].h >= Math.max(a[0].o, a[0].c));
    ok(a[0].l <= Math.min(a[0].o, a[0].c));
  });

  T('generate: every candle is an object with o, h, l, c numbers', function (eq, ok) {
    var a = generate(21, { count: 30 });
    for (var i = 0; i < a.length; i++) {
      var c = a[i];
      ok(typeof c.o === 'number' && !isNaN(c.o), 'o is number at ' + i);
      ok(typeof c.h === 'number' && !isNaN(c.h), 'h is number at ' + i);
      ok(typeof c.l === 'number' && !isNaN(c.l), 'l is number at ' + i);
      ok(typeof c.c === 'number' && !isNaN(c.c), 'c is number at ' + i);
    }
    eq(true, true);
  });

  /* ============================================================
     structural identity of first candle
     ============================================================ */

  T('generate: candle[0] open is derived from candle[0] close (no previous candle)', function (ok) {
    /* The generator sets open[0] = close[0] - (rng() - 0.5) * 1.2,
       which is a small delta in the [-0.6, 0.6] range before clamping. */
    var a = generate(1234, { count: 5 });
    var delta = Math.abs(a[0].o - a[0].c);
    ok(delta <= 0.7, 'first candle open/close delta too large: ' + delta);
  });
})();