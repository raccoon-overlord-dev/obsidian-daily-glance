# Daily Glance

Your day at a glance in Obsidian: a clock, the weather, your calendars and a countdown timer in one view. It uses your active theme (light, dark or any community theme) and adapts to where you put it: a narrow sidebar, a full-width tab, or a phone.

- [Features](#features)
- [Installation](#installation)
- [Usage](#usage)
- [Settings reference](#settings-reference)
- [Network use](#network-use)
- [Privacy](#privacy)
- [How it is built](#how-it-is-built)
- [Development](#development)
- [Adding a new item](#adding-a-new-item)
- [License](#license)

## Features

- **Clock**: time and date. 12- or 24-hour time, optional seconds, and any [moment.js date format](https://momentjs.com/docs/#/displaying/format/).
- **Weather**: current temperature, conditions and today's high/low, plus an optional 5-day forecast, from [Open-Meteo](https://open-meteo.com/) (free, no account, no API key). °C or °F.
- **Calendar**: read-only view of up to 5 `.ics` feeds (Google Calendar, iCloud, Outlook, Nextcloud, …) merged into one. Handles recurring events (including edited and deleted occurrences), all-day events and timezones. Five layouts, a configurable first day of the week, optional ISO week numbers and optional per-calendar colours.
- **Timer**: countdown with start, pause/resume and reset. It keeps running while the widget is closed and shows a notice when time is up.
- **Theme-native**: the plugin ships no colours of its own. Every colour, font and radius comes from your theme.
- **Responsive**: a 2×2 grid in a wide pane, one column in a narrow one. Turning items off reflows the rest without leaving gaps.
- **Independent items**: if the weather service or one calendar feed is down, only that item shows an error; the others keep working.

## Installation

### From Community plugins

1. Open **Settings → Community plugins → Browse**.
2. Search for **Daily Glance**, install it, then enable it.

### Manual

1. Download `main.js`, `manifest.json` and `styles.css` from the [latest release](../../releases/latest).
2. Copy them into `<your vault>/.obsidian/plugins/daily-glance/`.
3. Reload Obsidian and enable **Daily Glance** in **Settings → Community plugins**.

## Usage

Open the widget with the ribbon icon or the command palette (**Daily Glance: Open**). It opens in the right sidebar. Drag its tab anywhere, like any other view: another sidebar, the main area, or a pop-out window.

Items always appear in the same order: clock, weather, calendar, timer. Turn off the ones you don't need in settings.

### Clock

Shows the time and the date. The time format, seconds and date format are set in settings, and changes apply immediately.

### Weather

1. In **Settings → Daily Glance → Weather**, type a city and press Enter (or click away).
2. The setting shows the place that was found, for example "Found: Roma, Lazio, Italy". If it's the wrong one, add a region or country ("Paris, Texas").

The widget shows the current conditions and, if enabled, the next 5 days. Data refreshes every 30 minutes while the widget is open. The ↻ button refreshes it now. If an update fails, the last data stays visible with an "Updated … ago · update failed" line; the plugin retries every 5 minutes.

### Calendar

1. In **Settings → Daily Glance → Calendar**, click **Add feed**.
2. Paste the calendar's `.ics` address and, optionally, a name. The name is shown under each event; without one, feeds are called "Feed 1", "Feed 2", ….

Where to find the address:

| Service | Where |
|---|---|
| Google Calendar | Settings → *(your calendar)* → Integrate calendar → **Secret address in iCal format** |
| iCloud | Calendar app → share the calendar as **Public Calendar** → copy the link (`webcal://` works) |
| Outlook.com | Settings → Calendar → Shared calendars → **Publish a calendar** → ICS link |

Layouts (setting **Layout**):

| Layout | Shows |
|---|---|
| Month + events | Month grid (dots mark days with events) and the upcoming events |
| Week + events | 7-day strip with event titles, and the upcoming events |
| Events only | The next 5 events in the coming 14 days |
| Month only | Month grid |
| Week only | 7-day strip |

- **‹ / ›** move by month or week; **Today** jumps back and clears the selection.
- **Click a day** (or Tab to it and press Enter) to list that day's events. Click it again to go back to "Upcoming".
- In a wide pane (900 px or more), the event list sits beside the month grid.
- Feeds refresh every 15 minutes while the widget is open; the ↻ button refreshes them now. A feed that fails shows its own error line, e.g. "“Work” feed failed to load (HTTP 404)"; the other feeds still show their events.

### Timer

Enter hours, minutes and seconds, then press **Start**. While it runs you can **Pause**, **Resume** or **Reset**. When time is up the panel shows "Time's up" and Obsidian shows a notice, even if the widget is closed. The timer is not saved when Obsidian quits.

## Settings reference

| Setting | Default | Notes |
|---|---|---|
| Show clock / weather / calendar / timer | On | Hidden items are not rendered and make no network requests. |
| Time format | 24-hour | 12-hour adds AM/PM. |
| Show seconds | On | Off: the clock changes once a minute. |
| Date format | `dddd, D MMMM YYYY` | moment.js format, with a live preview. |
| City | *(empty)* | Looked up once when changed. |
| Temperature unit | °C | °C or °F. |
| 5-day forecast | On | |
| Layout | Month + events | See the table above. |
| Week starts on | Monday | Any day. |
| Show week numbers | Off | ISO week numbers ("W39"). |
| Colour events by calendar | Off | When on, each feed gets a colour picker. Its event titles are highlighted and its month-view dots use that colour. |
| Feeds | *(none)* | Up to 5, each with a name, an `.ics` URL and an optional colour. |

## Network use

This plugin connects to:

- **Open-Meteo** (`geocoding-api.open-meteo.com`, `api.open-meteo.com`): the city name you enter is sent once to find its coordinates, and those coordinates are sent to fetch the forecast. Only when the weather item is enabled and a city is set.
- **The calendar URLs you add**: each `.ics` URL is downloaded as-is. Only when the calendar item is enabled.

Nothing else is contacted. There is no telemetry and no account.

## Privacy

A calendar's `.ics` address, such as Google's "secret address", lets anyone who has it read that calendar. The plugin stores these URLs in `<vault>/.obsidian/plugins/daily-glance/data.json`. If you sync, share or publish your vault (for example to a Git repository), that file goes with it: exclude it, or keep the vault private. The plugin never logs these URLs and never includes them in error messages.

## How it is built

TypeScript, bundled with esbuild, following the official [sample plugin](https://github.com/obsidianmd/obsidian-sample-plugin) layout.

- **Networking** uses Obsidian's `requestUrl`, not `fetch`: it isn't subject to CORS (calendar servers don't send CORS headers) and works on mobile.
- **Dates** use the `moment` bundled with Obsidian, so it isn't shipped twice.
- **Calendar parsing** uses [`ical.js`](https://github.com/kewisch/ical.js), the only runtime dependency. It handles `RRULE`, `EXDATE`, `RECURRENCE-ID` overrides and `VTIMEZONE`.
- **DOM** is built with Obsidian's `createEl` / `createDiv`. Remote content (event titles, place names) is only ever set as text, never as HTML.
- **Icons** are Obsidian's built-in Lucide icons via `setIcon`. No SVGs are bundled.

### Source layout

| File | Role |
|---|---|
| `src/main.ts` | The plugin: registers the view, ribbon icon, command and settings tab. Owns the long-lived state (settings, timer, weather and calendar caches) and the background intervals. |
| `src/view.ts` | `DailyGlanceView`, the `ItemView`. `render()` builds the grid and one panel per enabled item; `redraw(id)` refills a single panel. |
| `src/panel.ts` | The panel shell shared by every item (header, actions, body) and helpers for the loading, error, stale and empty states. |
| `src/settings.ts` | Settings type, defaults, the fixed item order (`ITEMS`) and the settings tab. |
| `src/clock.ts`, `src/timer.ts`, `src/weather.ts`, `src/calendar.ts` | One file per item: its data logic and its render function. |
| `src/moment.ts` | Re-exports Obsidian's `moment` with a callable type (needed with TypeScript 7). |
| `styles.css` | All styling. |

### Key design decisions

- **State lives on the plugin, views only render it.** The timer, the weather cache and the parsed calendars belong to the plugin object. Closing and reopening the widget, or having it open in two places, never loses data or starts extra downloads.
- **Time is computed, not counted.** The timer stores its end timestamp and derives the remaining time from `Date.now()`, so it stays correct while the view is hidden or the device sleeps.
- **Data sources rate-limit themselves.** `Weather.refresh()` and `Calendar.refresh()` return early unless their interval has passed; `force` skips that check (the ↻ buttons, a changed city or feed). The plugin can call `refreshData()` freely: when a view opens, after any settings change, and once a minute while a widget is open.
- **Settings apply live.** `saveSettings()` re-renders every open view. When async data arrives, only the affected panel is redrawn (`plugin.redraw(id)`), so the timer inputs or the calendar selection aren't disturbed.
- **One tick for the whole view.** Each view runs a single 1-second interval, registered with `registerInterval` so Obsidian clears it on unload. Items that need per-second updates (clock, timer) give the view a tick function.
- **Calendar occurrences are expanded on demand.** Each feed is parsed once per download. `Calendar.occurrences(from, to)` expands recurring events for any range, so the upcoming list, the month grid and the week strip ask for exactly the range they display. All-day events are built as local dates so they never shift across timezones.
- **Colours come only from the theme.** `styles.css` maps Obsidian's CSS variables once, onto `--dg-*` aliases on `.daily-glance`, and every other rule reads the aliases. Nothing in the stylesheet is a literal colour. The one exception is the optional per-calendar colour, which is user data applied inline as `--dg-event-color`.
- **Container queries, not media queries.** The layout responds to the width of the widget itself (breakpoints 480 px and 900 px), so it collapses correctly in a narrow sidebar even on a wide screen.

## Development

Requirements: Node.js and npm.

```bash
npm install
npm run dev     # esbuild watch: rebuilds main.js on every change
npm run build   # type-check (tsc) + minified production build
```

To try your build, copy `main.js`, `manifest.json` and `styles.css` into a test vault's `.obsidian/plugins/daily-glance/` folder, then reload the plugin. Disabling and re-enabling it in **Settings → Community plugins** is enough. The [Hot-Reload](https://github.com/pjeby/hot-reload) plugin does this automatically.

UI rules to keep when changing anything visual:

- Every class starts with `daily-glance-`; states are `is-*` classes.
- Colours only through the `--dg-*` aliases; no hex, rgb or hsl values in `styles.css`.
- Spacing, sizes and radii use Obsidian's variables (`--size-4-*`, `--font-ui-*`, `--radius-*`).
- Reuse Obsidian's `clickable-icon`, `mod-cta`, `setIcon` and `setTooltip`. Every icon-only button needs an `aria-label` and a tooltip.
- Only the timer progress bar animates, and only when reduced motion is off.

Plugin-specific CSS that isn't in the design system goes in the **Plugin additions** block at the end of `styles.css`.

## Adding a new item

An item is one panel in the grid. Adding one, for example a "Quote of the day", takes five steps.

**1. Register it.** In `src/settings.ts`, add its id to `ItemId`, add it to `ITEMS` at the position where it should appear, and give it a default in `DEFAULT_SETTINGS.show`:

```ts
export type ItemId = "clock" | "weather" | "calendar" | "timer" | "quote";

export const ITEMS: { id: ItemId; title: string }[] = [
	// …
	{ id: "quote", title: "Quote" },
];

// DEFAULT_SETTINGS
show: { clock: true, weather: true, calendar: true, timer: true, quote: true },
```

The "Show …" toggle in settings is generated from `ITEMS`, so there's nothing else to add for it.

**2. Write the render function** in a new `src/quote.ts`. It receives the panel and fills `panel.body` (and `panel.actions` for header buttons). It must be safe to call again on the same panel, so empty the panel first:

```ts
import type DailyGlancePlugin from "./main";
import { Panel, renderEmpty, renderStatus, setLoading } from "./panel";

export function renderQuote(panel: Panel, plugin: DailyGlancePlugin): void {
	panel.body.empty();
	panel.actions.empty();
	panel.el.removeClass("is-loading");

	const { quote } = plugin;
	if (quote.error) return void renderStatus(panel.body, "error", `Quote failed to load (${quote.error}).`);
	if (!quote.text) return setLoading(panel, true);
	panel.body.createDiv({ cls: "daily-glance-quote-text", text: quote.text });
}
```

Use `setLoading`, `renderStatus(…, "error" | "stale", …)` and `renderEmpty` for the loading, error, stale and empty states, so every item looks and behaves the same.

**3. Hook it into the view.** In `DailyGlanceView.redraw()` in `src/view.ts`:

```ts
if (id === "quote") renderQuote(panel, this.plugin);
```

If the item changes every second, return a tick function and store it instead, like the clock: `this.ticks.quote = renderQuote(…)`.

**4. If it loads data, give it a source on the plugin.** Follow `Weather` or `Calendar`: a class that caches the last result, rate-limits itself in `refresh(force = false)`, and calls `plugin.redraw("quote")` when its state changes. Then create it in `src/main.ts` and add it to `refreshData()`:

```ts
quote = new Quote(this);

refreshData(): void {
	this.weather.refresh();
	this.calendar.refresh();
	this.quote.refresh();
}
```

Always use `requestUrl`, never `fetch`. Put remote text into the DOM only as text. Document the new domain under [Network use](#network-use).

**5. Style it.** Add rules to the **Plugin additions** block in `styles.css`, using `daily-glance-<item>-*` class names and only `--dg-*` colours. The grid handles placement: items flow in `ITEMS` order, and an odd last item spans the full width.

Add the item's settings to the settings type, the defaults and `DailyGlanceSettingTab.display()`. Call `plugin.saveSettings()` after every change so open views update live.

## License

[MIT](LICENSE) © raccoon-overlord-dev
