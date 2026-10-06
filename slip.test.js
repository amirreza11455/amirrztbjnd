/* ============================================================================
   Tamga — Slip tests (R5)
   ============================================================================ */

(function () {
  'use strict';

  var TM = window.TM;
  var test = TM.tests.test;
  var S = TM.slip;

  function t(name, fn) {
    test(name, function (h) { fn(h.eq, h.ok); });
  }

  var NOW = new Date(2026, 9, 5, 12, 0, 0);  /* Mon Oct 5, 12:00 */

  function mk(opts) {
    opts = opts || {};
    return {
      id: 'a1', number: 127,
      primaryAsset: opts.asset || 'BTC',
      direction: opts.dir || 'bearish',
      timeframe: opts.tf || '4H',
      confidence: opts.conf === undefined ? 78 : opts.conf,
      target: opts.target === undefined ? 80000 : opts.target,
      invalidation: opts.inv === undefined ? 82000 : opts.inv,
      createdAt: TM.util.localIso(opts.created || new Date(2026, 9, 5, 9, 12)),
      expiresAt: opts.expiresAt ? TM.util.localIso(opts.expiresAt) : null,
      resolution: opts.resolution || null,
      reviewId: opts.reviewId || null,
      text: opts.text || 'BTC approaching resistance...'
    };
  }

  /* ---- formatWeekdayTime ---- */

  t('formatWeekdayTime: Mon 16:44', function (eq) {
    eq(TM.util.formatWeekdayTime(new Date(2026, 9, 5, 16, 44)), 'Mon 16:44');
  });
  t('formatWeekdayTime: midnight', function (eq) {
    eq(TM.util.formatWeekdayTime(new Date(2026, 9, 5, 0, 0)), 'Mon 00:00');
  });
  t('formatWeekdayTime: single-digit hour', function (eq) {
    eq(TM.util.formatWeekdayTime(new Date(2026, 9, 5, 9, 7)), 'Mon 09:07');
  });

  /* ---- model: states ---- */

  t('model: open', function (eq) {
    var m = S.model(mk({ expiresAt: new Date(2026, 9, 5, 13, 12) }), NOW);
    eq(m.statusLabel, 'Locked');
    eq(m.tone, 'open');
    eq(m.numberLabel, 'No. 127');
  });

  t('model: expired', function (eq) {
    var m = S.model(mk({ expiresAt: new Date(2026, 9, 5, 11, 0) }), NOW);
    eq(m.statusLabel, 'Needs resolving');
    eq(m.tone, 'expired');
  });

  t('model: correct', function (eq) {
    var m = S.model(mk({
      resolution: { outcome: 'correct', resolvedAt: TM.util.localIso(new Date(2026, 9, 5, 11, 30)) }
    }), NOW);
    eq(m.statusLabel, 'Correct');
    eq(m.tone, 'correct');
  });

  t('model: partial', function (eq) {
    var m = S.model(mk({
      resolution: { outcome: 'partial', resolvedAt: TM.util.localIso(new Date(2026, 9, 5, 11, 30)) }
    }), NOW);
    eq(m.statusLabel, 'Partial');
    eq(m.tone, 'partial');
  });

  t('model: wrong', function (eq) {
    var m = S.model(mk({
      resolution: { outcome: 'wrong', resolvedAt: TM.util.localIso(new Date(2026, 9, 5, 11, 30)) }
    }), NOW);
    eq(m.statusLabel, 'Wrong');
    eq(m.tone, 'wrong');
  });

  t('model: invalid', function (eq) {
    var m = S.model(mk({
      resolution: { outcome: 'invalid', resolvedAt: TM.util.localIso(new Date(2026, 9, 5, 11, 30)) }
    }), NOW);
    eq(m.statusLabel, 'No setup');
  });

  /* ---- sentence ---- */

  t('model: sentence bearish', function (eq) {
    var m = S.model(mk({ dir: 'bearish', target: 80000, inv: 82000, conf: 78 }), NOW);
    eq(m.sentence, 'Bearish on BTC, 4H. Target 80000, invalidated above 82000. Confidence 78%.');
  });

  t('model: sentence bullish', function (eq) {
    var m = S.model(mk({ dir: 'bullish', target: 90000, inv: 80000, conf: 65 }), NOW);
    eq(m.sentence, 'Bullish on BTC, 4H. Target 90000, invalidated below 80000. Confidence 65%.');
  });

  t('model: sentence neutral (no levels)', function (eq) {
    var m = S.model(mk({ dir: 'neutral', target: null, inv: null, conf: 50 }), NOW);
    eq(m.sentence, 'Neutral on BTC, 4H. Confidence 50%.');
  });

  t('model: missing confidence', function (eq) {
    var m = S.model(mk({ conf: undefined, target: null, inv: null, dir: 'neutral' }), NOW);
    eq(m.sentence, 'Neutral on BTC, 4H.');
  });

  /* ---- footer ---- */

  t('model: footer locked/expires', function (eq) {
    var m = S.model(mk({
      created: new Date(2026, 9, 5, 9, 12),
      expiresAt: new Date(2026, 9, 5, 13, 12)
    }), NOW);
    eq(m.footerText, 'Locked Mon 09:12. Expires Mon 13:12.');
  });

  t('model: footer expired', function (eq) {
    var m = S.model(mk({ expiresAt: new Date(2026, 9, 5, 11, 0) }), NOW);
    eq(m.footerText, 'Expired Mon 11:00.');
  });

  t('model: footer resolved', function (eq) {
    var m = S.model(mk({
      resolution: { outcome: 'correct', resolvedAt: TM.util.localIso(new Date(2026, 9, 5, 11, 30)) }
    }), NOW);
    eq(m.footerText, 'Resolved Mon 11:30.');
  });

  /* ---- actions ---- */

  t('model: actions for open', function (eq) {
    var m = S.model(mk({ expiresAt: new Date(2026, 9, 6) }), NOW);
    eq(m.actions.join(','), 'Resolve');
  });
  t('model: actions for expired', function (eq) {
    var m = S.model(mk({ expiresAt: new Date(2026, 9, 4) }), NOW);
    eq(m.actions.join(','), 'Resolve');
  });
  t('model: actions for resolved w/o review', function (eq) {
    var m = S.model(mk({
      resolution: { outcome: 'correct', resolvedAt: TM.util.localIso(new Date(2026, 9, 5, 11, 0)) }
    }), NOW);
    eq(m.actions.join(','), 'Add review');
  });
  t('model: no actions for resolved w/ review', function (eq) {
    var m = S.model(mk({
      resolution: { outcome: 'correct', resolvedAt: TM.util.localIso(new Date(2026, 9, 5, 11, 0)) },
      reviewId: 'r1'
    }), NOW);
    eq(m.actions.length, 0);
  });

  /* ---- empty ---- */

  t('model: empty analysis -> blank slip', function (eq) {
    var m = S.model(null, NOW);
    eq(m.empty, true);
    eq(m.numberLabel, 'No. —');
    eq(m.actions.length, 0);
    eq(m.levels, null);
  });

  /* ---- levels ---- */

  t('model: levels exposed when target + invalidation present', function (eq) {
    var m = S.model(mk({ target: 100, inv: 200 }), NOW);
    eq(m.levels.target, 100);
    eq(m.levels.invalidation, 200);
  });

  t('model: no levels for neutral', function (eq) {
    var m = S.model(mk({ target: null, inv: null }), NOW);
    eq(m.levels, null);
  });
})();