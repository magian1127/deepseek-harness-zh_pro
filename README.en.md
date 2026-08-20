# deepseek-harness-zh_pro

**A comprehensive enhancement plugin for DeepSeek Harness**

**语言 / Language:** [中文](README.md) · [English](README.en.md)

<p align="center">
  <img alt="Version 0.6.2" src="https://img.shields.io/badge/%E7%89%88%E6%9C%AC-0.6.2-5965d8">
  <img alt="Interface Chinese" src="https://img.shields.io/badge/%E7%95%8C%E9%9D%A2-%E4%B8%AD%E6%96%87-4aa3ff">
  <img alt="MIT License" src="https://img.shields.io/badge/license-MIT-3b7a57">
</p>

A comprehensive enhancement plugin with UI polish, layout tweaks, prompt injection, and
more. "Chinese completion" applies only to the Chinese interface, making it more complete
and readable; the full stats line, auto-expand thinking, default expanded lines, and chat
width work in both Chinese and English. Prompt injection is a separate explicit toggle,
off by default.

## Features

| Feature | Default | Description |
| --- | --- | --- |
| Chinese completion | On | Chinese UI only: fixes leftover English and normalizes tokens, API keys, model IDs, durations, and count formats |
| Full stats line | On | Keeps the chat stats line on one fully visible row, auto-shrinks the font, and scrolls horizontally when extremely long |
| Auto-expand latest thinking | On | Expands the newest thinking output as it streams in and collapses the previous auto-expanded one when a new one appears |
| Default expanded lines | 20 lines | Shows only the last N lines (latest content) of an expanded thinking block; the rest collapses into an "expand all" control to avoid lag on very long thinking; 0 disables the limit |
| Chat width | On, 90% | Adjusts the chat column width by 50%–100% on large screens, splitting the side margins evenly |
| Prompt injection | Off | Injects an editable prompt into subsequent model requests, targeting either the initial system prompt or the first user prompt |
| Auto-archive old sessions | 7 days | When the New Session screen opens, auto-archives sessions inactive beyond the configured days (hidden from the list only, log kept; 0 disables it) |
| Archived sessions view | On | Adds an "Archive" button to every workspace row: clicking it hides that group's normal sessions and shows archived sessions directly in the official list flow (sorted by most recent activity, 5 by default, +5 per expand); the row overflow menu has rename / fork / unarchive / delete; clicking a row restores and opens the session |
| Delete session (recycle bin) | On | Chinese UI only: adds a "Delete session" item to a session row's overflow menu; moves the session log directory into the OS recycle bin (Windows Recycle Bin / macOS Trash / XDG Trash) and removes its workspace slot (no restore position) |

Chinese completion only applies to the Chinese interface; the other interface enhancements
work in both Chinese and English. All features are configured under **DSH Settings →
Enhancements**. See the
[behavior contract](https://github.com/magian1127/deepseek-harness-zh_pro/blob/master/docs/behavior.md)
for the full defaults and boundaries.

## Requirements

- DeepSeek Harness Web GUI, default profile `web`
- Node.js `^22.19.0 || >=24.0.0`

## Installation

```sh
# Official channel: restart DSH once after installing
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
files hot-reload automatically while the DSH HMR service is available, otherwise restart
as the logs indicate.

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
| Chinese completion, stats, thinking expansion, default expanded lines, chat width, archived sessions view | Browser localStorage: `deepseek-harness-zh_pro:enhancements` |
| Prompt toggle, text, injection target | DSH `settings.yaml`, namespace `dsh-zh` |

The plugin registers no model tools and uploads no data. Except for explicitly enabled
prompt injection, no feature modifies model requests. Chinese completion only applies to
the Chinese interface; the other interface enhancements also apply to the English
interface. Prompt injection is still controlled solely by its own toggle.

## FAQ

**Does the prompt turn on automatically?** No, it is off by default. Editing the prompt
text does not mean injection is enabled.

## Development documentation

- [Behavior contract](https://github.com/magian1127/deepseek-harness-zh_pro/blob/master/docs/behavior.md)
- [Runtime architecture](https://github.com/magian1127/deepseek-harness-zh_pro/blob/master/docs/architecture.md)
- [Development guide](https://github.com/magian1127/deepseek-harness-zh_pro/blob/master/docs/development.md)
- [Troubleshooting](https://github.com/magian1127/deepseek-harness-zh_pro/blob/master/docs/troubleshooting.md)
- [Release process](https://github.com/magian1127/deepseek-harness-zh_pro/blob/master/docs/release.md)

## License

[MIT](LICENSE)
