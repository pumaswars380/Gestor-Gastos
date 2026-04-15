/* =====================================================================
 * SERVICE WORKER — Gestor de Gastos PWA
 * 
 * Funciones:
 * 1. Cachear archivos para uso offline
 * 2. Mostrar notificaciones push desde la app
 * 3. Periodic Background Sync para verificar vencimientos
 * 4. Manejar clics en notificaciones
 * ===================================================================== */

const CACHE_NAME = 'gestor-gastos-v1';
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './manifest.json',
    'https://cdn.tailwindcss.com',
    'https://unpkg.com/lucide@0.460.0',
    'https://cdn.jsdelivr.net/npm/chart.js@4.4.7',
    'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js'
];

/* ----- INSTALL: Cachear archivos esenciales ----- */
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('[SW] Cacheando archivos...');
                return cache.addAll(ASSETS_TO_CACHE).catch(err => {
                    console.warn('[SW] Algunos archivos no se pudieron cachear:', err);
                });
            })
            .then(() => self.skipWaiting())
    );
});

/* ----- ACTIVATE: Limpiar caches antiguas ----- */
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(name => {
                    if (name !== CACHE_NAME) {
                        console.log('[SW] Eliminando cache antiguo:', name);
                        return caches.delete(name);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

/* ----- FETCH: Estrategia Network First con fallback a cache ----- */
self.addEventListener('fetch', (event) => {
    // Solo cachear GET requests
    if (event.request.method !== 'GET') return;

    event.respondWith(
        fetch(event.request)
            .then(response => {
                // Clonar y cachear la respuesta exitosa
                if (response && response.status === 200) {
                    const responseClone = response.clone();
                    caches.open(CACHE_NAME).then(cache => {
                        cache.put(event.request, responseClone);
                    });
                }
                return response;
            })
            .catch(() => {
                // Si falla la red, buscar en cache
                return caches.match(event.request);
            })
    );
});

/* ----- MESSAGE: Recibir mensajes de la app principal ----- */
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SHOW_NOTIFICATION') {
        const { title, body, tag } = event.data;
        self.registration.showNotification(title, {
            body: body,
            icon: './icons/icon-192.png',
            badge: './icons/icon-192.png',
            tag: tag || 'expense-notification',
            requireInteraction: true,
            vibrate: [200, 100, 200],
            actions: [
                { action: 'open', title: 'Ver gastos' },
                { action: 'dismiss', title: 'Descartar' }
            ],
            data: { url: './' }
        });
    }

    if (event.data && event.data.type === 'SYNC_EXPENSES') {
        // Recibir datos de gastos para verificación en segundo plano
        // (usado por Periodic Background Sync)
    }
});

/* ----- NOTIFICATION CLICK: Abrir la app al tocar la notificación ----- */
self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    if (event.action === 'dismiss') return;

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true })
            .then(windowClients => {
                // Si ya hay una pestaña abierta, enfocarla
                for (let client of windowClients) {
                    if (client.url.includes('index.html') || client.url.endsWith('/')) {
                        return client.focus();
                    }
                }
                // Si no, abrir una nueva
                return clients.openWindow(event.notification.data?.url || './');
            })
    );
});

/* ----- PERIODIC BACKGROUND SYNC: Verificar vencimientos periódicamente ----- */
self.addEventListener('periodicsync', (event) => {
    if (event.tag === 'check-due-expenses') {
        event.waitUntil(checkExpensesInBackground());
    }
});

async function checkExpensesInBackground() {
    const allClients = await clients.matchAll({ type: 'window' });
    
    // Si hay una ventana activa, pedirle que haga la verificación
    // (la ventana tiene acceso a localStorage con los datos)
    if (allClients.length > 0) {
        allClients[0].postMessage({ type: 'CHECK_EXPENSES' });
        return;
    }

    // Si no hay ventana activa, no podemos acceder a localStorage
    // desde el SW directamente, así que mostramos una notificación genérica
    // recordando al usuario que revise sus pagos
    const today = new Date();
    const dayOfMonth = today.getDate();
    
    // Solo notificar los primeros 5 días del mes o cada lunes como recordatorio
    if (dayOfMonth <= 5 || today.getDay() === 1) {
        self.registration.showNotification('📋 Revisa tus pagos', {
            body: 'Abre el Gestor de Gastos para verificar si tienes pagos pendientes hoy.',
            icon: './icons/icon-192.png',
            badge: './icons/icon-192.png',
            tag: 'periodic-reminder',
            requireInteraction: false,
            vibrate: [100, 50, 100],
            data: { url: './' }
        });
    }
}
