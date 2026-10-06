/* ============================================================================
   TradeMark — Store
   ----------------------------------------------------------------------------
   The DATA CONTRACT. Currently backed by an in-memory Map. A future IndexedDB
   adapter MUST implement the same methods with identical signatures / shapes,
   so callers never change.

   Async API:
     TM.store.ready()                -> Promise<void>
     TM.store.listAnalyses(opts?)    -> Promise<Analysis[]>
          opts: { status?, from?, to?, limit?, order? }
            status: 'open' | 'expired' | 'resolved'
            from, to: Date (inclusive)
            order: 'asc' | 'desc' (by createdAt), default 'desc'
            limit: number
     TM.store.getAnalysis(id)        -> Promise<Analysis|null>
     TM.store.countAnalyses()        -> Promise<number>
     TM.store.listReviews()          -> Promise<Review[]>
     TM.store.onChange(cb)           -> () => void  (unsubscribe)

   Analysis (returned frozen):
     { id, number, createdAt (local ISO+offset), text,
       primaryAsset, relatedAssets[], direction, target, invalidation,
       timeframe, expiresAt, confidence, screenshotId,
       resolution, reviewId }

   Review (returned frozen):
     { id, analysisId, createdAt, followedPlan,
       wentRight, wentWrong, wouldChange, mentalState }

   Derived status (computed, NOT stored):
     open     -> resolution === null && (expiresAt == null || now <  expiresAt)
     expired  -> resolution === null &&  expiresAt != null && now >= expiresAt
     resolved -> resolution !== null

   Part 6 additions:
     - listAnalyses() silently skips malformed records with a console.warn.
     - No behaviour change for valid data.
   ============================================================================ */

