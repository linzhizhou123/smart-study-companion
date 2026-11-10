/* Boot after every module is loaded. */
(function () {
  'use strict';
  const ZB = window.ZB;
  if (!ZB || !ZB.init) return;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ZB.init);
  } else {
    ZB.init();
  }
})();
