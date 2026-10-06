/* ============================================================================
   TradeMark — Util tests
   ----------------------------------------------------------------------------
   Zero-dependency tests for TM.util. Registered via TM.tests.test(...) which
   is provided by tests.html. Each test receives { eq, ok } as helpers.

   Coverage:
     - localDateKey, startOfLocalDay, isSameLocalDay, isYesterday
     - Midnight boundary: 23:59 vs 00:01
     - Month and year rollover
     - relativeTime buckets
     - formatTime, formatShortDate, localIso
     - escapeHtml with quotes and backticks
     - mulberry32 determinism and seed sensitivity
     - clamp
     - el() DOM builder (textContent only — never innerHTML)
   ============================================================================ */

(function () {
  'use strict';

  var TM = window.TM;
  var u = TM.util;
  var test = TM.tests.test;

  /* The runner passes { eq, ok } into each test function. We register tests
     via this small wrapper so we don't depend on the runner's own helpers
     leaking into module scope. */
  function T(name, fn) {
    test(name, function (helpers) {
      fn(helpers.eq, helpers.ok);
    });
  }

  /* ============================================================
     date helpers
     ============================================================ */

  T('localDateKey pads month and day', function (eq) {
    eq(u.localDateKey(new Date(2026, 0, 5)),  '2026-01-05');
    eq(u.localDateKey(new Date(2026, 9, 15)), '2026-10-15');
    eq(u.localDateKey(new Date(2026, 11, 31)), '2026-12-31');
  });

  T('startOfLocalDay returns local midnight', function (eq) {
    var d = u.startOfLocalDay(new Date(2026, 5, 15, 23, 59, 59));
    eq(d.getFullYear(), 2026);
    eq(d.getMonth(), 5);
    eq(d.getDate(), 15);
    eq(d.getHours(), 0);
    eq(d.getMinutes(), 0);
    eq(d.getSeconds(), 0);
  });

  T('isSameLocalDay: 23:59 vs 00:01 across midnight', function (eq) {
    var a = new Date(2026, 9, 5, 23, 59, 0);
    var b = new Date(2026, 9, 6, 0, 1, 0);
    eq(u.isSameLocalDay(a, b), false);
    eq(u.isSameLocalDay(a, new Date(2026, 9, 5, 0, 0, 1)), true);
  });

  T('isYesterday across month boundary', function (eq) {
    var now = new Date(2026, 10, 1, 10, 0, 0); /* Nov 1 */
    eq(u.isYesterday(new Date(2026, 9, 31, 22, 0, 0), now), true);  /* Oct 31 */
    eq(u.isYesterday(new Date(2026, 9, 30, 22, 0, 0), now), false);
  });

  T('isYesterday across year boundary', function (eq) {
    var now = new Date(2027, 0, 1, 0, 30, 0);   /* Jan 1 2027 */
    eq(u.isYesterday(new Date(2026, 11, 31, 23, 30, 0), now), true);
  });

  T('isYesterday: same day is not yesterday', function (eq) {
    var now = new Date(2026, 9, 5, 12, 0, 0);
    eq(u.isYesterday(new Date(2026, 9, 5, 0, 0, 1), now), false);
    eq(u.isYesterday(new Date(2026, 9, 5, 23, 59, 59), now), false);
  });

  T('formatTime pads to two digits', function (eq) {
    eq(u.formatTime(new Date(2026, 9, 5, 3, 7)),  '03:07');
    eq(u.formatTime(new Date(2026, 9, 5, 14, 32)), '14:32');
    eq(u.formatTime(new Date(2026, 9, 5, 0, 0)),  '00:00');
  });

  T('formatShortDate returns "Oct 5, 2026"', function (eq) {
    eq(u.formatShortDate(new Date(2026, 0, 1)),  'Jan 1, 2026');
    eq(u.formatShortDate(new Date(2026, 9, 5)),  'Oct 5, 2026');
    eq(u.formatShortDate(new Date(2026, 11, 31)), 'Dec 31, 2026');
  });

  /* ============================================================
     relativeTime
     ============================================================ */

  T('relativeTime buckets', function (eq) {
    var now = new Date(2026, 9, 5, 12, 0, 0);
    eq(u.relativeTime(new Date(2026, 9, 5, 11, 59, 30), now), 'just now');
    eq(u.relativeTime(new Date(2026, 9, 5, 11, 45, 0),  now), '15m ago');
    eq(u.relativeTime(new Date(2026, 9, 5, 8, 0, 0),   now), '4h ago');
    eq(u.relativeTime(new Date(2026, 9, 4, 20, 0, 0),  now), 'yesterday');
    eq(u.relativeTime(new Date(2026, 9, 1, 12, 0, 0),  now), '4d ago');
    eq(u.relativeTime(new Date(2026, 8, 15, 12, 0, 0), now), 'Sep 15, 2026');
  });

  T('relativeTime: future dates fall back to formatShortDate', function (eq) {
    var now = new Date(2026, 9, 5, 12, 0, 0);
    eq(u.relativeTime(new Date(2026, 9, 6, 12, 0, 0), now), 'Oct 6, 2026');
  });

  /* ============================================================
     localIso — the ONLY date serialisation format the app uses
     ============================================================ */

  T('localIso includes numeric offset, never Z', function (eq, ok) {
    var s = u.localIso(new Date(2026, 9, 5, 14, 32, 0));
    ok(/^2026-10-05T14:32:00[+-]\d{2}:\d{2}$/.test(s), 'got: ' + s);
    ok(s.indexOf('Z') === -1, 'must not use Z (UTC)');
  });

  T('localIso round-trips through Date', function (eq) {
    var d = new Date(2026, 9, 5, 14, 32, 7);
    var s = u.localIso(d);
    var back = new Date(s);
    eq(back.getTime(), d.getTime());
  });

  /* ============================================================
     escapeHtml
     ============================================================ */

  T('escapeHtml escapes & < > " \' `', function (eq) {
    eq(
      u.escapeHtml('<a href="x" onclick=\'y\'>`z`&</a>'),
      '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&#96;z&#96;&amp;&lt;/a&gt;'
    );
  });

  T('escapeHtml on empty and nullish input', function (eq) {
    eq(u.escapeHtml(''), '');
    eq(u.escapeHtml(null), 'null');
    eq(u.escapeHtml(undefined), 'undefined');
  });

  /* ============================================================
     mulberry32
     ============================================================ */

  T('mulberry32 is deterministic and seed-sensitive', function (eq, ok) {
    var a = u.mulberry32(42);
    var b = u.mulberry32(42);
    var c = u.mulberry32(43);
    var sa = [];
    var sb = [];
    for (var i = 0; i < 10; i++) { sa.push(a()); sb.push(b()); }
    for (var j = 0; j < 10; j++) eq(sa[j], sb[j]);
    ok(c() !== sa[0], 'different seeds should diverge on first output');
  });

  T('mulberry32 outputs stay in [0, 1)', function (eq, ok) {
    var rng = u.mulberry32(7);
    for (var i = 0; i < 100; i++) {
      var v = rng();
      ok(v >= 0 && v < 1, 'out of range: ' + v);
    }
    eq(true, true);
  });

  /* ============================================================
     clamp
     ============================================================ */

  T('clamp returns value within bounds', function (eq) {
    eq(u.clamp(5, 0, 10), 5);
    eq(u.clamp(-1, 0, 10), 0);
    eq(u.clamp(11, 0, 10), 10);
    eq(u.clamp(0, 0, 10), 0);
    eq(u.clamp(10, 0, 10), 10);
  });

  /* ============================================================
     el — DOM builder (textContent only)
     ============================================================ */

  T('el builds DOM with textContent only, no innerHTML', function (eq) {
    var n = u.el('div', { class: 'x', text: '<script>alert(1)<\/script>' });
    eq(n.className, 'x');
    eq(n.textContent, '<script>alert(1)<\/script>');
    eq(n.querySelector('script'), null);
    eq(n.children.length, 0);
  });

  T('el attaches children as strings and nodes', function (eq) {
    var child = u.el('span', { text: 'inner' });
    var n = u.el('div', null, ['text ', child, 42]);
    eq(n.textContent, 'text inner42');
    eq(n.children.length, 1);
  });

  T('el skips null and false children', function (eq) {
    var n = u.el('div', null, [null, 'a', false, undefined, 'b']);
    eq(n.textContent, 'ab');
  });

  T('el wires onEvent attributes', function (eq, ok) {
    var clicked = 0;
    var n = u.el('button', { onClick: function () { clicked++; } });
    n.dispatchEvent(new Event('click'));
    eq(clicked, 1);
    ok(true);
  });

  T('el applies dataset and style objects', function (eq) {
    var n = u.el('div', {
      dataset: { role: 'x' },
      style:   { width: '10px', height: '5px' }
    });
    eq(n.dataset.role, 'x');
    eq(n.style.width, '10px');
    eq(n.style.height, '5px');
  });

  T('el sets boolean attrs as empty string', function (eq) {
    var n = u.el('input', { disabled: true });
    eq(n.getAttribute('disabled'), '');
    eq(n.disabled, true);
  });

  /* ============================================================
     debounce
     ============================================================ */

  T('debounce collapses rapid calls', function (eq, ok) {
    var calls = 0;
    var fn = u.debounce(function () { calls++; }, 20);
    fn(); fn(); fn();
    ok(calls === 0, 'should not fire immediately');
    setTimeout(function () {
      ok(calls === 1, 'should fire exactly once after quiet period');
      eq(true, true);
    }, 60);
  });

  /* ============================================================
     easings
     ============================================================ */

  T('easing functions map 0->0 and 1->1', function (eq) {
    eq(u.easeInOutCubic(0), 0);
    eq(u.easeInOutCubic(1), 1);
    eq(u.easeOutQuad(0), 0);
    eq(u.easeOutQuad(1), 1);
  });

  T('easing functions are monotonic on [0,1]', function (eq, ok) {
    var prev = -Infinity;
    for (var i = 0; i <= 20; i++) {
      var t = i / 20;
      var v = u.easeInOutCubic(t);
      ok(v >= prev - 1e-9, 'not monotonic at t=' + t);
      prev = v;
    }
    eq(true, true);
  });
})();