<div align="center">

<img src="src-tauri/icons/128x128@2x.png" alt="Lumber" width="112" height="112" />

# Lumber

**A modern, blazing-fast desktop log viewer.**

Open GB-scale logs instantly, tail them live, and actually find what you're looking for.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Tauri 2](https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white)
![React 19](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![Rust](https://img.shields.io/badge/Rust-000000?logo=rust&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Platform](https://img.shields.io/badge/platform-macOS%20%C2%B7%20Windows%20%C2%B7%20Linux-lightgrey)

</div>

> Raw **logs** are just timber. Lumber planes them into something you can build with.

Lumber is a desktop log viewer built for the moments that matter: a production incident, a gigabyte-sized file, and a terminal that chokes the moment you `tail -f` it. It keeps the original file on disk and only an index in memory, so opening a huge log is instant and scrolling stays smooth — while a keyboard-first UI gets you from "what happened?" to the exact line fast.

## Screenshots

> _Screenshots coming soon._

## Features

- ⚡ **Built for huge files** — A streaming indexer keeps just a compact per-line index in memory; the original never leaves disk. Open GB-scale logs immediately, with the indexed head available before the scan even finishes.
- 📡 **Live tail (Follow)** — File-watcher–driven incremental indexing follows the tail in real time. Scroll up and Follow pauses with a "new lines" indicator; press `End` (or hit the bottom) to resume.
- 🔎 **Instant search** — Plain or regex, case-insensitive, with every match highlighted (lines are never hidden), a live match count, and jump-to-next/previous. An invalid regex just keeps your last good result.
- 🧪 **Non-destructive filters** — Include (AND across conditions, `A|B` for OR within one), exclude, level masks (ERROR-only, WARN and above), and JSON field conditions like `level:error service:api`.
- 🚨 **Error navigation** — Jump straight to the next or previous error / warning, independent of your search.
- ⌨️ **Command palette** — One `Ctrl+K` entry point for search, filter, highlight, go-to-line, go-to-time, navigation, and view actions. Any selected text is prefilled automatically.
- 🖍️ **Highlight rules** — Color-code patterns without filtering anything out, managed from the left rail.
- 🧾 **Row detail & JSON** — Right-click a row for a detail panel that pretty-prints JSON and lets you add a filter from any field value.
- 🪟 **Split panes & tab groups** — Split the same file into panes, or place different files side by side. Multi-file tabs with a recents menu.
- 🗺️ **Overview strip** — A histogram + minimap of error / warning / match density over time, with jump-to-timestamp.
- 🎨 **Polished, themeable UI** — Dark-first design with a light theme, custom window chrome, and Inter + JetBrains Mono bundled for fully offline use.
- 📐 **Format auto-detection** — Plain text (timestamp / level patterns) and JSON Lines, with lossy handling of broken UTF-8 so the viewer never dies on a bad byte.
- ↩️ **Word-wrap toggle**, ⚑ **bookmarks**, and a keyboard-centric workflow throughout.

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [Rust](https://www.rust-lang.org/tools/install) (stable) and the [Tauri 2 system prerequisites](https://tauri.app/start/prerequisites/) for your OS

### Run & build

```bash
# install frontend dependencies
npm install

# run the app in development (hot-reloading frontend + native window)
npm run tauri dev

# build a production desktop bundle for your platform
npm run tauri build
```

Other handy scripts:

```bash
npm run dev     # frontend only, in the browser (no native APIs)
npm test        # run the Vitest suite
```

Want a big file to try it on? `node tools/gen-log.mjs` generates a synthetic log.

## Keyboard shortcuts

Press `?` inside the app for the full, always-current list.

**General**

| Keys | Action |
| --- | --- |
| `Ctrl+K` / `Ctrl+F` | Command palette (search · filter · go to) |
| `/` | Focus the quick-filter input |
| `Ctrl+O` | Open file |
| `Ctrl+W` | Close current tab |
| `Ctrl+Tab` | Cycle tabs within a group |
| `Ctrl+T` | Toggle dark / light theme |
| `Alt+Z` | Toggle line wrapping |
| `Alt+\` / `Alt+-` | Split pane right / down (same file) |
| `Alt+W` | Close current pane |
| `Alt+← ↑ ↓ →` | Move pane focus |
| Right-click a tab | Split it into a side-by-side group (different files) |
| `?` | Show shortcuts · `Esc` closes panels / clears input |

**Navigation**

| Keys | Action |
| --- | --- |
| `Ctrl+↓` / `Ctrl+↑` (or `F3` / `Shift+F3`) | Next / previous search match |
| `Ctrl+Alt+↓` / `Ctrl+Alt+↑` (or `F4` / `Shift+F4`) | Next / previous error |
| `Ctrl+L` | Toggle Follow (live tail) |
| `End` | Jump to bottom and resume Follow |

**Mouse**

| Action | Result |
| --- | --- |
| Click | Select a row |
| Right-click | Row detail · search / filter by the selected text |
| Click ⚑ on a row | Toggle bookmark |
| Select text, then `Ctrl+K` | Selection is prefilled in the palette |
| Scroll up | Pause Follow |

## How it works

Lumber's guiding principle: **the original bytes stay on disk; only an index lives in memory.**

- **Indexer** — Streams the file on a background thread, recording a fixed, compact record per line (byte offset + packed level / timestamp flags). Roughly 10M lines fit in a small, predictable footprint, and the indexed prefix is queryable before the scan completes.
- **Watcher** — Uses [`notify`](https://crates.io/crates/notify) to incrementally index appended data and to detect truncation / rotation and re-index. The frontend only receives batched "line count changed" events, never raw line data.
- **Query engine** — Runs search (plain / regex) and filters (level mask + include/exclude + JSON field conditions) off the UI thread. A generation counter cancels stale queries instantly, so typing stays responsive.
- **Aggregator** — Bucketizes the file into the histogram and minimap density arrays that power the overview strip.

Rows are then fetched by the virtualized list on demand, so only what's on screen is ever read back from disk.

## Tech stack

| Layer | Choice |
| --- | --- |
| Shell | Tauri 2 (Rust) |
| Frontend | React 19 · TypeScript · Vite 7 |
| Styling | Tailwind CSS 4 |
| Virtualized list | TanStack Virtual |
| State | zustand |
| Command palette | cmdk |
| Rust crates | serde · serde_json · notify · regex · chrono |
| Tests | Vitest (frontend) · `cargo test` (Rust) |

## Project structure

```
lumber/
├─ src/                  # React 19 + TypeScript frontend
│  ├─ components/        # LogList, Rail, Palette, Minimap, DetailPanel, …
│  ├─ ipc/              # typed Tauri command / event wrappers
│  ├─ store.ts           # zustand store (tabs, filters, search, follow, panes)
│  ├─ controller.ts      # cross-cutting actions & focus bus
│  └─ follower · lineCache · splitTree · format
├─ src-tauri/            # Rust backend
│  └─ src/               # index · tab · query · aggregate · commands (IPC)
└─ tools/gen-log.mjs     # synthetic log generator for testing
```

## Roadmap

Deliberately out of scope for now, but on the radar:

- Exporting / sharing filtered results
- A merged, multi-file timeline view
- Remote sources (SSH, Docker, network streams)

Lumber is, and intends to stay, a fast read-only **viewer** — it never modifies your logs.

## Contributing

Issues and pull requests are welcome. If you're planning a larger change, opening an issue first to discuss it is appreciated.

## License

[MIT](LICENSE) © 2026 JunYoungJo
