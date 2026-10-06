/* ============================================================================
   TradeMark — Analysis Story tests
   ----------------------------------------------------------------------------
   Zero-dependency tests for the pure helpers of TM.AnalysisStory. No canvas
   is touched here.

   Coverage:
     - Timeline state machine (advance) — phase progression, boundary crossing,
       wrap to next scenario, cycle A -> B -> C -> A, bounded under huge dt
     - SCENARIOS structure — three, one CORRECT/WRONG/PARTIAL, valid waypoints
     - flipLabel — prefers right, flips left when clipping
     - lockedText — "LOCKED hh:mm" from an injected clock
     - annotationZone — desktop vs mobile layout
     - PHASE_MS shape — one duration per phase
   ============================================================================ */

(function () {
  'use strict';

  var TM = window.TM;
  var test = TM.tests.test;
  var S = TM.AnalysisStory;

  function T(name, fn) {
    test(name, function (helpers) {
      fn(helpers.eq, helpers.ok);
    });
  }

  /* ============================================================
     timeline state machine
     ============================================================ */

  T('advance: single phase progresses linearly', function (eq) {
    var s0 = { phase: 1, phaseTime: 0, scenarioIndex: 0 };
    var s1 = S.advance(s0, 200);
    eq(s1.phase, 1);
    eq(s1.phaseTime, 200);
    eq(s1.scenarioAdvanced, false);
  });

  T('advance: crossing a boundary moves to next phase', function (eq) {
    /* PHASE_MS[1] = 800 */
    var s0 = { phase: 1, phaseTime: 700, scenarioIndex: 0 };
    var s1 = S.advance(s0, 200);
    eq(s1.phase, 2);
    eq(s1.phaseTime, 100);
    eq(s1.scenarioAdvanced, false);
  });

  T('advance: overflow past last phase wraps to 0 + next scenario', function (eq) {
    var last = S.PHASE_MS.length - 1;
    var s0 = {
      phase: last,
      phaseTime: S.PHASE_MS[last] - 100,
      scenarioIndex: 0
    };
    var s1 = S.advance(s0, 500);
    eq(s1.phase, 0);
    eq(s1.scenarioIndex, 1);
    eq(s1.scenarioAdvanced, true);
    eq(s1.phaseTime, 400);
  });

  T('advance: scenario index cycles A -> B -> C -> A', function (eq) {
    var last = S.PHASE_MS.length - 1;
    var idx = 0;
    for (var i = 0; i < 3; i++) {
      var s0 = {
        phase: last,
        phaseTime: S.PHASE_MS[last] - 10,
        scenarioIndex: idx
      };
      var s1 = S.advance(s0, 100);
      idx = s1.scenarioIndex;
      eq(idx, (i + 1) % S.SCENARIOS.length);
    }
  });

  T('advance: huge dt does not infinite-loop (guard)', function (eq, ok) {
    var s0 = { phase: 0, phaseTime: 0, scenarioIndex: 0 };
    var s1 = S.advance(s0, 1000000);
    ok(s1.phaseTime < S.PHASE_MS[s1.phase],
       'phaseTime bounded by current phase duration');
    ok(typeof s1.scenarioIndex === 'number');
    eq(true, true);
  });

  T('advance: dt exactly equal to phase boundary crosses once', function (eq) {
    /* PHASE_MS[0] = 1200 */
    var s0 = { phase: 0, phaseTime: 0, scenarioIndex: 0 };
    var s1 = S.advance(s0, 1200);
    eq(s1.phase, 1);
    eq(s1.phaseTime, 0);
  });

  T('advance: dt just under boundary stays in same phase', function (eq) {
    var s0 = { phase: 0, phaseTime: 0, scenarioIndex: 0 };
    var s1 = S.advance(s0, 1199);
    eq(s1.phase, 0);
    eq(s1.phaseTime, 1199);
  });

  T('advance: state passed in is not mutated', function (eq) {
    var s0 = { phase: 1, phaseTime: 100, scenarioIndex: 0 };
    S.advance(s0, 5000);
    eq(s0.phase, 1);
    eq(s0.phaseTime, 100);
    eq(s0.scenarioIndex, 0);
  });

  /* ============================================================
     PHASE_MS shape
     ============================================================ */

  T('PHASE_MS: one duration per phase, all positive numbers', function (eq, ok) {
    eq(S.PHASE_MS.length, 10);
    for (var i = 0; i < S.PHASE_MS.length; i++) {
      ok(typeof S.PHASE_MS[i] === 'number' && S.PHASE_MS[i] > 0,
         'phase ' + i + ' duration invalid');
    }
  });

  T('PHASE_MS: total loop time is between 12 and 20 seconds', function (ok) {
    var total = S.PHASE_MS.reduce(function (a, b) { return a + b; }, 0);
    ok(total >= 12000 && total <= 20000,
       'total loop time out of range: ' + total + 'ms');
  });

  /* ============================================================
     SCENARIOS
     ============================================================ */

  T('SCENARIOS: three scenarios, one CORRECT/WRONG/PARTIAL', function (eq, ok) {
    eq(S.SCENARIOS.length, 3);
    var outcomes = S.SCENARIOS.map(function (s) { return s.outcome; });
    ok(outcomes.indexOf('CORRECT') >= 0, 'missing CORRECT');
    ok(outcomes.indexOf('WRONG')   >= 0, 'missing WRONG');
    ok(outcomes.indexOf('PARTIAL') >= 0, 'missing PARTIAL');
  });

  T('SCENARIOS: unique seed per scenario', function (eq, ok) {
    var seeds = S.SCENARIOS.map(function (s) { return s.seed; });
    var uniq = seeds.filter(function (v, i) { return seeds.indexOf(v) === i; });
    eq(uniq.length, seeds.length);
    ok(true);
  });

  T('SCENARIOS: each has 6+ waypoints, strictly increasing indices', function (eq, ok) {
    S.SCENARIOS.forEach(function (s) {
      ok(s.waypoints.length >= 6, s.id + ' has >= 6 waypoints');
      for (var i = 1; i < s.waypoints.length; i++) {
        ok(s.waypoints[i].index > s.waypoints[i - 1].index,
           s.id + ' waypoints must strictly increase');
      }
    });
    eq(true, true);
  });

  T('SCENARIOS: each has key, target, invalidation levels with label strings', function (eq, ok) {
    S.SCENARIOS.forEach(function (s) {
      ok(s.levels && s.levels.key,          s.id + ' missing key level');
      ok(s.levels && s.levels.target,       s.id + ' missing target');
      ok(s.levels && s.levels.invalidation, s.id + ' missing invalidation');
      ok(typeof s.levels.key.label === 'string');
      ok(typeof s.levels.target.label === 'string');
      ok(typeof s.levels.invalidation.label === 'string');
      ok(typeof s.levels.key.price === 'number');
    });
    eq(true, true);
  });

  T('SCENARIOS: pin and hit indices within candle range', function (eq, ok) {
    S.SCENARIOS.forEach(function (s) {
      ok(s.pin && typeof s.pin.index === 'number');
      ok(s.hit && typeof s.hit.index === 'number');
      ok(s.pin.index >= 0 && s.pin.index < 120,
         s.id + ' pin out of range');
      ok(s.hit.index >= 0 && s.hit.index < 120,
         s.id + ' hit out of range');
      ok(s.hit.index > s.pin.index,
         s.id + ' hit must be after pin');
    });
    eq(true, true);
  });

  T('SCENARIOS: WRONG scenario hits invalidation, CORRECT hits target', function (eq) {
    var wrong   = S.SCENARIOS.filter(function (s) { return s.outcome === 'WRONG'; })[0];
    var correct = S.SCENARIOS.filter(function (s) { return s.outcome === 'CORRECT'; })[0];
    eq(wrong.touchedFirst,   'invalidation');
    eq(correct.touchedFirst, 'target');
  });

  T('SCENARIOS: tone matches outcome', function (eq) {
    S.SCENARIOS.forEach(function (s) {
      if (s.outcome === 'CORRECT') eq(s.tone, 'success');
      if (s.outcome === 'WRONG')   eq(s.tone, 'danger');
      if (s.outcome === 'PARTIAL') eq(s.tone, 'warning');
    });
  });

  /* ============================================================
     flipLabel
     ============================================================ */

  T('flipLabel: prefers right, flips left when clipping', function (eq) {
    var zone = { x0: 0, y0: 0, x1: 300, y1: 200 };
    var r = S.flipLabel(50, 40, zone);
    eq(r.align, 'left');
    eq(r.x, 56);

    var l = S.flipLabel(280, 60, zone);
    eq(l.align, 'right');
    eq(l.x, 280 - 6 - 60);   /* PAD = 6 */
  });

  T('flipLabel: boundary case exactly at zone edge', function (eq) {
    var zone = { x0: 0, y0: 0, x1: 300, y1: 200 };
    /* anchorX + PAD + textW == zone.x1 -> not flipped (uses >) */
    var r = S.flipLabel(300 - 6 - 40, 40, zone);
    eq(r.align, 'left');
  });

  /* ============================================================
     lockedText
     ============================================================ */

  T('lockedText: formats LOCKED hh:mm from injected clock', function (eq) {
    eq(S.lockedText(new Date(2026, 9, 5, 14, 32)), 'LOCKED 14:32');
    eq(S.lockedText(new Date(2026, 9, 5, 3, 7)),   'LOCKED 03:07');
    eq(S.lockedText(new Date(2026, 9, 5, 0, 0)),   'LOCKED 00:00');
  });

  T('lockedText: never uses the word "Verified"', function (eq, ok) {
    var s = S.lockedText(new Date(2026, 9, 5, 14, 32));
    ok(s.indexOf('Verified') === -1, 'must not contain "Verified"');
    ok(s.indexOf('LOCKED') === 0,    'must start with "LOCKED"');
    eq(true, true);
  });

  /* ============================================================
     annotationZone
     ============================================================ */

  T('annotationZone: mobile uses bottom strip', function (eq, ok) {
    var m = S.annotationZone(400, 800);
    ok(m.y0 >= 0.4 * 800 - 1, 'mobile zone should start around 45%');
    eq(m.x0, 20);
    eq(m.x1, 400 - 20);
    eq(m.y1, 800 - 20);
  });

  T('annotationZone: desktop uses right side', function (eq, ok) {
    var d = S.annotationZone(1440, 900);
    ok(d.x0 >= 0.35 * 1440, 'desktop zone should start right of H1');
    eq(d.y0, 40);
    eq(d.x1, 1440 - 20);
    eq(d.y1, 900 - 40);
  });

  T('annotationZone: switch happens at 720px', function (eq, ok) {
    var just  = S.annotationZone(719, 800);
    var over  = S.annotationZone(720, 800);
    ok(just.y0 > 100, 'small viewport uses bottom-strip zone');
    eq(over.y0, 40);  /* desktop branch */
    eq(true, true);
  });

  /* ============================================================
     colour contract
     ============================================================ */

  T('SCENARIOS: no scenario uses the word "Verified"', function (ok) {
    S.SCENARIOS.forEach(function (s) {
      var blob = JSON.stringify(s);
      if (blob.indexOf('Verified') !== -1) {
        throw new Error(s.id + ' contains forbidden word "Verified"');
      }
    });
    ok(true);
  });

  T('SCENARIOS: every scenario carries a distinct hit price', function (eq, ok) {
    var prices = S.SCENARIOS.map(function (s) { return s.hit.price; });
    var uniq = prices.filter(function (v, i) { return prices.indexOf(v) === i; });
    eq(uniq.length, prices.length);
    ok(true);
  });
})();