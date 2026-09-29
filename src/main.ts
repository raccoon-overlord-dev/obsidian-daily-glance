import { Notice, Plugin } from "obsidian";
import { DEFAULT_SETTINGS, DailyGlanceSettings, DailyGlanceSettingTab, ItemId, ITEMS } from "./settings";
import { DailyGlanceView, VIEW_TYPE } from "./view";
import { beep, Timer } from "./timer";
import { setLanguage, t } from "./i18n";
import { Weather } from "./weather";
import { Calendar } from "./calendar";

export default class DailyGlancePlugin extends Plugin {
	settings!: DailyGlanceSettings;
	timer = new Timer();
	weather = new Weather(this);
	calendar = new Calendar(this);

	async onload(): Promise<void> {
		await this.loadSettings();

		this.registerView(VIEW_TYPE, (leaf) => new DailyGlanceView(leaf, this));
		this.addRibbonIcon("layout-dashboard", "Open Daily Glance", () => this.activateView());
		this.addCommand({
			id: "open",
			name: "Open", // shown as "Daily Glance: Open"; guidelines: no plugin name in command names
			callback: () => this.activateView(),
		});
		this.addSettingTab(new DailyGlanceSettingTab(this.app, this));

		// Plugin-level so the notice fires even when no view is open.
		this.registerInterval(
			window.setInterval(() => {
				if (!this.timer.check()) return;
				new Notice(t("timesUp"));
				if (this.settings.timerSound) beep();
			}, 1000)
		);
		// Refresh due data only while a widget is open.
		this.registerInterval(
			window.setInterval(() => {
				if (this.app.workspace.getLeavesOfType(VIEW_TYPE).length) this.refreshData();
			}, 60_000)
		);
	}

	async activateView(): Promise<void> {
		const { workspace } = this.app;
		let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0];
		if (!leaf) {
			leaf = workspace.getRightLeaf(false) ?? workspace.getLeaf(true);
			await leaf.setViewState({ type: VIEW_TYPE, active: true });
		}
		await workspace.revealLeaf(leaf);
	}

	async loadSettings(): Promise<void> {
		const data = (await this.loadData()) as Partial<DailyGlanceSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
		this.settings.show = Object.assign({}, DEFAULT_SETTINGS.show, data?.show);
		this.settings.feeds = (data?.feeds ?? []).slice();
		// Saved order first (known ids only), then any item it's missing.
		const ids = ITEMS.map((i) => i.id);
		const saved = Array.isArray(data?.order) ? data.order.filter((id) => ids.includes(id)) : [];
		this.settings.order = [...new Set([...saved, ...ids])];
		setLanguage(this.settings.language);
	}

	// Settings apply live to every open widget view.
	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		for (const view of this.views()) view.render();
		this.refreshData();
	}

	// Fetches whatever is due; each source rate-limits itself.
	refreshData(): void {
		void this.weather.refresh();
		void this.calendar.refresh();
	}

	redraw(id: ItemId): void {
		for (const view of this.views()) view.redraw(id);
	}

	private views(): DailyGlanceView[] {
		return this.app.workspace
			.getLeavesOfType(VIEW_TYPE)
			.map((leaf) => leaf.view)
			.filter((view): view is DailyGlanceView => view instanceof DailyGlanceView);
	}
}
