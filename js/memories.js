/* ============================================================================
   TradeMark — Floating Memories ("Ledger Terminal")
   ----------------------------------------------------------------------------
   A subtle visual layer over the hero showing chips from the user's own
   trading history. Pointer-events: none on the layer; chips themselves are
   interactive.

   - pick(analyses, {seed, count}) is a PURE deterministic function.
   - Chips are placed at predefined SLOTS (percent rects), never random.

   Part 7 slot layout:
     Desktop: hero is asymmetric — text on the left column, terminal frame
              on the right. Chips live only in the right column
              (x >= 0.58) and stay below the frame header (y >= 0.24) and
              above the frame bottom (y <= 0.84).
     Mobile : hero is stacked — text on top, frame below. Chips float over
              the frame body, below the frame header (y >= 0.72).

   Motion: slow transform-only drift (translate3d), unique durations 18-34s,
   alternate direction; opacity 0.55 -> 1 on hover/focus. No blur filters.
   Reduced motion: static, no drift.

   Empty state (zero real analyses): up to 3 clearly labeled EXAMPLE chips
   (dashed border, "EXAMPLE" tag, not clickable). As soon as one real
   analysis exists, examples disappear completely — never mixed.

   Extension point: TM.memories.sources = [fn(analyses, opts) -> items].
   Only the analyses source is implemented. Reviews / reflections / insights
   sources will be appended in later phases.

   Exports:
     TM.memories.pick(analyses, opts)
     TM.memories.render(container, analyses)
     TM.memories.slots()
     TM.memories.sources        (extension array)
     TM.memories._extractText   (test-only)
   ============================================================================ */

