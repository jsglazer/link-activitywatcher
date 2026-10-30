# link-activitywatcher

[![GitHub release](https://img.shields.io/github/v/release/jsglazer/link-activitywatcher?logo=github)](https://github.com/jsglazer/link-activitywatcher/releases)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/jsglazer/link-activitywatcher/blob/main/LICENSE)
[![Made with Claude](https://img.shields.io/badge/Made_with-Claude-D97756?logo=anthropic)](https://claude.ai)
[![CI](https://github.com/jsglazer/link-activitywatcher/actions/workflows/ci.yml/badge.svg)](https://github.com/jsglazer/link-activitywatcher/actions/workflows/ci.yml)

An Obsidian plugin that acts as an [ActivityWatch](https://activitywatch.net/) watcher. It reports which vault and which note you are working in to your local aw-server, so ActivityWatch's **Editor** view and timeline show time per note, per vault, and per file type.

Desktop only. A from-scratch rewrite of [aw-watcher-obsidian](https://github.com/grimmtheshrimp/aw-watcher-obsidian) with the same data format, plus focus/idle awareness, automatic reconnection, exclusions, and file events that do not split your activity timeline.

## What gets sent

Heartbeats for the open note go to the bucket `aw-watcher-obsidian_<hostname>` (type `app.editor.activity`, the same type and keys aw-watcher-vscode uses):

| Key | Value |
| --- | --- |
| `file` | Vault-relative path with a leading `/`, e.g. `/Projects/Plan.md` |
| `project` | Vault name |
| `language` | File type: Markdown, Canvas, Bases, PDF, Image, Audio, Video, or the upper-cased extension |
| `projectPath` | Absolute vault folder (can be turned off) |
| `editor` / `editorVersion` | `Obsidian` and the Obsidian API version |

A heartbeat is sent when you open a note and then every *N* seconds (default 10) while you are active. aw-server merges consecutive heartbeats for the same note into one event.

With **Record file events** on, note create / rename / delete events are written to a separate bucket, `aw-watcher-obsidian-fileevents_<hostname>` (type `app.editor.fileevent`, keys as above plus `eventType` and `oldFile` for renames). They live in their own bucket so they never interrupt the activity timeline.

Everything goes to the server URL you configure (default `http://127.0.0.1:5600`). The plugin never contacts anything else.

## When it reports

Heartbeats are sent only when all of these hold:

- tracking is not paused;
- an Obsidian window has OS focus (unless **Only while Obsidian is focused** is off);
- you have used the keyboard or mouse in Obsidian within the idle timeout (default 5 minutes; 0 disables it);
- the open file does not match an exclusion pattern.

If aw-server is not running when Obsidian starts, or stops later, the plugin keeps working and retries in the background (5 s, 10 s, 20 s … up to every 5 minutes). File events that happen while it is offline are kept (up to 200) and sent when it comes back. If you delete the bucket in the ActivityWatch web UI, it is recreated automatically.

## Status bar

| Shows | Meaning | Click |
| --- | --- | --- |
| `AW: tracking` | Reporting the open note | Pause |
| `AW: idle` / `AW: unfocused` | Connected, but not reporting right now | Pause |
| `AW: excluded` | The open note matches an exclusion pattern | Pause |
| `AW: paused` | Tracking switched off | Resume |
| `AW: offline` | aw-server not reachable (hover for the error) | Retry now |

## Settings

| Setting | Default | Notes |
| --- | --- | --- |
| Server URL | `http://127.0.0.1:5600` | Use port 5666 for the ActivityWatch testing server. **Test connection** shows the server version and hostname. |
| Pause tracking | off | Persists across restarts. |
| Heartbeat interval | 10 s | 2–60 s. |
| Only while Obsidian is focused | on | |
| Idle timeout | 5 min | 0 = report while a note is open, even with no input. |
| Record file events | on | Create / rename / delete, in a separate bucket. |
| Excluded paths | none | One glob per line (see below). |
| Send vault folder path | on | Turns `projectPath` on or off. |

### Exclusion patterns

Matched case-insensitively against the vault-relative path:

- `Private/` excludes a folder and everything under it.
- `*.excalidraw.md` (no `/`) matches that file name in any folder.
- `Journal/**/draft-*` uses `**` to span any number of folders; `*` and `?` stay within one folder.
- Lines starting with `#` are comments.

## Commands

| Command | What it does |
| --- | --- |
| **Reconnect to ActivityWatch** | Retry the connection now. |
| **Pause / resume tracking** | Same as the status bar toggle. |

## Seeing the data in ActivityWatch

Open the ActivityWatch web UI (http://localhost:5600) → **Activity** → your host. The **Editor** section lists files, projects (vaults), and languages from `app.editor.activity` buckets. Raw events are under **Raw Data** → `aw-watcher-obsidian_<hostname>`.

The bucket name matches the original aw-watcher-obsidian plugin, so history recorded by it continues in the same bucket. Do not run both plugins at once.

## Development

```
npm install
npm test        # headless Vitest suite for src/core
AW_LIVE_URL=http://127.0.0.1:5600 npm test   # also runs a test against a live aw-server (throwaway bucket, deleted afterwards)
npm run build   # type-check + bundle to main.js
```
