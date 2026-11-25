// PBD POS service worker — ทำให้เปิดหน้าขายได้แม้ไม่มีเน็ต
// เปลี่ยนเลขเวอร์ชันนี้ทุกครั้งที่อัปโหลดไฟล์ใหม่ เพื่อให้เครื่องพนักงานรับเวอร์ชันใหม่เร็วขึ้น
const VERSION = 'pbd-pos-v2.5.0';

const SHELL = ['./', './index.html', './app.js', './qr.js', './config.js', './manifest.webmanifest', './icon-192.png', './icon-512.png'];
const LIBS = [
  'https://static.line-scdn.net/liff/edge/2/sdk.js',
  'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    await c.addAll(SHELL);
    await Promise.all(LIBS.map(async (u) => {
      try {
        const res = await fetch(new Request(u, { mode: 'no-cors' }));
        await c.put(u, res);
      } catch (x) { /* ได้ตอนเปิดครั้งถัดไป */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  // ไม่แคช API และหน้าล็อกอิน LINE
  if (/script\.google|googleusercontent|api\.line\.me|access\.line\.me/.test(u.hostname)) return;

  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        const c = await caches.open(VERSION);
        c.put('./index.html', res.clone());
        return res;
      } catch (x) {
        return (await caches.match('./index.html')) || Response.error();
      }
    })());
    return;
  }

  // stale-while-revalidate: ใช้ของในเครื่องก่อน แล้วอัปเดตเบื้องหลัง
  e.respondWith((async () => {
    const c = await caches.open(VERSION);
    const hit = await c.match(req, { ignoreSearch: u.origin === self.location.origin });
    const net = fetch(req).then((res) => {
      if (res && (res.ok || res.type === 'opaque')) c.put(req, res.clone());
      return res;
    }).catch(() => hit);
    return hit || net;
  })());
});
