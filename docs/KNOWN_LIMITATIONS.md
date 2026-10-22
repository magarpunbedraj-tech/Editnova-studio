# Known limitations (v1.0)

- **One video track.** No overlays, picture-in-picture, separate music track,
  titles/text, transitions between clips (fades go via black), speed changes,
  color tools or effects yet. See `ROADMAP.md`.
- **Preview** uses the webview's decoders. Some codecs (HEVC without the
  Windows extension, MPEG-2, ProRes, many AVI/MKV) need a one-click smooth
  preview. Seeking is not guaranteed frame-exact on variable-frame-rate phone
  footage; export uses FFmpeg and is accurate. Volume boosts above 100 % are
  heard only in the export.
- **Export** is MP4 (H.264 + AAC) only; no HEVC/AV1/ProRes, no custom bitrate,
  no export queue, no HDR (HDR sources are exported as SDR without tone
  mapping and may look washed out).
- **GPU encoding** supports NVIDIA NVENC only. AMD/Intel use the CPU encoder.
- **Projects** reference media by absolute path; moving footage requires
  relinking. There is no "collect files" packaging.
- **Recovery** keeps one rolling checkpoint, not version history.
- **Installer** is not code-signed, so SmartScreen warns on first run until a
  signing certificate is configured (see `LICENSING.md`). There is no
  automatic in-app updater; the app shows a notice and links to the release.
- **Single instance**: double-clicking a project while EditNova is open starts
  a second window.
- **Windows only** is packaged and tested. The code builds for macOS/Linux with
  their Tauri prerequisites but is not distributed.
