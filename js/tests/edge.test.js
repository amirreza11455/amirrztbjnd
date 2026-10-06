/* ============================================================================
   Tamga — Edge case tests (R8)
   ============================================================================ */

(function () {
  'use strict';

  var TM = window.TM;
  var test = TM.tests.test;
  var u = TM.util;

  function T(name, fn) {
    test(name, function (h) { fn(h.eq, h.ok); });
  }

  /* ============================================================
     text safety
     ============================================================ */

  T('edge: very long analysis text survives escapeHtml', function (eq, ok) {
    var s = 'A'.repeat(5000) + '<script>x<\/script>';
    var out = u.escapeHtml(s);
    ok(out.indexOf('<') === -1);
    ok(out.indexOf('>') === -1);
    ok(out.indexOf('&lt;script&gt;') >= 0);
    ok(out.length >= 5000);
    eq(true, true);
  });

  T('edge: escapeHtml preserves non-HTML content exactly', function (eq) {
    var s = 'BTC rejected 81.8K then retraced to 79.2K within 4H.';
    eq(u.escapeHtml(s), s);
  });

  T('edge: quotes in text do not break DOM builders', function (eq) {
    var n = u.el('div', { text: 'He said "hi" & <ok>' });
    eq(n.textContent, 'He said "hi" & <ok>');
    eq(n.children.length, 0);
    eq(n.querySelector('script'), null);
  });

  T('edge: backticks and $ in text are inert', function (eq) {
    var n = u.el('div', { text: '${alert(1)} `back`' });
    eq(n.textContent, '${alert(1)} `back`');
    eq(n.children.length, 0);
  });

  T('edge: el() never returns a child <script>', function (eq) {
    var n = u.el('div', { text: '<script>alert(1)<\/script>tail' });
    eq(n.querySelector('script'), null);
    eq(n.textContent, '<script>alert(1)<\/script>tail');
  });

  /* ============================================================
     slip.render — user text through DOM
     ============================================================ */

  T('edge: slip.render puts user text via textContent, no innerHTML', function (eq, ok) {
    var c = document.createElement('div');
    var hostile = 'BTC <script>alert(1)<\/script> at "81.8K"';
    var a = {
      id: 'a1', number: 127, primaryAsset: 'BTC', direction: 'bearish',
      timeframe: '4H', confidence: 78, target: 80000, invalidation: 82000,
      createdAt: u.localIso(new Date()),
      expiresAt: null, resolution: null, reviewId: null,
      text: hostile
    };
    TM.slip.render(c, a, new Date());
    var body = c.querySelector('.tm-slip__body');
    ok(body, 'body element missing');
    eq(body.textContent, hostile);
    eq(c.querySelector('script'), null);
  });

  T('edge: slip.render handles very long asset name', function (eq) {
    var c = document.createElement('div');
    var longAsset = 'W' + 'X'.repeat(40);
    var a = {
      id: 'a1', number: 1, primaryAsset: longAsset, direction: 'bullish',
      timeframe: '4H', confidence: 60, target: 100, invalidation: 90,
      createdAt: u.localIso(new Date()),
      expiresAt: null, resolution: null, reviewId: null, text: 'Valid text.'
    };
    TM.slip.render(c, a, new Date());
    var sentence = c.querySelector('.tm-slip__sentence');
    eq(sentence.textContent.indexOf(longAsset) >= 0, true);
  });

  T('edge: slip.render handles missing confidence', function (eq) {
    var c = document.createElement('div');
    var a = {
      id: 'a1', number: 1, primaryAsset: 'BTC', direction: 'neutral',
      timeframe: '4H', confidence: undefined, target: null, invalidation: null,
      createdAt: u.localIso(new Date()),
      expiresAt: null, resolution: null, reviewId: null, text: 'neutral'
    };
    TM.slip.render(c, a, new Date());
    var sentence = c.querySelector('.tm-slip__sentence');
    eq(sentence.textContent.indexOf('Confidence'), -1);
  });

  T('edge: slip.model handles null analysis -> empty slip', function (eq) {
    var m = TM.slip.model(null, new Date());
    eq(m.empty, true);
    eq(m.numberLabel, 'No. —');
    eq(m.actions.length, 0);
  });

  /* ============================================================
     timeline.layout — stress and edge cases
     ============================================================ */

  T('edge: timeline.layout with 250 analyses caps lanes and does not overflow', function (eq, ok) {
    var now = new Date();
    var arr = [];
    for (var i = 0; i < 250; i++) {
      var d = new Date(now.getTime() - i * 3600 * 1000);  /* spread over ~10 days */
      arr.push({
        id: 'a' + i, number: i + 1,
        createdAt: u.localIso(d),
        primaryAsset: 'BTC', direction: 'bearish', timeframe: '4H',
        confidence: 60, target: 80000, invalidation: 82000,
        expiresAt: u.localIso(new Date(d.getTime() + 4 * 3600 * 1000)),
        resolution: null, reviewId: null, text: 'text'
      });
    }
    var d = TM.timeline.layout(arr, now);
    ok(d.bars.length <= 7, 'capped to maxLanes');
    ok(d.height > 0 && d.height < 5000, 'height bounded');
    ok(d.nowX >= 0 && d.nowX <= d.width, 'nowX within bounds');
    eq(true, true);
  });

  T('edge: timeline.layout tolerates expiresAt before createdAt', function (eq, ok) {
    var now = new Date();
    var a = {
      id: 'a1', number: 1,
      createdAt: u.localIso(new Date(now.getTime() - 3600 * 1000)),
      primaryAsset: 'BTC', direction: 'bearish', timeframe: '4H',
      confidence: 60, target: null, invalidation: null,
      expiresAt: u.localIso(new Date(now.getTime() - 7200 * 1000)),  /* earlier */
      resolution: null, reviewId: null, text: 'text'
    };
    var d = TM.timeline.layout([a], now);
    /* bar exists; x1 < x0 raw should not break; width >= 0 */
    if (d.bars.length) ok(d.bars[0].width >= 0, 'width non-negative');
    eq(true, true);
  });

  T('edge: timeline.layout tolerates resolvedAt after now', function (eq, ok) {
    var now = new Date();
    var a = {
      id: 'a1', number: 1,
      createdAt: u.localIso(new Date(now.getTime() - 3600 * 1000)),
      primaryAsset: 'BTC', direction: 'bearish', timeframe: '4H',
      confidence: 60, target: null, invalidation: null,
      expiresAt: null,
      resolution: { outcome: 'correct', resolvedAt: u.localIso(new Date(now.getTime() + 3600 * 1000)) },
      reviewId: null, text: 'text'
    };
    var d = TM.timeline.layout([a], now);
    if (d.bars.length) ok(d.bars[0].width >= 0);
    eq(true, true);
  });

  T('edge: timeline.layout tolerates duplicate ids', function (eq, ok) {
    var now = new Date();
    var mk = function (t) {
      return {
        id: 'dup', number: 1,
        createdAt: u.localIso(new Date(now.getTime() - t * 1000)),
        primaryAsset: 'BTC', direction: 'bearish', timeframe: '4H',
        confidence: 60, target: null, invalidation: null,
        expiresAt: null, resolution: null, reviewId: null, text: 'text'
      };
    };
    var d = TM.timeline.layout([mk(3600), mk(1800), mk(600)], now);
    ok(d.bars.length === 3, 'all kept even with duplicate ids');
    eq(true, true);
  });

  /* ============================================================
     store._statusOf
     ============================================================ */

  T('edge: store _statusOf boundary (now == expiresAt -> expired)', function (eq) {
    var now = new Date(2026, 9, 5, 12, 0, 0);
    var a = { resolution: null, expiresAt: u.localIso(now) };
    eq(TM.store._statusOf(a, now), 'expired');
  });

  T('edge: store _statusOf one ms before boundary -> open', function (eq) {
    var now = new Date(2026, 9, 5, 12, 0, 0);
    var just = new Date(now.getTime() + 1);
    var a = { resolution: null, expiresAt: u.localIso(just) };
    eq(TM.store._statusOf(a, now), 'open');
  });

  T('edge: store _statusOf resolution always wins', function (eq) {
    var now = new Date(2026, 9, 5, 12, 0, 0);
    var a = {
      resolution: { outcome: 'correct', resolvedAt: u.localIso(now),
                    touchedFirst: 'target', note: '' },
      expiresAt: u.localIso(new Date(2026, 9, 1))
    };
    eq(TM.store._statusOf(a, now), 'resolved');
  });

  /* ============================================================
     localIso
     ============================================================ */

  T('edge: localIso round-trips across a full day', function (eq) {
    for (var h = 0; h < 24; h++) {
      var d = new Date(2026, 9, 5, h, 30, 15);
      var back = new Date(u.localIso(d));
      eq(back.getTime(), d.getTime());
    }
  });

  T('edge: localIso never ends with Z', function (ok) {
    var s = u.localIso(new Date(2026, 9, 5, 14, 32, 0));
    ok(s.indexOf('Z') === -1);
    ok(/[+-]\d{2}:\d{2}$/.test(s));
  });

  /* ============================================================
     misc
     ============================================================ */

  T('edge: clamp handles NaN by returning NaN (documented)', function (eq, ok) {
    var out = u.clamp(NaN, 0, 10);
    ok(typeof out === 'number');
    ok(isNaN(out));
  });

  T('edge: mulberry32 with seed = 0 still produces output', function (eq, ok) {
    var rng = u.mulberry32(0);
    var first = rng();
    ok(typeof first === 'number' && first >= 0 && first < 1);
    eq(true, true);
  });

  T('edge: formatWeekdayTime handles midnight', function (eq) {
    eq(u.formatWeekdayTime(new Date(2026, 9, 5, 0, 0)), 'Mon 00:00');
  });
})();