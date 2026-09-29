import { setIcon } from "obsidian";
import type { Panel } from "./panel";
import type { DailyGlanceSettings } from "./settings";
import { t } from "./i18n";

type Status = "idle" | "running" | "paused" | "done";

// Lives on the plugin, not the view, so it survives the view being closed.
// Remaining time is always derived from timestamps, never from counting ticks.
export class Timer {
	status: Status = "idle";
	duration = 25 * 60_000; // last set duration; also prefills the idle inputs
	private endAt = 0;
	private left = 0; // remaining ms while paused

	remaining(): number {
		if (this.status === "running") return Math.max(0, this.endAt - Date.now());
		if (this.status === "paused") return this.left;
		if (this.status === "done") return 0;
		return this.duration;
	}

	start(ms: number): void {
		this.duration = ms;
		this.endAt = Date.now() + ms;
		this.status = "running";
	}

	pause(): void {
		this.left = this.remaining();
		this.status = "paused";
	}

	resume(): void {
		this.endAt = Date.now() + this.left;
		this.status = "running";
	}

	reset(): void {
		this.status = "idle";
	}

	// Returns true once, when a running timer reaches zero.
	check(): boolean {
		if (this.status !== "running" || Date.now() < this.endAt) return false;
		this.status = "done";
		return true;
	}
}

// Minutes → "15 min", "1 h", "1 h 30".
export function presetLabel(min: number): string {
	const h = Math.floor(min / 60);
	const rest = min % 60;
	if (!h) return `${min} min`;
	return rest ? `${h} h ${rest}` : `${h} h`;
}

// Three short beeps, synthesized with Web Audio, so there's no sound file to ship.
export function beep(): void {
	const ctx = new AudioContext();
	for (let i = 0; i < 3; i++) {
		const at = ctx.currentTime + i * 0.3;
		const osc = ctx.createOscillator();
		const gain = ctx.createGain();
		osc.frequency.value = 880;
		gain.gain.setValueAtTime(0.2, at);
		gain.gain.exponentialRampToValueAtTime(0.001, at + 0.2);
		osc.connect(gain).connect(ctx.destination);
		osc.start(at);
		osc.stop(at + 0.2);
	}
	window.setTimeout(() => void ctx.close(), 1500);
}

function format(ms: number): string {
	const total = Math.ceil(ms / 1000);
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	const pad = (n: number) => String(n).padStart(2, "0");
	return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function button(parent: HTMLElement, icon: string, text: string, cta: boolean, onClick: () => void): void {
	const btn = parent.createEl("button", { cls: cta ? "mod-cta" : undefined });
	setIcon(btn.createSpan(), icon);
	btn.appendText(text);
	btn.addEventListener("click", onClick);
}

// Returns a tick function; the view calls it every second.
export function renderTimer(panel: Panel, timer: Timer, settings: DailyGlanceSettings): () => void {
	let drawn: Status;
	let display: HTMLElement | null = null;
	let bar: HTMLElement | null = null;
	let progress: HTMLElement | null = null;

	const update = () => {
		if (!display || !bar || !progress) return;
		const left = timer.remaining();
		const pct = Math.round(((timer.duration - left) / timer.duration) * 100);
		display.setText(format(left));
		bar.setCssStyles({ width: `${pct}%` });
		progress.setAttr("aria-valuenow", pct);
	};

	const draw = () => {
		drawn = timer.status;
		panel.body.empty();
		panel.el.toggleClass("is-done", drawn === "done");
		display = bar = progress = null;
		const root = panel.body.createDiv({ cls: ["daily-glance-timer", `is-${drawn}`] });

		if (drawn === "idle") {
			const inputs = root.createDiv({ cls: "daily-glance-timer-inputs" });
			const total = Math.round(timer.duration / 1000);
			const field = (label: string, value: number) => {
				const input = inputs
					.createEl("label", { cls: "daily-glance-timer-field", text: label })
					.createEl("input", { type: "text", value: String(value).padStart(2, "0") });
				input.inputMode = "numeric";
				return input;
			};
			const h = field(t("hours"), Math.floor(total / 3600));
			inputs.createSpan({ cls: "daily-glance-timer-sep", text: ":" });
			const m = field(t("minutes"), Math.floor((total % 3600) / 60));
			inputs.createSpan({ cls: "daily-glance-timer-sep", text: ":" });
			const s = field(t("seconds"), total % 60);
			const controls = root.createDiv({ cls: "daily-glance-timer-controls" });
			button(controls, "play", t("start"), true, () => {
				const n = (el: HTMLInputElement) => Math.max(0, parseInt(el.value, 10) || 0);
				const ms = ((n(h) * 60 + n(m)) * 60 + n(s)) * 1000;
				if (ms === 0) return;
				timer.start(ms);
				draw();
			});
			if (settings.timerPresets) {
				for (const min of [settings.preset1, settings.preset2]) {
					button(controls, "timer", presetLabel(min), false, () => (timer.start(min * 60_000), draw()));
				}
			}
			return;
		}

		if (drawn === "done") {
			const label = root.createDiv({ cls: "daily-glance-timer-done-label", attr: { role: "status" } });
			setIcon(label.createSpan(), "bell");
			label.appendText(t("timesUp"));
		}
		display = root.createDiv({ cls: "daily-glance-timer-display" });
		progress = root.createDiv({
			cls: "daily-glance-timer-progress",
			attr: { role: "progressbar", "aria-valuemin": 0, "aria-valuemax": 100 },
		});
		bar = progress.createDiv();
		const controls = root.createDiv({ cls: "daily-glance-timer-controls" });
		if (drawn === "running") button(controls, "pause", t("pause"), false, () => (timer.pause(), draw()));
		if (drawn === "paused") button(controls, "play", t("resume"), true, () => (timer.resume(), draw()));
		button(controls, "rotate-ccw", t("reset"), drawn === "done", () => (timer.reset(), draw()));
		update();
	};

	draw();
	return () => (timer.status !== drawn ? draw() : update());
}
