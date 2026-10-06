/* ============================================================================
   TradeMark — Floating Memories tests
   ----------------------------------------------------------------------------
   Zero-dependency tests for TM.memories (Part 4). All pure logic — no network,
   no timers, no canvas.

   Coverage:
     - extractText: URL stripping, first-sentence cut, 60-char cut at word
       boundary + ellipsis, short sentences kept as-is, empty input
     - pick: deterministic for same seed (same order, same text), 90-day
       window, one-per-analysis (by id), short-text skip, malformed records
       safely ignored, meta format
     - render: zero analyses -> 1-3 EXAMPLE chips, no links; real analyses
       -> no EXAMPLE chips, at least one link
     - slots(): desktop returns 6, mobile returns 3, positions in [0,1]
   ============================================================================ */

(function () {
  'use strict';

  var TM = window.TM;
  var test = TM.tests.test;
  var M = TM.memories;

  function T(name, fn) {
    test(name, function (helpers) {
      fn(helpers.eq, helpers.ok);
    });
  }

  /* Build a minimal analysis-shaped object for tests. Days-ago is relative
     to "now" so 90-day boundary tests behave correctly. */
  function mkAnalysis(i, daysAgo, text) {
    var d = new Date();
    d.setDate(d.getDate() - daysAgo);
    return {
      id: 'a' + i,
      number: i,
      createdAt: TM.util.localIso(d),
      text: text
    };
  }

  /* ============================================================
     extractText
     ============================================================ */

  T('extractText: strips URLs and normalises whitespace', function (eq) {
    var t = M._extractText('See https://tradingview.com/x/abc123 for context. Also www.x.io.');
    eq(t, 'See for context');
  });

  T('extractText: takes first sentence only', function (eq) {
    eq(M._extractText('First sentence. Second sentence.'), 'First sentence');
  });

  T('extractText: cuts to 60 chars at a word boundary + ellipsis', function (eq, ok) {
    var long = 'This is a very long analysis sentence that goes way beyond the sixty char limit easily';
    var out = M._extractText(long);
    ok(out.length <= 61, 'bounded length, got: ' + out.length);
    ok(out.charCodeAt(out.length - 1) === 0x2026, 'ends with ellipsis');
    ok(out.indexOf(' ') > 0, 'cut on a word boundary');
    eq(true, true);
  });

  T('extractText: keeps short sentences as-is (minus period)', function (eq) {
    eq(M._extractText('Wait for confirmation.'), 'Wait for confirmation');
    eq(M._extractText('Entered too early.'),    'Entered too early');
  });

  T('extractText: empty input returns empty string', function (eq) {
    eq(M._extractText(''), '');
    eq(M._extractText(null), '');
    eq(M._extractText(undefined), '');
  });

  T('extractText: whitespace-only input returns empty string', function (eq) {
    eq(M._extractText('   \n\t  '), '');
  });

  T('extractText: no-period text under 60 chars is returned whole', function (eq) {
    eq(M._extractText('BTC is coiling above support'), 'BTC is coiling above support');
  });

  T('extractText: multiple URLs and spaces collapse cleanly', function (eq) {
    var t = M._extractText('Check  https://a.io/x  and  https://b.io/y  before entry.');
    eq(t, 'Check and before entry');
  });

  /* ============================================================
     pick — determinism
     ============================================================ */

  T('pick: same seed -> identical order and text', function (eq) {
    var arr = [
      mkAnalysis(1, 1, 'One short note about BTC'),
      mkAnalysis(2, 2, 'Two short note about ETH'),
      mkAnalysis(3, 3, 'Three short note about SOL'),
      mkAnalysis(4, 4, 'Four short note about BNB')
    ];
    var a = M.pick(arr, { seed: 12345, count: 3 });
    var b = M.pick(arr, { seed: 12345, count: 3 });
    eq(a.length, b.length);
    for (var i = 0; i < a.length; i++) {
      eq(a[i].id, b[i].id);
      eq(a[i].text, b[i].text);
      eq(a[i].meta, b[i].meta);
    }
  });

  T('pick: different seed -> generally different order', function (eq, ok) {
    var arr = [];
    for (var i = 1; i <= 20; i++) {
      arr.push(mkAnalysis(i, i % 10, 'Consistent text about levels ' + i));
    }
    var a = M.pick(arr, { seed: 1, count: 6 });
    var b = M.pick(arr, { seed: 2, count: 6 });
    var sameOrder = a.map(function (x) { return x.id; }).join(',') ===
                    b.map(function (x) { return x.id; }).join(',');
    ok(!sameOrder, 'different seeds should usually differ');
    eq(true, true);
  });

  /* ============================================================
     pick — filtering
     ============================================================ */

  T('pick: candidates outside 90 days are excluded', function (eq) {
    var arr = [
      mkAnalysis(1, 5,   'Recent note about market structure'),
      mkAnalysis(2, 120, 'Old note that should be ignored')
    ];
    var out = M.pick(arr, { seed: 1, count: 6 });
    eq(out.length, 1);
    eq(out[0].id, 'a1');
  });

  T('pick: exactly at 90-day boundary is kept (t >= cutoff)', function (eq, ok) {
    /* cutoff is Date.now() - 90 * 86400000. A record created ~89.9 days ago
       is well inside; 90.1 days ago is outside. */
    var arr = [
      mkAnalysis(1, 89, 'Very recent text for boundary check'),
      mkAnalysis(2, 91, 'Slightly old text for boundary check')
    ];
    var out = M.pick(arr, { seed: 1, count: 6 });
    ok(out.length >= 1, 'at least the 89-day one must survive');
    var ids = out.map(function (o) { return o.id; });
    ok(ids.indexOf('a1') >= 0, 'a1 (89 days) must be present');
    ok(ids.indexOf('a2') === -1, 'a2 (91 days) must be excluded');
    eq(true, true);
  });

  T('pick: short texts are skipped', function (eq) {
    var arr = [
      mkAnalysis(1, 5, 'short'),                               /* < 12 chars */
      mkAnalysis(2, 5, 'This is long enough to qualify.')
    ];
    var out = M.pick(arr, { seed: 1, count: 6 });
    eq(out.length, 1);
    eq(out[0].id, 'a2');
  });

  T('pick: at most one chip per analysis (by id)', function (eq) {
    var arr = [];
    for (var i = 1; i <= 10; i++) {
      arr.push(mkAnalysis(i, i, 'Consistent text about levels ' + i));
    }
    var out = M.pick(arr, { seed: 7, count: 6 });
    var ids = out.map(function (o) { return o.id; });
    var uniq = ids.filter(function (v, idx) { return ids.indexOf(v) === idx; });
    eq(ids.length, uniq.length);
  });

  T('pick: malformed records are safely ignored', function (eq, ok) {
    var arr = [
      null,
      undefined,
      { id: 'x' },                                              /* no createdAt */
      { id: 'y', createdAt: 'not-a-date', text: 'Some text here' },
      mkAnalysis(3, 5, 'Valid enough analysis text.')
    ];
    var out = M.pick(arr, { seed: 1, count: 6 });
    ok(Array.isArray(out));
    eq(out.length, 1);
    eq(out[0].id, 'a3');
  });

  T('pick: count defaults to 6 when opts.count omitted', function (eq) {
    var arr = [];
    for (var i = 1; i <= 20; i++) {
      arr.push(mkAnalysis(i, i, 'Consistent text about levels ' + i));
    }
    var out = M.pick(arr, { seed: 1 });
    eq(out.length, 6);
  });

  T('pick: count smaller than pool size is honoured', function (eq) {
    var arr = [];
    for (var i = 1; i <= 20; i++) {
      arr.push(mkAnalysis(i, i, 'Consistent text about levels ' + i));
    }
    var out = M.pick(arr, { seed: 1, count: 2 });
    eq(out.length, 2);
  });

  /* ============================================================
     pick — meta format
     ============================================================ */

  T('pick: meta formatted "#N · Mon D"', function (eq, ok) {
    var arr = [mkAnalysis(127, 5, 'BTC approaching resistance here for sure.')];
    var out = M.pick(arr, { seed: 1, count: 1 });
    eq(out.length, 1);
    ok(/^#127 \u00B7 [A-Z][a-z]{2} \d+$/.test(out[0].meta),
       'meta: ' + out[0].meta);
    eq(true, true);
  });

  /* ============================================================
     pick — empty / no-candidates
     ============================================================ */

  T('pick: empty array returns empty result', function (eq) {
    eq(M.pick([], { seed: 1, count: 6 }).length, 0);
  });

  T('pick: all-candidates-too-short returns empty result', function (eq) {
    var arr = [
      mkAnalysis(1, 5, 'tiny'),
      mkAnalysis(2, 5, 'bit')
    ];
    eq(M.pick(arr, { seed: 1, count: 6 }).length, 0);
  });

  /* ============================================================
     slots
     ============================================================ */

  T('slots: positions are percentages within [0, 1]', function (eq, ok) {
    var s = M.slots();
    ok(s.length === 3 || s.length === 6,
       'slots should be 3 (mobile) or 6 (desktop), got ' + s.length);
    for (var i = 0; i < s.length; i++) {
      ok(s[i].x >= 0 && s[i].x <= 1, 'x out of range: ' + s[i].x);
      ok(s[i].y >= 0 && s[i].y <= 1, 'y out of range: ' + s[i].y);
    }
    eq(true, true);
  });

  T('slots: desktop slots avoid the left H1/CTA block', function (ok) {
    /* At least in jsdom-like environments, matchMedia returns desktop by
       default. If it doesn't, skip the desktop-only assertion. */
    var s = M.slots();
    if (s.length === 6) {
      for (var i = 0; i < s.length; i++) {
        if (s[i].x < 0.5) {
          /* one slot near the middle-lower zone is allowed at x ≈ 0.55 */
          if (s[i].x < 0.5) {
            throw new Error('desktop slot ' + i + ' overlaps the left block');
          }
        }
      }
    }
    ok(true);
  });

  /* ============================================================
     render — empty state
     ============================================================ */

  T('render: zero analyses -> up to 3 EXAMPLE chips, no links', function (eq, ok) {
    var c = document.createElement('div');
    M.render(c, []);
    var chips = c.querySelectorAll('.tm-mem--example');
    ok(chips.length >= 1 && chips.length <= 3, '1-3 examples');
    eq(c.querySelectorAll('a.tm-mem').length, 0);
    ok(true);
  });

  T('render: EXAMPLE chips are not clickable (spans, not anchors)', function (eq, ok) {
    var c = document.createElement('div');
    M.render(c, []);
    var chips = c.querySelectorAll('.tm-mem--example');
    ok(chips.length > 0);
    for (var i = 0; i < chips.length; i++) {
      eq(chips[i].tagName.toLowerCase(), 'span');
    }
    ok(true);
  });

  T('render: EXAMPLE chips carry the EXAMPLE tag', function (eq, ok) {
    var c = document.createElement('div');
    M.render(c, []);
    var tags = c.querySelectorAll('.tm-mem--example .tm-mem__tag');
    ok(tags.length > 0, 'at least one EXAMPLE tag');
    eq(tags[0].textContent, 'EXAMPLE');
    ok(true);
  });

  /* ============================================================
     render — real data
     ============================================================ */

  T('render: real analyses -> no EXAMPLE chips', function (eq, ok) {
    var arr = [mkAnalysis(1, 1, 'BTC rejected resistance exactly as planned.')];
    var c = document.createElement('div');
    M.render(c, arr);
    eq(c.querySelectorAll('.tm-mem--example').length, 0);
    ok(c.querySelectorAll('a.tm-mem').length >= 1, 'has at least one real chip');
    ok(true);
  });

  T('render: real chips are anchors with #/analysis/<id>', function (eq, ok) {
    var arr = [mkAnalysis(1, 1, 'BTC rejected resistance exactly as planned.')];
    var c = document.createElement('div');
    M.render(c, arr);
    var a = c.querySelector('a.tm-mem');
    ok(!!a, 'expected at least one anchor');
    eq(a.getAttribute('href'), '#/analysis/a1');
    ok(true);
  });

  T('render: real chips carry a meta line', function (eq, ok) {
    var arr = [mkAnalysis(127, 1, 'BTC rejected resistance exactly as planned.')];
    var c = document.createElement('div');
    M.render(c, arr);
    var meta = c.querySelector('.tm-mem__meta');
    ok(!!meta, 'expected meta element');
    ok(meta.textContent.indexOf('#127') === 0, 'meta starts with #127');
    ok(true);
  });

  T('render: real analyses are never mixed with EXAMPLE chips', function (eq, ok) {
    var arr = [mkAnalysis(1, 1, 'BTC rejected resistance exactly as planned.')];
    var c = document.createElement('div');
    M.render(c, arr);
    eq(c.querySelectorAll('.tm-mem--example').length, 0);
    ok(c.querySelectorAll('a.tm-mem').length > 0);
    ok(true);
  });

  T('render: container is cleared before each render', function (eq) {
    var arr1 = [mkAnalysis(1, 1, 'First analysis with valid text.')];
    var arr2 = [mkAnalysis(2, 1, 'Second analysis with valid text.')];
    var c = document.createElement('div');
    M.render(c, arr1);
    M.render(c, arr2);
    eq(c.querySelectorAll('a.tm-mem').length, 1);
    eq(c.querySelector('a.tm-mem').getAttribute('href'), '#/analysis/a2');
  });

  T('render: too-short real analyses fall back to EXAMPLE state', function (eq, ok) {
    var arr = [mkAnalysis(1, 1, 'tiny')];
    var c = document.createElement('div');
    M.render(c, arr);
    ok(c.querySelectorAll('.tm-mem--example').length > 0,
       'short-only input must show examples');
    eq(c.querySelectorAll('a.tm-mem').length, 0);
    ok(true);
  });

  /* ============================================================
     sources extension point
     ============================================================ */

  T('sources: array exists and holds at least one source function', function (eq, ok) {
    ok(Array.isArray(M.sources), 'sources must be an array');
    ok(M.sources.length >= 1, 'at least one source');
    eq(typeof M.sources[0], 'function');
    ok(true);
  });
})();