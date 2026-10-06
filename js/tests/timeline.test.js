/* ============================================================================
   Tamga — Timeline tests (R4)
   ============================================================================ */

(function () {
  'use strict';

  var TM = window.TM;
  var test = TM.tests.test;
  var T = TM.timeline;

  function t(name, fn) {
    test(name, function (h) { fn(h.eq, h.ok); });
  }

  function mk(id, num, createdDate, opts) {
    opts = opts || {};
    return {
      id: id, number: num,
      createdAt: TM.util.localIso(createdDate),
      primaryAsset: opts.asset || 'BTC',
      direction: opts.dir || 'bearish',
      timeframe: '4H',
      confidence: opts.conf || 70,
      expiresAt: opts.expiresAt ? TM.util.localIso(opts.expiresAt) : null,
      resolution: opts.resolution || null,
      text: 'test'
    };
  }

  var NOW = new Date(2026, 9, 5, 12, 0, 0);  /* Oct 5, noon */

  /* ---- status ---- */

  t('status: resolution outcome wins', function (eq) {
    var a = mk('a', 1, new Date(2026, 9, 4), {
      resolution: { outcome: 'correct', resolvedAt: TM.util.localIso(new Date(2026, 9, 4, 20, 0)) }
    });
    eq(T._statusOf(a, NOW), 'correct');
  });

  t('status: expiresAt == now -> expired', function (eq) {
    var a = mk('a', 1, new Date(2026, 9, 4), { expiresAt: NOW });
    eq(T._statusOf(a, NOW), 'expired');
  });

  t('status: null expiresAt -> open', function (eq) {
    var a = mk('a', 1, new Date(2026, 9, 5, 10, 0));
    eq(T._statusOf(a, NOW), 'open');
  });

  t('status: future expiresAt -> open', function (eq) {
    var a = mk('a', 1, new Date(2026, 9, 5, 10, 0),
      { expiresAt: new Date(2026, 9, 6, 10, 0) });
    eq(T._statusOf(a, NOW), 'open');
  });

  /* ---- layout: lane order ---- */

  t('layout: lane 0 is newest', function (eq) {
    var arr = [
      mk('a1', 1, new Date(2026, 9, 5, 8, 0)),
      mk('a2', 2, new Date(2026, 9, 5, 10, 0)),
      mk('a3', 3, new Date(2026, 9, 5, 6, 0))
    ];
    var d = T.layout(arr, NOW);
    eq(d.bars[0].id, 'a2');
    eq(d.bars[0].lane, 0);
    eq(d.bars[1].id, 'a1');
    eq(d.bars[2].id, 'a3');
  });

  t('layout: maxLanes cap', function (eq) {
    var arr = [];
    for (var i = 0; i < 12; i++) {
      arr.push(mk('a' + i, i, new Date(2026, 9, 5, 3 + i, 0)));
    }
    var d = T.layout(arr, NOW);
    eq(d.bars.length, 7);
  });

  /* ---- inclusion / exclusion ---- */

  t('layout: resolved before window excluded', function (eq) {
    var a = mk('a', 1, new Date(2026, 9, 1, 10, 0), {
      resolution: { outcome: 'correct', resolvedAt: TM.util.localIso(new Date(2026, 9, 1, 14, 0)) }
    });
    var d = T.layout([a], NOW);
    eq(d.bars.length, 0);
  });

  t('layout: open analysis created before window but expiring inside -> clippedLeft', function (eq, ok) {
    var a = mk('a', 1, new Date(2026, 9, 1, 10, 0), {
      expiresAt: new Date(2026, 9, 4, 10, 0)
    });
    var d = T.layout([a], NOW);
    eq(d.bars.length, 1);
    ok(d.bars[0].clippedLeft, 'clippedLeft should be true');
  });

  t('layout: resolved-in-window ends at resolvedAt', function (eq) {
    var a = mk('a', 1, new Date(2026, 9, 5, 8, 0), {
      resolution: { outcome: 'correct', resolvedAt: TM.util.localIso(new Date(2026, 9, 5, 11, 0)) }
    });
    var d = T.layout([a], NOW);
    eq(d.bars.length, 1);
    ok_approx_eq(d.bars[0].resolvedMs, new Date(2026, 9, 5, 11, 0).getTime());
    function ok_approx_eq(a, b) { eq(a, b); }
  });

  /* ---- ticks ---- */

  t('layout: ticks at local midnight and noon across month boundary', function (eq, ok) {
    var now = new Date(2026, 9, 31, 8, 0, 0);  /* Oct 31, 08:00 */
    var d = T.layout([], now);
    var labels = d.ticks.map(function (t) { return t.label; });
    ok(labels.indexOf('Sat 31') >= 0, 'missing Sat 31');
    ok(labels.indexOf('Sun 1') >= 0,  'missing Sun 1');
    ok(labels.indexOf('12:00') >= 0,  'missing 12:00');
    var sat = d.ticks.filter(function (t) { return t.label === 'Sat 31'; })[0];
    ok(sat && sat.bold, 'day label should be bold');
  });

  /* ---- empty state ---- */

  t('layout: empty returns example=true and no real bars', function (eq) {
    var d = T.layout([], NOW);
    eq(d.example, true);
    eq(d.bars.length, 0);
  });

  t('layout: malformed records are skipped', function (eq) {
    var arr = [
      null, undefined, {}, { id: 'x' },
      { id: 'y', createdAt: 'not-a-date' },
      mk('z', 1, new Date(2026, 9, 5, 10, 0))
    ];
    var d = T.layout(arr, NOW);
    eq(d.bars.length, 1);
    eq(d.bars[0].id, 'z');
  });

  /* ---- label placement ---- */

  t('label placement: width 120 -> right', function (eq) {
    var r = T._labelPlacement(120, '#127  BTC  ▼', 100, 220, 1200);
    eq(r.side, 'right');
    eq(r.showConfidence, false);
  });

  t('label placement: width 150 -> right', function (eq) {
    var r = T._labelPlacement(150, '#127  BTC  ▼', 100, 250, 1200);
    eq(r.side, 'right');
  });

  t('label placement: width 151 -> inside', function (eq) {
    var r = T._labelPlacement(151, '#127  BTC  ▼', 100, 251, 1200);
    eq(r.side, 'inside');
    eq(r.showConfidence, false);
  });

  t('label placement: width 200 -> inside no confidence', function (eq) {
    var r = T._labelPlacement(200, '#127  BTC  ▼', 100, 300, 1200);
    eq(r.side, 'inside');
    eq(r.showConfidence, false);
  });

  t('label placement: width 201 -> inside + confidence', function (eq) {
    var r = T._labelPlacement(201, '#127  BTC  ▼', 100, 301, 1200);
    eq(r.side, 'inside');
    eq(r.showConfidence, true);
  });

  t('label placement: near right edge flips left', function (eq) {
    var r = T._labelPlacement(100, '#127  BTC  ▼', 1000, 1100, 1200);
    eq(r.side, 'left');
    eq(r.anchor, 'end');
  });
})();