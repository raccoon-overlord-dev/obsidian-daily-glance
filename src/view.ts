import { ItemView, WorkspaceLeaf } from "obsidian";
import type DailyGlancePlugin from "./main";
import type { ItemId } from "./settings";
import { t } from "./i18n";
import { createPanel, Panel } from "./panel";
import { renderClock } from "./clock";
import { renderTimer } from "./timer";
import { renderWeather } from "./weather";
import { renderCalendar } from "./calendar";

export const VIEW_TYPE = "daily-glance-view";

export class DailyGlanceView extends ItemView {
	// State of the current render; replaced on every render().
	private panels: Partial<Record<ItemId, Panel>> = {};
	private ticks: Partial<Record<ItemId, () => void>> = {}; // run every second

	constructor(leaf: WorkspaceLeaf, private plugin: DailyGlancePlugin) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Daily Glance";
	}

	getIcon(): string {
		return "layout-dashboard";
	}

	async onOpen(): Promise<void> {
		this.render();
		this.registerInterval(
			window.setInterval(() => Object.values(this.ticks).forEach((t) => t()), 1000)
		);
		this.plugin.refreshData();
	}

	render(): void {
		const root = this.contentEl;
		root.empty();
		this.panels = {};
		this.ticks = {};
		const grid = root.createDiv({ cls: "daily-glance" }).createDiv({ cls: "daily-glance-grid" });
		const { settings } = this.plugin;
		for (const id of settings.order) {
			if (!settings.show[id]) continue;
			this.panels[id] = createPanel(grid, id, t(id), settings.showTitles);
			this.redraw(id);
		}
	}

	// Rebuild one panel's contents in place (other panels keep their state).
	redraw(id: ItemId): void {
		const panel = this.panels[id];
		if (!panel) return;
		const { settings } = this.plugin;
		if (id === "clock") this.ticks.clock = renderClock(panel.body, settings);
		if (id === "timer") this.ticks.timer = renderTimer(panel, this.plugin.timer, settings);
		if (id === "weather") renderWeather(panel, this.plugin);
		if (id === "calendar") renderCalendar(panel, this.plugin);
	}
}
