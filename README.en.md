# deepseek-harness-zh_pro

**A comprehensive enhancement plugin for DeepSeek Harness**

**语言 / Language:** [中文](README.md) · [English](README.en.md)

<p align="center">
  <img alt="Version 0.8.0" src="https://img.shields.io/badge/%E7%89%88%E6%9C%AC-0.8.0-5965d8">
  <img alt="Interface Chinese" src="https://img.shields.io/badge/%E7%95%8C%E9%9D%A2-%E4%B8%AD%E6%96%87-4aa3ff">
  <img alt="MIT License" src="https://img.shields.io/badge/license-MIT-3b7a57">
</p>

A comprehensive enhancement plugin with UI polish, layout tweaks, prompt injection, and
more. "Chinese completion" applies only to the Chinese interface, making it more complete
and readable; the other UI and session enhancements work in both Chinese and English.
Prompt injection, agent-role localization, and tool-description localization are separate
explicit toggles, all off by default.

## Features

| Feature | Default | Description |
| --- | --- | --- |
| Chinese completion | On | Chinese UI only: fixes leftover English and normalizes tokens, API keys, model IDs, durations, and count formats |
| Agent-role prompt localization | Off | Uses Chinese system prompts and built-in system sections (identity, checkout path, Web GUI note) for the four built-in agent roles on new sessions only; existing sessions are not reinjected |
| Tool-description localization | Off | Uses Chinese for confirmed built-in DSH tool descriptions and their first-party guidance sections in the system prompt (including the Cordis plugin-development guide of the cordis preset and the plan-mode policy) in new-session model requests; tool and parameter names remain unchanged |
| Full stats line | On | Keeps the chat stats line on one fully visible row, auto-shrinks the font, and scrolls horizontally when extremely long |
| Auto-expand latest thinking | On | Expands the newest thinking output as it streams in and collapses the previous auto-expanded one when a new one appears |
| Default expanded lines | 20 lines | Limits an expanded thinking block to N visible lines; 0 disables the limit |
| Expand mode | Button mode | Button mode reveals more lines in batches; scroll mode keeps an independent scrolling viewport, with the configured earliest/latest direction controlling its initial position |
| Prompt injection | Off | Injects an editable prompt into subsequent model requests, targeting either the initial system prompt or the first user prompt |
| Auto-archive old sessions | 7 days | When the New Session screen opens, auto-archives sessions inactive beyond the configured days (hidden from the list only, log kept; 0 disables it) |
| Archived sessions view | On | Adds an "Archive" button to every workspace row: clicking it hides that group's normal sessions and shows archived sessions directly in the official list flow (sorted by most recent activity, 5 by default, +5 per expand); the row overflow menu has rename / fork / unarchive / delete; clicking a row restores and opens the session |
| Service monitor | Off | Shows locally started services between the session list and Settings in the sidebar: a green dot plus the address (e.g. 127.0.0.1:81) and its uptime; hovering resolves the owning process on demand (first hover shows "resolving…", then swaps in name/PID, path and command line in place; later hovers are instant, and the cache clears when the service stops), click reveals the process folder in the file manager. Its collapsible card at the bottom of the settings page (official plugin-card style) adds custom watch entries (name + address text boxes, editable anytime after adding, always shown: green dot online / gray dot offline) and a refresh interval (default 10s, 2-300). Port scanning and probes work on all three platforms; process attribution and folder reveal are best-effort per platform (Linux needs `ss`/`xdg-open`), so it is off by default |
| Delete session (recycle bin) | On | Adds a "Delete session" item to a session row's overflow menu in both UI languages; moves the session log directory into the OS recycle bin (Windows Recycle Bin / macOS Trash / XDG Trash) and removes its workspace slot (no restore position) |
| Other features · Session delete button | On | A flat row in the final Other features settings section controls whether the overflow-menu delete item is shown |

Chinese completion only applies to the Chinese interface; the other interface enhancements
work in both Chinese and English. All features are configured under **DSH Settings →
Enhancements**. See the
[behavior contract](https://github.com/magian1127/deepseek-harness-zh_pro/blob/main/docs/behavior.md)
for the full defaults and boundaries.

## Requirements

- DeepSeek Harness Web GUI, default profile `web`
- Node.js `^22.19.0 || >=24.0.0`

## Installation

```sh
# Official persistent channel: takes effect on the next natural start
dsh plugin --profile web add deepseek-harness-zh_pro

# Hot install: takes effect immediately while DSH is running
npx -y deepseek-harness-zh_pro install --profile web
```

Local source debugging (run dependency installation first; `prepare` generates runtime artifacts):

```powershell
pnpm install
node bin/dsh-zh.mjs install --profile web --link $PWD
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

Check the status after installing:

```sh
npx -y deepseek-harness-zh_pro status --profile web
```

## Updating

Re-run the install command to update dependencies and the persistent bundle. After
browser-side content updates, refresh the page; when developing with a local link, host
files hot-reload automatically while the DSH HMR service is available; otherwise diagnose and report the unavailable hot path rather than restarting DSH.

## Uninstalling

```sh
dsh plugin --profile web remove deepseek-harness-zh_pro
# or
npx -y deepseek-harness-zh_pro remove --profile web
```

Uninstalling cleans up temporary hot rows and running entries but does not delete DSH
session data. Existing values in localStorage and settings may remain and can be reused
after reinstalling.

## Settings and data

| Data | Storage |
| --- | --- |
| Chinese completion, stats, thinking expansion/mode/direction, default expanded lines, chat width, archived-session view, service monitor, session-delete button | Browser localStorage: `deepseek-harness-zh_pro:enhancements` |
| Prompt toggle, text, injection target, auto-archive days | DSH `settings.yaml`, namespace `dsh-zh` |
| Agent-role and tool-description localization | DSH `settings.yaml`, namespace `dsh-zh` |

The plugin registers no model tools and uploads no data. Except for explicitly enabled
prompt injection, agent-role localization, and tool-description localization, no feature
modifies model requests. Chinese completion only applies to the Chinese interface; the
other interface enhancements also apply to the English interface. Each model-request
feature is controlled solely by its own toggle.

## FAQ

**Does the prompt turn on automatically?** No, it is off by default. Editing the prompt
text does not mean injection is enabled.

## Development documentation

- [Behavior contract](https://github.com/magian1127/deepseek-harness-zh_pro/blob/main/docs/behavior.md)
- [Runtime architecture](https://github.com/magian1127/deepseek-harness-zh_pro/blob/main/docs/architecture.md)
- [Development guide](https://github.com/magian1127/deepseek-harness-zh_pro/blob/main/docs/development.md)
- [Troubleshooting](https://github.com/magian1127/deepseek-harness-zh_pro/blob/main/docs/troubleshooting.md)
- [Release process](https://github.com/magian1127/deepseek-harness-zh_pro/blob/main/docs/release.md)

## License

[MIT](LICENSE)
