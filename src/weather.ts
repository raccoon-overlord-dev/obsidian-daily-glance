import { requestUrl, setIcon, setTooltip } from "obsidian";
import { moment } from "./moment";
import type DailyGlancePlugin from "./main";
import { Panel, renderEmpty, renderStatus, setLoading } from "./panel";

export type TempUnit = "C" | "F";

export interface WeatherLocation {
	name: string; // shown in the widget
	label: string; // "Roma, Lazio, Italy": shown in settings to disambiguate
	latitude: number;
	longitude: number;
}

interface Day {
	date: string; // YYYY-MM-DD, in the location's timezone
	code: number;
	max: number;
	min: number;
}

interface WeatherData {
	temp: number;
	code: number;
	days: Day[]; // [0] = today
}

// WMO weather interpretation codes → Lucide icon + label (Open-Meteo docs).
const WMO: Record<number, [string, string]> = {
	0: ["sun", "Clear sky"],
	1: ["cloud-sun", "Mainly clear"],
	2: ["cloud-sun", "Partly cloudy"],
	3: ["cloud", "Overcast"],
	45: ["cloud-fog", "Fog"],
	48: ["cloud-fog", "Rime fog"],
	51: ["cloud-drizzle", "Light drizzle"],
	53: ["cloud-drizzle", "Drizzle"],
	55: ["cloud-drizzle", "Heavy drizzle"],
	56: ["cloud-drizzle", "Freezing drizzle"],
	57: ["cloud-drizzle", "Freezing drizzle"],
	61: ["cloud-rain", "Light rain"],
	63: ["cloud-rain", "Rain"],
	65: ["cloud-rain", "Heavy rain"],
	66: ["cloud-rain", "Freezing rain"],
	67: ["cloud-rain", "Freezing rain"],
	71: ["cloud-snow", "Light snow"],
	73: ["cloud-snow", "Snow"],
	75: ["cloud-snow", "Heavy snow"],
	77: ["cloud-snow", "Snow grains"],
	80: ["cloud-rain", "Light showers"],
	81: ["cloud-rain", "Showers"],
	82: ["cloud-rain", "Heavy showers"],
	85: ["cloud-snow", "Snow showers"],
	86: ["cloud-snow", "Heavy snow showers"],
	95: ["cloud-lightning", "Thunderstorm"],
	96: ["cloud-lightning", "Thunderstorm with hail"],
	99: ["cloud-lightning", "Thunderstorm with hail"],
};
const wmo = (code: number) => WMO[code] ?? ["cloud", "Unknown"];

const REFRESH_MS = 30 * 60_000;
const RETRY_MS = 5 * 60_000;

// Response shapes: remote data, so every field is optional and checked before use.
interface GeocodeResponse {
	results?: { name?: string; admin1?: string; country?: string; latitude?: number; longitude?: number }[];
}
interface ForecastResponse {
	current?: { temperature_2m?: number; weather_code?: number };
	daily?: { time?: string[]; weather_code?: number[]; temperature_2m_max?: number[]; temperature_2m_min?: number[] };
}

// Throws on network error; returns null when the city isn't found.
export async function geocode(city: string): Promise<WeatherLocation | null> {
	const res = await requestUrl({
		url: `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`,
	});
	const r = (res.json as GeocodeResponse | null)?.results?.[0];
	if (!r || typeof r.latitude !== "number" || typeof r.longitude !== "number") return null;
	const name = String(r.name ?? city);
	return {
		name,
		label: [name, r.admin1, r.country].filter(Boolean).join(", "),
		latitude: r.latitude,
		longitude: r.longitude,
	};
}

async function fetchWeather(loc: WeatherLocation, unit: TempUnit): Promise<WeatherData> {
	const res = await requestUrl({
		url:
			`https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}` +
			`&current=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min` +
			`&timezone=auto&forecast_days=6&temperature_unit=${unit === "F" ? "fahrenheit" : "celsius"}`,
	});
	const { current, daily } = (res.json as ForecastResponse | null) ?? {};
	const temp = current?.temperature_2m;
	const { time, weather_code: codes, temperature_2m_max: max, temperature_2m_min: min } = daily ?? {};
	if (typeof temp !== "number" || !Array.isArray(time) || !codes || !max || !min) {
		throw new Error("unexpected response");
	}
	return {
		temp,
		code: current?.weather_code ?? -1, // -1: unknown, renders as "Unknown"
		days: time.map((date, i) => ({ date, code: codes[i], max: max[i], min: min[i] })),
	};
}

