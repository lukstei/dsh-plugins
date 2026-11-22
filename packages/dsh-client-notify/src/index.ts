import type { Context } from "@deepseek-ai/cordis";
import type { WebRoute } from "@deepseek-ai/dsh-host-webserver";

export type { WebRoute };

export const name = "dsh-client-notify";
export const inject = ["webServer"] as const;

export const SERVICE_WORKER_SCRIPT = `
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow('/');
      }
    })
  );
});
`.trim();

export function apply(ctx: Context): void {
	for (const path of ["/sw.js", "/tsctl/sw.js"]) {
		ctx.effect(
			() =>
				ctx.webServer.register({
					kind: "exact",
					path,
					handler: (_req, res) => {
						res.writeHead(200, {
							"content-type": "application/javascript; charset=utf-8",
							"cache-control": "no-cache",
							"service-worker-allowed": "/",
						});
						res.end(SERVICE_WORKER_SCRIPT);
					},
				}),
			`dsh-client-notify: service worker route (${path})`,
		);
	}
}
