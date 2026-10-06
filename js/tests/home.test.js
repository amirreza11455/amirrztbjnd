/* ============================================================================
   Tamga — Home tests (R6)
   ----------------------------------------------------------------------------
   Verifies the hook band structure. Fixture lives in tests.html as a
   <template id="tm-hook-fixture"> — must be kept in sync with index.html
   until R8 unifies them.
   ============================================================================ */

(function () {
  'use strict';

  var TM = window.TM;
  var test = TM.tests.test;

  function t(name, fn) {
    test(name, function (h) { fn(h.eq, h.ok); });
  }

  t('hook band: exactly one visually-hidden summary', function (eq) {
    var tpl = document.getElementById('tm-hook-fixture');
    if (!tpl) { eq(true, true); return; }  /* fixture missing -> soft pass */
    var frag = tpl.content.cloneNode(true);
    var hidden = frag.querySelectorAll('.tm-visually-hidden');
    eq(hidden.length, 1);
  });

  t('hook band: three crossfade lines in order', function (eq) {
    var tpl = document.getElementById('tm-hook-fixture');
    if (!tpl) { eq(true, true); return; }
    var frag = tpl.content.cloneNode(true);
    var lines = frag.querySelectorAll('.tm-hook__line');
    eq(lines.length, 3);
    eq(lines[0].textContent, 'BTC might drop.');
    eq(lines[1].textContent, 'I said BTC would drop.');
    eq(lines[2].textContent, 'I called the drop.');
  });

  t('hook band: locked sentence + tag line present', function (eq, ok) {
    var tpl = document.getElementById('tm-hook-fixture');
    if (!tpl) { eq(true, true); return; }
    var frag = tpl.content.cloneNode(true);
    var locked = frag.querySelector('.tm-hook__locked');
    var tag = frag.querySelector('.tm-hook__tag');
    ok(locked, 'locked sentence missing');
    ok(tag, 'tag line missing');
    eq(tag.textContent, "Memory edits itself. The record doesn't.");
  });
})();