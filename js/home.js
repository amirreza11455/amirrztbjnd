/* ============================================================================
   Tamga — Home view (R4 + R5 + R7)
   ----------------------------------------------------------------------------
   Composes: hero + hook + timeline + slip + waiting.
   ============================================================================ */

(function () {
  'use strict';

  var TM = (window.TM = window.TM || {});

  var _selectedId = null;
  var _intervalId = null;

  /* Return the template's DocumentFragment so ALL sections are appended,
     not just the first one. */
  function build() {
    var tpl = document.getElementById('tm-home-template');
    if (!tpl) return null;
    return tpl.content.cloneNode(true);
  }

  function wireCtas(root) {
    var btns = root.querySelectorAll('[data-action="new-analysis"]');
    Array.prototype.forEach.call(btns, function (b) {
      b.addEventListener('click', function () {
        if (TM.shell && TM.shell.newAnalysis) TM.shell.newAnalysis();
      });
    });
  }

  /* ------------------------------------------------------------
     hero chart
     ------------------------------------------------------------ */

  var _chart = null;

  function mountChart(root) {
    var canvas = root.querySelector('#tm-hero-canvas');
    if (!canvas || !TM.HeroChart) return function () {};

    _chart = new TM.HeroChart();
    _chart.mount(canvas, { seed: 42 });
    _chart.start();

    var priceEl  = root.querySelector('#tm-hero-price');
    var changeEl = root.querySelector('#tm-hero-change');
    var lastClose = null;

    _chart.onFrame(function () {
      if (!priceEl || !changeEl) return;
      var candles = _chart.candles;
      if (!candles || !candles.length) return;
      var last = candles[candles.length - 1];
      var first = candles[0];
      var price = (last.c / 100 * 80000 + 20000).toFixed(0);
      var pct = ((last.c - first.c) / first.c * 100).toFixed(2);
      priceEl.textContent = '$' + Number(price).toLocaleString();
      var up = last.c >= first.c;
      changeEl.textContent = (up ? '+' : '') + pct + '%';
      changeEl.className = 'tm-hero__chart-price-chg ' +
        (up ? 'tm-hero__chart-price-chg--up' : 'tm-hero__chart-price-chg--down');
    });

    return function () {
      if (_chart) { _chart.destroy(); _chart = null; }
    };
  }

  /* ------------------------------------------------------------
     timeline + slip
     ------------------------------------------------------------ */

  function mountProof(root) {
    var timelineEl = root.querySelector('.tm-timeline');
    var slipHost   = root.querySelector('#tm-slip-host');
    if (!timelineEl || !slipHost) return function () {};

    var latest = [];
    var unsub = null;

    function renderSlip() {
      var sel = null;
      if (_selectedId) {
        for (var i = 0; i < latest.length; i++) {
          if (latest[i].id === _selectedId) { sel = latest[i]; break; }
        }
      }
      if (!sel && latest.length) {
        var sorted = latest.slice().sort(function (a, b) {
          return new Date(b.createdAt) - new Date(a.createdAt);
        });
        sel = sorted[0];
        _selectedId = sel.id;
      }
      if (!sel) _selectedId = null;
      TM.timeline._setSelectedId(_selectedId);
      TM.slip.render(slipHost, sel || null, new Date(), {
        onAction: function (label) {
          if (TM.shell && TM.shell.modal) {
            TM.shell.modal({
              title: label,
              body: 'Coming in Phase 1.',
              actions: [{ label: 'OK', variant: 'primary' }]
            });
          }
        }
      });
    }

    function renderTimeline() {
      TM.timeline._setSelectedId(_selectedId);
      TM.timeline.render(timelineEl, latest, new Date(), {
        onSelect: function (analysis) {
          _selectedId = analysis.id;
          renderSlip();
          renderTimeline();
        },
        selectedId: _selectedId
      });
    }

    function refresh() {
      if (!TM.store || !TM.store.listAnalyses) {
        latest = [];
        renderTimeline();
        renderSlip();
        return;
      }
      TM.store.listAnalyses({ order: 'desc' })
        .then(function (items) {
          latest = items || [];
          renderTimeline();
          renderSlip();
        })
        .catch(function (err) {
          console.error('[home] timeline load failed', err);
          latest = [];
          renderTimeline();
          renderSlip();
        });
    }

    refresh();
    unsub = TM.store.onChange(refresh);

    _intervalId = setInterval(function () {
      if (document.hidden) return;
      renderTimeline();
      renderSlip();
    }, 60000);

    return function () {
      if (unsub) unsub();
      if (_intervalId) { clearInterval(_intervalId); _intervalId = null; }
    };
  }

  /* ------------------------------------------------------------
     waiting on you
     ------------------------------------------------------------ */

  function mountWaiting(root) {
    var rows = root.querySelector('#tm-waiting-rows');
    if (!rows || !TM.today) return function () {};

    var unsub = null;

    function refresh() {
      Promise.all([
        TM.store.listAnalyses({ order: 'desc' }),
        TM.store.listReviews()
      ]).then(function (res) {
        TM.today.render(rows, res[0], res[1], new Date());
      }).catch(function (err) {
        console.error('[home] waiting load failed', err);
        TM.today.render(rows, [], [], new Date());
      });
    }
    refresh();
    unsub = TM.store.onChange(refresh);
    return function () { if (unsub) unsub(); };
  }

  /* ------------------------------------------------------------
     render
     ------------------------------------------------------------ */

  function render(outlet) {
    try {
      var frag = build();
      if (!frag) throw new Error('home template missing');

      /* Append the whole fragment so all sections land in the outlet. */
      outlet.appendChild(frag);

      /* Query against the outlet — it now holds every section. */
      wireCtas(outlet);

      var chartOff  = mountChart(outlet);
      var proofOff = mountProof(outlet);
      var todayOff = mountWaiting(outlet);

      return function teardown() {
        if (chartOff) chartOff();
        if (proofOff) proofOff();
        if (todayOff) todayOff();
        _selectedId = null;
      };
    } catch (err) {
      console.error('[home] render failed', err);
      if (TM.shell && TM.shell.toast) {
        TM.shell.toast('Could not load home view.', { type: 'danger', ms: 4000 });
      }
      var fallback = document.createElement('section');
      fallback.className = 'tm-view';
      fallback.appendChild(document.createTextNode('Something went wrong.'));
      while (outlet.firstChild) outlet.removeChild(outlet.firstChild);
      outlet.appendChild(fallback);
      return function () {};
    }
  }

  TM.home = { render: render };
})();