/**
 * Applies the saved theme before the first paint, so someone on light mode
 * never gets a flash of the dark interface while React boots.
 *
 * A separate file rather than an inline script because the CSP is
 * `script-src 'self'`, which blocks inline scripts by design.
 */
(function () {
  try {
    var stored = localStorage.getItem('gimnasio.theme.v1');
    var light =
      stored === 'light' ||
      (stored !== 'dark' && window.matchMedia('(prefers-color-scheme: light)').matches);
    document.documentElement.dataset.theme = light ? 'light' : 'dark';
    document.documentElement.style.colorScheme = light ? 'light' : 'dark';
  } catch (error) {
    document.documentElement.dataset.theme = 'dark';
    document.documentElement.style.colorScheme = 'dark';
  }
})();
