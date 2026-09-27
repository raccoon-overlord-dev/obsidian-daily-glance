import { setIcon } from "obsidian";

export interface Panel {
	el: HTMLElement;
	actions: HTMLElement;
	body: HTMLElement;
}

// Shared shell: section.daily-glance-panel > header + body (design-system/components/Panel).
export function createPanel(parent: HTMLElement, id: string, title: string): Panel {
	const el = parent.createEl("section", {
		cls: ["daily-glance-panel", `daily-glance-panel--${id}`],
		attr: { "aria-label": title },
	});
	const header = el.createEl("header", { cls: "daily-glance-panel-header" });
	header.createSpan({ cls: "daily-glance-panel-title", text: title });
	const actions = header.createSpan({ cls: "daily-glance-panel-actions" });
	const body = el.createDiv({ cls: "daily-glance-panel-body" });
	return { el, actions, body };
}

export function setLoading(panel: Panel, loading: boolean): void {
	panel.el.toggleClass("is-loading", loading);
	if (!loading) return;
	panel.body.empty();
	panel.body.createDiv({ cls: "daily-glance-skeleton" });
	panel.body.createDiv({ cls: "daily-glance-skeleton" });
}

export function renderStatus(parent: HTMLElement, kind: "error" | "stale", text: string): HTMLElement {
	const el = parent.createDiv({ cls: ["daily-glance-status", `is-${kind}`] });
	if (kind === "error") el.setAttr("role", "alert");
	setIcon(el.createSpan(), kind === "error" ? "alert-circle" : "history");
	el.appendText(text);
	return el;
}

export function renderEmpty(parent: HTMLElement, icon: string, text: string): HTMLElement {
	const el = parent.createDiv({ cls: "daily-glance-empty" });
	setIcon(el.createSpan(), icon);
	el.appendText(text);
	return el;
}
