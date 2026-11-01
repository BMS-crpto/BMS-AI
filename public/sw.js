// Minimal service worker so the browser treats BMS AI as an installable app.
// It deliberately caches nothing: chats, login and AI answers always come live from the server.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
