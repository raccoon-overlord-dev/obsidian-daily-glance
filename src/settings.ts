import {
	App,
	PluginSettingTab,
	requireApiVersion,
	Setting,
	SettingDefinitionItem,
	SettingDefinitionList,
} from "obsidian";
import type DailyGlancePlugin from "./main";
import { DEFAULT_DATE_FORMAT } from "./clock";
import { presetLabel } from "./timer";
import { geocode, TempUnit, WeatherLocation } from "./weather";
import { CAL_LAYOUTS, CalLayout, Feed, feedName, MAX_FEEDS } from "./calendar";
import { moment } from "./moment";
import { Language, LANGUAGES, setLanguage } from "./i18n";

export type ItemId = "clock" | "weather" | "calendar" | "timer";

// Default render order; the user can reorder (settings.order).
export const ITEMS: { id: ItemId; title: string }[] = [
	{ id: "clock", title: "Clock" },
	{ id: "weather", title: "Weather" },
	{ id: "calendar", title: "Calendar" },
	{ id: "timer", title: "Timer" },
];

export interface DailyGlanceSettings {
	show: Record<ItemId, boolean>;
	order: ItemId[];
	showTitles: boolean;
	language: Language;
	timeFormat: "24h" | "12h";
	showSeconds: boolean;
	dateFormat: string;
	city: string;
	location: WeatherLocation | null; // resolved from city once, when it changes
	showForecast: boolean;
	tempUnit: TempUnit;
	feeds: Feed[]; // .ics URLs are private secrets: never log them
	calendarLayout: CalLayout;
	weekStart: number; // 0 = Sunday … 6 = Saturday
	showWeekNumbers: boolean;
	colorEvents: boolean;
	upcomingCount: number;
	upcomingDays: number;
	timerSound: boolean;
	timerPresets: boolean;
	preset1: number; // minutes
	preset2: number;
}

export const DEFAULT_SETTINGS: DailyGlanceSettings = {
	show: { clock: true, weather: true, calendar: true, timer: true },
	order: ITEMS.map((i) => i.id),
	showTitles: true,
	language: "auto",
	timeFormat: "24h",
	showSeconds: true,
	dateFormat: DEFAULT_DATE_FORMAT,
	city: "",
	location: null,
	showForecast: true,
	tempUnit: "C",
	feeds: [],
	calendarLayout: "month-events",
	weekStart: 1,
	showWeekNumbers: false,
	colorEvents: false,
	upcomingCount: 5,
	upcomingDays: 14,
	timerSound: true,
	timerPresets: true,
	preset1: 15,
	preset2: 30,
};

// Dropdown values are strings; these settings are stored as numbers.
const NUMERIC_KEYS = ["weekStart", "upcomingCount", "upcomingDays", "preset1", "preset2"];
const PRESET_MINUTES = [1, 5, 10, 15, 20, 25, 30, 45, 60, 90, 120];
const options = (values: number[], label: (n: number) => string) =>
	Object.fromEntries(values.map((n) => [String(n), label(n)]));

// Settings are declared once, in getSettingDefinitions(). Obsidian ≥ 1.13 renders them itself
// (and indexes them for settings search); on older versions display() renders the same list.
export class DailyGlanceSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: DailyGlancePlugin) {
		super(app, plugin);
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		const { feeds, order } = this.plugin.settings;
		const title = (id: ItemId) => ITEMS.find((i) => i.id === id)?.title ?? id;
		const weekdays: Record<string, string> = {};
		for (let i = 0; i < 7; i++) weekdays[String(i)] = moment.weekdays(i);

