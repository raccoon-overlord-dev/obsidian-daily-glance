import ICAL from "ical.js";
import { requestUrl, setIcon, setTooltip } from "obsidian";
import { moment } from "./moment";
import type DailyGlancePlugin from "./main";
import { localeData, m, t } from "./i18n";
import { Panel, renderEmpty, renderStatus, setLoading } from "./panel";

export interface Feed {
	name: string;
	url: string;
	color?: string; // "#rrggbb", used only when settings.colorEvents is on
}

export const MAX_FEEDS = 5;
const REFRESH_MS = 15 * 60_000;
// ponytail: occurrences are walked from DTSTART; cap guards against runaway rules.
// If old daily series get slow, start the iterator near the range instead.
const MAX_OCCURRENCES = 20_000;

export interface CalEvent {
	title: string;
	start: Date;
	end: Date;
	allDay: boolean;
	feed: string; // display name
	color?: string; // feed colour, when colouring is enabled
}

interface FeedState {
	events: ICAL.Event[] | null; // parsed masters (exceptions attached), or null if never loaded
	error: string | null;
}

export const feedName = (feed: Feed, i: number) => feed.name.trim() || t("feedN", { n: i + 1 });

// All-day dates are calendar dates: build them in local time so they never shift by timezone.
function toDate(t: ICAL.Time): Date {
	return t.isDate ? new Date(t.year, t.month - 1, t.day) : t.toJSDate();
}

function parse(text: string): ICAL.Event[] {
	const cal = new ICAL.Component(ICAL.parse(text) as unknown[]);
	for (const tz of cal.getAllSubcomponents("vtimezone")) ICAL.TimezoneService.register(tz);

	// Group by UID: the master carries the RRULE, RECURRENCE-ID components override single occurrences.
	const masters = new Map<string, ICAL.Component>();
	const exceptions = new Map<string, ICAL.Component[]>();
	const standalone: ICAL.Component[] = [];
	for (const ve of cal.getAllSubcomponents("vevent")) {
		const uid = String(ve.getFirstPropertyValue("uid") ?? "");
		if (!ve.hasProperty("recurrence-id")) {
			if (uid && !masters.has(uid)) masters.set(uid, ve);
			else standalone.push(ve);
		} else if (uid) {
			exceptions.set(uid, [...(exceptions.get(uid) ?? []), ve]);
		}
	}
	const events: ICAL.Event[] = [];
	for (const [uid, master] of masters) {
		events.push(new ICAL.Event(master, { exceptions: exceptions.get(uid) ?? [] }));
		exceptions.delete(uid);
	}
	// Overrides whose master isn't in the feed: show them as single events.
	for (const ve of [...standalone, ...[...exceptions.values()].flat()]) events.push(new ICAL.Event(ve));
	return events;
}

function isCancelled(e: ICAL.Event): boolean {
	return String(e.component.getFirstPropertyValue("status") ?? "").toUpperCase() === "CANCELLED";
}

// Plugin-level cache of parsed feeds, keyed by URL; views expand occurrences from it.
export class Calendar {
	private feeds = new Map<string, FeedState>();
	loading = false;
	private attemptedAt = 0;

	constructor(private plugin: DailyGlancePlugin) {}

	private active(): Feed[] {
		return this.plugin.settings.feeds.filter((f) => f.url.trim());
	}