// Plugin-level cache so re-rendering a view never refetches.
export class Weather {
	data: WeatherData | null = null;
	fetchedAt = 0;
	error: string | null = null;
	loading = false;
	private attemptedAt = 0;

	constructor(private plugin: DailyGlancePlugin) {}

	// Location or unit changed: drop the old data.
	clear(): void {
		this.data = null;
		this.error = null;
		this.fetchedAt = this.attemptedAt = 0;
	}

	// Fetch if due (30 min after a success, 5 min after a failure), or now when forced.
	async refresh(force = false): Promise<void> {
		const { location: loc, tempUnit } = this.plugin.settings;
		if (!loc || !this.plugin.settings.show.weather || this.loading) return;
		const wait = this.error ? RETRY_MS : REFRESH_MS;
		if (!force && Date.now() - this.attemptedAt < wait) return;

		this.loading = true;
		this.attemptedAt = Date.now();
		this.plugin.redraw("weather");
		try {
			const data = await fetchWeather(loc, tempUnit);
			const now = this.plugin.settings;
			if (loc !== now.location || tempUnit !== now.tempUnit) return; // settings changed mid-request
			this.data = data;
			this.fetchedAt = Date.now();
			this.error = null;
		} catch (e) {
			this.error = e instanceof Error ? e.message : String(e);
		} finally {
			this.loading = false;
			this.plugin.redraw("weather");
		}
	}
}

const deg = (n: number) => `${Math.round(n)}°`;

export function renderWeather(panel: Panel, plugin: DailyGlancePlugin): void {
	const { settings, weather } = plugin;
	panel.body.empty();
	panel.actions.empty();
	panel.el.removeClass("is-loading", "is-stale");

	if (!settings.city.trim()) {
		renderEmpty(panel.body, "map-pin", "Set a city in Settings → Daily Glance.");
		return;
	}
	if (!settings.location) {
		renderStatus(panel.body, "error", `Couldn't find “${settings.city}”. Check the city in Settings → Daily Glance.`);
		return;
	}

	const refresh = panel.actions.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "Refresh" } });
	setIcon(refresh, "refresh-cw");
	setTooltip(refresh, "Refresh");
	refresh.addEventListener("click", () => void weather.refresh(true));

	const data = weather.data;
	if (!data) {
		if (weather.error) renderStatus(panel.body, "error", `Weather failed to load from Open-Meteo (${weather.error}).`);
		else setLoading(panel, true);
		return;
	}

	const [today, ...rest] = data.days;
	const [icon, label] = wmo(data.code);
	const now = panel.body.createDiv({ cls: "daily-glance-weather-now" });
	setIcon(now.createSpan({ cls: "daily-glance-weather-icon" }), icon);
	now.createSpan({ cls: "daily-glance-weather-temp", text: deg(data.temp) });
	const meta = now.createSpan({ cls: "daily-glance-weather-meta" });
	meta.createSpan({ cls: "daily-glance-weather-cond", text: label });
	if (today) meta.createSpan({ cls: "daily-glance-weather-range", text: `H ${deg(today.max)} · L ${deg(today.min)}` });
	meta.createSpan({ cls: "daily-glance-weather-place", text: settings.location.name });

	if (weather.error) {
		panel.el.addClass("is-stale");
		renderStatus(panel.body, "stale", `Updated ${moment(weather.fetchedAt).fromNow()} · update failed`).setAttr(
			"title",
			"Last update failed"
		);
	}

	if (settings.showForecast) {
		const forecast = panel.body.createDiv({ cls: "daily-glance-weather-forecast" });
		for (const day of rest.slice(0, 5)) {
			const [dayIcon, dayLabel] = wmo(day.code);
			const el = forecast.createDiv({ cls: "daily-glance-weather-day", attr: { title: dayLabel } });
			el.createSpan({ text: moment(day.date, "YYYY-MM-DD").format("ddd") });
			setIcon(el.createSpan({ attr: { "aria-label": dayLabel } }), dayIcon);
			el.createSpan({ cls: "daily-glance-weather-day-hi", text: deg(day.max) });
			el.createSpan({ cls: "daily-glance-weather-day-lo", text: deg(day.min) });
		}
	}
}