(function () {
  'use strict';

  var TM = (window.TM = window.TM || {});
  var util = TM.util;

  /* ============================================================
     internal state
     ============================================================ */

  var analyses = new Map();   // id -> frozen Analysis
  var reviews  = new Map();   // id -> frozen Review
  var nextNumber = 1;
  var listeners = new Set();

  /* ============================================================
     internals
     ============================================================ */

  function notify() {
    listeners.forEach(function (cb) {
      try { cb(); }
      catch (e) { console.error('[store] listener error', e); }
    });
  }

  function statusOf(a, now) {
    if (!a) return 'open';
    if (a.resolution) return 'resolved';
    if (a.expiresAt && new Date(a.expiresAt).getTime() <= now.getTime()) {
      return 'expired';
    }
    return 'open';
  }

  function freezeAnalysis(a) {
    if (a.relatedAssets) Object.freeze(a.relatedAssets);
    if (a.resolution)    Object.freeze(a.resolution);
    return Object.freeze(a);
  }

  function freezeReview(r) {
    return Object.freeze(r);
  }

  /* ============================================================
     public API
     ============================================================ */

  function ready() {
    if (TM.config && TM.config.DEV) {
      var mode = devSeedMode();
      if (mode) seed(mode);
    }
    return Promise.resolve();
  }

  function listAnalyses(opts) {
    opts = opts || {};
    var now = new Date();
    var order = opts.order === 'asc' ? 1 : -1;

    var arr = Array.from(analyses.values());

    /* Part 6: skip malformed records — never crash the UI. */
    arr = arr.filter(function (a) {
      if (!a || typeof a !== 'object') {
        console.warn('[store] skipping malformed record');
        return false;
      }
      if (typeof a.createdAt !== 'string') {
        console.warn('[store] skipping record without createdAt');
        return false;
      }
      if (isNaN(new Date(a.createdAt).getTime())) {
        console.warn('[store] skipping record with invalid createdAt');
        return false;
      }
      return true;
    });

    if (opts.status) {
      arr = arr.filter(function (a) { return statusOf(a, now) === opts.status; });
    }
    if (opts.from) {
      var fromT = opts.from.getTime();
      arr = arr.filter(function (a) {
        return new Date(a.createdAt).getTime() >= fromT;
      });
    }
    if (opts.to) {
      var toT = opts.to.getTime();
      arr = arr.filter(function (a) {
        return new Date(a.createdAt).getTime() <= toT;
      });
    }

    arr.sort(function (x, y) {
      return (new Date(x.createdAt) - new Date(y.createdAt)) * order;
    });

    if (opts.limit) arr = arr.slice(0, opts.limit);

    return Promise.resolve(arr);
  }

  function getAnalysis(id) {
    return Promise.resolve(analyses.get(id) || null);
  }

  function countAnalyses() {
    return Promise.resolve(analyses.size);
  }

  function listReviews() {
    return Promise.resolve(Array.from(reviews.values()));
  }

  function onChange(cb) {
    if (typeof cb !== 'function') return function () {};
    listeners.add(cb);
    return function () { listeners.delete(cb); };
  }

  TM.store = {
    ready:          ready,
    listAnalyses:   listAnalyses,
    getAnalysis:    getAnalysis,
    countAnalyses:  countAnalyses,
    listReviews:    listReviews,
    onChange:       onChange,

    /* Exposed for tests only. Do not depend on this in app code. */
    _statusOf:      statusOf
  };

  /* ============================================================
     DEV SEEDING
     Runs only when TM.config.DEV is true and a seed mode is set.
     Never persisted.
     ============================================================ */

  function devSeedMode() {
    var h = window.location.hash;
    if (!/(?:^|[#&?])dev(?:$|[&=])/.test(h)) return null;
    var m = h.match(/[&?]seed=([a-z]+)/);
    return m ? m[1] : null;
  }

  var ASSETS = ['BTC', 'ETH', 'BTC.D', 'USDT.D', 'ETH.D', 'SOL'];
  var TFS    = ['15M', '1H', '4H', '1D'];
  var DIRS   = ['bullish', 'bearish', 'neutral'];
  var OUTS   = ['correct', 'partial', 'wrong', 'invalid'];
  var TF_MS  = {
    '15M': 15 * 60e3,
    '1H':  60 * 60e3,
    '4H':  4 * 60 * 60e3,
    '1D':  24 * 60 * 60e3
  };

  var TEXT_SAMPLES = [
    'Watching $A into resistance. Waiting for a reaction before committing.',
    'Structure on $TF suggests continuation while $R holds.',
    'If we lose this level, expect a sweep of the prior low before any reclaim.',
    '$A compressing into a decision point. Patience here.',
    'Bearish if rejection confirms; otherwise invalidate above the wick.'
  ];

  function pick(rng, arr) {
    return arr[Math.floor(rng() * arr.length)];
  }

  function pickCreated(i, rng, now) {
    /* Deterministic corner cases at fixed indices:
         0 -> yesterday 10:15
         1 -> yesterday 23:59 (midnight-boundary check)
         2 -> today 00:01 (midnight-boundary check)
         3 -> 8 days ago (open-but-expired case) */
    if (i === 0) return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 10, 15, 0);
    if (i === 1) return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 20);
    if (i === 2) return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 1, 10);
    if (i === 3) return new Date(now.getTime() - 8 * 24 * 3600e3);

    var daysAgo = Math.floor(rng() * 45);
    var hh = Math.floor(rng() * 24);
    var mm = Math.floor(rng() * 60);
    var d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, hh, mm, 0);
    if (d.getTime() > now.getTime()) d = new Date(now.getTime() - 60e3);
    return d;
  }

  function maybeResolve(i, created, now, rng) {
    if (i === 3) return null; /* forced open-but-expired */

    var ageDays = (now.getTime() - created.getTime()) / 86400000;
    var p = ageDays > 3 ? 0.85 : ageDays > 1 ? 0.5 : 0.15;
    if (rng() >= p) return null;

    var outcome = pick(rng, OUTS);
    var touched = outcome === 'correct' ? 'target'
                : outcome === 'wrong'   ? 'invalidation'
                : pick(rng, ['target', 'invalidation', 'neither']);

    var resolvedAt = new Date(created.getTime() + Math.min(now - created, 3 * 86400000));
    return {
      outcome:      outcome,
      resolvedAt:   util.localIso(resolvedAt),
      touchedFirst: touched,
      note:         ''
    };
  }

  function makeAnalysis(i, created, rng) {
    var tf = pick(rng, TFS);
    var primary = pick(rng, ASSETS);

    var related = [];
    var nRel = Math.floor(rng() * 3);
    var guard = 0;
    while (related.length < nRel && guard++ < 12) {
      var a = pick(rng, ASSETS);
      if (a !== primary && related.indexOf(a) === -1) related.push(a);
    }

    var direction = pick(rng, DIRS);
    var confidence = 40 + Math.floor(rng() * 55);
    var expiresAt = new Date(created.getTime() + TF_MS[tf] * (2 + Math.floor(rng() * 3)));

    var now = new Date();
    var resolution = maybeResolve(i, created, now, rng);

    var number = i + 1;
    var id = 'a' + String(number).padStart(4, '0');
    var reviewId = (resolution && rng() < 0.7)
      ? 'r' + String(number).padStart(4, '0')
      : null;

    var text = pick(rng, TEXT_SAMPLES)
      .replace('$A',  primary)
      .replace('$TF', tf)
      .replace('$R',  related[0] || 'USDT.D');

    var base = primary === 'BTC' ? 80000
             : primary === 'ETH' ? 3000
             : 50;

    var target = direction === 'bearish'
      ? Math.round(base * (0.94 + rng() * 0.03))
      : direction === 'bullish'
        ? Math.round(base * (1.03 + rng() * 0.04))
        : null;

    var invalidation = direction === 'bearish'
      ? Math.round(base * (1.02 + rng() * 0.02))
      : direction === 'bullish'
        ? Math.round(base * (0.95 + rng() * 0.02))
        : null;

    return {
      id:             id,
      number:         number,
      createdAt:      util.localIso(created),
      text:           text,
      primaryAsset:   primary,
      relatedAssets:  related,
      direction:      direction,
      target:         target,
      invalidation:   invalidation,
      timeframe:      tf,
      expiresAt:      util.localIso(expiresAt),
      confidence:     confidence,
      screenshotId:   null,
      resolution:     resolution,
      reviewId:       reviewId
    };
  }

  function makeReview(analysis, rng) {
    var created = new Date(new Date(analysis.createdAt).getTime() + 2 * 86400000);
    return freezeReview({
      id:          analysis.reviewId,
      analysisId:  analysis.id,
      createdAt:   util.localIso(created),
      followedPlan: rng() < 0.7,
      wentRight:   '',
      wentWrong:   '',
      wouldChange: '',
      mentalState: ''
    });
  }

  function seed(mode) {
    var count = mode === 'many' ? 60
              : mode === 'few'  ? 5
              : 0;
    if (!count) return;

    /* Deterministic per mode, so reloads look the same. */
    var rng = util.mulberry32(0xC0FFEE ^ count);
    var now = new Date();

    for (var i = 0; i < count; i++) {
      var created = pickCreated(i, rng, now);
      var analysis = makeAnalysis(i, created, rng);
      analyses.set(analysis.id, freezeAnalysis(analysis));
      if (analysis.number >= nextNumber) nextNumber = analysis.number + 1;
      if (analysis.reviewId) {
        reviews.set(analysis.reviewId, makeReview(analysis, rng));
      }
    }

    notify();
  }
})();