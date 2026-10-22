# Licensing and distribution

**EditNova Studio** source is MIT-licensed (`LICENSE`).

**FFmpeg** is bundled in the Windows installer as two separate executables
(`ffmpeg.exe`, `ffprobe.exe`) from BtbN/FFmpeg-Builds' GPL build, which
includes libx264. EditNova runs them as subprocesses and does not link to
them. Obligations we meet in each release:

- `legal/FFMPEG-LICENSE.txt` (the GPLv3 text shipped with the build) and
  `legal/THIRD-PARTY-NOTICES.txt` are installed with the app.
- `legal/FFMPEG-SOURCE.txt` records the exact archive, SHA-256 and FFmpeg
  commit.
- The GitHub Release attaches the FFmpeg source for that commit. BtbN's build
  scripts (which pin every bundled library's source version) are public at
  https://github.com/BtbN/FFmpeg-Builds.

For the strictest reading of GPL "complete corresponding source", also attach
the sources of the bundled third-party libraries (x264, etc.) to the release.
We are not lawyers; have counsel review before commercial distribution.
H.264/AAC may be patent-encumbered in some countries.

**Code signing.** To remove the SmartScreen warning, obtain a code-signing
certificate (for example Azure Trusted Signing or an OV/EV certificate) and
configure `bundle.windows.signCommand` or `certificateThumbprint` in
`tauri.conf.json`, with the secret stored in GitHub Actions secrets.

Other dependencies (Tauri, React, Zustand, Rust crates) are MIT and/or
Apache-2.0; versions are pinned in `package-lock.json` and `Cargo.lock`.
`docs/npm-licenses.json` lists npm packages.
