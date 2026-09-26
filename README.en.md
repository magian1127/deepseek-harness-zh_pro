# deepseek-harness-zh_pro

**A comprehensive enhancement plugin for DeepSeek Harness**

**语言 / Language:** [中文](README.md) · [English](README.en.md)

<p align="center">
    <img alt="Version 0.9.4" src="https://img.shields.io/badge/%E7%89%88%E6%9C%AC-0.9.4-5965d8">
  <img alt="Interface Chinese" src="https://img.shields.io/badge/%E7%95%8C%E9%9D%A2-%E4%B8%AD%E6%96%87-4aa3ff">
  <img alt="MIT License" src="https://img.shields.io/badge/license-MIT-3b7a57">
</p>

A comprehensive enhancement plugin for Chinese UI completion, thinking display, session-list
controls, service monitoring, and optional model-request localization. Chinese completion applies
only to the Chinese interface; all other UI and session enhancements work in both interface
languages. Every feature that modifies model requests is an independent explicit toggle and is
off by default.

## Features

The rows below follow **DSH Settings → Enhancements** from top to bottom:

| Feature | Default | Description |
| --- | --- | --- |
| Chinese completion | On | Chinese UI only: fixes confirmed leftover English and normalizes tokens, API keys, model IDs, durations, and count formats |
| Agent-role prompt localization | Off | Localizes the four built-in roles and confirmed system sections; locked on a new session's first request and never retrofitted into old sessions |
| Tool-description localization | Off | Localizes confirmed built-in DSH tool descriptions and guidance; tool names, parameter names, and third-party tools remain unchanged; new sessions only |
| Injected-context localization | Off | Replaces DSH-injected official context (workspace instruction frames, skill catalog frames, runtime context including its header line, approval/mode switch notices, dynamic-plugin notices, scheduled reminders, compaction checkpoint preambles) with Chinese before it enters session history; GUI and model requests stay consistent, new sessions only; translating the snapshot header makes DSH inject one replacement snapshot per step (slight session-log growth) |
| Web search | On | Routes the conversational web_search tool to a multi-engine backend (keyless: DuckDuckGo best-effort, with Yandex and Bing as the workhorses — Yandex via its legacy /search/site/ endpoint, Bing preferring cn.bing.com over its structured RSS channel with www and the HTML endpoint as fallbacks — plus Wikipedia; if TAVILY_API_KEY is present in credentials, the Tavily API takes priority); when the Zhipu plugin is also installed, Zhipu is preferred and a Zhipu failure (including content filtering) automatically retries via the multi-engine backend; environments where the official web_search tool is invisible (the Web profile default) get a tool shell automatically, which yields to the Zhipu shell when that plugin is present; the "Web search" settings card lets you add or clear the Tavily API key directly (effective immediately, no restart) |
| Prompt injection | Off | Injects editable text into subsequent requests; the default text asks for Chinese reasoning and replies, and the default target is the initial system prompt |
| Auto-expand latest thinking | On | Expands the newest streaming thinking block and collapses the previous block that the plugin auto-expanded; after a turn closes under the DSH v0.1.2 compact view it stays hidden with the official process fold (see the behavior contract) |
| Default expanded lines | 20 lines, latest N | Limits the initial visible region to 0–200 lines; 0 disables the limit, and the direction can be changed to earliest N |
| Expand mode | Button mode | Button mode reveals lines in batches; scroll mode uses a fixed-height scrolling viewport |
| Auto-archive old sessions | 7 days | Archives inactive sessions when the New Session view opens; range 0–365, with 0 disabling it |
| Archived-session view | On | Adds a workspace archive view (its button sits after the select-all button) whose rows can be restored, renamed, forked, or deleted, and can be multi-selected for batch unarchive or batch deletion |
| Session delete button | On | Shows “Delete session” in row menus — on ordinary session rows and on archived rows of the official “Show archived” view alike; the log moves to the OS recycle bin and no list restore slot is retained; deleted sessions never appear in the archive view, nor in the official list under the “All conversations (show archived)” / “Only archived” views, nor in search results (most typically the one that drops into the “Ungrouped” bucket) |
| Session multi-select | On | Lets idle rows be selected for batch deletion or archiving; running, pending-interaction, and unread-completion rows are not selectable. Archived-session rows in the archive view are selectable too; the batch entries follow the selection's archive make-up — all unarchived gives “Archive selected”, all archived gives “Unarchive selected”, and a mixed selection gives only “Delete selected” (archiving and unarchiving each hold for just half of it). A select-all button on each workspace row checks every selectable session of that workspace at once (click again to clear) |
| Service monitor | Off | Dual form: keeps the original panel between the session list and Settings in the left sidebar, and adds a "Service monitor" tab in the right sidebar (entry on the guide page); shows local listening services started during the conversation; hover resolves the process on demand and click reveals its location; **the left panel shows at most 10 rows per screen** — scroll with the wheel (no scrollbar shown) or use the arrow below the list to page down, which flips to "back to top" at the end; the tab's "Baseline ports" section lets you bring a baseline port back into monitoring with a click; right-pane entries have three action buttons after the uptime — Exclude (move back to baseline, no confirmation), Always watch (add to custom watch entries in Settings, confirmation required), Kill process (try to terminate with normal privileges, confirmation required); the left panel has no buttons |
| Refresh interval | 10 seconds | Range 2–300 seconds; polling pauses while the page is hidden |
| Custom watch entries | Empty | Entries can be added or edited and remain visible as online/offline; maximum 100 |

