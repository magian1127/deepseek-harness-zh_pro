# deepseek-harness-zh_pro

**A comprehensive enhancement plugin for DeepSeek Harness**

**语言 / Language:** [中文](README.md) · [English](README.en.md)

<p align="center">
    <img alt="Version 0.11.1" src="https://img.shields.io/badge/%E7%89%88%E6%9C%AC-0.11.1-5965d8">
  <img alt="Interface Chinese" src="https://img.shields.io/badge/%E7%95%8C%E9%9D%A2-%E4%B8%AD%E6%96%87-4aa3ff">
  <img alt="MIT License" src="https://img.shields.io/badge/license-MIT-3b7a57">
</p>

A comprehensive enhancement plugin for Chinese UI completion, thinking display, session-list
controls, service monitoring, and optional model-request localization. Chinese completion applies
only to the Chinese interface; all other UI and session enhancements work in both interface
languages. Every feature that modifies model requests is an independent explicit toggle and is
off by default.

## Features

The tables below follow the real top-to-bottom order of **DSH Settings → Enhancements**, and keep the
in-page order inside each group. A sticky action bar holds every change as a draft: press **Save** to
apply and persist everything at once (host fields go out as one atomic commit, which removes most of
the per-keystroke stutter), or **Revert** to drop the drafts.

**Chinese completion and model-request localization**

| Feature | Default | Description |
| --- | --- | --- |
| Chinese completion | On | Chinese UI only: fixes confirmed leftover English and normalizes terminology, count, and duration formats |
| Agent-role prompt localization | Off | Swaps the built-in roles' system prompts for Chinese; locked on a new session's first request, never retrofitted |
| Tool-description localization | Off | Localizes official tool descriptions; tool names, parameters, and third-party tools stay unchanged; new sessions only |
| Injected-context localization | Off | Turns DSH-injected official context into Chinese, consistent in the GUI and the model request; new sessions only. Covers the runtime-context snapshot (header and body), time readings, workspace-instruction frames, the skill catalog frame, and approval/plan-mode notices |
| Prompt injection | Off | Injects the "Injected text" into subsequent requests. The default text is "始终用中文进行推理，并用中文输出你的思考过程。" — always reason in Chinese and write the thinking process in Chinese. |

**Chat display** (collapsible group)

| Feature | Default | Description |
| --- | --- | --- |
| Auto-expand latest thinking | On | Expands the newest streaming thinking block and collapses the one the plugin expanded before |
| Default expanded lines | 20 lines, latest N | Shows only N lines before folding, to keep long thinking smooth; range 0–200, 0 for no limit, direction can start from the earliest lines |
| Expand mode | Button mode | Button mode reveals lines in batches; scroll mode uses a fixed-height scrolling viewport |

**Session list** (collapsible group)

| Feature | Default | Description |
| --- | --- | --- |
| Auto-archive old sessions | 7 days | Archives sessions idle longer than N days when the New Session view opens (hidden only, logs kept); range 0–365, 0 disables it |
| Archived-session view | On | Adds an archive entry on each workspace row: archived sessions show inside the official list's own group, and the row menu can rename, fork, unarchive, or delete |
| Session delete button | On | Adds "Delete session" to session menus for both live and archived rows; the log goes to the OS recycle bin with no list restore slot |
| Session multi-select | On | Idle rows can be selected for batch delete or archive; running, pending-interaction, and unread-completion rows are not selectable. Batch entries follow the selection, and each workspace row also offers select-all |

**Web search** (collapsible group; search rows first, reader rows after)

| Feature | Default | Description |
| --- | --- | --- |
| Smart search button | On | Shows "Smart search" under the composer; turning it off hides the button and keeps its code from loading. When on, it remembers its state per session, and an off session stops receiving web tools and guidance |
| Enable multi-engine search | On | Takes over the `web_search` backend using the priority list below; off keeps the backend the deployment configured |
| Results per query | 0 (no takeover) | 0 keeps the official behavior (8 sources, round-robin merge); N groups results per query and drops cross-query duplicates. The effective count is also capped by the official "Results per search" |
| Search backend priority | DeepSeek Search API → Zhipu → keyless multi-engine | Reorder with ▲/▼. Backends are tried in order: not installed, unavailable, or failed falls through, only a total failure reports an error, and a user cancellation never retries. Keyless multi-engine covers DuckDuckGo, Yandex, Bing, and Wikipedia, with Tavily first when `TAVILY_API_KEY` is set |
| Tavily API key | Empty | Enter or clear the key here; saved and effective immediately, no restart |

Reader rows (same card, right after the search rows):

| Feature | Default | Description |
| --- | --- | --- |
| Enable keyless web reader | On | Takes over the `web_fetch` backend using the priority list below; off keeps the backend the deployment configured |
| Fetch backend priority | DeepSeek cloud reader → Zhipu webReader → keyless ring → local fetch | Reorder with ▲/▼, same fall-through rules as search. The keyless ring tries Exa → Parallel → Keenable public endpoints; fetching sends the URL to the selected vendor's cloud service and wraps the body in an "external web content (untrusted)" marker. Safety gate: public http(s) only, credentials in the URL and local/private addresses are refused |

**Plugin sync** (collapsible group)

| Feature | Default | Description |
| --- | --- | --- |
| Plugin sync | Direction follows the current environment | Copies installed plugins from the other profile: desktop → web when running the web app, web → desktop in the desktop app. Only the highest version of a package is kept, never downgraded, additive only; runs through the official plugin manager with peer checks and rollback |

**Service monitor** (own card, off by default)

