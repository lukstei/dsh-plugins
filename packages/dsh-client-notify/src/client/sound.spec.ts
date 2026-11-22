import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type SoundModule = typeof import("./sound.ts");

type MockOscillator = {
	type: string;
	frequency: {
		setValueAtTime: ReturnType<typeof vi.fn>;
		exponentialRampToValueAtTime: ReturnType<typeof vi.fn>;
	};
	connect: ReturnType<typeof vi.fn>;
	start: ReturnType<typeof vi.fn>;
	stop: ReturnType<typeof vi.fn>;
};

type MockGain = {
	gain: {
		setValueAtTime: ReturnType<typeof vi.fn>;
		linearRampToValueAtTime: ReturnType<typeof vi.fn>;
		exponentialRampToValueAtTime: ReturnType<typeof vi.fn>;
	};
	connect: ReturnType<typeof vi.fn>;
};

describe("sound module", () => {
	let playPopChime: SoundModule["playPopChime"];
	let playAlertChime: SoundModule["playAlertChime"];
	let createdOscillators: MockOscillator[];
	let createdGains: MockGain[];
	let contexts: Array<{
		state: string;
		stateAtCreation: string;
		resume: ReturnType<typeof vi.fn>;
	}>;
	let contextState: "running" | "suspended";

	beforeEach(async () => {
		createdOscillators = [];
		createdGains = [];
		contexts = [];
		contextState = "suspended";

		class MockAudioContext {
			currentTime = 0;
			destination = {};
			state: "running" | "suspended";
			stateAtCreation: "running" | "suspended";
			resume = vi.fn(async () => {
				this.state = "running";
			});

			constructor() {
				this.state = contextState;
				this.stateAtCreation = contextState;
				contexts.push(this);
			}

			createOscillator() {
				const osc: MockOscillator = {
					type: "",
					frequency: {
						setValueAtTime: vi.fn(),
						exponentialRampToValueAtTime: vi.fn(),
					},
					connect: vi.fn().mockReturnThis(),
					start: vi.fn(),
					stop: vi.fn(),
				};
				createdOscillators.push(osc);
				return osc;
			}

			createGain() {
				const gain: MockGain = {
					gain: {
						setValueAtTime: vi.fn(),
						linearRampToValueAtTime: vi.fn(),
						exponentialRampToValueAtTime: vi.fn(),
					},
					connect: vi.fn().mockReturnThis(),
				};
				createdGains.push(gain);
				return gain;
			}
		}

		(globalThis as unknown as { window: unknown }).window = {
			AudioContext: MockAudioContext,
		};

		vi.resetModules();
		({ playPopChime, playAlertChime } = await import("./sound.ts"));
	});

	afterEach(() => {
		vi.restoreAllMocks();
		delete (globalThis as unknown as { window?: unknown }).window;
	});

	it("resumes a suspended context before scheduling", () => {
		playPopChime();

		expect(contexts).toHaveLength(1);
		expect(contexts[0].stateAtCreation).toBe("suspended");
		expect(contexts[0].resume).toHaveBeenCalledTimes(1);
		expect(createdOscillators[0].start).toHaveBeenCalledWith(0);
	});

	it("reuses one context across chimes", () => {
		playPopChime();
		playAlertChime();

		expect(contexts).toHaveLength(1);
	});

	it("playPopChime plays single downward tone", () => {
		contextState = "running";

		playPopChime();

		expect(createdOscillators).toHaveLength(1);
		expect(createdGains).toHaveLength(1);
		expect(createdOscillators[0].frequency.setValueAtTime).toHaveBeenCalledWith(
			791,
			0,
		);
		expect(
			createdOscillators[0].frequency.exponentialRampToValueAtTime,
		).toHaveBeenCalledWith(791 * 0.22, 0.05);
		expect(createdOscillators[0].start).toHaveBeenCalledWith(0);
		expect(createdOscillators[0].stop).toHaveBeenCalledWith(0.12);
	});

	it("playAlertChime plays two-tone ascending sequence", () => {
		playAlertChime();

		expect(createdOscillators).toHaveLength(2);
		expect(createdGains).toHaveLength(2);

		expect(createdOscillators[0].frequency.setValueAtTime).toHaveBeenCalledWith(
			587.33,
			0,
		);
		expect(createdOscillators[0].start).toHaveBeenCalledWith(0);
		expect(createdOscillators[0].stop).toHaveBeenCalledWith(0.12);

		expect(createdOscillators[1].frequency.setValueAtTime).toHaveBeenCalledWith(
			880,
			0.12,
		);
		expect(createdOscillators[1].start).toHaveBeenCalledWith(0.12);
		expect(createdOscillators[1].stop).toHaveBeenCalledWith(0.24);
	});

	it("handles missing AudioContext gracefully", () => {
		(globalThis as unknown as { window: unknown }).window = {};

		expect(() => playPopChime()).not.toThrow();
		expect(() => playAlertChime()).not.toThrow();
	});
});