(function () {
  'use strict';

  var TM = (window.TM = window.TM || {});
  var util = TM.util;
  var el = util.el;

  /* ============================================================
     constants
     ============================================================ */

  var MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /* Part 7: slots are constrained to the right column on desktop
     (x >= 0.58) and to the lower half on mobile (y >= 0.72). */
  var SLOTS_DESKTOP = [
    { x: 0.62, y: 0.24 },
    { x: 0.84, y: 0.30 },
    { x: 0.90, y: 0.50 },
    { x: 0.86, y: 0.70 },
    { x: 0.64, y: 0.84 },
    { x: 0.58, y: 0.58 }
  ];
  var SLOTS_MOBILE = [
    { x: 0.22, y: 0.72 },
    { x: 0.78, y: 0.76 },
    { x: 0.50, y: 0.88 }
  ];

  var EXAMPLES = [
    'Wait for confirmation.',
    'Entered too early.',
    'Most of my mistakes were on low timeframes.'
  ];

  var MIN_TEXT_LEN = 12;
  var MAX_TEXT_LEN = 60;
  var MAX_AGE_DAYS = 90;

  /* ============================================================
     helpers
     ============================================================ */

  function isMobile() {
    return window.matchMedia('(max-width: 720px)').matches;
  }

  function slots() {
    return isMobile() ? SLOTS_MOBILE : SLOTS_DESKTOP;
  }

  function shortMeta(d) {
    return MONTHS_SHORT[d.getMonth()] + ' ' + d.getDate();
  }

  /* First sentence, whitespace-normalised, URLs stripped, cut to
     MAX_TEXT_LEN at a word boundary + ellipsis. */
  function extractText(raw) {
    if (!raw) return '';
    var s = String(raw)
      .replace(/https?:\/\/\S+/gi, '')
      .replace(/www\.\S+/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

    var dot = s.indexOf('.');
    if (dot >= 0 && dot < 200) s = s.slice(0, dot);
    s = s.trim();

    if (s.length > MAX_TEXT_LEN) {
      var cut = s.slice(0, MAX_TEXT_LEN);
      var sp = cut.lastIndexOf(' ');
      if (sp > 40) cut = cut.slice(0, sp);
      s = cut + '\u2026';
    }
    return s;
  }

  /* FNV-1a hash of the local date key — stable per calendar day. */
  function daySeed() {
    var key = util.localDateKey(new Date());
    var h = 2166136261 >>> 0;
    for (var i = 0; i < key.length; i++) {
      h ^= key.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h;
  }

  function shuffle(arr, rng) {
    var out = arr.slice();
    for (var i = out.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = out[i]; out[i] = out[j]; out[j] = t;
    }
    return out;
  }

  /* ============================================================
     pick — pure, deterministic given the same seed
     ============================================================ */

  function pick(analyses, opts) {
    opts = opts || {};
    var count = opts.count || 6;
    var seed = opts.seed == null ? daySeed() : (opts.seed >>> 0);
    var rng = util.mulberry32(seed);
    var now = Date.now();
    var cutoff = now - MAX_AGE_DAYS * 86400000;

    /* candidate pool: last 90 days */
    var pool = (analyses || []).filter(function (a) {
      if (!a || typeof a !== 'object') return false;
      if (typeof a.createdAt !== 'string') return false;
      var t = new Date(a.createdAt).getTime();
      return !isNaN(t) && t >= cutoff;
    });
    pool = shuffle(pool, rng);

    var seen = Object.create(null);
    var out = [];
    for (var i = 0; i < pool.length && out.length < count; i++) {
      var a = pool[i];
      if (seen[a.id]) continue;
      seen[a.id] = true;

      var t = extractText(a.text);
      if (t.length < MIN_TEXT_LEN) continue;

      out.push({
        id: a.id,
        text: t,
        meta: '#' + a.number + ' \u00B7 ' + shortMeta(new Date(a.createdAt))
      });
    }
    return out;
  }

  /* ============================================================
     rendering
     ============================================================ */

  function chip(item, index) {
    var slotList = slots();
    var s = slotList[index % slotList.length];
    var isExample = item.example === true;

    var attrs = {
      class: 'tm-mem' + (isExample ? ' tm-mem--example' : ''),
      style: {
        left: (s.x * 100) + '%',
        top:  (s.y * 100) + '%'
      },
      'data-idx': String(index)
    };
    if (!isExample) attrs.href = '#/analysis/' + item.id;

    var node = isExample ? el('span', attrs) : el('a', attrs);

    if (isExample) {
      node.appendChild(el('span', { class: 'tm-mem__tag', text: 'EXAMPLE' }));
    }
    node.appendChild(el('span', { text: item.text }));

    if (!isExample) {
      node.appendChild(el('span', { class: 'tm-mem__meta', text: item.meta }));

      /* unique slow drift per chip, alternate direction */
      var dur = 18 + ((index * 5 + 7) % 17);   /* 18..34s */
      var key = (index % 2 === 0) ? 'tm-mem-drift-a' : 'tm-mem-drift-b';
      node.style.animation = key + ' ' + dur + 's ease-in-out infinite alternate';
    }
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function render(container, analyses) {
    clear(container);

    /* gather candidates from all registered sources */
    var candidates = [];
    var sources = TM.memories.sources;
    for (var i = 0; i < sources.length; i++) {
      var res = sources[i](analyses, { count: 6 });
      for (var j = 0; j < res.length; j++) candidates.push(res[j]);
    }

    /* cap by slot count, dedupe by id */
    var limit = slots().length;
    var seen = Object.create(null);
    var items = [];
    for (var k = 0; k < candidates.length && items.length < limit; k++) {
      var c = candidates[k];
      if (seen[c.id]) continue;
      seen[c.id] = true;
      items.push(c);
    }

    /* empty state: examples only, never mixed with real chips */
    if (items.length === 0) {
      var maxEx = Math.min(3, EXAMPLES.length);
      for (var e = 0; e < maxEx; e++) {
        container.appendChild(chip({ text: EXAMPLES[e], example: true }, e));
      }
      return;
    }

    for (var m = 0; m < items.length; m++) {
      container.appendChild(chip(items[m], m));
    }
  }

  /* ============================================================
     sources — extension point
     ============================================================ */

  function analysesSource(analyses, opts) {
    return pick(analyses, opts);
  }

  /* ============================================================
     exports
     ============================================================ */

  TM.memories = {
    pick:   pick,
    render: render,
    slots:  slots,

    /* extension point — later phases append more sources */
    sources: [analysesSource],

    /* test-only */
    _extractText: extractText
  };
})();