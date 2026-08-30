# deepseek-harness-zh_pro

**A comprehensive enhancement plugin for DeepSeek Harness**

**语言 / Language:** [中文](README.md) · [English](README.en.md)

<p align="center">
  <img alt="Version 0.9.0" src="https://img.shields.io/badge/%E7%89%88%E6%9C%AC-0.9.0-5965d8">
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

| Settings location | Feature | Default | Description |
| --- | --- | --- | --- |
| Flat row | Chinese completion | On | Chinese UI only: fixes confirmed leftover English and normalizes tokens, API keys, model IDs, durations, and count formats |
| Flat row | Agent-role prompt localization | Off | Uses Chinese for the four built-in agent roles and confirmed first-party system sections; locked on the first request of a new session and never reinjected into existing sessions |
| Flat row | Tool-description localization | Off | Localizes confirmed built-in DSH tool descriptions and guidance; tool names, parameter names, and third-party tools remain unchanged; new sessions only |
| Flat row | Prompt injection | Off | Injects editable text into subsequent requests; the default text asks for Chinese reasoning and replies, and the default target is the initial system prompt |
| Chat display | Auto-expand latest thinking | On | Expands the newest streaming thinking block and collapses the previous block that the plugin auto-expanded |
| Chat display | Default expanded lines | 20 lines, latest N | Limits the initial visible region to 0–200 lines; 0 disables the limit, and the direction can be changed to earliest N |
| Chat display | Expand mode | Button mode | Button mode reveals lines in batches; scroll mode uses a fixed-height scrolling viewport |
| Chat display | Full stats line | On | Keeps the chat stats on one line, shrinking or scrolling horizontally when needed |
| Session list | Auto-archive old sessions | 7 days | Archives inactive sessions when the New Session view opens; range 0–365, with 0 disabling it |
| Session list | Archived-session view | On | Adds a workspace archive view whose rows can be restored, renamed, forked, or deleted |
| Session list | Session delete button | On | Shows “Delete session” in row menus; the log moves to the OS recycle bin and no list restore slot is retained |
| Session list | Session multi-select | On | Lets idle rows be selected for batch deletion or archiving; running, pending-interaction, and unread-completion rows are not selectable |
| Service monitor | Service monitor | Off | Shows local listening services started during the conversation; hover resolves the process on demand and click reveals its location |
| Service monitor | Refresh interval | 10 seconds | Range 2–300 seconds; polling pauses while the page is hidden |
| Service monitor | Custom watch entries | Empty | Entries can be added or edited and remain visible as online/offline; maximum 100 |

Chat display, Session list, and Service monitor use the same collapsible plugin-card style. They
start collapsed and remember their open state independently. See the
[behavior contract](https://github.com/magian1127/deepseek-harness-zh_pro/blob/main/docs/behavior.md)
for full interaction, data, and safety boundaries.

## Requirements

- DeepSeek Harness Web GUI ≥ 0.1.2-alpha.1, default profile `web`
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
| Chinese completion, thinking display, stats, archived-session view, session deletion, session multi-select, service monitor, and the three cards' open state | Browser localStorage: `deepseek-harness-zh_pro:enhancements` |
| Agent-role localization, tool-description localization, prompt toggle/text/target, and auto-archive days | DSH `settings.yaml`, namespace `dsh-zh` |

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
