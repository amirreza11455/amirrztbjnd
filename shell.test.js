/* ============================================================================
   Tamga — Shell tests (R3)
   ============================================================================ */

(function () {
  'use strict';

  var TM = window.TM;
  var test = TM.tests.test;
  var cs = TM.shell.computeStatusLine;

  function T(name, fn) {
    test(name, function (helpers) { fn(helpers.eq, helpers.ok); });
  }

  function mk(date, expiresAt, resolution) {
    return {
      id: 'a-' + Math.random().toString(36).slice(2, 8),
      number: 1,
      createdAt: TM.util.localIso(date),
      expiresAt: expiresAt ? TM.util.localIso(expiresAt) : null,
      resolution: resolution || null
    };
  }

  var NOW = new Date(2026, 9, 5, 12, 0, 0);

  /* ============================================================
     computeStatusLine
     ============================================================ */

  T('status: zero analyses -> idle "No analyses yet"', function (eq) {
    var r = cs([], NOW);
    eq(r.text, 'No analyses yet');
    eq(r.tone, 'idle');
  });

  T('status: only open -> "1 waiting for a result"', function (eq) {
    var r = cs([mk(new Date(2026, 9, 5, 10, 0), new Date(2026, 9, 6, 10, 0))], NOW);
    eq(r.text, '1 waiting for a result');
    eq(r.tone, 'pending');
  });

  T('status: only expired -> "1 needs resolving" (singular)', function (eq) {
    var r = cs([mk(new Date(2026, 9, 3), new Date(2026, 9, 4, 10, 0))], NOW);
    eq(r.text, '1 needs resolving');
    eq(r.tone, 'pending');
  });

  T('status: multiple expired -> "3 need resolving" (plural)', function (eq) {
    var arr = [
      mk(new Date(2026, 9, 1), new Date(2026, 9, 2)),
      mk(new Date(2026, 9, 1), new Date(2026, 9, 3)),
      mk(new Date(2026, 9, 1), new Date(2026, 9, 4))
    ];
    var r = cs(arr, NOW);
    eq(r.text, '3 need resolving');
  });

  T('status: open + expired joined by comma', function (eq) {
    var arr = [
      mk(new Date(2026, 9, 5, 10, 0), new Date(2026, 9, 6, 10, 0)),   /* open */
      mk(new Date(2026, 9, 1),         new Date(2026, 9, 2, 10, 0))    /* expired */
    ];
    var r = cs(arr, NOW);
    eq(r.text, '1 waiting for a result, 1 needs resolving');
    eq(r.tone, 'pending');
  });

  T('status: all resolved -> idle', function (eq) {
    var arr = [
      mk(new Date(2026, 9, 1), new Date(2026, 9, 2), { outcome: 'correct' }),
      mk(new Date(2026, 9, 1), new Date(2026, 9, 3), { outcome: 'wrong' })
    ];
    var r = cs(arr, NOW);
    eq(r.text, 'Everything is resolved');
    eq(r.tone, 'idle');
  });

  T('status: boundary expiresAt == now counts as expired', function (eq) {
    var r = cs([mk(new Date(2026, 9, 1), NOW)], NOW);
    eq(r.text, '1 needs resolving');
    eq(r.tone, 'pending');
  });

  T('status: malformed records ignored', function (eq) {
    var arr = [
      null,
      undefined,
      { id: 'x' },                                  /* no createdAt */
      { id: 'y', createdAt: 'not-a-date' },
      mk(new Date(2026, 9, 5, 10, 0), new Date(2026, 9, 6, 10, 0))   /* valid open */
    ];
    var r = cs(arr, NOW);
    eq(r.text, '1 waiting for a result');
    eq(r.tone, 'pending');
  });

  T('status: all-malformed non-empty still shows "No analyses yet"? no — shows idle', function (eq, ok) {
    /* Non-empty array whose only entries are malformed should fall through
       to the "nothing pending" branch. */
    var arr = [ null, { id: 'x' } ];
    var r = cs(arr, NOW);
    /* tone is idle either way; the text may be "No analyses yet" or
       "Everything is resolved" depending on our choice. We assert idle. */
    eq(r.tone, 'idle');
    ok(typeof r.text === 'string' && r.text.length > 0);
  });

  T('status: no analyses -> exact text is "No analyses yet"', function (eq) {
    eq(cs(null, NOW).text, 'No analyses yet');
    eq(cs(undefined, NOW).text, 'No analyses yet');
    eq(cs([], NOW).text, 'No analyses yet');
  });
})();