/* ============================================================================
   Tamga — Shell (R3, final)
   ----------------------------------------------------------------------------
   Top bar with wordmark, live status line, desktop nav; mobile bottom tab bar.
   Both navs are built from ROUTES. The inactive one is display:none (a11y tree
   contains only one).

   Note: perf-toggle wiring was removed in R8 along with the chart modules.
   ============================================================================ */

(function () {
  'use strict';

  var TM = (window.TM = window.TM || {});
  var util = TM.util;
  var el = util.el;

  /* ============================================================
     routes
     ============================================================ */

  var ROUTES = [
    { path: '/home',         label: 'Home',         nav: false },
    { path: '/analyses',     label: 'Analyses',     nav: true  },
    { path: '/archive',      label: 'Archive',      nav: true  },
    { path: '/reviews',      label: 'Reviews',      nav: true  },
    { path: '/insights',     label: 'Insights',     nav: true  },
    { path: '/track-record', label: 'Track record', nav: true  },
    { path: '/profile',      label: 'Profile',      nav: true  }
  ];

  /* ============================================================
     toast
     ============================================================ */

  function toast(msg, opts) {
    opts = opts || {};
    var root = document.getElementById('tm-toasts');
    if (!root) return;

    var node = el('div', {
      class: 'tm-toast tm-toast--' + (opts.type || 'info'),
      role: 'status'
    }, el('span', { text: msg }));

    root.appendChild(node);
    requestAnimationFrame(function () { node.classList.add('is-in'); });

    var ms = opts.ms == null ? 3000 : opts.ms;
    setTimeout(function () {
      node.classList.remove('is-in');
      setTimeout(function () {
        if (node.parentNode) node.parentNode.removeChild(node);
      }, util.prefersReducedMotion() ? 0 : 220);
    }, ms);
  }

  /* ============================================================
     focus helpers
     ============================================================ */

  var FOCUSABLE_SEL =
    'a[href], button:not([disabled]), textarea:not([disabled]), ' +
    'input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

  function getFocusable(root) {
    var all = root.querySelectorAll(FOCUSABLE_SEL);
    var out = [];
    for (var i = 0; i < all.length; i++) {
      var n = all[i];
      if (n.offsetParent !== null || n === document.activeElement) out.push(n);
    }
    return out;
  }

  function trapTab(e, root) {
    var f = getFocusable(root);
    if (!f.length) return;
    var first = f[0];
    var last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  /* ============================================================
     modal
     ============================================================ */

  function modal(opts) {
    opts = opts || {};
    var previouslyFocused = document.activeElement;

    var dialog = el('div', {
      class: 'tm-modal__dialog',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': opts.title || 'Dialog',
      tabindex: '-1'
    });
    if (opts.title) {
      dialog.appendChild(el('h2', { class: 'tm-modal__title', text: opts.title }));
    }

    var body = el('div', { class: 'tm-modal__body' });
    if (opts.body instanceof Node) body.appendChild(opts.body);
    else if (typeof opts.body === 'string') body.textContent = opts.body;
    dialog.appendChild(body);

    var actionsEl = el('div', { class: 'tm-modal__actions' });
    var actions = opts.actions || [{ label: 'Close', variant: 'primary' }];
    actions.forEach(function (a) {
      var btn = el('button', {
        class: 'tm-btn tm-btn--' + (a.variant || 'ghost'),
        type: 'button',
        text: a.label,
        onClick: function () {
          if (a.onClick) a.onClick();
          close();
        }
      });
      actionsEl.appendChild(btn);
    });
    dialog.appendChild(actionsEl);

    var backdrop = el('div', {
      class: 'tm-modal',
      onClick: function (e) { if (e.target === backdrop) close(); }
    }, dialog);

    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'Tab') trapTab(e, dialog);
    }

    function close() {
      document.removeEventListener('keydown', onKey, true);
      var done = function () {
        if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
        document.body.classList.remove('tm-modal-open');
        if (previouslyFocused && previouslyFocused.focus) previouslyFocused.focus();
      };
      if (util.prefersReducedMotion()) return done();
      backdrop.classList.remove('is-in');
      setTimeout(done, 180);
    }

    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(backdrop);
    document.body.classList.add('tm-modal-open');
    requestAnimationFrame(function () { backdrop.classList.add('is-in'); });

    var first = getFocusable(dialog)[0];
    (first || dialog).focus();

    return { close: close };
  }

  /* ============================================================
     shared "New analysis" handler
     ============================================================ */

  function showNewAnalysisModal() {
    modal({
      title: 'New analysis',
      body: 'Coming in a later phase.',
      actions: [{ label: 'OK', variant: 'primary' }]
    });
  }

  /* ============================================================
     router
     ============================================================ */

  var currentTeardown = null;

  function parseRoute() {
    var raw = window.location.hash.replace(/^#/, '');
    var q = raw.search(/[&?]/);
    if (q >= 0) raw = raw.slice(0, q);
    return raw.charAt(0) === '/' ? raw : '/home';
  }

  function comingSoonNode(title, lead) {
    var kids = [el('h1', { class: 'tm-view__title', text: title })];
    if (lead) kids.push(el('p', { class: 'tm-view__lead', text: lead }));
    kids.push(el('p', { class: 'tm-view__muted', text: 'Coming soon.' }));
    return el('section', { class: 'tm-view' }, kids);
  }

  function renderRoute() {
    var route = parseRoute();
    var outlet = document.getElementById('tm-outlet');
    if (!outlet) return;

    if (currentTeardown) {
      try { currentTeardown(); } catch (_) {}
      currentTeardown = null;
    }
    while (outlet.firstChild) outlet.removeChild(outlet.firstChild);

    var node = null;

    if (route === '/home' && TM.home && TM.home.render) {
      currentTeardown = TM.home.render(outlet) || null;
    } else {
      var m = route.match(/^\/analysis\/(.+)$/);
      if (m) {
        node = comingSoonNode('Analysis', 'ID: ' + m[1]);
      } else {
        var known = ROUTES.filter(function (r) { return r.path === route; })[0];
        node = known
          ? comingSoonNode(known.label)
          : comingSoonNode('Not found', route);
      }
      if (node) outlet.appendChild(node);
    }

    var navItems = document.querySelectorAll('[data-route]');
    Array.prototype.forEach.call(navItems, function (a) {
      if (a.getAttribute('data-route') === route) {
        a.setAttribute('aria-current', 'page');
      } else {
        a.removeAttribute('aria-current');
      }
    });

    document.title = TM.config.APP_NAME + ' — ' +
      (route.replace(/^\//, '') || 'home');
  }

  /* ============================================================
     side panel
     ============================================================ */

  function togglePanel(open) {
    var panel    = document.getElementById('tm-panel');
    var backdrop = document.getElementById('tm-panel-backdrop');
    var opener   = document.getElementById('tm-menu-btn');
    if (!panel || !backdrop || !opener) return;

    var isOpen = typeof open === 'boolean'
      ? open
      : !panel.classList.contains('is-open');

    panel.classList.toggle('is-open', isOpen);
    backdrop.classList.toggle('is-open', isOpen);
    panel.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
    opener.setAttribute('aria-expanded', isOpen ? 'true' : 'false');

    if (isOpen) {
      var first = getFocusable(panel)[0];
      if (first) first.focus();
    } else {
      opener.focus();
    }
  }

  /* ============================================================
     status line (R3)
     ============================================================ */

  /* Pure: derive the status text from a list of analyses. */
  function computeStatusLine(analyses, now) {
    now = now || new Date();

    if (!analyses || analyses.length === 0) {
      return { text: 'No analyses yet', tone: 'idle' };
    }

    var open = 0;
    var expired = 0;
    for (var i = 0; i < analyses.length; i++) {
      var a = analyses[i];
      if (!a || typeof a !== 'object') continue;
      if (typeof a.createdAt !== 'string') continue;
      if (isNaN(new Date(a.createdAt).getTime())) continue;
      if (a.resolution) continue;
      if (a.expiresAt && new Date(a.expiresAt).getTime() <= now.getTime()) {
        expired++;
      } else {
        open++;
      }
    }

    var parts = [];
    if (open > 0) {
      parts.push(open + ' waiting for a result');
    }
    if (expired > 0) {
      parts.push(expired + (expired === 1 ? ' needs resolving' : ' need resolving'));
    }

    if (!parts.length) {
      return { text: 'Everything is resolved', tone: 'idle' };
    }
    return { text: parts.join(', '), tone: 'pending' };
  }

  function renderStatusLine(status) {
    var wrap = document.getElementById('tm-status');
    if (!wrap) return;
    var dot  = wrap.querySelector('.tm-status__dot');
    var text = wrap.querySelector('.tm-status__text');

    if (dot) {
      dot.classList.toggle('tm-status__dot--pending', status.tone === 'pending');
    }
    if (text) text.textContent = status.text;
    wrap.setAttribute('aria-label', status.text);
  }

  function mountStatusLine() {
    var wrap = document.getElementById('tm-status');
    if (!wrap) return;

    function refresh() {
      if (!TM.store || !TM.store.listAnalyses) {
        renderStatusLine({ text: 'Status unavailable', tone: 'idle' });
        return;
      }
      TM.store.listAnalyses({ order: 'desc' })
        .then(function (items) {
          renderStatusLine(computeStatusLine(items, new Date()));
        })
        .catch(function (err) {
          console.error('[shell] status line load failed', err);
          renderStatusLine({ text: 'Status unavailable', tone: 'idle' });
        });
    }

    refresh();
    if (TM.store && TM.store.onChange) {
      TM.store.onChange(refresh);
    }
  }

  /* ============================================================
     wiring
     ============================================================ */

  function buildNav() {
    var top    = document.getElementById('tm-nav-top');
    var bottom = document.getElementById('tm-nav-bottom');
    if (!top && !bottom) return;

    var items = ROUTES.filter(function (r) { return r.nav; });

    [top, bottom].forEach(function (nav) {
      if (!nav) return;
      items.forEach(function (r) {
        nav.appendChild(el('a', {
          href: '#' + r.path,
          'data-route': r.path,
          class: 'tm-nav__item',
          text: r.label
        }));
      });
    });
  }

  function wireTopbar() {
    var brand = document.getElementById('tm-brand');
    if (brand) brand.textContent = TM.config.APP_NAME;

    var menuBtn = document.getElementById('tm-menu-btn');
    if (menuBtn) {
      menuBtn.addEventListener('click', function () { togglePanel(); });
    }

    var newBtn = document.getElementById('tm-new-btn');
    if (newBtn) {
      newBtn.addEventListener('click', showNewAnalysisModal);
    }
  }

  function wirePanel() {
    var closeBtn = document.getElementById('tm-panel-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', function () { togglePanel(false); });
    }

    var backdrop = document.getElementById('tm-panel-backdrop');
    if (backdrop) {
      backdrop.addEventListener('click', function () { togglePanel(false); });
    }

    var backup = document.getElementById('tm-panel-backup');
    if (backup) {
      backup.addEventListener('click', function () {
        toast('Backup coming soon.');
      });
    }

    var settings = document.getElementById('tm-panel-settings');
    if (settings) {
      settings.addEventListener('click', function () {
        toast('Settings coming soon.');
      });
    }

    var about = document.getElementById('tm-panel-about');
    if (about) {
      about.addEventListener('click', function () {
        modal({
          title: 'About ' + TM.config.APP_NAME,
          body: 'A permanent memory and track record for your trading decisions.',
          actions: [{ label: 'Close', variant: 'primary' }]
        });
      });
    }

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      var panel = document.getElementById('tm-panel');
      if (panel && panel.classList.contains('is-open')) togglePanel(false);
    });
  }

  function wireSkipLink() {
    var skip = document.getElementById('tm-skip');
    if (!skip) return;
    skip.addEventListener('click', function (e) {
      e.preventDefault();
      var outlet = document.getElementById('tm-outlet');
      if (outlet) outlet.focus();
    });
  }

  function updateDevBadge() {
    var b = document.getElementById('tm-dev-badge');
    if (!b) return;
    if (TM.config.DEV) b.removeAttribute('hidden');
    else b.setAttribute('hidden', '');
  }

  /* ============================================================
     init + exports
     ============================================================ */

  function init() {
    buildNav();
    wireTopbar();
    wirePanel();
    wireSkipLink();
    mountStatusLine();

    window.addEventListener('hashchange', function () {
      renderRoute();
      updateDevBadge();
    });

    renderRoute();
    updateDevBadge();
  }

  TM.shell = {
    toast:             toast,
    modal:             modal,
    newAnalysis:       showNewAnalysisModal,
    computeStatusLine: computeStatusLine,
    init:              init
  };

  /* ============================================================
     auto-boot
     ============================================================ */

  function boot() {
    Promise.resolve(TM.store && TM.store.ready ? TM.store.ready() : null)
      .then(init)
      .catch(function (err) {
        console.error('[shell] boot failed', err);
        init();  /* still try to render — store failures degrade gracefully */
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();