# EditNova Studio

A free, offline video editor for Windows. Import clips, trim, split, reorder,
fade and set volume, then export an MP4 that plays everywhere. Nothing is
uploaded; your original files are never changed.

**Download:** [EditNova-Studio-Setup.exe](https://github.com/magarpunbedraj-tech/Editnova-studio/releases/latest/download/EditNova-Studio-Setup.exe)
· **Website:** https://magarpunbedraj-tech.github.io/Editnova-studio/

## Install (users)

1. Download `EditNova-Studio-Setup.exe` from the latest release.
2. Double-click it. If Windows SmartScreen says *"Windows protected your PC"*,
   click **More info → Run anyway** (the installer is not yet code-signed).
3. Open **EditNova Studio** from the Start menu.

The installer includes the FFmpeg video engine, needs no administrator rights,
and installs Microsoft WebView2 automatically if your PC lacks it.
Uninstall from **Settings → Apps**.

## Features (v1.1)

- Import MP4, MOV, MKV, WebM, AVI, M4V with the Import button or by dropping
  files on the window. Poster thumbnails in the media list and timeline.
- Timeline: drag to reorder, click to seek, scrub the ruler, split (`S`), trim
  to playhead (`Q`/`W`), duplicate, delete, undo/redo (100 steps), zoom and fit.
- Per-clip volume (0–200 %, mute) and fade in/out from black, previewed live
  and rendered identically in the export.
- Titles (`T`): one-line text at top, middle or bottom, three sizes, any
  colour, optional dark box, smooth fades, Nepali/Devanagari supported. Titles
  can span clips and are dragged along their own lane.
- Music track (`M`): MP3, WAV, M4A, AAC, OGG, FLAC, Opus. Drag along the
  timeline, skip the intro, volume and fades, waveform display, and automatic
  ducking under clip sound.
- Export: Best / Balanced / Smaller presets, 1080p, 720p, 4K, vertical 9:16,
  square and 4:5. NVIDIA NVENC GPU encoding when available, CPU x264 otherwise.
  Real progress with time remaining, cancel, full decode check before saving,
  existing files never overwritten, "Show in folder" afterwards.
- Projects: Save (`Ctrl+S`), Save as, recent projects, double-click
  `.novaproject` files to open them, drop a project file on the window,
  unsaved-changes prompt when closing, crash recovery checkpoint, relink
  moved media. Version 1 projects from 0.1 open and upgrade automatically.
- Smooth preview: one click converts a clip the preview can't play into a
  lightweight copy (cached between sessions). Export always uses the original.
- Light and dark themes, keyboard shortcuts sheet (`?`), update notice.

## How releases are built

Everything is automated by GitHub Actions (`.github/workflows/build.yml`) on a
Windows runner:

1. Downloads the latest FFmpeg release build from BtbN/FFmpeg-Builds and
   verifies its SHA-256.
2. Runs the JavaScript tests, the TypeScript build, and the Rust tests, which
   render real video with FFmpeg and check the pixels and sound.
3. Builds the NSIS installer with FFmpeg bundled.
4. Smoke-tests it: silent install, checks the bundled files, launches the app.
5. Uploads the installer as a build artifact. If the version in
   `package.json` has no release yet, it publishes GitHub Release `vX.Y.Z`
   with the installer, checksums and the FFmpeg source archive.

To release a new version: bump `version` in `package.json`,
`src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml` (plus the
`editnova-studio` entry in `src-tauri/Cargo.lock`), update
`docs/RELEASE_NOTES.md`, then commit and push to `main`. The release is
created automatically once the build passes.

The website in `website/` is published to GitHub Pages by
`.github/workflows/website.yml`. In the repository, set **Settings → Pages →
Source** to **GitHub Actions** once.

## Develop locally (Windows)

Prerequisites: Node.js 22+, Rust (MSVC), Visual Studio Build Tools with
"Desktop development with C++", and FFmpeg/FFprobe on PATH (or set
`EDITNOVA_FFMPEG_DIR`). See https://v2.tauri.app/start/prerequisites/.

```
npm ci
npm run desktop          # run the app with hot reload
npm test                 # timeline engine tests
npm run build            # type-check and bundle the UI
cargo test --manifest-path src-tauri/Cargo.toml --no-default-features --locked
```

`scripts/start-windows.cmd` checks the prerequisites and starts the app.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| Space | Play / pause |
| ← / → (Shift for 1 s) | Step one frame |
| Home / End | Start / end |
| S | Split at playhead |
| T / M | Add title / add music at playhead |
| Q / W | Trim clip start / end to playhead |
| Delete | Remove selected clip |
| Ctrl+D | Duplicate clip |
| Ctrl+Z, Ctrl+Shift+Z / Ctrl+Y | Undo, redo |
| Ctrl+S, Ctrl+Shift+S | Save, save as |
| Ctrl+O, Ctrl+I, Ctrl+E | Open, import, export |
| Ctrl+= / Ctrl+− / Ctrl+wheel | Zoom timeline |
| ? | Show all shortcuts |

## Documentation

- `docs/ARCHITECTURE.md` — modules, document model, rendering, security
- `docs/KNOWN_LIMITATIONS.md` — what v1.0 does not do yet
- `docs/ROADMAP.md` — next phases
- `docs/LICENSING.md` — MIT for EditNova, GPL for the bundled FFmpeg
- `docs/TEST_REPORT.md` — what is tested and where

License: MIT. The bundled FFmpeg is GPL; see `legal/THIRD-PARTY-NOTICES.txt`.
