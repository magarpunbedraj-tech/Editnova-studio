# Roadmap

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Import, preview, sequential timeline, trim/split, JSON projects, MP4 export | Done (0.1) |
| 1.0 release | Bundled FFmpeg installer, drag-and-drop, reorder by dragging, thumbnails, fades, volume, export presets, NVENC, real progress, save/recent/close guard, file association, website, CI release pipeline | Done |
| 1.1 | Schema v3: titles lane, music track with ducking, sound-file import and waveforms | Done |
| 1.2 | Schema v4: transitions (dissolve, dip, wipe, slide) and per-clip speed | Done |
| 2 | Per-clip crop/zoom (Ken Burns), multi-line and animated titles, voice-over recording, colour adjustments | Next |
| 3 | Photo/still support, layer compositor, image export | Planned |
| 4 | Keyframes, color adjustments, audio cleanup | Planned |
| 5 | Optional on-device AI: auto-captions (Whisper), silence removal, background removal | Planned |
| 6 | Signed installer + auto-updater, single-instance, AMD/Intel GPU encoders, proxy generation in background | Planned |

Rules carried forward: never ship a control before the operation behind it
works and is tested; preview and export must share one definition of every
effect; schema changes get a version bump and a tested migration.
