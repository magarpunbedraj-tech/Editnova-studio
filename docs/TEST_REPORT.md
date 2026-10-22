# Phase 1 validation report

Date: 22 October 2026. Environment: Linux host, Node 24.19.0, Rust 1.99.1,
system FFmpeg/FFprobe. These results do not certify Windows behavior.

| Check | Result |
| --- | --- |
| TypeScript strict check + Vite production build | PASS |
| JavaScript timeline unit tests | 12 PASS |
| Rust schema/persistence tests | 4 PASS |
| Rust real FFmpeg integration tests | 3 PASS |
| npm dependency audit | No reported vulnerabilities at check time |
| Rust formatting / parsing | PASS |
| Linux native desktop compilation | BLOCKED: missing pkg-config / GTK / WebKit development packages; host package installation unavailable |
| Windows cross-target compile from Linux | BLOCKED at resource generation: `llvm-rc` unavailable; native bridge not fully type-checked |
| Windows native launch, installer and WebView2 | NOT RUN on Windows |
| Browser visual / interaction automation | BLOCKED: Chromium launch rejected by host socket/process restrictions |
| Windows CI workflow | PROVIDED, NOT EXECUTED |
| RustSec dependency audit | NOT RUN |

## Executed core coverage

JavaScript tests cover trim invariants, invalid/NaN ranges, cumulative source
mapping, split duration preservation, split endpoints, reorder immutability,
undo/redo branching, bounded history, schema versions, duplicate IDs and Unicode
JSON roundtrip.

Rust persistence tests cover recovery roundtrip, atomic replacement, preserving
an existing project on an invalid save, malformed JSON and oversized projects.

Real render integration tests generate original synthetic fixtures with FFmpeg.
They invoke the **actual Rust media renderer**, not a mocked export function.
They cover:
- Probing audio/video metadata and silent-source detection.
- Trimming/concatenating differently timed clips with and without audio.
- H.264/AAC output dimensions, approximate duration and decoding.
- Sampling output pixels to verify red/blue clip order.
- Twelve consecutive cuts with audio/video stream-duration agreement.
- Existing-output refusal and byte preservation.
- Cancellation with no final output publication.
- Missing files, unsupported extension and invalid video errors.
- A source filename containing Nepali text, spaces and shell punctuation.

Tests use short representative synthetic media. Large media, HDR/VFR, GPU
encoding, a real Windows sound device, seek accuracy, long-session memory,
installer upgrades, power loss and hostile parser inputs were not certified.

Run the README's Windows acceptance sequence before calling Phase 1 release
ready or beginning Phase 2. The source contains no compiled installer and makes
no bug-free or production-ready claim.
