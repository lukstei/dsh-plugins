import {
	type NotificationSound,
	playAlertChime,
	playPopChime,
} from "./sound.ts";

export function registerServiceWorker(): void {
	if (typeof navigator === "undefined" || !("serviceWorker" in navigator))
		return;
	navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
		navigator.serviceWorker.register("sw.js").catch(() => {});
	});
}

export function requestNotificationPermission(): void {
	if (typeof window === "undefined") return;

	registerServiceWorker();

	if (!("Notification" in window)) return;
	if (window.Notification.permission !== "default") return;

	const onRequest = (): void => {
		if (window.Notification.permission === "default") {
			void window.Notification.requestPermission().then((permission) => {
				if (permission !== "default") {
					window.removeEventListener("click", onRequest);
					window.removeEventListener("touchend", onRequest);
					window.removeEventListener("keydown", onRequest);
				}
			});
		}
	};

	window.addEventListener("click", onRequest);
	window.addEventListener("touchend", onRequest);
	window.addEventListener("keydown", onRequest);
}

function constructNotification(
	title: string,
	options: NotificationOptions,
): void {
	try {
		const notification = new window.Notification(title, options);
		notification.onclick = () => {
			window.focus();
			notification.close();
		};
	} catch {
		// Suppressed when platform forbids new Notification() (e.g. mobile/PWA requiring ServiceWorker)
	}
}

export function showBrowserNotification(
	title: string,
	message: string,
	sound: NotificationSound,
): void {
	if (typeof window === "undefined") return;

	const isMobile =
		(typeof window.matchMedia === "function" &&
			window.matchMedia("(pointer: coarse)").matches) ||
		(typeof navigator !== "undefined" && (navigator.maxTouchPoints ?? 0) > 0);

	// Suppress desktop notification if user is actively in the tab on desktop
	if (!isMobile && document.hasFocus() && !document.hidden) return;

	if (
		"Notification" in window &&
		window.Notification.permission === "granted"
	) {
		const options: NotificationOptions = {
			body: message,
			icon: "/favicon.svg",
		};

		if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
			const resolveSwReg = async (): Promise<
				ServiceWorkerRegistration | undefined
			> => {
				const reg = await navigator.serviceWorker.getRegistration();
				if (reg && "showNotification" in reg) return reg;
				return Promise.race([
					navigator.serviceWorker.ready,
					new Promise<undefined>((resolve) =>
						setTimeout(() => resolve(undefined), 300),
					),
				]);
			};

			void resolveSwReg()
				.then((reg) => {
					if (reg && "showNotification" in reg) {
						void reg.showNotification(title, options);
						return;
					}
					constructNotification(title, options);
				})
				.catch(() => {
					constructNotification(title, options);
				});
		} else {
			constructNotification(title, options);
		}
	}

	if (sound === "alert") {
		playAlertChime();
	} else {
		playPopChime();
	}
}
