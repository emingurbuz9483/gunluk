const CACHE = 'gunluk-v2'; // HER DEPLOY'DA BUNU ARTIR (v2, v3...) — yoksa telefonunda eski sürüm açılmaya devam eder.

const KABUK = [
  './',
  './index.html',
  './app.js',
  './style.css',
  './manifest.json',
  './icons/192.png',
  './icons/512.png'
];

// Kur: kabuğu önbelleğe al ve beklemeden devral.
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(KABUK)).then(() => self.skipWaiting()));
});

// Etkinleş: eski sürüm önbelleklerini sil, açık sekmeleri hemen üstlen.
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(adlar => Promise.all(adlar.filter(a => a !== CACHE).map(a => caches.delete(a))))
      .then(() => self.clients.claim())
  );
});

// Getir: önce önbellek, olmazsa ağ. Çevrimdışıyken uygulama yine de açılır.
self.addEventListener('fetch', e => {
  const istek = e.request;
  if(istek.method !== 'GET' || !istek.url.startsWith(self.location.origin)) return;
  e.respondWith(
    caches.match(istek).then(vurus => vurus || fetch(istek).then(yanit => {
      // Ağdan geleni de sakla ki bir dahakine çevrimdışı çalışsın.
      if(yanit && yanit.ok && yanit.type === 'basic'){
        const kopya = yanit.clone();
        caches.open(CACHE).then(c => c.put(istek, kopya));
      }
      return yanit;
    }).catch(() => {
      // Ağ yok ve önbellekte yok: gezinme isteklerini uygulama kabuğuna düşür.
      if(istek.mode === 'navigate') return caches.match('./index.html');
      return new Response('', { status: 504, statusText: 'cevrimdisi' });
    }))
  );
});
