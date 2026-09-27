import { moment } from "./moment";
import type { DailyGlanceSettings } from "./settings";

// Returns a tick function; the view calls it every second.
export function renderClock(body: HTMLElement, settings: DailyGlanceSettings): () => void {
	body.empty();
	const clock = body.createDiv({ cls: "daily-glance-clock" });
	const time = clock.createDiv({ cls: "daily-glance-clock-time" });
	const main = time.createSpan();
	const is12h = settings.timeFormat === "12h";
	const seconds = settings.showSeconds ? time.createSpan({ cls: "daily-glance-clock-seconds" }) : null;
	const ampm = is12h ? time.createSpan({ cls: "daily-glance-clock-ampm" }) : null;
	const date = clock.createDiv({ cls: "daily-glance-clock-date" });

	// Called every second; without seconds the text only changes once a minute.
	const tick = () => {
		const now = moment();
		main.setText(now.format(is12h ? "h:mm" : "HH:mm"));
		seconds?.setText(now.format("ss"));
		ampm?.setText(now.format("A"));
		date.setText(now.format(settings.dateFormat || DEFAULT_DATE_FORMAT));
	};
	tick();
	return tick;
}

export const DEFAULT_DATE_FORMAT = "dddd, D MMMM YYYY";
