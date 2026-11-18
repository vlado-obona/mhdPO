// Údaje o zostavení pre riadok „Verzia … · build … · platforma“ v pätičke.
// V repe je prázdny: workflow ho pri zostavení prepíše (web: číslo buildu a commit,
// skúšobný build z vetvy: SKÚŠKA, vetva a commit). Číslo buildu Android/iOS appka
// číta z nainštalovanej appky (versionCode / CFBundleVersion), nie odtiaľto.
window.__BUILD__ = {};
