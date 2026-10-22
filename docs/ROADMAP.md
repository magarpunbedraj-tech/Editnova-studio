# Roadmap

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Import, preview, sequential timeline, trim/split, JSON projects, MP4 export | Done (0.1) |
| 1.0 release | Bundled FFmpeg installer, drag-and-drop, reorder by dragging, thumbnails, fades, volume, export presets, NVENC, real progress, save/recent/close guard, file association, website, CI release pipeline | Done |
| 2 | Multi-track schema (v3): music/voice track, titles and text, cross-dissolves, speed, per-clip crop/zoom; shared filter definitions for preview and export | Next |
| 3 | Photo/still support, layer compositor, image export | Planned |
| 4 | Keyframes, color adjustments, audio cleanup | Planned |
| 5 | Optional on-device AI: auto-captions (Whisper), silence removal, background removal | Planned |
| 6 | Signed installer + auto-updater, single-instance, AMD/Intel GPU encoders, proxy generation in background | Planned |

Rules carried forward: never ship a control before the operation behind it
works and is tested; preview and export must share one definition of every
effect; schema changes get a version bump and a tested migration.
