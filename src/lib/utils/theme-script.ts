/**
 * Inline script that runs in <head> before React hydrates.
 *
 * Why: writes data-theme/data-density/lang to <html> from localStorage
 * (or prefers-color-scheme) so the page paints with the correct theme on
 * first frame. Without this, you get a flash of white-then-dark on load.
 *
 * Reads the same shape that prefs.ts persists under "tme:prefs".
 */
export const themeInitScript = `
(function(){
  try {
    var raw = localStorage.getItem('tme:prefs');
    var theme = null;
    var density = 'normal';
    var locale = 'tr';
    var followSystem = false;
    if (raw) {
      var parsed = JSON.parse(raw);
      var s = (parsed && parsed.state) ? parsed.state : {};
      followSystem = s.themeFollowsSystem === true;
      theme = s.theme || null;
      if (s.density) density = s.density;
      if (s.locale) locale = s.locale;
    }
    if (!theme || followSystem) {
      var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      theme = followSystem ? (prefersDark ? 'dark' : 'white') : 'dark';
    }
    if (theme !== 'white' && theme !== 'sepia' && theme !== 'dark') theme = 'dark';
    if (density !== 'compact' && density !== 'normal' && density !== 'comfy') density = 'normal';
    if (locale !== 'tr' && locale !== 'en') locale = 'tr';
    var root = document.documentElement;
    root.setAttribute('data-theme', theme);
    root.setAttribute('data-density', density);
    root.setAttribute('lang', locale);
    requestAnimationFrame(function(){ root.classList.add('theme-init-complete'); });
  } catch (_) {
    var r = document.documentElement;
    r.setAttribute('data-theme', 'dark');
    r.setAttribute('data-density', 'normal');
  }
})();
`;
