# Architecture

## Modules

| Module | Responsibility |
| --- | --- |
| `src/App.tsx` | Editor orchestration: state, playback, keyboard, dialogs, backend events |
| `src/ui/Timeline.tsx` | Ruler, video and audio lanes, scrubbing, pointer drag-to-reorder, zoom |
| `src/ui/Panels.tsx` | Media list with poster frames, inspector (timing, sound, fades), welcome screen |
| `src/ui/Dialogs.tsx` | Export, progress with ETA, finished, unsaved changes, shortcuts, about |
| `src/api.ts` | Typed wrappers for every native command, event subscription, update check |
| `src/engine.mjs` (+ `.d.mts`) | Pure sequence operations, validation, migration, history |
| `src/store.ts` | Zustand document/history state |
| `src-tauri/src/model.rs` | Native schema, v1→v2 migration, validation |
| `src-tauri/src/media.rs` | Tool lookup, probe, thumbnails, render with fades/volume, NVENC detection, progress parsing |
| `src-tauri/src/persistence.rs` | Bounded project loading, atomic saving, recent-project list |
| `src-tauri/src/main.rs` | Dialogs, IPC commands, file-scope approval, drag-and-drop, close guard |
| `tests/engine.test.mjs` | Timeline invariants (22 tests) |
| `src-tauri/tests/render.rs` | Real FFmpeg rendering tests |

The Rust library builds without the `desktop` feature so rendering and
persistence are tested without the GUI. Blocking work runs on Tauri's worker
pool; progress events stream to React; an atomic flag cancels jobs; a busy
guard prevents overlapping media jobs.

## Document model (version 2)

`name`, output `width`, `height`, `fps`, `media[]`, ordered `clips[]`.
Media: UUID, absolute path, name, duration, dimensions, audio flag.
Clip: UUID, media UUID, source `in`/`out` seconds, `volume` (0–2 linear),
`fadeIn`/`fadeOut` seconds (each ≤ 10 s, together ≤ clip length).
Sequence times are cumulative clip lengths: no gaps, no overlaps.

Version 1 files (EditNova 0.1) are upgraded on load by adding `volume: 1` and
zero fades; the next save writes version 2. Unknown versions are rejected.
JavaScript (`engine.mjs`) and Rust (`model.rs`) enforce identical rules.

## Rendering

Each clip is rendered to a normalized segment: scaled to fit the canvas with
black padding, square pixels, the project frame rate, yuv420p, H.264 High
profile, 48 kHz stereo AAC. Silent sources get a generated silent track.
Volume uses FFmpeg `volume`; fades use `fade` (video, to black) and `afade`,
applied after `apad` so they also cover padded audio. Segments are joined with
the concat demuxer (stream copy), probed for duration and fully decoded with
`-xerror` before the result is copied beside the target and published with a
no-clobber rename. Existing files are never overwritten.

Encoders: `libx264` (Best: medium/CRF 18, Balanced: faster/CRF 21, Smaller:
faster/CRF 26) or `h264_nvenc` (p5, VBR CQ 19/23/28) when the user enables it
and a one-frame test encode succeeds. One encoder is used for a whole export so
segments always concatenate cleanly.

Progress comes from FFmpeg's `-progress` report (position in seconds), combined
across clips into a real fraction; the UI derives the time remaining.

## Preview

The webview plays the source file for the clip under the playhead and moves to
the next clip at the out point. Fades are previewed with a black overlay and
element volume (boosts above 100 % are export-only). If the webview cannot
decode a source, the monitor offers a smooth preview: a 720p H.264 copy cached
in the app cache folder under a key of path + size + modification time, reused
across sessions and rebuilt if the source changes.

## Persistence

- Save writes to the project's known path; Save as and first save show a dialog.
- Saving is atomic (temp file, fsync, rename).
- A recovery checkpoint is written 1.5 s after each edit to the app data folder.
- The recent list (12 entries) lives in `recent.json` in the app data folder.

## Security model

- File access is user-driven: dialogs, drag-and-drop and Windows file
  association arguments. The frontend cannot ask the backend to read an
  arbitrary path: `open_project_path` only accepts projects already chosen or
  listed in recents; `reveal` only exported files; `open_link` only three fixed
  URLs.
- The asset protocol starts with an empty scope; probed media, generated
  thumbnails and previews receive individual read grants.
- FFprobe/FFmpeg use `Command::args` (no shell) and a `file,pipe` protocol
  whitelist. Probes are size- and time-bounded.
- Project loading is capped at 10 MB with schema bounds.
- No shell, filesystem or HTTP plugins. CSP limits network access to the IPC
  bridge and `api.github.com` (update check).

## Distribution

`tauri.conf.json` builds an NSIS installer (per-user, no admin), registers the
`.novaproject` association, and ships `legal/` notices. The release overlay
`tauri.release.conf.json` adds `ffmpeg.exe`/`ffprobe.exe` as external binaries
(installed beside `editnova-studio.exe`, where `media::tool_path` finds them)
plus the FFmpeg license and source note. CI fetches FFmpeg; it is never
committed to the repository.