Chat display, Session list, and Service monitor use the same collapsible plugin-card style. They
start collapsed and remember their open state independently. See the
[behavior contract](https://github.com/magian1127/deepseek-harness-zh_pro/blob/main/docs/behavior.md)
for full interaction, data, and safety boundaries.

## Requirements

- DeepSeek Harness ≥ `0.1.7-alpha.2`; full UI uses `web`
- Node.js `^22.19.0 || >=24.0.0`

## Installation

```sh
# Web GUI
dsh plugin --profile web add deepseek-harness-zh_pro

# Headless mode
dsh plugin --profile headless add deepseek-harness-zh_pro

# Hot-install only into a running Web GUI
npx -y deepseek-harness-zh_pro install --profile web
```

Bundles are profile-scoped. The headless profile runs only the Host half, with no browser enhancements.

**DSH Desktop (the Electron app)**: supported — same Web application and plugin machinery (desktop Host port 19387). The desktop profile (`~/.dsh/profiles/desktop`) is owned exclusively by the app; the `dsh plugin` CLI rejects it by name, and so does this plugin's `dsh-zh` CLI (`--profile desktop`). For a link dev install (while the desktop app is **not running**), edit `~/.dsh/profiles/desktop/package.json`:

```jsonc
"dependencies": { "deepseek-harness-zh_pro": "link:<absolute path to this repo>" },
"dsh": { "profile": { "bundles": [ /* keep official bundles, append */ "deepseek-harness-zh_pro" ] } }
```

then run `pnpm install` inside the profile directory to materialize the link. Start the desktop app to mount; after source changes run `npm run build` and restart the app; to uninstall, remove both entries and run `pnpm install` again.

Local source development:

```powershell
pnpm install
node bin/dsh-zh.mjs install --profile web --link $PWD
dsh plugin --profile headless add "link:<project-path>"
```

TypeScript source build and checks:

```powershell
pnpm install
npm run typecheck
npm test
npm pack --dry-run --json
```

`src/` contains the only hand-written source; `lib/`, `bin/`, `scripts/`, and the root
verification scripts are Git-ignored build artifacts. `prepare`, `npm run build`, or `prepack`
generates them as needed, including the classic client script before publishing.

Check each profile independently:

```sh
npx -y deepseek-harness-zh_pro status --profile web
dsh plugin --profile headless list
```

## Updating

Re-run the install command to update dependencies and the persistent bundle. After
browser-side content updates, refresh the page. When developing with a local link, this
package evicts its own ESM module-cache entries when its Fiber is released:

- **Upgrading to this version from an older build requires one `dsh web` restart** —
  the cleanup code itself must first enter the long-running process;
- afterwards, rebuilding and cycling the row (plugin-list disable → enable, or a
  `dsh plugin` remove/add round trip) loads the new build without a restart;
- if the running instance comes from an older build without the cleanup code, a
  disable → enable cycle will not load the new build; restart once instead.

Do not substitute repeated trial-and-error for diagnosis.

## Uninstalling

```sh
dsh plugin --profile web remove deepseek-harness-zh_pro
dsh plugin --profile headless remove deepseek-harness-zh_pro
# A running Web GUI can also use:
npx -y deepseek-harness-zh_pro remove --profile web
```

Removal is profile-scoped; short-lived profiles stop loading it on their next invocation, without deleting sessions.

## Settings and data

| Data | Storage |
| --- | --- |
| Chinese completion, thinking display, stats, archived-session view, session deletion, session multi-select, service monitor, and the three cards' open state | Browser localStorage: `deepseek-harness-zh_pro:enhancements` |
| Agent-role localization, tool-description localization, injected-context localization, web search, prompt toggle/text/target, and auto-archive days | DSH `settings.yaml`, namespace `dsh-zh` |
| Optional Tavily API key (when present, search prefers Tavily) | DSH credentials: key `TAVILY_API_KEY` under the `refs:` section of `${DSH_HOME:-~/.dsh}/.credentials.yaml`, or an environment variable of the same name (read on every call, never cached); you can also add or clear it right in the "Web search" settings card (same location; the UI only ever sees a masked hint) |

The plugin uploads no data; its only model-tool registration is the `web_search` tool shell
of web search (installed and removed with the toggle, see the feature table). Except for web
search and explicitly enabled prompt injection, agent-role localization, tool-description
localization, and injected-context localization, no feature modifies model requests;
injected-context localization replaces DSH-injected official English text before it enters
session history (closing the toggle restores English for new injections, while already-written
history stays as official behavior). When web search is on, search queries are sent to the
selected backend: to Zhipu when that plugin is installed and available (handled by that
plugin), to the Tavily API when TAVILY_API_KEY is present in credentials (the key travels
only in the Authorization header), otherwise to the public DuckDuckGo/Yandex/Bing/Wikipedia
endpoints; this plugin stores no queries or results, and never writes the key into config,
logs, or diagnostics snapshots.
Chinese completion only applies to the Chinese interface; the
other interface enhancements also apply to the English interface. Each model-request
feature is controlled solely by its own toggle.

Headless mode has no browser settings page but shares `${DSH_HOME:-~/.dsh}/settings.yaml`. Configure the four Host toggles in Web; `headless` reads the same namespace.

## FAQ

**Does the prompt turn on automatically?** No, it is off by default. Editing the prompt
text does not mean injection is enabled.

**How do I route search through Tavily?** Just type the key into the "Web search" settings card
and save — it takes effect immediately, no restart needed. Note that **the first install or
update of this plugin needs one `dsh web` restart**: the credentials endpoint is new on the host
side, and without that restart the card reports "Host endpoint not ready" (the key itself is
fine). You can also add a line
`TAVILY_API_KEY: "tvly-…"` under the `refs:` section of `${DSH_HOME:-~/.dsh}/.credentials.yaml`
(or set an environment variable of the same name). Once found, search prefers the Tavily API
(`search_depth: basic`; 1 of the 1000 free monthly credits per search) and, when the quota runs
out, backs off for an hour and degrades to the keyless engines instead of failing. An environment
variable takes precedence over the credentials file, in which case the card's "Clear" is disabled.
To conserve credits and use Tavily only when every keyless engine fails, see the Tavily note in
[`docs/behavior.md`](docs/behavior.md).

**Why does search report `DuckDuckGo 触发反爬限流 (HTTP 202)`?** That is normal for DDG from
this IP; the plugin degrades to Yandex/Bing/Wikipedia and aggregates every engine's outcome
into the error message. See [`docs/troubleshooting.md`](docs/troubleshooting.md).

## Development documentation

- [Behavior contract](https://github.com/magian1127/deepseek-harness-zh_pro/blob/main/docs/behavior.md)
- [Runtime architecture](https://github.com/magian1127/deepseek-harness-zh_pro/blob/main/docs/architecture.md)
- [Development guide](https://github.com/magian1127/deepseek-harness-zh_pro/blob/main/docs/development.md)
- [Troubleshooting](https://github.com/magian1127/deepseek-harness-zh_pro/blob/main/docs/troubleshooting.md)
- [Release process](https://github.com/magian1127/deepseek-harness-zh_pro/blob/main/docs/release.md)

## License

[MIT](LICENSE)
