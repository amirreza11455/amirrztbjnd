/* ============================================================================
   Tamga — Config
   ----------------------------------------------------------------------------
   Central configuration. The one and only source for the app name and the
   feature flags. DEV is a live getter — it reflects the current location.hash
   at read time, so toggling #dev in the URL works without a reload.

   No other file should hardcode the app name.
   ============================================================================ */

(function () {
  'use strict';

  var TM = (window.TM = window.TM || {});

  /* Matches `dev` as a standalone token in the hash.
     Accepts: #dev, #dev&seed=few, #/home?dev, etc.
     Rejects: #development, #devil, #my-dev. */
  var DEV_RE = /(?:^|[#&?])dev(?:$|[&=])/;

  var cfg = {
    /* Brand name — the only place it exists. */
    APP_NAME: 'Tamga',

    /* Feature flags. Flip to true as the corresponding part lands. */
    FEATURES: {
      backup:      false,
      settings:    false,
      insights:    false,
      trackRecord: false
    }
  };

  /* DEV is read live, not cached, so hash changes are reflected immediately. */
  Object.defineProperty(cfg, 'DEV', {
    enumerable: true,
    configurable: false,
    get: function () {
      return DEV_RE.test(window.location.hash);
    }
  });

  TM.config = cfg;
})();