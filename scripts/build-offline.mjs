import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const dist = resolve('dist');
async function files(directory, prefix = '') {
  const entries = await readdir(directory, {withFileTypes:true});
  const paths = [];
  for (const entry of entries) {
    const path = `${prefix}${entry.name}`;
    if (entry.isDirectory()) paths.push(...await files(resolve(directory,entry.name),`${path}/`));
    else if (entry.name !== 'sw.js') paths.push(`/${path}`);
  }
  return paths.sort();
}
const assets = await files(dist);
const digest = createHash('sha256');
for (const asset of assets) digest.update(await readFile(resolve(dist,asset.slice(1))));
const version = digest.digest('hex').slice(0,16);
const script = `// Generated from the complete production bundle. Never cache accounts or API responses.
const CACHE = 'rephase-shell-${version}';
const ASSETS = ${JSON.stringify(assets)};
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('rephase-shell-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('/index.html')));
  } else if (ASSETS.includes(url.pathname)) {
    event.respondWith(caches.match(url.pathname).then(cached => cached || fetch(request)));
  }
});
`;
await writeFile(resolve(dist,'sw.js'),script);
console.log(`Offline shell prepared: ${assets.length} assets, version ${version}.`);
