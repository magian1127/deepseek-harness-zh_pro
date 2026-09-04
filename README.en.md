# deepseek-harness-zh_pro

**A comprehensive enhancement plugin for DeepSeek Harness**

**语言 / Language:** [中文](README.md) · [English](README.en.md)

<p align="center">
  <img alt="Version 0.9.2" src="https://img.shields.io/badge/%E7%89%88%E6%9C%AC-0.9.2-5965d8">
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
| Flat row | Agent-role prompt localization | Off | Localizes the four built-in roles, the Open Design runtime persona, and confirmed system sections; locked on a new session's first request and never retrofitted into old sessions |
| Flat row | Tool-description localization | Off | Localizes confirmed built-in DSH tool descriptions and guidance; tool names, parameter names, and third-party tools remain unchanged; new sessions only |
| Flat row | Injected-context localization | Off | Replaces DSH-injected official context (workspace instruction frames, skill catalog frames, runtime context including its header line, approval/mode switch notices, dynamic-plugin notices, scheduled reminders, compaction checkpoint preambles) with Chinese before it enters session history; GUI and model requests stay consistent, new sessions only; translating the snapshot header makes DSH inject one replacement snapshot per step (slight session-log growth) |
| Flat row | Prompt injection | Off | Injects editable text into subsequent requests; the default text asks for Chinese reasoning and replies, and the default target is the initial system prompt |
| Chat display | Auto-expand latest thinking | On | Expands the newest streaming thinking block and collapses the previous block that the plugin auto-expanded; after a turn closes under the DSH v0.1.2 compact view it stays hidden with the official process fold (see the behavior contract) |
| Chat display | Default expanded lines | 20 lines, latest N | Limits the initial visible region to 0–200 lines; 0 disables the limit, and the direction can be changed to earliest N |
| Chat display | Expand mode | Button mode | Button mode reveals lines in batches; scroll mode uses a fixed-height scrolling viewport |
| Chat display | Full stats line | On | Keeps the chat stats on one line, shrinking or scrolling horizontally when needed |
| Session list | Auto-archive old sessions | 7 days | Archives inactive sessions when the New Session view opens; range 0–365, with 0 disabling it |
| Session list | Archived-session view | On | Adds a workspace archive view (its button sits after the select-all button) whose rows can be restored, renamed, forked, or deleted, and can be multi-selected for batch unarchive or batch deletion |
| Session list | Session delete button | On | Shows “Delete session” in row menus; the log moves to the OS recycle bin and no list restore slot is retained; deleted sessions never appear in the archive view |
| Session list | Session multi-select | On | Lets idle rows be selected for batch deletion or archiving; running, pending-interaction, and unread-completion rows are not selectable. Archived-session rows in the archive view are selectable too, with batch unarchive and batch deletion; a select-all button on each workspace row checks every selectable session of that workspace at once (click again to clear) |
| Service monitor | Service monitor | Off | Shows local listening services started during the conversation; hover resolves the process on demand and click reveals its location |
| Service monitor | Refresh interval | 10 seconds | Range 2–300 seconds; polling pauses while the page is hidden |
| Service monitor | Custom watch entries | Empty | Entries can be added or edited and remain visible as online/offline; maximum 100 |

Chat display, Session list, and Service monitor use the same collapsible plugin-card style. They
start collapsed and remember their open state independently. See the
[behavior contract](https://github.com/magian1127/deepseek-harness-zh_pro/blob/main/docs/behavior.md)
for full interaction, data, and safety boundaries.

## Requirements

- DeepSeek Harness ≥ `0.1.2-rc.1`; full UI uses `web`, Open Design stdio uses `open-design`, and DSH one-shot tasks may use `headless`
- Node.js `^22.19.0 || >=24.0.0`

## Installation

```sh
# Web GUI
dsh plugin --profile web add deepseek-harness-zh_pro

# Open Design's actual stdio profile
dsh plugin --profile open-design add deepseek-harness-zh_pro

# Optional: DSH's built-in headless profile
dsh plugin --profile headless add deepseek-harness-zh_pro

# Hot-install only into a running Web GUI
npx -y deepseek-harness-zh_pro install --profile web
```

Bundles are profile-scoped; Open Design actually runs `dsh --profile open-design --stdio`. Non-Web profiles run only the Host half, so browser enhancements cannot enter the Open Design UI. Because `open-design` reserves stdout for strict JSONL, informational logs go to stderr there.

Local source development:

```powershell
pnpm install
node bin/dsh-zh.mjs install --profile web --link $PWD
dsh plugin --profile open-design add "link:<project-path>"
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
dsh plugin --profile open-design list
dsh --profile open-design --dump-default-config
dsh plugin --profile headless list
```

## Updating

Re-run the install command to update dependencies and the persistent bundle. After
browser-side content updates, refresh the page; when developing with a local link, host
files hot-reload automatically while the DSH HMR service is available; otherwise diagnose and report the unavailable hot path rather than restarting DSH.

## Uninstalling

```sh
dsh plugin --profile web remove deepseek-harness-zh_pro
dsh plugin --profile open-design remove deepseek-harness-zh_pro
dsh plugin --profile headless remove deepseek-harness-zh_pro
# A running Web GUI can also use:
npx -y deepseek-harness-zh_pro remove --profile web
```

Removal is profile-scoped; short-lived profiles stop loading it on their next invocation, without deleting sessions.

## Settings and data

| Data | Storage |
| --- | --- |
| Chinese completion, thinking display, stats, archived-session view, session deletion, session multi-select, service monitor, and the three cards' open state | Browser localStorage: `deepseek-harness-zh_pro:enhancements` |
| Agent-role localization, tool-description localization, injected-context localization, prompt toggle/text/target, and auto-archive days | DSH `settings.yaml`, namespace `dsh-zh` |

The plugin registers no model tools and uploads no data. Except for explicitly enabled
prompt injection, agent-role localization, tool-description localization, and
injected-context localization, no feature modifies model requests; injected-context
localization replaces DSH-injected official English text before it enters session history
(closing the toggle restores English for new injections, while already-written history stays
as official behavior). Chinese completion only applies to the Chinese interface; the
other interface enhancements also apply to the English interface. Each model-request
feature is controlled solely by its own toggle.

Open Design and stock headless have no browser settings page but share `${DSH_HOME:-~/.dsh}/settings.yaml`. Configure the four Host toggles in Web; `open-design` / `headless` read the same namespace. The OpenDesign Charter is application-provided user content and is not translated.

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
