import { App, PluginSettingTab, Setting } from "obsidian";
import type DailyGlancePlugin from "./main";
import { DEFAULT_DATE_FORMAT } from "./clock";
import { geocode, TempUnit, WeatherLocation } from "./weather";
import { CAL_LAYOUTS, CalLayout, Feed, feedName, MAX_FEEDS } from "./calendar";
import { moment } from "./moment";

export type ItemId = "clock" | "weather" | "calendar" | "timer";

// Fixed render order (design system: Clock → Weather → Calendar → Timer).
export const ITEMS: { id: ItemId; title: string }[] = [
	{ id: "clock", title: "Clock" },
	{ id: "weather", title: "Weather" },
	{ id: "calendar", title: "Calendar" },
	{ id: "timer", title: "Timer" },
];

export interface DailyGlanceSettings {
	show: Record<ItemId, boolean>;
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
}

export const DEFAULT_SETTINGS: DailyGlanceSettings = {
	show: { clock: true, weather: true, calendar: true, timer: true },
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
};

export class DailyGlanceSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: DailyGlancePlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl).setName("Items").setHeading();
		for (const item of ITEMS) {
			new Setting(containerEl)
				.setName(`Show ${item.title.toLowerCase()}`)
				.addToggle((t) =>
					t.setValue(this.plugin.settings.show[item.id]).onChange(async (v) => {
						this.plugin.settings.show[item.id] = v;
						await this.plugin.saveSettings();
					})
				);
		}

		new Setting(containerEl).setName("Clock").setHeading();
		new Setting(containerEl).setName("Time format").addDropdown((d) =>
			d
				.addOptions({ "24h": "24-hour", "12h": "12-hour" })
				.setValue(this.plugin.settings.timeFormat)
				.onChange(async (v) => {
					this.plugin.settings.timeFormat = v as DailyGlanceSettings["timeFormat"];
					await this.plugin.saveSettings();
				})
		);
		new Setting(containerEl).setName("Show seconds").addToggle((t) =>
			t.setValue(this.plugin.settings.showSeconds).onChange(async (v) => {
				this.plugin.settings.showSeconds = v;
				await this.plugin.saveSettings();
			})
		);
		const dateFormat = new Setting(containerEl).setName("Date format");
		const sample = dateFormat.descEl.createSpan();
		dateFormat.descEl.prepend("Moment format string. Preview: ");
		dateFormat.addMomentFormat((m) =>
			m
				.setDefaultFormat(DEFAULT_DATE_FORMAT)
				.setValue(this.plugin.settings.dateFormat)
				.setSampleEl(sample)
				.onChange(async (v) => {
					this.plugin.settings.dateFormat = v;
					await this.plugin.saveSettings();
				})
		);

		new Setting(containerEl).setName("Weather").setHeading();
		const city = new Setting(containerEl).setName("City");
		const status = city.descEl.createSpan();
		const showStatus = (text: string, error = false) => {
			status.setText(text);
			status.toggleClass("mod-warning", error);
		};
		const loc = this.plugin.settings.location;
		if (loc) showStatus(`Found: ${loc.label}`);
		else if (this.plugin.settings.city) showStatus(`Couldn't find “${this.plugin.settings.city}”.`, true);
		else showStatus("Weather data from Open-Meteo.");
		city.addText((t) => {
			t.setPlaceholder("e.g. Roma").setValue(this.plugin.settings.city);
			// "change" fires on blur/Enter, so we geocode once per edit, not per keystroke.
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
						showStatus(`Lookup failed (${e instanceof Error ? e.message : e}). Edit the city to retry.`, true);
					}
				} else showStatus("Weather data from Open-Meteo.");
				await this.plugin.saveSettings();
			};
			t.inputEl.addEventListener("change", () => void onChange());
		});
		new Setting(containerEl).setName("Temperature unit").addDropdown((d) =>
			d
				.addOptions({ C: "°C", F: "°F" })
				.setValue(this.plugin.settings.tempUnit)
				.onChange(async (v) => {
					this.plugin.settings.tempUnit = v as TempUnit;
					this.plugin.weather.clear(); // refetch in the new unit
					await this.plugin.saveSettings();
				})
		);
		new Setting(containerEl).setName("5-day forecast").addToggle((t) =>
			t.setValue(this.plugin.settings.showForecast).onChange(async (v) => {
				this.plugin.settings.showForecast = v;
				await this.plugin.saveSettings();
			})
		);

		new Setting(containerEl)
			.setName("Calendar")
			.setDesc("Read-only .ics feeds (e.g. Google Calendar's secret address). The URLs are stored in this vault's plugin data.")
			.setHeading();
		new Setting(containerEl).setName("Layout").addDropdown((d) =>
			d
				.addOptions(CAL_LAYOUTS)
				.setValue(this.plugin.settings.calendarLayout)
				.onChange(async (v) => {
					this.plugin.settings.calendarLayout = v as CalLayout;
					await this.plugin.saveSettings();
				})
		);
		new Setting(containerEl).setName("Week starts on").addDropdown((d) => {
			// Listed from Monday; values are moment's day numbers (0 = Sunday).
			for (const i of [1, 2, 3, 4, 5, 6, 0]) d.addOption(String(i), moment.weekdays(i));
			d.setValue(String(this.plugin.settings.weekStart)).onChange(async (v) => {
				this.plugin.settings.weekStart = Number(v);
				await this.plugin.saveSettings();
			});
		});
		new Setting(containerEl)
			.setName("Show week numbers")
			.setDesc("ISO week numbers.")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.showWeekNumbers).onChange(async (v) => {
					this.plugin.settings.showWeekNumbers = v;
					await this.plugin.saveSettings();
				})
			);
		new Setting(containerEl)
			.setName("Colour events by calendar")
			.setDesc("Pick a colour for each feed below; its event titles get highlighted with it.")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.colorEvents).onChange(async (v) => {
					this.plugin.settings.colorEvents = v;
					await this.plugin.saveSettings();
					this.display();
				})
			);
		const { feeds, colorEvents } = this.plugin.settings;
		// Save on "change" (blur/Enter), so a feed is fetched once per edit, not per keystroke.
		const saveFeeds = async () => {
			await this.plugin.saveSettings();
			await this.plugin.calendar.refresh(true);
		};
		feeds.forEach((feed, i) => {
			const row = new Setting(containerEl)
				.setName(feedName(feed, i))
				.addText((t) => {
					t.setPlaceholder("Name (optional)").setValue(feed.name);
					t.inputEl.addEventListener("change", () => {
						feed.name = t.getValue();
						void this.plugin.saveSettings().then(() => this.display());
					});
				})
				.addText((t) => {
					t.setPlaceholder("https://…/basic.ics").setValue(feed.url);
					t.inputEl.addEventListener("change", () => {
						feed.url = t.getValue().trim();
						void saveFeeds();
					});
				});
			if (colorEvents) {
				// No colour until one is picked; the picker just starts from black.
				row.addColorPicker((c) =>
					c.setValue(feed.color ?? "#000000").onChange(async (v) => {
						feed.color = v;
						await this.plugin.saveSettings();
					})
				);
				row.addExtraButton((b) =>
					b
						.setIcon("rotate-ccw")
						.setTooltip("Remove colour")
						.onClick(async () => {
							delete feed.color;
							await this.plugin.saveSettings();
							this.display();
						})
				);
			}
			row.addExtraButton((b) =>
				b
					.setIcon("trash-2")
					.setTooltip("Remove feed")
					.onClick(async () => {
						feeds.splice(i, 1);
						await saveFeeds();
						this.display();
					})
			);
		});
		new Setting(containerEl).addButton((b) =>
			b
				.setButtonText("Add feed")
				.setDisabled(feeds.length >= MAX_FEEDS)
				.onClick(async () => {
					if (feeds.length >= MAX_FEEDS) return;
					feeds.push({ name: "", url: "" });
					await this.plugin.saveSettings();
					this.display();
				})
		);
	}
}
