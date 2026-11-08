// Service worker ของ WattWise: ให้เปิดแอปได้แม้เน็ตหลุด
// - ไฟล์ของแอป (same-origin GET): ลองโหลดจากเน็ตก่อน แล้วเก็บสำเนาไว้ ถ้าเน็ตหลุดใช้สำเนาแทน
//   (เปิดแอปครั้งต่อไปจึงได้เวอร์ชันล่าสุดเสมอเมื่อมีเน็ต)
// - คำขอไป Firebase/โดเมนอื่น: ไม่แตะ ปล่อยผ่านตามปกติ
// เปลี่ยนเลขเวอร์ชันด้านล่างทุกครั้งที่แก้ไฟล์แอป เพื่อล้างสำเนาเก่า
const CACHE = 'wattwise-v3';
const FILES = ['./', './index.html', './calculate.js', './manifest.json', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((r) => r || caches.match('./index.html')))
  );
});
