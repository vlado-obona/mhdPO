#!/usr/bin/env node
// Zostaví release plánovača MHD Prešov do releases/v<verzia>/:
//   mhd-presov-standalone.html — celá appka v jednom súbore (Leaflet,
//   dataset aj podkladová sieť trás inline). Funguje otvorením hocikde —
//   z disku, z mailu, z akéhokoľvek hostingu; online si dotiahne OSM
//   dlaždice, offline kreslí na sieť trás MHD.
//
// Použitie: node scripts/mhd/build-release.mjs <verzia>   (napr. 1.0.0)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('Použitie: node scripts/mhd/build-release.mjs <verzia napr. 1.0.0>');
  process.exit(1);
}

const APP = 'mhd-app';
const OUT = join('releases', `v${version}`);
const read = (f) => readFileSync(join(APP, f), 'utf8');

function mustReplace(src, from, to, label) {
  if (!src.includes(from)) throw new Error(`build-release: nenašiel sa blok „${label}“ — app.js/index.html sa zmenili, uprav build-release.mjs`);
  return src.replace(from, to);
}

const dataset = read('data/dataset.json');
const basemap = read('data/basemap.json');
const appCss = read('app.css');
const leafletCss = read('vendor/leaflet.css');
const leafletJs = read('vendor/leaflet.js');
const meta = JSON.parse(dataset).meta;

const raptor = read('raptor.js').replace(/^export /gm, '');

// verzia v app.js musí sedieť s verziou release
{
  const vm = read('app.js').match(/const APP_VERSION = '([^']+)'/);
  if (!vm || vm[1] !== version) {
    throw new Error(`APP_VERSION v app.js (${vm && vm[1]}) sa nezhoduje s ${version} — najprv uprav mhd-app/app.js`);
  }
}

let app = read('app.js');
app = mustReplace(app, "import { Raptor, planJourneys } from './raptor.js';\n", '', 'import');
app = mustReplace(app,
  `  let v = '';
  try { v = (await (await fetch('data/version.json', { cache: 'no-cache' })).json()).v; } catch {}
  const res = await fetch(\`data/dataset.json\${v ? \`?v=\${v}\` : ''}\`);
  if (!res.ok) throw new Error('Dataset sa nepodarilo načítať');
  D = await res.json();`,
  `  D = window.__DATASET__;`,
  'načítanie datasetu');
app = mustReplace(app,
  `  fetch('data/basemap.json').then((r) => r.ok ? r.json() : null).then((lines) => {`,
  `  Promise.resolve(window.__BASEMAP__).then((lines) => {`,
  'načítanie basemapy');
app = mustReplace(app,
  `  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }`,
  '', 'service worker');

let html = read('index.html');
const bodyStart = html.indexOf('<body>');
const bodyEnd = html.indexOf('  <script src="vendor/leaflet.js">');
if (bodyStart < 0 || bodyEnd < 0) throw new Error('build-release: nečakaná štruktúra index.html');
const body = html.slice(bodyStart + '<body>'.length, bodyEnd);

const out = `<!doctype html>
<html lang="sk">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>MHD Prešov — plánovač spojení (v${version})</title>
<style>
${leafletCss}
${appCss}
</style>
</head>
<body>
${body}
<div style="max-width:640px;margin:0 auto 2rem;padding:0 1rem;font-size:.75rem;color:#667">
Samostatná verzia v${version} — cestovné poriadky platné
${meta.validFrom}–${meta.validTo} (zabalené v súbore, generované ${meta.generated?.slice(0, 10)}).
</div>
<script>
${leafletJs}
</script>
<script>window.__DATASET__ = ${dataset};
window.__BASEMAP__ = ${basemap};</script>
<script>
${raptor}
${app}
</script>
</body>
</html>
`;

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, `mhd-presov-v${version}.html`), out);
writeFileSync(join(OUT, 'RELEASE.md'), `# MHD Prešov v${version}

- vytvorené: ${new Date().toISOString()}
- cestovné poriadky: ${meta.validFrom}–${meta.validTo} (${meta.agency})
- zdroj dát: ${meta.source ? meta.source.split('\n')[0] : 'data/gtfs-presov/SOURCE.txt'}

Súbory:
- mhd-presov-v${version}.html — celá appka v jednom súbore, otvor v hociktorom
  prehliadači (aj z disku, aj offline — mapa vtedy kreslí sieť trás MHD).
- mhd-presov-v${version}.apk — Android aplikácia s dátami zabalenými vnútri
  (pridáva ju workflow „MHD Presov - offline APK“).
`);
console.log(`releases/v${version}/mhd-presov-v${version}.html — ${(out.length / 1048576).toFixed(2)} MB`);