		return [
			{
				type: "group",
				heading: "General",
				items: [
					{
						name: "Language",
						desc: "Language of the widget: labels, dates, weekdays and weather conditions.",
						control: { type: "dropdown", key: "language", options: LANGUAGES },
					},
					{ name: "Show panel titles", control: { type: "toggle", key: "showTitles" } },
				],
			},
			{
				type: "list",
				heading: "Items",
				items: order.map((id) => ({
					name: title(id),
					desc: `Show the ${title(id).toLowerCase()} panel.`,
					control: { type: "toggle", key: `show.${id}` },
				})),
				onReorder: (from, to) => void this.moveItem(from, to),
			},
			{
				type: "group",
				heading: "Clock",
				items: [
					{
						name: "Time format",
						control: { type: "dropdown", key: "timeFormat", options: { "24h": "24-hour", "12h": "12-hour" } },
					},
					{ name: "Show seconds", control: { type: "toggle", key: "showSeconds" } },
					{ name: "Date format", desc: "Moment format string.", render: (setting) => this.renderDateFormat(setting) },
				],
			},
			{
				type: "group",
				heading: "Weather",
				items: [
					{ name: "City", desc: "Weather data from Open-Meteo.", render: (setting) => this.renderCity(setting) },
					{ name: "Temperature unit", control: { type: "dropdown", key: "tempUnit", options: { C: "°C", F: "°F" } } },
					{ name: "5-day forecast", control: { type: "toggle", key: "showForecast" } },
				],
			},
			{
				type: "group",
				heading: "Calendar",
				items: [
					{ name: "Layout", control: { type: "dropdown", key: "calendarLayout", options: CAL_LAYOUTS } },
					{ name: "Week starts on", control: { type: "dropdown", key: "weekStart", options: weekdays } },
					{ name: "Show week numbers", desc: "ISO week numbers.", control: { type: "toggle", key: "showWeekNumbers" } },
					{
						name: "Upcoming events",
						desc: "How many events the list shows, and how far ahead it looks.",
						control: { type: "dropdown", key: "upcomingCount", options: options([3, 5, 10, 15, 20], String) },
					},
					{
						name: "Upcoming range",
						control: {
							type: "dropdown",
							key: "upcomingDays",
							options: options([1, 3, 7, 14, 30, 60], (n) => (n === 1 ? "1 day" : `${n} days`)),
						},
					},
					{
						name: "Colour events by calendar",
						desc: "Pick a colour for each feed below; its event titles get highlighted with it.",
						control: { type: "toggle", key: "colorEvents" },
					},
					{
						name: "Feed privacy",
						desc: "Add read-only .ics URLs (e.g. Google Calendar's secret address). They are stored in this vault's plugin data (data.json): don't share or sync that file publicly.",
					},
				],
			},
			{
				type: "group",
				heading: "Timer",
				items: [
					{ name: "Sound", desc: "Beep when the timer ends.", control: { type: "toggle", key: "timerSound" } },
					{ name: "Presets", desc: "Two quick-start buttons next to Start.", control: { type: "toggle", key: "timerPresets" } },
					{
						name: "Preset 1",
						control: { type: "dropdown", key: "preset1", options: options(PRESET_MINUTES, presetLabel) },
					},
					{
						name: "Preset 2",
						control: { type: "dropdown", key: "preset2", options: options(PRESET_MINUTES, presetLabel) },
					},
				],
			},
			{
				type: "list",
				heading: "Calendar feeds",
				emptyState: "No feeds yet.",
				items: feeds.map((feed, i) => ({
					name: feedName(feed, i),
					aliases: ["calendar", "ics"],
					render: (setting) => this.renderFeed(setting, i),
				})),
				onDelete: (i) => void this.removeFeed(i),
				// Omitted at the limit, which hides the add button.
				addItem: feeds.length < MAX_FEEDS ? { name: "Add feed", action: () => void this.addFeed() } : undefined,
			},
		];
	}

	// Control keys are settings field names; "show.<item>" addresses the nested toggles.
	getControlValue(key: string): unknown {
		const s = this.plugin.settings;
		if (key.startsWith("show.")) return s.show[key.slice(5) as ItemId];
		if (NUMERIC_KEYS.includes(key)) return String((s as unknown as Record<string, number>)[key]);
		return (s as unknown as Record<string, unknown>)[key];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		const s = this.plugin.settings;
		if (key.startsWith("show.")) s.show[key.slice(5) as ItemId] = value === true;
		else if (NUMERIC_KEYS.includes(key)) (s as unknown as Record<string, number>)[key] = Number(value);
		else (s as unknown as Record<string, unknown>)[key] = value;
		if (key === "tempUnit") this.plugin.weather.clear(); // refetch in the new unit
		if (key === "language") setLanguage(s.language);
		await this.plugin.saveSettings();
		if (key === "colorEvents") this.rerender(); // show/hide the per-feed colour pickers
	}

	// Fallback for Obsidian < 1.13 (1.13+ never calls it while definitions exist).
	display(): void {
		this.containerEl.empty();
		for (const def of this.getSettingDefinitions()) this.renderFallback(this.containerEl, def);
	}

	private rerender(): void {
		if (requireApiVersion("1.13.0")) this.update();
		else this.display();
	}

	private renderFallback(el: HTMLElement, def: SettingDefinitionItem): Setting | undefined {
		if ("type" in def) {
			if (def.type === "page") return; // not used
			if (def.heading) new Setting(el).setName(def.heading).setHeading();
			const list = def.type === "list" ? (def as SettingDefinitionList) : null;
			const count = def.items?.length ?? 0;
			def.items?.forEach((item, i) => {
				const row = this.renderFallback(el, item);
				const { onDelete, onReorder } = list ?? {};
				// No drag handles before 1.13: move rows with up/down buttons instead.
				if (row && onReorder) {
					if (i > 0) row.addExtraButton((b) => b.setIcon("arrow-up").setTooltip("Move up").onClick(() => onReorder(i, i - 1)));
					if (i < count - 1)
						row.addExtraButton((b) => b.setIcon("arrow-down").setTooltip("Move down").onClick(() => onReorder(i, i + 1)));
				}
				if (row && onDelete) {
					row.addExtraButton((b) => b.setIcon("trash-2").setTooltip("Remove").onClick(() => onDelete(i)));
				}
			});
			if (!def.items?.length && typeof list?.emptyState === "string") new Setting(el).setDesc(list.emptyState);
			const addItem = list?.addItem;
			if (addItem) new Setting(el).addButton((b) => b.setButtonText(addItem.name).onClick(() => addItem.action(b.buttonEl)));
			return;
		}
		const setting = new Setting(el).setName(def.name);
		if (def.desc) setting.setDesc(def.desc);
		if (def.render) {
			// Our render callbacks only use the Setting; SettingGroup doesn't exist before 1.11.
			(def.render as (s: Setting) => void)(setting);
		} else if (def.control?.type === "toggle") {
			const { key } = def.control;
			setting.addToggle((t) =>
				t.setValue(this.getControlValue(key) === true).onChange((v) => void this.setControlValue(key, v))
			);
		} else if (def.control?.type === "dropdown") {
			const { key, options } = def.control;
			setting.addDropdown((d) =>
				d
					.addOptions(options)
					.setValue(String(this.getControlValue(key)))
					.onChange((v) => void this.setControlValue(key, v))
			);
		}
		return setting;
	}

	private renderDateFormat(setting: Setting): void {
		const sample = createSpan();
		setting.descEl.empty();
		setting.descEl.append("Moment format string. Preview: ", sample);
		setting.addMomentFormat((m) =>
			m
				.setDefaultFormat(DEFAULT_DATE_FORMAT)
				.setValue(this.plugin.settings.dateFormat)
				.setSampleEl(sample)
				.onChange(async (v) => {
					this.plugin.settings.dateFormat = v;
					await this.plugin.saveSettings();
				})
		);
	}

	private renderCity(setting: Setting): void {
		setting.descEl.empty();
		const status = setting.descEl.createSpan();
		const showStatus = (text: string, error = false) => {
			status.setText(text);
			status.toggleClass("mod-warning", error);
		};
		const { location, city } = this.plugin.settings;
		if (location) showStatus(`Found: ${location.label}`);
		else if (city) showStatus(`Couldn't find “${city}”.`, true);
		else showStatus("Weather data from Open-Meteo.");

		setting.addText((t) => {
			t.setPlaceholder("e.g. Roma").setValue(city);
			const onChange = async () => {
				const value = t.getValue().trim();
				const { settings } = this.plugin;
				if (value === settings.city && settings.location) return;
				settings.city = value;
				settings.location = null;
				this.plugin.weather.clear();
				if (value) {
					showStatus("Looking up…");
					try {
						settings.location = await geocode(value);
						if (settings.city !== value) return; // edited again meanwhile
						if (settings.location) showStatus(`Found: ${settings.location.label}`);
						else showStatus(`Couldn't find “${value}”.`, true);
					} catch (e) {
						showStatus(`Lookup failed (${e instanceof Error ? e.message : String(e)}). Edit the city to retry.`, true);
					}
				} else showStatus("Weather data from Open-Meteo.");
				await this.plugin.saveSettings();
			};
			// "change" fires on blur/Enter, so we geocode once per edit, not per keystroke.
			t.inputEl.addEventListener("change", () => void onChange());
		});
	}

	private renderFeed(setting: Setting, i: number): void {
		const feed = this.plugin.settings.feeds[i];
		if (!feed) return;
		// Save on "change" (blur/Enter), so a feed is fetched once per edit, not per keystroke.
		setting
			.addText((t) => {
				t.setPlaceholder("Name (optional)").setValue(feed.name);
				t.inputEl.addEventListener("change", () => {
					feed.name = t.getValue();
					void this.plugin.saveSettings().then(() => this.rerender()); // row title shows the name
				});
			})
			.addText((t) => {
				t.setPlaceholder("https://…/basic.ics").setValue(feed.url);
				t.inputEl.addEventListener("change", () => {
					feed.url = t.getValue().trim();
					void this.saveFeeds();
				});
			});
		if (!this.plugin.settings.colorEvents) return;
		// No colour until one is picked; the picker just starts from black.
		setting.addColorPicker((c) =>
			c.setValue(feed.color ?? "#000000").onChange(async (v) => {
				feed.color = v;
				await this.plugin.saveSettings();
			})
		);
		setting.addExtraButton((b) =>
			b
				.setIcon("rotate-ccw")
				.setTooltip("Remove colour")
				.onClick(() => {
					delete feed.color;
					void this.plugin.saveSettings().then(() => this.rerender());
				})
		);
	}

	private async moveItem(from: number, to: number): Promise<void> {
		const { order } = this.plugin.settings;
		const [id] = order.splice(from, 1);
		if (id) order.splice(to, 0, id);
		await this.plugin.saveSettings();
		this.rerender();
	}

	private async saveFeeds(): Promise<void> {
		await this.plugin.saveSettings();
		await this.plugin.calendar.refresh(true);
	}

	private async addFeed(): Promise<void> {
		const { feeds } = this.plugin.settings;
		if (feeds.length >= MAX_FEEDS) return;
		feeds.push({ name: "", url: "" });
		await this.plugin.saveSettings();
		this.rerender();
	}

	private async removeFeed(i: number): Promise<void> {
		this.plugin.settings.feeds.splice(i, 1);
		await this.saveFeeds();
		this.rerender();
	}
}
