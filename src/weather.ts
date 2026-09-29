import { requestUrl, setIcon, setTooltip } from "obsidian";
import { m, StringKey, t } from "./i18n";
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

// WMO weather interpretation codes → Lucide icon + label key (Open-Meteo docs).
const WMO: Record<number, [string, StringKey]> = {
	0: ["sun", "clearSky"],
	1: ["cloud-sun", "mainlyClear"],
	2: ["cloud-sun", "partlyCloudy"],
	3: ["cloud", "overcast"],
	45: ["cloud-fog", "fog"],
	48: ["cloud-fog", "rimeFog"],
	51: ["cloud-drizzle", "lightDrizzle"],
	53: ["cloud-drizzle", "drizzle"],
	55: ["cloud-drizzle", "heavyDrizzle"],
	56: ["cloud-drizzle", "freezingDrizzle"],
	57: ["cloud-drizzle", "freezingDrizzle"],
	61: ["cloud-rain", "lightRain"],
	63: ["cloud-rain", "rain"],
	65: ["cloud-rain", "heavyRain"],
	66: ["cloud-rain", "freezingRain"],
	67: ["cloud-rain", "freezingRain"],
	71: ["cloud-snow", "lightSnow"],
	73: ["cloud-snow", "snow"],
	75: ["cloud-snow", "heavySnow"],
	77: ["cloud-snow", "snowGrains"],
	80: ["cloud-rain", "lightShowers"],
	81: ["cloud-rain", "showers"],
	82: ["cloud-rain", "heavyShowers"],
	85: ["cloud-snow", "snowShowers"],
	86: ["cloud-snow", "heavySnowShowers"],
	95: ["cloud-lightning", "thunderstorm"],
	96: ["cloud-lightning", "thunderstormHail"],
	99: ["cloud-lightning", "thunderstormHail"],
};
const wmo = (code: number): [string, string] => {
	const [icon, key] = WMO[code] ?? ["cloud", "unknown"];
	return [icon, t(key)];
};

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
		renderEmpty(panel.body, "map-pin", t("setCity"));
		return;
	}
	if (!settings.location) {
		renderStatus(panel.body, "error", t("cityNotFound", { city: settings.city }));
		return;
	}

	const refresh = panel.actions.createEl("button", { cls: "clickable-icon", attr: { "aria-label": t("refresh") } });
	setIcon(refresh, "refresh-cw");
	setTooltip(refresh, t("refresh"));
	refresh.addEventListener("click", () => void weather.refresh(true));

	const data = weather.data;
	if (!data) {
		if (weather.error) renderStatus(panel.body, "error", t("weatherFailed", { error: weather.error }));
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
	if (today) meta.createSpan({ cls: "daily-glance-weather-range", text: t("highLow", { hi: deg(today.max), lo: deg(today.min) }) });
	meta.createSpan({ cls: "daily-glance-weather-place", text: settings.location.name });

	if (weather.error) {
		panel.el.addClass("is-stale");
		renderStatus(panel.body, "stale", t("stale", { when: m(weather.fetchedAt).fromNow() })).setAttr(
			"title",
			t("lastUpdateFailed")
		);
	}

	if (settings.showForecast) {
		const forecast = panel.body.createDiv({ cls: "daily-glance-weather-forecast" });
		for (const day of rest.slice(0, 5)) {
			const [dayIcon, dayLabel] = wmo(day.code);
			const el = forecast.createDiv({ cls: "daily-glance-weather-day", attr: { title: dayLabel } });
			el.createSpan({ text: m(day.date, "YYYY-MM-DD").format("ddd") });
			setIcon(el.createSpan({ attr: { "aria-label": dayLabel } }), dayIcon);
			el.createSpan({ cls: "daily-glance-weather-day-hi", text: deg(day.max) });
			el.createSpan({ cls: "daily-glance-weather-day-lo", text: deg(day.min) });
		}
	}
}
