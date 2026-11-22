export type NotificationSound = "stop" | "alert";

let sharedContext: AudioContext | undefined;

function audioContext(): AudioContext | undefined {
	const AudioCtx =
		window.AudioContext ||
		(window as unknown as { webkitAudioContext: typeof AudioContext })
			.webkitAudioContext;
	if (!AudioCtx) return undefined;
	sharedContext ??= new AudioCtx();
	// edge case: Firefox hands back a suspended context; notes scheduled on a frozen clock never fire
	if (sharedContext.state === "suspended") {
		void sharedContext.resume().catch(() => {});
	}
	return sharedContext;
}

export function playPopChime(): void {
	try {
		const ctx = audioContext();
		if (!ctx) return;
		const notes = [791];
		const startTime = ctx.currentTime;

		notes.forEach((freq, i) => {
			const osc = ctx.createOscillator();
			const gain = ctx.createGain();
			const t = startTime + i * 0.12;

			osc.type = "sine";
			osc.frequency.setValueAtTime(freq, t);
			osc.frequency.exponentialRampToValueAtTime(freq * 0.22, t + 0.05);
			gain.gain.setValueAtTime(0, t);
			gain.gain.linearRampToValueAtTime(0.11, t + 0.01);
			gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);

			osc.connect(gain).connect(ctx.destination);
			osc.start(t);
			osc.stop(t + 0.12);
		});
	} catch {
		// Suppressed when browser policy blocks audio before user interaction
	}
}

export function playAlertChime(): void {
	try {
		const ctx = audioContext();
		if (!ctx) return;
		const notes = [587.33, 880];
		const startTime = ctx.currentTime;

		notes.forEach((freq, i) => {
			const osc = ctx.createOscillator();
			const gain = ctx.createGain();
			const t = startTime + i * 0.12;

			osc.type = "sine";
			osc.frequency.setValueAtTime(freq, t);
			gain.gain.setValueAtTime(0, t);
			gain.gain.linearRampToValueAtTime(0.12, t + 0.01);
			gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);

			osc.connect(gain).connect(ctx.destination);
			osc.start(t);
			osc.stop(t + 0.12);
		});
	} catch {
		// Suppressed when browser policy blocks audio before user interaction
	}
}