| Feature | Default | Description |
| --- | --- | --- |
| Service monitor | Off | Shows local listening services started during the conversation; hover resolves the process and click reveals its location; the left panel shows at most 10 rows per screen and pages when there are more |
| Workspace panel | On | Keeps the monitor panel between the session list and Settings |
| Sidebar monitor tab | On | Adds a "Service monitor" tab in the right sidebar (entry on the guide page), with per-entry actions to exclude, always watch, or kill the process |
| Refresh interval | 10 seconds | Range 2–300 seconds; polling pauses while the page is hidden |
| Custom watch entries | Empty | Add, rename, or edit entries that stay visible as online/offline and resolve their process on hover; maximum 100 |

Chat display, Session list, Web search, and Plugin sync are collapsible groups that start collapsed and
remember their open state independently; the Service monitor card folds too. See the
[behavior contract](https://github.com/magian1127/deepseek-harness-zh_pro/blob/main/docs/behavior.md)
for full interaction, data, and safety boundaries (Chinese).

## Requirements

- DeepSeek Harness `>=0.2.0-rc.2 <0.3.0` (declared as `engines.dsh`, covering the whole
  0.2.x family; 0.1.x and earlier are rejected by DSH's plugin compatibility check);
  full UI uses `web`
- Node.js `^22.19.0 || >=24.0.0`

> DSH 0.2.1 removed the built-in `{{cwd}}` prompt variable (the working directory is now
> supplied by the working-directory service). It **rejects the request** on any `{{…}}`
> reference it cannot resolve, and this plugin is adapted: if a custom deployment keeps
> `Your working directory is {{cwd}}.` in `personaSuffix` / a preset's `suffix`, the plugin
> clears that sentence instead of writing it back into the request; and if the prompt-injection
> text box contains an unresolvable placeholder such as `{{cwd}}`, that section is kept
> verbatim (not interpolated) instead of failing the request. See the
> [behavior contract](docs/behavior.md) (Chinese).

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

**Syncing plugins between desktop and Web**: you do not need to reinstall plugins one by one in
both profiles — open **Settings → Enhancements → Plugin sync** on the side you want to fill in,
click "Check differences" to see the list, then "Sync now". The direction follows the current
environment automatically: running in the web app it is desktop → web, running in the desktop app
it is web → desktop. For the same package only the higher version is kept — if this profile is
already at or above the reference it is left alone (never downgraded), and nothing is removed. The
feature reuses the official DSH plugin manager, so it is equivalent to installing from the desktop
app sidebar "Plugins" page, and it inherits the same peer checks and rollback.

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

Re-run the install command to update dependencies and the persistent bundle. Browser-side
content (UI, settings page, cards) is hot-swapped by client-hmr, which polls every 500 ms —
no page refresh needed after a build.

The host half (`lib/*.js`) takes effect **as soon as the build finishes** when developing
with a local link:

- The package watches its own build artifacts and performs a full swap on change: it
  clears its module-cache entries in both the ESM and CJS layers, re-imports the entry,
  then rebuilds the Fiber that owns the existing row. No restart, and no
  disable → enable round trip in the plugin list.
- **Upgrading to the first version that has this capability requires one `dsh web`
  restart**: the swap code itself still lives in the old module. Builds after that
  restart get restart-free swapping.
- Installed (npm, non-link) setups work the same way, though they rarely need it —
  upgrading goes through the install command.

One distinction worth keeping: disable → enable in the plugin list does **not** load a new
build. It only rebuilds the Fiber and reuses the in-process module namespace; it never
re-imports. Do not use it as an update mechanism.

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
| Agent-role localization, tool-description localization, injected-context localization, web search, search backend priority, results per query, keyless web reader, fetch backend priority, prompt toggle/text/target, and auto-archive days | DSH `settings.yaml`, namespace `dsh-zh` |
| Optional Tavily API key (when present, search prefers Tavily) | DSH credentials: key `TAVILY_API_KEY` under the `refs:` section of `${DSH_HOME:-~/.dsh}/.credentials.yaml`, or an environment variable of the same name (read on every call, never cached); you can also add or clear it right in the "Web search" settings card (same location; the UI only ever sees a masked hint) |

The plugin uploads no data; its only model-tool registration is the `web_search` tool shell
of web search (installed and removed with the toggle, see the feature table). Except for web
search and explicitly enabled prompt injection, agent-role localization, tool-description
localization, and injected-context localization, no feature modifies model requests;
injected-context localization replaces DSH-injected official English text before it enters
session history (closing the toggle restores English for new injections, while already-written
history stays as official behavior). When web search is on, search queries are sent to the
backends in the priority list, tried top to bottom: a backend that is not installed or
unavailable is skipped outright, and a failing backend records a fallback diagnostic and
falls through to the next one, so one query reaches at most the first few entries. Taking
over the selection also writes `searchProvider: dsh-zh-web` onto the `web` row through the
official settings channel (persisted in the profile patch), and restores the previous value
when the toggle turns off or the plugin unloads. Zhipu is hit when that plugin is installed
and available (handled by that plugin), the Tavily API when TAVILY_API_KEY is present in
credentials (the key travels only in the Authorization header), otherwise the public
DuckDuckGo/Yandex/Bing/Wikipedia endpoints; this plugin stores no queries or results, and
never writes the key into config, logs, or diagnostics snapshots.
The keyless web reader analogously takes over the `web` row's `fetchProvider` (writes
`dsh-zh-web-fetch`, restores on off/unload). In the default order, DeepSeek cloud reader and
Zhipu webReader are skipped when not installed or lacking a key; the keyless ring walks
Exa → Parallel → Keenable (30s per endpoint, a rate-limited endpoint is skipped for 60s);
the fetch request's URL is sent to the selected backend (keyless endpoints are public cloud
services), the body is wrapped in an "external web content (untrusted)" boundary marker, and
this plugin stores neither URLs nor bodies.
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
