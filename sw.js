/* =====================================================================
   sw.js — Fitilho · service worker
   Guarda o app (só código, fonte e ícones) para funcionar sem internet.
   Os textos dos livros NÃO passam por aqui: ficam no IndexedDB.
   Ao publicar qualquer mudança, aumente VERSAO para o celular baixar
   a versão nova.
   ===================================================================== */
var VERSAO = 'fitilho-v1.2.2';

var ARQUIVOS = [
  './',
  'index.html',
  'style.css',
  'parser.js',
  'app.js',
  'manifest.webmanifest',
  'icons/icone-192.png',
  'icons/icone-512.png',
  'icons/icone-maskable-512.png',
  'icons/apple-touch-icon.png',
  'icons/favicon-32.png',
  'media/acordado.webm',
  'media/acordado.mp4',
  'fonts/atkinson-hyperlegible-latin-400-normal.woff2',
  'fonts/atkinson-hyperlegible-latin-400-italic.woff2',
  'fonts/atkinson-hyperlegible-latin-700-normal.woff2',
  'fonts/atkinson-hyperlegible-latin-700-italic.woff2',
  'fonts/atkinson-hyperlegible-latin-ext-400-normal.woff2',
  'fonts/atkinson-hyperlegible-latin-ext-400-italic.woff2',
  'fonts/atkinson-hyperlegible-latin-ext-700-normal.woff2',
  'fonts/atkinson-hyperlegible-latin-ext-700-italic.woff2'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(VERSAO).then(function (c) {
      return c.addAll(ARQUIVOS.map(function (u) { return new Request(u, { cache: 'reload' }); }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (nomes) {
      return Promise.all(nomes.filter(function (n) { return n.indexOf('fitilho-') === 0 && n !== VERSAO; })
        .map(function (n) { return caches.delete(n); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Navegação (abrir o app): sempre responde com o index.html guardado
  if (req.mode === 'navigate') {
    e.respondWith(
      caches.match('index.html', { cacheName: VERSAO }).then(function (r) {
        return r || fetch(req);
      }).catch(function () { return fetch(req); })
    );
    return;
  }

  // Demais arquivos: primeiro o cache; se faltar, rede
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(function (r) {
      return r || fetch(req);
    })
  );
});