	async refresh(force = false): Promise<void> {
		const { settings } = this.plugin;
		if (!settings.show.calendar || this.loading) return;
		if (!force && Date.now() - this.attemptedAt < REFRESH_MS) return;

		const feeds = this.active();
		// Drop removed feeds right away.
		for (const url of this.feeds.keys()) if (!feeds.some((f) => f.url === url)) this.feeds.delete(url);
		if (!feeds.length) return this.plugin.redraw("calendar");

		this.loading = true;
		this.attemptedAt = Date.now();
		this.plugin.redraw("calendar");
		await Promise.all(
			feeds.map(async (feed) => {
				const prev = this.feeds.get(feed.url);
				let text: string;
				try {
					text = (await requestUrl({ url: feed.url.trim().replace(/^webcal:\/\//i, "https://") })).text;
				} catch (e) {
					// Never include the URL: it's a secret.
					const status = (e as { status?: number }).status;
					return this.feeds.set(feed.url, { events: prev?.events ?? null, error: status ? `HTTP ${status}` : t("networkError") });
				}
				try {
					this.feeds.set(feed.url, { events: parse(text), error: null });
				} catch {
					this.feeds.set(feed.url, { events: prev?.events ?? null, error: t("invalidCalendar") });
				}
			})
		);
		this.loading = false;
		this.plugin.redraw("calendar");
	}

	// Feeds that have never loaded successfully and have no error yet.
	pending(): boolean {
		return this.active().some((f) => !this.feeds.has(f.url));
	}

	errors(): { feed: string; error: string }[] {
		return this.plugin.settings.feeds.flatMap((f, i) => {
			const error = f.url.trim() ? this.feeds.get(f.url)?.error : null;
			return error ? [{ feed: feedName(f, i), error }] : [];
		});
	}

	// Every occurrence overlapping [from, to), sorted by start.
	occurrences(from: Date, to: Date): CalEvent[] {
		const out: CalEvent[] = [];
		const toTime = ICAL.Time.fromJSDate(to, true);
		const { settings } = this.plugin;
		settings.feeds.forEach((f, i) => {
			if (!f.url.trim()) return;
			const feed = feedName(f, i);
			const color = settings.colorEvents && /^#[0-9a-f]{6}$/i.test(f.color ?? "") ? f.color : undefined;
			const add = (title: string, start: ICAL.Time, end: ICAL.Time) => {
				const s = toDate(start);
				let e = toDate(end);
				if (e <= s) e = start.isDate ? new Date(s.getFullYear(), s.getMonth(), s.getDate() + 1) : s;
				if (e > from && s < to) out.push({ title: title || t("noTitle"), start: s, end: e, allDay: start.isDate, feed, color });
			};
			for (const ev of this.feeds.get(f.url)?.events ?? []) {
				if (!ev.isRecurring()) {
					if (!isCancelled(ev)) add(ev.summary, ev.startDate, ev.endDate);
					continue;
				}
				const it = ev.iterator();
				for (let n = 0, t = it.next(); t && n < MAX_OCCURRENCES; n++, t = it.next()) {
					if (t.compare(toTime) >= 0) break;
					const occ = ev.getOccurrenceDetails(t);
					if (!isCancelled(occ.item)) add(occ.item.summary, occ.startDate, occ.endDate);
				}
			}
		});
		return out.sort((a, b) => a.start.getTime() - b.start.getTime());
	}
}

export type CalLayout = "month-events" | "week-events" | "events" | "month" | "week";
export const CAL_LAYOUTS: Record<CalLayout, string> = {
	"month-events": "Month + events",
	"week-events": "Week + events",
	events: "Events only",
	month: "Month only",
	week: "Week only",
};

// Navigation state, shared by all open views and kept across redraws.
const nav = { cursor: null as moment.Moment | null, selected: null as moment.Moment | null };

function renderEvents(parent: HTMLElement, plugin: DailyGlancePlugin, events: CalEvent[], label: string, empty: string): void {
	const { settings } = plugin;
	const list = parent.createDiv({ cls: "daily-glance-cal-events" });
	list.createDiv({ cls: "daily-glance-cal-events-label", text: label });
	if (!events.length) {
		renderEmpty(list, "calendar", empty);
		return;
	}
	const time = settings.timeFormat === "12h" ? "h:mm A" : "HH:mm";
	const today = m().startOf("day");
	for (const ev of events) {
		// An event already under way is listed under today.
		const day = moment.max(m(ev.start).startOf("day"), today);
		const diff = day.diff(today, "days");
		const row = list.createDiv({
			cls: "daily-glance-cal-event",
			attr: { title: m(ev.start).format(settings.dateFormat) },
		});
		const when = row.createDiv({ cls: "daily-glance-cal-event-when" });
		when.createEl("b", { text: diff === 0 ? t("today") : diff === 1 ? t("tomorrow") : day.format("ddd D") });
		when.appendText(ev.allDay ? t("allDay") : `${m(ev.start).format(time)}–${m(ev.end).format(time)}`);
		const what = row.createDiv();
		paint(what.createDiv({ cls: "daily-glance-cal-event-title", text: ev.title }), ev);
		what.createDiv({ cls: "daily-glance-cal-event-feed", text: ev.feed });
	}
}

// Tags an element with its event's feed colour; styles.css turns it into a highlight/dot.
function paint(el: HTMLElement, ev: CalEvent): HTMLElement {
	if (ev.color) {
		el.addClass("has-color");
		el.setCssProps({ "--dg-event-color": ev.color });
	}
	return el;
}

function iconButton(parent: HTMLElement, icon: string, label: string, onClick: () => void): void {
	const b = parent.createEl("button", { cls: "clickable-icon", attr: { "aria-label": label } });
	setIcon(b, icon);
	setTooltip(b, label);
	b.addEventListener("click", onClick);
}

// Start of the week containing `d`, for a week starting on `weekStart` (0 = Sunday).
function weekOf(d: moment.Moment, weekStart: number): moment.Moment {
	const day = d.clone().startOf("day");
	return day.subtract((day.day() - weekStart + 7) % 7, "days");
}

// ISO week of a row: the row's Thursday is always in the ISO week that owns most of the row.
const weekNumber = (rowStart: moment.Moment, weekStart: number) =>
	rowStart.clone().add((4 - weekStart + 7) % 7, "days").isoWeek();

const eventsOn = (events: CalEvent[], day: moment.Moment) => {
	const from = day.toDate();
	const to = day.clone().add(1, "day").toDate();
	return events.filter((e) => e.end > from && e.start < to);
};

// A focusable, clickable day (div, not <button>, so Obsidian's button styling stays off the grid).
function dayCell(parent: HTMLElement, cls: string, day: moment.Moment, redraw: () => void): HTMLElement {
	const isToday = day.isSame(m(), "day");
	const isSelected = !!nav.selected?.isSame(day, "day");
	const el = parent.createDiv({
		cls: [cls, ...(isToday ? ["is-today"] : []), ...(isSelected ? ["is-selected"] : [])],
		attr: { role: "gridcell", tabindex: 0, "aria-selected": isSelected, "aria-label": day.format("dddd D MMMM YYYY") },
	});
	if (isToday) el.setAttr("aria-current", "date");
	const toggle = () => {
		nav.selected = isSelected ? null : day.clone();
		redraw();
	};
	el.addEventListener("click", toggle);
	el.addEventListener("keydown", (e) => {
		if (e.key === "Enter" || e.key === " ") {
			e.preventDefault();
			toggle();
		}
	});
	return el;
}

export function renderCalendar(panel: Panel, plugin: DailyGlancePlugin): void {
	const { settings, calendar } = plugin;
	panel.body.empty();
	panel.actions.empty();
	panel.el.removeClass("is-loading");

	if (!settings.feeds.some((f) => f.url.trim())) {
		renderEmpty(panel.body, "calendar", t("addFeed"));
		return;
	}
	iconButton(panel.actions, "refresh-cw", t("refreshCalendars"), () => void calendar.refresh(true));
	if (calendar.pending()) {
		setLoading(panel, true);
		return;
	}
	for (const { feed, error } of calendar.errors()) {
		renderStatus(panel.body, "error", t("feedFailed", { feed, error }));
	}

	const layout = settings.calendarLayout;
	const redraw = () => renderCalendar(panel, plugin);
	const showUpcoming = layout === "events" || layout.endsWith("-events");
	const cal = panel.body.createDiv({ cls: "daily-glance-cal" });

	if (layout !== "events") {
		const isMonth = layout.startsWith("month");
		const unit = isMonth ? "month" : "week";
		const { weekStart } = settings;
		const cursor = m(nav.cursor ?? undefined); // re-localized: the language may have changed
		const first = isMonth ? weekOf(cursor.clone().startOf("month"), weekStart) : weekOf(cursor, weekStart);
		const rows = isMonth
			? Math.ceil((cursor.clone().endOf("month").diff(first, "days") + 1) / 7)
			: 1;
		const events = calendar.occurrences(first.toDate(), first.clone().add(rows * 7, "days").toDate());

		const wrap = cal.createDiv();
		const navEl = wrap.createDiv({ cls: "daily-glance-cal-nav" });
		const last = first.clone().add(6, "days");
		const label = isMonth
			? cursor.format("MMMM YYYY")
			: `${first.format("D MMM")} – ${last.format("D MMM YYYY")}`;
		navEl.createSpan({
			cls: "daily-glance-cal-month-label",
			text: !isMonth && settings.showWeekNumbers ? `${label} · ${t("weekShort", { n: weekNumber(first, weekStart) })}` : label,
		});
		const move = (n: number) => () => {
			nav.cursor = cursor.clone().add(n, unit);
			redraw();
		};
		iconButton(navEl, "chevron-left", t(isMonth ? "prevMonth" : "prevWeek"), move(-1));
		navEl
			.createEl("button", { cls: ["clickable-icon", "daily-glance-cal-today"], text: t("today") })
			.addEventListener("click", () => {
				nav.cursor = nav.selected = null;
				redraw();
			});
		iconButton(navEl, "chevron-right", t(isMonth ? "nextMonth" : "nextWeek"), move(1));

		if (isMonth) {
			const grid = wrap.createDiv({ cls: "daily-glance-cal-grid", attr: { role: "grid" } });
			grid.toggleClass("has-week-numbers", settings.showWeekNumbers);
			if (settings.showWeekNumbers) grid.createDiv({ cls: "daily-glance-cal-weekday" });
			for (let i = 0; i < 7; i++) {
				grid.createDiv({ cls: "daily-glance-cal-weekday", text: localeData().weekdaysShort()[(weekStart + i) % 7] });
			}
			for (let r = 0; r < rows; r++) {
				const rowStart = first.clone().add(r * 7, "days");
				if (settings.showWeekNumbers) {
					grid.createDiv({
						cls: "daily-glance-cal-weeknum",
						text: t("weekShort", { n: weekNumber(rowStart, weekStart) }),
						attr: { "aria-label": t("week", { n: weekNumber(rowStart, weekStart) }) },
					});
				}
				for (let c = 0; c < 7; c++) {
					const day = rowStart.clone().add(c, "days");
					const cell = dayCell(grid, "daily-glance-cal-day", day, redraw);
					cell.toggleClass("is-outside", !day.isSame(cursor, "month"));
					cell.createSpan({ text: String(day.date()) });
					const dayEvents = eventsOn(events, day).slice(0, 3);
					if (dayEvents.length) {
						const dots = cell.createSpan({ cls: "daily-glance-cal-dots" });
						for (const ev of dayEvents) paint(dots.createEl("i", { cls: "daily-glance-cal-dot" }), ev);
					}
				}
			}
		} else {
			const week = wrap.createDiv({ cls: "daily-glance-cal-week", attr: { role: "grid" } });
			for (let c = 0; c < 7; c++) {
				const day = first.clone().add(c, "days");
				const cell = dayCell(week, "daily-glance-cal-week-day", day, redraw);
				cell.createDiv({ cls: "daily-glance-cal-weekday", text: day.format("ddd D") });
				const dayEvents = eventsOn(events, day);
				for (const ev of dayEvents.slice(0, 3)) {
					paint(cell.createDiv({ cls: "daily-glance-cal-event-title", text: ev.title, attr: { title: ev.title } }), ev);
				}
				if (dayEvents.length > 3) cell.createDiv({ cls: "daily-glance-cal-event-feed", text: `+${dayEvents.length - 3}` });
			}
		}
	}

	// A selected day replaces the upcoming list (and adds a list to the grid-only layouts).
	if (nav.selected && layout !== "events") {
		const from = nav.selected.toDate();
		const events = calendar.occurrences(from, nav.selected.clone().add(1, "day").toDate());
		renderEvents(cal, plugin, events, m(nav.selected).format("dddd D MMMM"), t("noEvents"));
	} else if (showUpcoming) {
		const events = calendar
			.occurrences(new Date(), m().add(settings.upcomingDays, "days").toDate())
			.slice(0, settings.upcomingCount);
		renderEvents(cal, plugin, events, t("upcoming"), t("noUpcoming", { days: settings.upcomingDays }));
	}
	cal.toggleClass("has-events", layout !== "events" && !!cal.querySelector(".daily-glance-cal-events"));
}
