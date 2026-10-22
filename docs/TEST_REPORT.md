# Test report — EditNova Studio 1.1.0

Date: 22 October 2026.

## Automated (GitHub Actions, `windows-latest`, every push)

| Check | Result |
| --- | --- |
| FFmpeg download with SHA-256 verification | PASS |
| JavaScript timeline engine tests (`npm test`) | 24 PASS |
| TypeScript strict type-check + Vite production build | PASS |
| Rust unit tests (schema v3, migrations, titles/music validation, music slicing and gain, fades/volume, progress parsing, paths, recent list, persistence) | 15 PASS |
| Rust real-render tests with the bundled FFmpeg | 7 PASS |
| Tauri desktop compile + NSIS installer build with bundled FFmpeg | PASS |
| Silent install, bundled `ffmpeg.exe`/`ffprobe.exe`/legal files present | PASS |
| App launches from the install folder and stays running for 15 s | PASS |

The real-render tests generate synthetic footage and run the same Rust renderer
the app uses. They check output dimensions, duration, audio presence, pixel
colors in clip order, existing-file protection, cancellation, Unicode and shell
characters in filenames, frame-exact length across 12 cuts with A/V agreement,
fade-in/fade-out brightness, muting (peak below −60 dB), monotonic progress
ending at 100 %, poster-frame creation and reuse, a title that crosses a cut
(visible on both sides, gone afterwards, with `%{...}`, quotes and colons in the
text), sound-file import, music entering at its timeline position over silent
clips, and ducking renders.

## UI walkthrough (Chromium, mocked native layer)

Import → clips placed on timeline with poster frames; click-to-seek; split with
`S`; fade presets; drag a clip to a new position; playback across clips with
the fade overlay; export dialog → progress with percentage → finished dialog;
light theme; shortcuts sheet; add a title with `T`, edit text (Nepali), size,
position and colour; drag a title along its lane; add music with `M` and hear it
follow the playhead at the faded, ducked level; unsaved-changes prompt on window close; drop
overlay. No page errors.

## Not covered by automation

Native file dialogs, real drag-and-drop from Explorer, NVENC on real NVIDIA
hardware (the CI runner has no GPU, so the CPU path is what is tested), high-DPI
and multi-monitor layout, very long or HDR/VFR footage, installer upgrades over
an older version. Check these by hand on your own PC after installing.
