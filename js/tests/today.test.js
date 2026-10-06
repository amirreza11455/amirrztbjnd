/* ============================================================================
   TradeMark — TODAY tests
   ----------------------------------------------------------------------------
   Zero-dependency tests for the pure compute helpers of TM.today. `now` is
   always passed as a parameter, so tests are deterministic and do not depend
   on the actual system clock.

   Coverage:
     - computeYesterday: midnight boundary (23:50 yesterday vs 00:10 today),
       item statuses (Review Needed / Resolved / Unresolved), counts
     - computeNeedsResolution: expiresAt == now boundary, ordering by expiresAt
     - computeReviewsNeeded: resolved without review, ordering by resolvedAt
     - computeLast: newest analysis, null when empty, all summary fields
     - computeArchiveStats: zero data, active-days across month/year boundary,
       resolved/unresolved split, first date
     - longDate: "Monday, October 5"
   ============================================================================ */

(function () {
  'use strict';

  var TM = window.TM;
  var test = TM.tests.test;
  var T0 = TM.today;

  function T(name, fn) {
    test(name, function (helpers) {
      fn(helpers.eq, helpers.ok);
    });
  }

  /* Build a minimal analysis-shaped object for tests. */
  function mk(id, num, createdDate, opts) {
    opts = opts || {};
    var a = {
      id: id,
      number: num,
      createdAt: TM.util.localIso(createdDate),
      text: opts.text || 'BTC rejected the level cleanly.',
      primaryAsset: opts.asset || 'BTC',
      direction: opts.dir || 'bearish',
      target: opts.target || null,
      invalidation: opts.inv || null,
      timeframe: '4H',
      confidence: 70,
      expiresAt: opts.expiresAt ? TM.util.localIso(opts.expiresAt) : null,
      screenshotId: null,
      resolution: opts.resolution || null,
      reviewId: opts.reviewId || null
    };
    return a;
  }

  /* ============================================================
     computeYesterday
     ============================================================ */

  T('computeYesterday: 23:50 yesterday counts, 00:10 today does not', function (eq) {
    var now = new Date(2026, 9, 5, 12, 0, 0); /* Oct 5, noon */
    var a1 = mk('a1', 1, new Date(2026, 9, 4, 23, 50));  /* yesterday 23:50 */
    var a2 = mk('a2', 2, new Date(2026, 9, 5, 0, 10));   /* today 00:10 */
    var r = T0.computeYesterday([a1, a2], [], now);
    eq(r.created, 1);
    eq(r.items.length, 1);
    eq(r.items[0].id, 'a1');
  });

  T('computeYesterday: 23:59 yesterday vs 00:00 today boundary', function (eq) {
    var now = new Date(2026, 9, 5, 12, 0, 0);
    var last = mk('last', 1, new Date(2026, 9, 4, 23, 59, 59));
    var first = mk('first', 2, new Date(2026, 9, 5, 0, 0, 0));
    var r = T0.computeYesterday([last, first], [], now);
    eq(r.created, 1);
    eq(r.items[0].id, 'last');
  });

  T('computeYesterday: items labelled correctly', function (eq) {
    var now = new Date(2026, 9, 5, 12, 0, 0);
    var res = {
      outcome: 'correct',
      resolvedAt: TM.util.localIso(new Date(2026, 9, 4, 18, 0)),
      touchedFirst: 'target',
      note: ''
    };
    var a1 = mk('a1', 1, new Date(2026, 9, 4, 10, 0), { resolution: res });
    var a2 = mk('a2', 2, new Date(2026, 9, 4, 11, 0), { resolution: res, reviewId: 'r2' });
    var a3 = mk('a3', 3, new Date(2026, 9, 4, 12, 0));
    var out = T0.computeYesterday([a1, a2, a3], [], now);
    eq(out.items[0].status, 'Review Needed');
    eq(out.items[1].status, 'Resolved');
    eq(out.items[2].status, 'Unresolved');
  });

  T('computeYesterday: reviews completed counted from reviews array', function (eq) {
    var now = new Date(2026, 9, 5, 12, 0, 0);
    var r1 = { id: 'r1', analysisId: 'a1',
               createdAt: TM.util.localIso(new Date(2026, 9, 4, 9, 0)) };
    var r2 = { id: 'r2', analysisId: 'a2',
               createdAt: TM.util.localIso(new Date(2026, 9, 4, 20, 0)) };
    var r3 = { id: 'r3', analysisId: 'a3',
               createdAt: TM.util.localIso(new Date(2026, 9, 3, 20, 0)) }; /* day before */
    var out = T0.computeYesterday([], [r1, r2, r3], now);
    eq(out.reviewsCompleted, 2);
  });

  T('computeYesterday: resolved-only analyses count in resolved bucket', function (eq) {
    var now = new Date(2026, 9, 5, 12, 0, 0);
    var a1 = mk('a1', 1, new Date(2026, 9, 1, 10, 0), {
      resolution: {
        outcome: 'wrong',
        resolvedAt: TM.util.localIso(new Date(2026, 9, 4, 22, 0)),
        touchedFirst: 'invalidation',
        note: ''
      }
    });
    var r = T0.computeYesterday([a1], [], now);
    eq(r.created, 0);
    eq(r.resolved, 1);
    eq(r.items.length, 1);
    eq(r.items[0].id, 'a1');
  });

  T('computeYesterday: no items -> empty list', function (eq) {
    var now = new Date(2026, 9, 5, 12, 0, 0);
    var r = T0.computeYesterday([], [], now);
    eq(r.created, 0);
    eq(r.resolved, 0);
    eq(r.reviewsCompleted, 0);
    eq(r.items.length, 0);
  });

  T('computeYesterday: dedupe items by id (created + resolved same day)', function (eq) {
    var now = new Date(2026, 9, 5, 12, 0, 0);
    var a1 = mk('a1', 1, new Date(2026, 9, 4, 10, 0), {
      resolution: {
        outcome: 'correct',
        resolvedAt: TM.util.localIso(new Date(2026, 9, 4, 18, 0)),
        touchedFirst: 'target',
        note: ''
      }
    });
    var r = T0.computeYesterday([a1], [], now);
    eq(r.items.length, 1);
  });

  /* ============================================================
     computeNeedsResolution
     ============================================================ */

  T('computeNeedsResolution: expiresAt exactly equal to now counts', function (eq) {
    var now = new Date(2026, 9, 5, 12, 0, 0);
    var a1 = mk('a1', 1, new Date(2026, 9, 3), { expiresAt: now });
    var a2 = mk('a2', 2, new Date(2026, 9, 3),
      { expiresAt: new Date(2026, 9, 5, 12, 0, 1) }); /* 1 second in future */
    var out = T0.computeNeedsResolution([a1, a2], now);
    eq(out.count, 1);
    eq(out.items[0].id, 'a1');
  });

  T('computeNeedsResolution: resolved analyses are excluded', function (eq) {
    var now = new Date(2026, 9, 5, 12, 0, 0);
    var a1 = mk('a1', 1, new Date(2026, 9, 3), {
      expiresAt: new Date(2026, 9, 4),
      resolution: {
        outcome: 'correct',
        resolvedAt: TM.util.localIso(new Date(2026, 9, 4, 10, 0)),
        touchedFirst: 'target', note: ''
      }
    });
    var out = T0.computeNeedsResolution([a1], now);
    eq(out.count, 0);
    eq(out.items.length, 0);
  });

  T('computeNeedsResolution: analyses without expiresAt are ignored', function (eq) {
    var now = new Date(2026, 9, 5, 12, 0, 0);
    var a1 = mk('a1', 1, new Date(2026, 9, 3));  /* expiresAt null */
    var out = T0.computeNeedsResolution([a1], now);
    eq(out.count, 0);
  });

  T('computeNeedsResolution: sorts by expiresAt ascending, returns oldest 3', function (eq) {
    var now = new Date(2026, 9, 5, 12, 0, 0);
    var arr = [
      mk('a1', 1, new Date(2026, 9, 1), { expiresAt: new Date(2026, 9, 4, 10, 0) }),
      mk('a2', 2, new Date(2026, 9, 1), { expiresAt: new Date(2026, 9, 3, 10, 0) }),
      mk('a3', 3, new Date(2026, 9, 1), { expiresAt: new Date(2026, 9, 4, 20, 0) }),
      mk('a4', 4, new Date(2026, 9, 1), { expiresAt: new Date(2026, 9, 2, 10, 0) })
    ];
    var out = T0.computeNeedsResolution(arr, now);
    eq(out.count, 4);
    eq(out.items.length, 3);
    eq(out.items[0].id, 'a4');  /* Sep->Oct 2, oldest expiry */
    eq(out.items[1].id, 'a2');  /* Oct 3 */
    eq(out.items[2].id, 'a1');  /* Oct 4 10:00 */
  });

  /* ============================================================
     computeReviewsNeeded
     ============================================================ */

  T('computeReviewsNeeded: resolved without review', function (eq) {
    var res = {
      outcome: 'wrong',
      resolvedAt: '2026-09-01T10:00:00+00:00',
      touchedFirst: 'invalidation',
      note: ''
    };
    var a1 = mk('a1', 1, new Date(2026, 8, 1), { resolution: res });
    var a2 = mk('a2', 2, new Date(2026, 8, 1), { resolution: res, reviewId: 'r2' });
    var out = T0.computeReviewsNeeded([a1, a2]);
    eq(out.count, 1);
    eq(out.items[0].id, 'a1');
  });

  T('computeReviewsNeeded: open analyses are excluded', function (eq) {
    var a1 = mk('a1', 1, new Date(2026, 8, 1));
    var out = T0.computeReviewsNeeded([a1]);
    eq(out.count, 0);
    eq(out.items.length, 0);
  });

  T('computeReviewsNeeded: sorts by resolvedAt ascending, returns oldest 3', function (eq) {
    function mkRes(iso) {
      return { outcome: 'correct', resolvedAt: iso, touchedFirst: 'target', note: '' };
    }
    var arr = [
      mk('a1', 1, new Date(2026, 8, 1), { resolution: mkRes('2026-09-05T10:00:00+00:00') }),
      mk('a2', 2, new Date(2026, 8, 1), { resolution: mkRes('2026-09-02T10:00:00+00:00') }),
      mk('a3', 3, new Date(2026, 8, 1), { resolution: mkRes('2026-09-08T10:00:00+00:00') }),
      mk('a4', 4, new Date(2026, 8, 1), { resolution: mkRes('2026-09-03T10:00:00+00:00') })
    ];
    var out = T0.computeReviewsNeeded(arr);
    eq(out.count, 4);
    eq(out.items[0].id, 'a2');
    eq(out.items[1].id, 'a4');
    eq(out.items[2].id, 'a1');
  });

  /* ============================================================
     computeLast
     ============================================================ */

  T('computeLast: null on empty', function (eq) {
    eq(T0.computeLast([]), null);
    eq(T0.computeLast(null), null);
  });

  T('computeLast: returns newest by createdAt', function (eq) {
    var a1 = mk('a1', 1, new Date(2026, 8, 1));
    var a2 = mk('a2', 2, new Date(2026, 9, 1));
    var a3 = mk('a3', 3, new Date(2026, 8, 15));
    eq(T0.computeLast([a1, a2, a3]).id, 'a2');
  });

  T('computeLast: surfaces all summary fields', function (eq, ok) {
    var a1 = mk('a1', 127, new Date(2026, 9, 5, 14, 32), {
      target: 80000,
      inv: 82000,
      asset: 'BTC',
      dir: 'bearish'
    });
    var out = T0.computeLast([a1]);
    eq(out.number, 127);
    eq(out.asset, 'BTC');
    eq(out.direction, 'bearish');
    eq(out.target, 80000);
    eq(out.invalidation, 82000);
    eq(out.confidence, 70);
    eq(out.status, 'open');
    ok(typeof out.createdAt === 'string');
  });

  T('computeLast: status reflects resolution outcome', function (eq) {
    var a1 = mk('a1', 1, new Date(2026, 9, 5), {
      resolution: {
        outcome: 'wrong',
        resolvedAt: TM.util.localIso(new Date(2026, 9, 5, 20, 0)),
        touchedFirst: 'invalidation', note: ''
      }
    });
    eq(T0.computeLast([a1]).status, 'wrong');
  });

  T('computeLast: does not mutate the input array', function (eq) {
    var a1 = mk('a1', 1, new Date(2026, 8, 1));
    var a2 = mk('a2', 2, new Date(2026, 9, 1));
    var arr = [a1, a2];
    T0.computeLast(arr);
    eq(arr[0].id, 'a1');
    eq(arr[1].id, 'a2');
  });

  /* ============================================================
     computeArchiveStats
     ============================================================ */

  T('computeArchiveStats: zero data', function (eq) {
    var s = T0.computeArchiveStats([]);
    eq(s.total, 0);
    eq(s.resolved, 0);
    eq(s.unresolved, 0);
    eq(s.activeDays, 0);
    eq(s.firstDate, null);
  });

  T('computeArchiveStats: active days across month boundary', function (eq) {
    var a1 = mk('a1', 1, new Date(2026, 8, 30, 22, 0));  /* Sep 30 */
    var a2 = mk('a2', 2, new Date(2026, 9, 1,  6, 0));   /* Oct 1 */
    var a3 = mk('a3', 3, new Date(2026, 9, 1, 22, 0));   /* Oct 1 (same day) */
    var s = T0.computeArchiveStats([a1, a2, a3]);
    eq(s.total, 3);
    eq(s.activeDays, 2);
  });

  T('computeArchiveStats: active days across year boundary', function (eq) {
    var a1 = mk('a1', 1, new Date(2026, 11, 31, 23, 59));
    var a2 = mk('a2', 2, new Date(2027, 0, 1, 0, 1));
    var s = T0.computeArchiveStats([a1, a2]);
    eq(s.activeDays, 2);
  });

  T('computeArchiveStats: resolved/unresolved split', function (eq) {
    var res = {
      outcome: 'correct',
      resolvedAt: TM.util.localIso(new Date(2026, 9, 5)),
      touchedFirst: 'target', note: ''
    };
    var a1 = mk('a1', 1, new Date(2026, 9, 1), { resolution: res });
    var a2 = mk('a2', 2, new Date(2026, 9, 2), { resolution: res });
    var a3 = mk('a3', 3, new Date(2026, 9, 3));
    var s = T0.computeArchiveStats([a1, a2, a3]);
    eq(s.total, 3);
    eq(s.resolved, 2);
    eq(s.unresolved, 1);
  });

  T('computeArchiveStats: firstDate is the earliest createdAt (local ISO)', function (eq, ok) {
    var a1 = mk('a1', 1, new Date(2026, 9, 15));
    var a2 = mk('a2', 2, new Date(2026, 8, 1));
    var a3 = mk('a3', 3, new Date(2026, 9, 20));
    var s = T0.computeArchiveStats([a1, a2, a3]);
    ok(typeof s.firstDate === 'string', 'firstDate is a string');
    var d = new Date(s.firstDate);
    eq(d.getFullYear(), 2026);
    eq(d.getMonth(), 8);  /* September */
    eq(d.getDate(), 1);
  });

  /* ============================================================
     longDate
     ============================================================ */

  T('longDate: "Monday, October 5"', function (eq) {
    eq(T0.longDate(new Date(2026, 9, 5)), 'Monday, October 5');
  });

  T('longDate: handles every weekday name', function (eq) {
    /* Oct 5 2026 is Monday; Oct 11 2026 is Sunday. */
    eq(T0.longDate(new Date(2026, 9, 5)),  'Monday, October 5');
    eq(T0.longDate(new Date(2026, 9, 6)),  'Tuesday, October 6');
    eq(T0.longDate(new Date(2026, 9, 7)),  'Wednesday, October 7');
    eq(T0.longDate(new Date(2026, 9, 8)),  'Thursday, October 8');
    eq(T0.longDate(new Date(2026, 9, 9)),  'Friday, October 9');
    eq(T0.longDate(new Date(2026, 9, 10)), 'Saturday, October 10');
    eq(T0.longDate(new Date(2026, 9, 11)), 'Sunday, October 11');
  });

  /* ============================================================
     robustness
     ============================================================ */

  T('compute* functions tolerate undefined arrays', function (eq, ok) {
    var now = new Date(2026, 9, 5);
    eq(T0.computeYesterday(undefined, undefined, now).created, 0);
    eq(T0.computeNeedsResolution(undefined, now).count, 0);
    eq(T0.computeReviewsNeeded(undefined).count, 0);
    eq(T0.computeLast(undefined), null);
    eq(T0.computeArchiveStats(undefined).total, 0);
    ok(true);
  });

  /* ============================================================
     computeWaitingRows (R7)
     ============================================================ */

  T('waiting rows: three rows in order', function (eq) {
    var now = new Date(2026, 9, 5, 12, 0, 0);
    var arr = [
      mk('a1', 1, new Date(2026, 9, 4, 10, 0), {
        expiresAt: new Date(2026, 9, 4, 20, 0)   /* expired */
      }),
      mk('a2', 2, new Date(2026, 9, 4, 11, 0), {
        resolution: { outcome: 'correct',
                      resolvedAt: TM.util.localIso(new Date(2026, 9, 5, 8, 0)),
                      touchedFirst: 'target', note: '' }   /* needs review */
      }),
      mk('a3', 3, new Date(2026, 9, 4, 12, 0))    /* yesterday */
    ];
    var rows = T0.computeWaitingRows(arr, [], now);
    eq(rows.length, 3);
    eq(rows[0].key, 'resolve');
    eq(rows[1].key, 'review');
    eq(rows[2].key, 'yesterday');
  });

  T('waiting rows: counts match data', function (eq) {
    var now = new Date(2026, 9, 5, 12, 0, 0);
    var arr = [
      mk('a1', 1, new Date(2026, 9, 4, 10, 0), { expiresAt: new Date(2026, 9, 4, 20, 0) }),
      mk('a2', 2, new Date(2026, 9, 3, 10, 0), { expiresAt: new Date(2026, 9, 4, 20, 0) }),
      mk('a3', 3, new Date(2026, 9, 4, 11, 0), {
        resolution: { outcome: 'wrong',
                      resolvedAt: TM.util.localIso(new Date(2026, 9, 5, 8, 0)),
                      touchedFirst: 'invalidation', note: '' }
      }),
      mk('a4', 4, new Date(2026, 9, 4, 12, 0))
    ];
    var rows = T0.computeWaitingRows(arr, [], now);
    eq(rows[0].count, 2);   /* a1, a2 */
    eq(rows[1].count, 1);   /* a3 */
    eq(rows[2].count, 2);   /* a3, a4 - created Oct 4 */
  });

  T('waiting rows: up to 3 items per row', function (eq) {
    var now = new Date(2026, 9, 5, 12, 0, 0);
    var arr = [];
    for (var i = 0; i < 8; i++) {
      arr.push(mk('a' + i, i, new Date(2026, 9, 3, 10, 0), {
        expiresAt: new Date(2026, 9, 4, 20, 0)
      }));
    }
    var rows = T0.computeWaitingRows(arr, [], now);
    eq(rows[0].count, 8);
    eq(rows[0].items.length, 3);
  });

  T('waiting rows: yesterday uses previous local day only', function (eq) {
    var now = new Date(2026, 9, 5, 12, 0, 0);
    var arr = [
      mk('a1', 1, new Date(2026, 9, 4, 23, 59)),
      mk('a2', 2, new Date(2026, 9, 5, 0, 1)),   /* today, not yesterday */
      mk('a3', 3, new Date(2026, 9, 3, 12, 0))   /* 2 days ago */
    ];
    var rows = T0.computeWaitingRows(arr, [], now);
    eq(rows[2].count, 1);
    eq(rows[2].items[0].id, 'a1');
  });

  T('waiting rows: zero-count rows still returned by compute', function (eq) {
    var now = new Date(2026, 9, 5, 12, 0, 0);
    var rows = T0.computeWaitingRows([], [], now);
    eq(rows.length, 3);
    eq(rows[0].count, 0);
    eq(rows[1].count, 0);
    eq(rows[2].count, 0);
  });

})();