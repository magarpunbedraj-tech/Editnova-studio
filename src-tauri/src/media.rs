use crate::model::{BlendKind, Clip, Media, MediaKind, Music, Placement, Project, Title};
use std::{
    hash::{Hash, Hasher},
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant},
};

pub const VIDEO_EXTENSIONS: [&str; 6] = ["mp4", "mov", "mkv", "webm", "avi", "m4v"];
pub const AUDIO_EXTENSIONS: [&str; 7] = ["mp3", "wav", "m4a", "aac", "ogg", "flac", "opus"];

/// Locates a media tool. Search order: the `EDITNOVA_FFMPEG_DIR` directory,
/// the folder containing the EditNova executable (where the Windows installer
/// places its bundled copies), then the system PATH.
pub fn tool_path(tool: &str) -> PathBuf {
    let file = if cfg!(windows) {
        format!("{tool}.exe")
    } else {
        tool.to_string()
    };
    let mut dirs: Vec<PathBuf> = Vec::new();
    if let Some(d) = std::env::var_os("EDITNOVA_FFMPEG_DIR") {
        dirs.push(PathBuf::from(d));
    }
    if let Some(d) = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(Path::to_path_buf))
    {
        dirs.push(d);
    }
    dirs.into_iter()
        .map(|d| d.join(&file))
        .find(|p| p.is_file())
        .unwrap_or_else(|| PathBuf::from(tool))
}

pub fn command(tool: &str) -> Command {
    #[allow(unused_mut)]
    let mut c = Command::new(tool_path(tool));
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW: never flash a console window.
        c.creation_flags(0x08000000);
    }
    c
}

fn tail(path: &Path, bytes: u64) -> String {
    let Ok(mut f) = std::fs::File::open(path) else {
        return String::new();
    };
    let len = f.metadata().map(|m| m.len()).unwrap_or(0);
    if len > bytes {
        let _ = f.seek(SeekFrom::Start(len - bytes));
    }
    let mut buf = Vec::new();
    let _ = f.read_to_end(&mut buf);
    String::from_utf8_lossy(&buf).into_owned()
}

/// Parses the most recent output position, in seconds, from an FFmpeg
/// `-progress` report.
pub fn parse_progress(report: &str) -> Option<f64> {
    for key in ["out_time_us=", "out_time_ms="] {
        if let Some(i) = report.rfind(key) {
            let digits: String = report[i + key.len()..]
                .chars()
                .take_while(|c| c.is_ascii_digit())
                .collect();
            if let Ok(us) = digits.parse::<u64>() {
                return Some(us as f64 / 1_000_000.0);
            }
        }
    }
    None
}

fn friendly_failure(stderr: &str) -> String {
    let last: String = stderr
        .chars()
        .rev()
        .take(3000)
        .collect::<String>()
        .chars()
        .rev()
        .collect();
    let lower = last.to_lowercase();
    let hint = if lower.contains("no space left") {
        "The destination drive is full. Free some space or export to another drive. "
    } else if lower.contains("permission denied") || lower.contains("access is denied") {
        "EditNova cannot write to that folder. Choose a folder you own, such as Videos. "
    } else if lower.contains("invalid data found") || lower.contains("moov atom not found") {
        "A source video is damaged or incomplete. "
    } else {
        ""
    };
    format!("{hint}Media process failed: {}", last.trim())
}

/// Runs a media subprocess, honouring cancellation. When `progress` is given,
/// FFmpeg must have been started with `-progress <file>` pointing at it; each
/// new output position (seconds) is passed to `on_progress`.
pub fn run_with_progress(
    mut c: Command,
    cancel: &AtomicBool,
    progress: Option<&Path>,
    on_progress: &mut dyn FnMut(f64),
) -> Result<(), String> {
    let err = tempfile::NamedTempFile::new().map_err(|e| e.to_string())?;
    let mut child = c
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(err.reopen().map_err(|e| e.to_string())?)
        .spawn()
        .map_err(|e| {
            format!(
                "Cannot start the media engine ({e}). Reinstall EditNova, or install FFmpeg and FFprobe on PATH."
            )
        })?;
    let began = Instant::now();
    let mut last_report = Instant::now();
    loop {
        if cancel.load(Ordering::Relaxed) || began.elapsed() > Duration::from_secs(24 * 3600) {
            let _ = child.kill();
            let _ = child.wait();
            return Err("Cancelled".into());
        }
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            if status.success() {
                return Ok(());
            }
            let s = std::fs::read_to_string(err.path()).unwrap_or_default();
            return Err(friendly_failure(&s));
        }
        if let Some(file) = progress {
            if last_report.elapsed() > Duration::from_millis(400) {
                last_report = Instant::now();
                if let Some(t) = parse_progress(&tail(file, 2048)) {
                    on_progress(t);
                }
            }
        }
        std::thread::sleep(Duration::from_millis(80));
    }
}

pub fn run(c: Command, cancel: &AtomicBool) -> Result<(), String> {
    run_with_progress(c, cancel, None, &mut |_| {})
}

/// Removes the Windows `\\?\` verbatim prefix that `canonicalize` adds to
/// ordinary drive paths, so paths stay readable and match the webview's form.
pub fn simplify(path: PathBuf) -> PathBuf {
    let text = path.to_string_lossy().into_owned();
    if let Some(rest) = text.strip_prefix(r"\\?\") {
        let b = rest.as_bytes();
        if b.len() >= 3 && b[0].is_ascii_alphabetic() && b[1] == b':' && b[2] == b'\\' {
            return PathBuf::from(rest);
        }
    }
    path
}

pub fn probe(path: &Path) -> Result<Media, String> {
    let path = simplify(
        path.canonicalize()
            .map_err(|e| format!("Missing media {}: {e}", path.display()))?,
    );
    if !path.is_file() {
        return Err("Media must be a local file".into());
    }
    let ext = path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();
    let kind = if VIDEO_EXTENSIONS.contains(&ext.as_str()) {
        MediaKind::Video
    } else if AUDIO_EXTENSIONS.contains(&ext.as_str()) {
        MediaKind::Audio
    } else {
        return Err(format!(
            "{} is not a supported file. EditNova opens MP4, MOV, MKV, WebM, AVI and M4V videos, and MP3, WAV, M4A, AAC, OGG, FLAC and Opus sound files.",
            path.file_name().unwrap_or_default().to_string_lossy()
        ));
    };
    let mut c = command("ffprobe");
    c.args([
        "-v",
        "error",
        "-protocol_whitelist",
        "file,pipe",
        "-show_streams",
        "-show_format",
        "-of",
        "json",
    ])
    .arg(&path);
    let output = tempfile::NamedTempFile::new().map_err(|e| e.to_string())?;
    let errors = tempfile::NamedTempFile::new().map_err(|e| e.to_string())?;
    let mut child = c
        .stdin(Stdio::null())
        .stdout(output.reopen().map_err(|e| e.to_string())?)
        .stderr(errors.reopen().map_err(|e| e.to_string())?)
        .spawn()
        .map_err(|e| {
            format!("The media engine (FFprobe) is unavailable: {e}. Reinstall EditNova.")
        })?;
    let began = Instant::now();
    loop {
        if began.elapsed() > Duration::from_secs(30)
            || output
                .as_file()
                .metadata()
                .map_err(|e| e.to_string())?
                .len()
                > 10_000_000
        {
            let _ = child.kill();
            let _ = child.wait();
            return Err("Reading this video took too long or returned too much metadata".into());
        }
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            if !status.success() {
                let detail = std::fs::read_to_string(errors.path()).unwrap_or_default();
                return Err(format!(
                    "{} could not be read. {}",
                    path.file_name().unwrap_or_default().to_string_lossy(),
                    detail.trim()
                ));
            }
            break;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    let j: serde_json::Value =
        serde_json::from_slice(&std::fs::read(output.path()).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    let streams = j["streams"].as_array().ok_or("No streams")?;
    let audio = streams.iter().any(|v| v["codec_type"] == "audio");
    let duration = j["format"]["duration"]
        .as_str()
        .and_then(|s| s.parse::<f64>().ok())
        .filter(|v| v.is_finite() && *v > 0.0)
        .ok_or("This file has no readable duration")?;
    let name: String = path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .into();
    if kind == MediaKind::Audio {
        if !audio {
            return Err(format!("{name} has no sound"));
        }
        return Ok(Media {
            id: uuid::Uuid::new_v4().to_string(),
            path: path.to_string_lossy().into(),
            name,
            duration,
            width: 0,
            height: 0,
            audio,
            kind,
        });
    }
    let v = streams
        .iter()
        .find(|v| v["codec_type"] == "video" && v["disposition"]["attached_pic"] != 1)
        .ok_or("This file has no video picture")?;
    let rotation = v["side_data_list"]
        .as_array()
        .and_then(|a| a.iter().find_map(|x| x["rotation"].as_f64()))
        .or_else(|| {
            v["tags"]["rotate"]
                .as_str()
                .and_then(|s| s.parse::<f64>().ok())
        })
        .unwrap_or(0.0);
    let mut width = v["width"].as_u64().unwrap_or(0) as u32;
    let mut height = v["height"].as_u64().unwrap_or(0) as u32;
    if ((rotation.abs() % 180.0) - 90.0).abs() < 1.0 {
        std::mem::swap(&mut width, &mut height);
    }
    if width < 1 || height < 1 {
        return Err("Invalid video dimensions".into());
    }
    Ok(Media {
        id: uuid::Uuid::new_v4().to_string(),
        path: path.to_string_lossy().into(),
        name,
        duration,
        width,
        height,
        audio,
        kind,
    })
}

/// Stable cache key for a source file: its path, size and modification time.
/// A changed file produces a new key, so stale previews are never reused.
pub fn file_key(path: &Path) -> Result<String, String> {
    let meta = std::fs::metadata(path).map_err(|e| e.to_string())?;
    let mut h = std::collections::hash_map::DefaultHasher::new();
    path.to_string_lossy().hash(&mut h);
    meta.len().hash(&mut h);
    if let Ok(t) = meta.modified() {
        if let Ok(d) = t.duration_since(std::time::UNIX_EPOCH) {
            d.as_nanos().hash(&mut h);
        }
    }
    Ok(format!("{:016x}", h.finish()))
}

/// Writes (or reuses) a small JPEG poster frame for the media in `cache_dir`.
pub fn thumbnail(m: &Media, cache_dir: &Path) -> Result<PathBuf, String> {
    std::fs::create_dir_all(cache_dir).map_err(|e| e.to_string())?;
    let ext = if m.kind == MediaKind::Audio { "png" } else { "jpg" };
    let target = cache_dir.join(format!("{}.{ext}", file_key(Path::new(&m.path))?));
    if target
        .metadata()
        .map(|x| x.is_file() && x.len() > 0)
        .unwrap_or(false)
    {
        return Ok(target);
    }
    let tmp = cache_dir.join(format!("{}.part.{ext}", uuid::Uuid::new_v4()));
    let mut c = command("ffmpeg");
    c.args([
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-y",
        "-protocol_whitelist",
        "file,pipe",
    ]);
    if m.kind == MediaKind::Audio {
        // A waveform picture for sound files.
        c.arg("-i").arg(&m.path).args([
            "-filter_complex",
            "aformat=channel_layouts=mono,showwavespic=s=800x120:colors=0x5fd3bc",
            "-frames:v",
            "1",
        ]);
    } else {
        let at = (m.duration * 0.1).min(3.0);
        c.args(["-ss", &format!("{at:.3}"), "-i"])
            .arg(&m.path)
            .args([
                "-map",
                "0:V:0",
                "-frames:v",
                "1",
                "-vf",
                "scale=320:180:force_original_aspect_ratio=decrease,pad=320:180:(ow-iw)/2:(oh-ih)/2",
                "-q:v",
                "5",
            ]);
    }
    c.arg(&tmp);
    let never = AtomicBool::new(false);
    let result = run(c, &never);
    if result.is_err() || !tmp.is_file() {
        let _ = std::fs::remove_file(&tmp);
        return Err(result.err().unwrap_or_else(|| "No poster frame".into()));
    }
    std::fs::rename(&tmp, &target).map_err(|e| e.to_string())?;
    Ok(target)
}

#[derive(Clone, Copy, PartialEq, Eq, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Quality {
    High,
    Standard,
    Small,
    Preview,
}

#[derive(Clone, Copy, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportOptions {
    pub quality: Quality,
    /// Use the NVIDIA hardware encoder when it is present and works.
    pub hardware: bool,
}

impl Default for ExportOptions {
    fn default() -> Self {
        ExportOptions {
            quality: Quality::Standard,
            hardware: false,
        }
    }
}

fn nvenc_args(q: Quality) -> Vec<String> {
    let cq = match q {
        Quality::High => "19",
        Quality::Standard => "23",
        Quality::Small | Quality::Preview => "28",
    };
    [
        "-c:v",
        "h264_nvenc",
        "-preset",
        "p5",
        "-rc",
        "vbr",
        "-cq",
        cq,
        "-b:v",
        "0",
        "-profile:v",
        "high",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect()
}

fn x264_args(q: Quality) -> Vec<String> {
    let (preset, crf) = match q {
        Quality::High => ("medium", "18"),
        Quality::Standard => ("faster", "21"),
        Quality::Small => ("faster", "26"),
        Quality::Preview => ("veryfast", "24"),
    };
    [
        "-c:v",
        "libx264",
        "-preset",
        preset,
        "-crf",
        crf,
        "-profile:v",
        "high",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect()
}

/// True when FFmpeg can actually encode with NVIDIA NVENC on this machine
/// (encoder compiled in, supported GPU and driver present).
pub fn hardware_encoder_works() -> bool {
    let mut c = command("ffmpeg");
    c.args([
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-f",
        "lavfi",
        "-i",
        "color=c=black:s=256x256:r=30:d=0.2",
        "-pix_fmt",
        "yuv420p",
    ])
    .args(nvenc_args(Quality::Standard))
    .args(["-f", "null", "-"]);
    let never = AtomicBool::new(false);
    run(c, &never).is_ok()
}

pub fn frame_count(len: f64, fps: u32) -> u64 {
    ((len * fps as f64).round() as u64).max(1)
}

/// `atempo` accepts 0.5–2, so larger changes are chained.
pub fn atempo(speed: f64) -> String {
    let mut s = speed;
    let mut out = Vec::new();
    while s > 2.0 + 1e-9 {
        out.push("atempo=2".to_string());
        s /= 2.0;
    }
    while s < 0.5 - 1e-9 {
        out.push("atempo=0.5".to_string());
        s /= 0.5;
    }
    if (s - 1.0).abs() > 1e-6 {
        out.push(format!("atempo={s:.6}"));
    }
    out.join(",")
}

/// One clip seen from `local_from` seconds into its own timeline length.
#[derive(Clone)]
pub struct Part {
    pub clip: Clip,
    pub path: String,
    pub has_audio: bool,
    pub local_from: f64,
}

impl Part {
    /// Where to start reading the source file.
    pub fn source_offset(&self) -> f64 {
        self.clip.r#in + self.local_from * self.clip.speed
    }
}

/// A stretch of the timeline rendered as one MP4 segment: either part of a
/// single clip, or the overlap where one clip turns into the next.
pub struct Piece {
    pub start: f64,
    pub len: f64,
    pub blend: Option<BlendKind>,
    pub parts: Vec<Part>,
}

/// Splits the timeline into pieces. A clip with transitions on both sides
/// becomes [blend in] [middle] [blend out]; each blend is shared with the
/// neighbouring clip.
pub fn plan(p: &Project) -> Vec<Piece> {
    let starts = p.starts();
    let part = |c: &Clip, local_from: f64| {
        let m = p.media.iter().find(|m| m.id == c.media_id);
        Part {
            clip: c.clone(),
            path: m.map(|m| m.path.clone()).unwrap_or_default(),
            has_audio: m.map(|m| m.audio).unwrap_or(false),
            local_from,
        }
    };
    let half_frame = 0.5 / p.fps as f64;
    let mut out = Vec::new();
    for (i, c) in p.clips.iter().enumerate() {
        let lead = c.blend_len();
        let tail = p.clips.get(i + 1).map(|n| n.blend_len()).unwrap_or(0.0);
        if i > 0 && lead > 0.0 {
            let prev = &p.clips[i - 1];
            out.push(Piece {
                start: starts[i],
                len: lead,
                blend: c.blend.map(|b| b.kind),
                parts: vec![part(prev, prev.len() - lead), part(c, 0.0)],
            });
        }
        let middle = c.len() - lead - tail;
        if middle > half_frame {
            out.push(Piece {
                start: starts[i] + lead,
                len: middle,
                blend: None,
                parts: vec![part(c, lead)],
            });
        }
    }
    out
}

/// Picture chain for one part: speed, fit to the canvas, exact frame count,
/// and the clip's own fades placed in part-local time.
pub fn part_video(p: &Project, part: &Part, piece_len: f64) -> String {
    let c = &part.clip;
    let pts = if (c.speed - 1.0).abs() > 1e-6 {
        format!("setpts=(PTS-STARTPTS)/{:.6}", c.speed)
    } else {
        "setpts=PTS-STARTPTS".to_string()
    };
    let mut vf = format!(
        "{pts},scale={w}:{h}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps={f},tpad=stop_mode=clone:stop_duration=2,trim=end_frame={n},setpts=PTS-STARTPTS,settb=AVTB,format=yuv420p",
        w = p.width,
        h = p.height,
        f = p.fps,
        n = frame_count(piece_len, p.fps),
    );
    if c.fade_in > 0.0 && part.local_from < 1e-6 {
        vf.push_str(&format!(",fade=t=in:st=0:d={:.3}", c.fade_in));
    }
    if c.fade_out > 0.0 {
        let st = c.len() - c.fade_out - part.local_from;
        if st > -1e-6 {
            vf.push_str(&format!(",fade=t=out:st={:.3}:d={:.3}", st.max(0.0), c.fade_out));
        }
    }
    vf
}

/// Sound chain for one part: resampled, speed-adjusted (pitch kept), volume,
/// padded with silence, and the clip's own fades in part-local time.
pub fn part_audio(part: &Part) -> String {
    let c = &part.clip;
    let mut af = String::from("aresample=48000:async=1:first_pts=0");
    // Generated silence needs no tempo change (atempo would add a faint
    // click at its start).
    let tempo = if part.has_audio {
        atempo(c.speed)
    } else {
        String::new()
    };
    if !tempo.is_empty() {
        af.push(',');
        af.push_str(&tempo);
    }
    if (c.volume - 1.0).abs() > 1e-6 {
        af.push_str(&format!(",volume={:.4}", c.volume));
    }
    af.push_str(",apad");
    if c.fade_in > 0.0 && part.local_from < 1e-6 {
        af.push_str(&format!(",afade=t=in:st=0:d={:.3}", c.fade_in));
    }
    if c.fade_out > 0.0 {
        let st = c.len() - c.fade_out - part.local_from;
        if st > -1e-6 {
            af.push_str(&format!(",afade=t=out:st={:.3}:d={:.3}", st.max(0.0), c.fade_out));
        }
    }
    af.push_str(",aformat=sample_fmts=fltp:channel_layouts=stereo");
    af
}

/// The part of a music item that plays during one segment.
pub struct MusicSlice {
    pub path: String,
    /// Where to start reading the sound file, in seconds.
    pub source_offset: f64,
    pub duration: f64,
    /// Delay from the start of the segment.
    pub local_start: f64,
    /// Timeline time of the slice's first sample.
    pub timeline_start: f64,
    pub music: Music,
}

pub fn music_slices(p: &Project, seg_start: f64, seg_len: f64) -> Vec<MusicSlice> {
    let seg_end = seg_start + seg_len;
    p.music
        .iter()
        .filter_map(|mu| {
            let media = p.media.iter().find(|m| m.id == mu.media_id)?;
            let a = mu.start.max(seg_start);
            let b = mu.end().min(seg_end);
            if b - a < 1e-3 {
                return None;
            }
            Some(MusicSlice {
                path: media.path.clone(),
                source_offset: mu.r#in + (a - mu.start),
                duration: b - a,
                local_start: a - seg_start,
                timeline_start: a,
                music: mu.clone(),
            })
        })
        .collect()
}

fn num(v: f64) -> String {
    format!("{v:.4}")
}

/// Gain expression for a music slice: its volume shaped by its fades, with
/// `t` running from 0 at the slice's first sample.
pub fn music_gain(sl: &MusicSlice) -> String {
    let m = &sl.music;
    let g = format!("({}+t)", num(sl.timeline_start));
    let mut terms = vec!["1".to_string()];
    if m.fade_in > 0.0 {
        terms.push(format!("({g}-{})/{}", num(m.start), num(m.fade_in)));
    }
    if m.fade_out > 0.0 {
        terms.push(format!("({}-{g})/{}", num(m.end()), num(m.fade_out)));
    }
    let shape = terms
        .into_iter()
        .reduce(|a, b| format!("min({a},{b})"))
        .unwrap_or_else(|| "1".into());
    format!("{}*clip({shape},0,1)", num(m.volume))
}

pub struct TitleFile {
    pub title: Title,
    pub text_file: String,
    pub font_file: String,
}

fn has_devanagari(text: &str) -> bool {
    text.chars().any(|c| ('\u{0900}'..='\u{097F}').contains(&c))
}

/// Finds a font for titles: `EDITNOVA_FONT` if set, then Windows' Segoe UI
/// (or Nirmala UI for Devanagari/Nepali text), then common Linux fonts.
pub fn find_font(devanagari: bool) -> Option<PathBuf> {
    if let Some(f) = std::env::var_os("EDITNOVA_FONT").map(PathBuf::from) {
        if f.is_file() {
            return Some(f);
        }
    }
    let windir = std::env::var_os("WINDIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"C:\Windows"))
        .join("Fonts");
    let windows: &[&str] = if devanagari {
        &["NirmalaB.ttf", "Nirmala.ttc", "Nirmala.ttf", "mangal.ttf"]
    } else {
        &["segoeuib.ttf", "arialbd.ttf", "segoeui.ttf", "arial.ttf"]
    };
    let unix: &[&str] = if devanagari {
        &[
            "/usr/share/fonts/truetype/noto/NotoSansDevanagari-Bold.ttf",
            "/usr/share/fonts/truetype/lohit-devanagari/Lohit-Devanagari.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        ]
    } else {
        &[
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
            "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
            "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        ]
    };
    windows
        .iter()
        .map(|f| windir.join(f))
        .chain(unix.iter().map(PathBuf::from))
        .find(|p| p.is_file())
}

/// Writes each title that appears in this segment to its own text file (so
/// no text ever needs escaping) and copies the font beside it.
fn title_files(
    p: &Project,
    piece: &Piece,
    dir: &Path,
    index: usize,
) -> Result<Vec<TitleFile>, String> {
    let mut out = Vec::new();
    for (k, t) in p.titles.iter().enumerate() {
        if t.start + t.duration <= piece.start + 1e-4 || t.start >= piece.start + piece.len - 1e-4 {
            continue;
        }
        let dev = has_devanagari(&t.text);
        let font = find_font(dev).ok_or(
            "No font for titles was found. Set EDITNOVA_FONT to a .ttf file and try again.",
        )?;
        let font_ext = font
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("ttf")
            .to_lowercase();
        let font_file = format!("font-{}.{font_ext}", if dev { "dev" } else { "latin" });
        if !dir.join(&font_file).is_file() {
            std::fs::copy(&font, dir.join(&font_file)).map_err(|e| e.to_string())?;
        }
        let text_file = format!("title-{index}-{k}.txt");
        std::fs::write(dir.join(&text_file), t.text.as_bytes()).map_err(|e| e.to_string())?;
        out.push(TitleFile {
            title: t.clone(),
            text_file,
            font_file,
        });
    }
    Ok(out)
}

pub fn drawtext(p: &Project, seg_start: f64, tf: &TitleFile) -> String {
    let t = &tf.title;
    let size = (p.height as f64 * t.size.fraction()).round().max(8.0);
    let s = t.start - seg_start;
    let e = s + t.duration;
    let f = (t.duration / 3.0).min(0.3);
    let y = match t.placement {
        Placement::Top => "h*0.08".to_string(),
        Placement::Center => "(h-text_h)/2".to_string(),
        Placement::Bottom => "h*0.92-text_h".to_string(),
    };
    let look = if t.backdrop {
        format!(
            ":box=1:boxcolor=black@0.55:boxborderw={}",
            (size * 0.35).round()
        )
    } else {
        ":shadowcolor=black@0.7:shadowx=2:shadowy=2".to_string()
    };
    format!(
        "drawtext=fontfile={font}:textfile={text}:expansion=none:fontsize={size}:fontcolor=0x{color}:x=(w-text_w)/2:y={y}{look}:alpha='if(lt(t,{s}+{f}),max(0,(t-{s})/{f}),if(gt(t,{e}-{f}),max(0,({e}-t)/{f}),1))':enable='between(t,{s},{e})'",
        font = tf.font_file,
        text = tf.text_file,
        color = &t.color[1..],
        s = num(s),
        e = num(e),
        f = num(f),
    )
}

/// Builds the complete filter graph for one piece. Each part contributes a
/// video input and, when its file has no sound, a generated silent input.
/// Produces `[v]` (picture with titles) and `[a]` (sound mixed with music).
pub fn piece_graph(
    p: &Project,
    piece: &Piece,
    titles: &[TitleFile],
    slices: &[MusicSlice],
) -> String {
    let mut g = Vec::new();
    let mut input = 0usize;
    for (k, part) in piece.parts.iter().enumerate() {
        let v = input;
        let a = if part.has_audio { v } else { v + 1 };
        input = a + 1;
        g.push(format!("[{v}:V:0]{}[pv{k}]", part_video(p, part, piece.len)));
        g.push(format!("[{a}:a:0]{}[pa{k}]", part_audio(part)));
    }
    let base = match piece.blend {
        None => {
            g.push("[pa0]anull[ca]".into());
            "pv0"
        }
        Some(kind) => {
            let d = frame_count(piece.len, p.fps) as f64 / p.fps as f64;
            g.push(format!(
                "[pv0][pv1]xfade=transition={}:duration={d:.6}:offset=0,format=yuv420p[vx]",
                kind.xfade()
            ));
            g.push(format!(
                "[pa0]afade=t=out:st=0:d={d:.6}[x0];[pa1]afade=t=in:st=0:d={d:.6}[x1];[x0][x1]amix=inputs=2:duration=longest:normalize=0[ca]"
            ));
            "vx"
        }
    };
    let mut v = String::new();
    for tf in titles {
        if !v.is_empty() {
            v.push(',');
        }
        v.push_str(&drawtext(p, piece.start, tf));
    }
    if v.is_empty() {
        v.push_str("null");
    }
    g.push(format!("[{base}]{v}[v]"));
    if slices.is_empty() {
        g.push("[ca]anull[a]".into());
        return g.join(";");
    }
    for (k, sl) in slices.iter().enumerate() {
        let delay = (sl.local_start * 1000.0).round() as u64;
        g.push(format!(
            "[{inp}:a:0]asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,volume='{gain}':eval=frame,adelay={delay}|{delay}[m{k}]",
            inp = input + k,
            gain = music_gain(sl),
        ));
    }
    if slices.len() == 1 {
        g.push("[m0]anull[mm]".into());
    } else {
        let labels: String = (0..slices.len()).map(|k| format!("[m{k}]")).collect();
        g.push(format!(
            "{labels}amix=inputs={}:duration=longest:normalize=0[mm]",
            slices.len()
        ));
    }
    let speech = piece
        .parts
        .iter()
        .any(|pt| pt.has_audio && pt.clip.volume > 0.0);
    if p.duck_music && speech {
        g.push("[ca]asplit=2[cb][sc];[mm][sc]sidechaincompress=threshold=0.02:ratio=8:attack=20:release=400[md];[cb][md]amix=inputs=2:duration=first:normalize=0[a]".into());
    } else {
        g.push("[ca][mm]amix=inputs=2:duration=first:normalize=0[a]".into());
    }
    g.join(";")
}

pub fn render(
    p: &Project,
    target: &Path,
    cancel: &AtomicBool,
    progress: impl Fn(f64, String),
) -> Result<(), String> {
    render_with(p, target, ExportOptions::default(), cancel, progress).map(|_| ())
}

/// Renders the timeline to a new MP4 at `target`. Returns a short description
/// of the encoder that was used.
pub fn render_with(
    p: &Project,
    target: &Path,
    opts: ExportOptions,
    cancel: &AtomicBool,
    progress: impl Fn(f64, String),
) -> Result<String, String> {
    p.validate()?;
    if p.clips.is_empty() {
        return Err("The timeline is empty. Add a clip before exporting.".into());
    }
    if target.exists() {
        return Err("Choose a new output filename; existing files are never overwritten".into());
    }
    let parent = target.parent().ok_or("Output directory missing")?;
    let dir = tempfile::Builder::new()
        .prefix(".editnova-render-")
        .tempdir_in(parent)
        .map_err(|e| format!("Cannot write to the chosen folder: {e}"))?;
    let hardware = opts.hardware && hardware_encoder_works();
    let (encoder, label) = if hardware {
        (nvenc_args(opts.quality), "NVIDIA NVENC H.264")
    } else {
        (x264_args(opts.quality), "CPU H.264 (x264)")
    };
    let audio_rate = if matches!(opts.quality, Quality::Small | Quality::Preview) {
        "128k"
    } else {
        "192k"
    };
    let total = p.duration().max(1e-6);
    let mut list =
        std::fs::File::create(dir.path().join("segments.txt")).map_err(|e| e.to_string())?;
    let mut done = 0.0;
    let report = dir.path().join("progress.txt");
    // Check every source once, and trust what is on disk now for sound.
    let mut checked = p.clone();
    for c in &p.clips {
        let m = checked
            .media
            .iter_mut()
            .find(|m| m.id == c.media_id)
            .ok_or("Unknown clip media")?;
        let actual = probe(Path::new(&m.path))?;
        if c.out > actual.duration + 0.05 {
            return Err(format!(
                "{} is shorter than when it was added. Relink or re-trim it.",
                m.name
            ));
        }
        m.audio = actual.audio;
        m.path = actual.path;
    }
    let pieces = plan(&checked);
    let starts = checked.starts();
    for (i, piece) in pieces.iter().enumerate() {
        let len = piece.len;
        let clip_no = starts
            .iter()
            .rposition(|s| *s <= piece.start + 1e-6)
            .unwrap_or(0)
            + 1;
        let stage = if piece.blend.is_some() {
            format!("Rendering transition into clip {} of {}", clip_no, p.clips.len())
        } else {
            format!("Rendering clip {} of {}", clip_no, p.clips.len())
        };
        progress(0.9 * done / total, stage.clone());
        let output = dir.path().join(format!("seg{i}.mp4"));
        let _ = std::fs::remove_file(&report);
        let slices = music_slices(&checked, piece.start, len);
        let mut c = command("ffmpeg");
        c.current_dir(dir.path()).args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-nostdin",
            "-nostats",
            "-y",
            "-protocol_whitelist",
            "file,pipe",
            "-progress",
        ])
        .arg(&report);
        for part in &piece.parts {
            c.args(["-ss", &format!("{:.6}", part.source_offset()), "-i"])
                .arg(&part.path);
            if !part.has_audio {
                c.args([
                    "-f",
                    "lavfi",
                    "-i",
                    "anullsrc=channel_layout=stereo:sample_rate=48000",
                ]);
            }
        }
        for sl in &slices {
            c.args([
                "-ss",
                &format!("{:.6}", sl.source_offset),
                "-t",
                &format!("{:.6}", sl.duration),
                "-i",
            ])
            .arg(&sl.path);
        }
        let titles = title_files(&checked, piece, dir.path(), i)?;
        let graph = piece_graph(&checked, piece, &titles, &slices);
        c.args([
            "-filter_complex",
            &graph,
            "-map",
            "[v]",
            "-map",
            "[a]",
            "-t",
            &format!("{len:.6}"),
            // An exact frame count keeps every segment, and so the joined
            // video, precisely as long as the timeline says.
            "-frames:v",
            &frame_count(len, p.fps).to_string(),
            "-pix_fmt",
            "yuv420p",
        ])
        .args(&encoder)
        .args([
            "-c:a",
            "aac",
            "-b:a",
            audio_rate,
            "-ar",
            "48000",
            "-ac",
            "2",
            "-map_metadata",
            "-1",
            "-movflags",
            "+faststart",
        ])
        .arg(&output);
        run_with_progress(c, cancel, Some(&report), &mut |t| {
            progress(0.9 * (done + t.min(len)) / total, stage.clone())
        })?;
        writeln!(list, "file 'seg{i}.mp4'").map_err(|e| e.to_string())?;
        done += len;
    }
    drop(list);
    progress(0.9, "Joining clips".into());
    let result = dir.path().join("result.mp4");
    let mut c = command("ffmpeg");
    c.current_dir(dir.path()).args([
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-y",
        "-f",
        "concat",
        "-safe",
        "1",
        "-i",
        "segments.txt",
        "-c",
        "copy",
        "-movflags",
        "+faststart",
        "result.mp4",
    ]);
    run(c, cancel)?;
    let check = probe(&result)?;
    if (check.duration - p.duration()).abs() > 0.2 + pieces.len() as f64 * 2.0 / p.fps as f64 {
        return Err("The rendered duration does not match the timeline".into());
    }
    let stage = "Checking the finished video".to_string();
    progress(0.92, stage.clone());
    let _ = std::fs::remove_file(&report);
    let mut c = command("ffmpeg");
    c.args(["-v", "error", "-xerror", "-nostdin", "-nostats", "-progress"])
        .arg(&report)
        .arg("-i")
        .arg(&result)
        .args(["-f", "null", "-"]);
    run_with_progress(c, cancel, Some(&report), &mut |t| {
        progress(0.92 + 0.07 * (t / total).min(1.0), stage.clone())
    })?;
    let mut tmp = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    let mut input = std::fs::File::open(result).map_err(|e| e.to_string())?;
    std::io::copy(&mut input, &mut tmp).map_err(|e| e.to_string())?;
    tmp.as_file().sync_all().map_err(|e| e.to_string())?;
    if cancel.load(Ordering::Relaxed) {
        return Err("Cancelled".into());
    }
    tmp.persist_noclobber(target).map_err(|e| e.to_string())?;
    progress(1.0, "Export complete".into());
    Ok(label.into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn simplifies_verbatim_drive_paths_only() {
        assert_eq!(
            simplify(PathBuf::from(r"\\?\C:\Videos\a.mp4")),
            PathBuf::from(r"C:\Videos\a.mp4")
        );
        let unc = PathBuf::from(r"\\?\UNC\server\share\a.mp4");
        assert_eq!(simplify(unc.clone()), unc);
        assert_eq!(simplify(PathBuf::from("/tmp/a.mp4")), PathBuf::from("/tmp/a.mp4"));
    }
    #[test]
    fn music_slices_cover_only_the_overlap() {
        let mut p = Project::new("m", 320, 180, 30);
        p.media.push(Media {
            id: "s".into(),
            path: "song.mp3".into(),
            name: "song.mp3".into(),
            duration: 60.0,
            width: 0,
            height: 0,
            audio: true,
            kind: MediaKind::Audio,
        });
        p.music.push(Music {
            id: "mu".into(),
            media_id: "s".into(),
            start: 2.0,
            r#in: 10.0,
            out: 16.0,
            volume: 0.5,
            fade_in: 1.0,
            fade_out: 0.0,
        });
        assert!(music_slices(&p, 0.0, 2.0).is_empty());
        let a = &music_slices(&p, 0.0, 3.0)[0];
        assert_eq!((a.source_offset, a.duration, a.local_start), (10.0, 1.0, 2.0));
        let b = &music_slices(&p, 3.0, 10.0)[0];
        assert_eq!((b.source_offset, b.duration, b.local_start), (11.0, 5.0, 0.0));
        assert_eq!(
            music_gain(b),
            "0.5000*clip(min(1,((3.0000+t)-2.0000)/1.0000),0,1)"
        );
    }
    #[test]
    fn devanagari_is_detected() {
        assert!(has_devanagari("नमस्ते"));
        assert!(!has_devanagari("Hello"));
    }
    #[test]
    fn frame_count_rounds_to_whole_frames() {
        assert_eq!(frame_count(0.5, 30), 15);
        assert_eq!(frame_count(1.0 / 30.0, 30), 1);
        assert_eq!(frame_count(0.0001, 24), 1);
        assert_eq!(frame_count(2.99, 25), 75);
    }
    #[test]
    fn parses_latest_progress_position() {
        let r = "frame=10\nout_time_us=1000000\nprogress=continue\nframe=20\nout_time_us=2500000\nout_time_ms=2500000\nprogress=continue\n";
        assert_eq!(parse_progress(r), Some(2.5));
        assert_eq!(parse_progress("out_time_us=N/A\n"), None);
        assert_eq!(parse_progress(""), None);
    }
    fn part(local_from: f64) -> Part {
        let mut c = Clip::new("c", "m", 1.0, 5.0);
        c.volume = 0.5;
        c.fade_in = 1.0;
        c.fade_out = 0.5;
        Part {
            clip: c,
            path: "a.mp4".into(),
            has_audio: true,
            local_from,
        }
    }
    #[test]
    fn part_chains_place_fades_in_local_time() {
        let af = part_audio(&part(0.0));
        assert!(af.contains("volume=0.5000"));
        assert!(af.contains("afade=t=in:st=0:d=1.000"));
        assert!(af.contains("afade=t=out:st=3.500:d=0.500"));
        let later = part_audio(&part(2.0));
        assert!(!later.contains("afade=t=in"));
        assert!(later.contains("afade=t=out:st=1.500:d=0.500"));
        let mut plain = part(0.0);
        plain.clip.volume = 1.0;
        plain.clip.fade_in = 0.0;
        plain.clip.fade_out = 0.0;
        let af = part_audio(&plain);
        assert!(!af.contains("volume") && !af.contains("afade") && !af.contains("atempo"));
    }
    #[test]
    fn atempo_chains_cover_quarter_to_four_times() {
        assert_eq!(atempo(1.0), "");
        assert_eq!(atempo(1.5), "atempo=1.500000");
        assert_eq!(atempo(4.0), "atempo=2,atempo=2.000000");
        assert_eq!(atempo(0.25), "atempo=0.5,atempo=0.500000");
    }
    #[test]
    fn plan_splits_clips_around_transitions() {
        use crate::model::Blend;
        let mut p = Project::new("plan", 320, 180, 25);
        p.media.push(Media {
            id: "m".into(),
            path: "a.mp4".into(),
            name: "a.mp4".into(),
            duration: 30.0,
            width: 320,
            height: 180,
            audio: true,
            kind: MediaKind::Video,
        });
        p.clips = vec![
            Clip::new("a", "m", 0.0, 4.0),
            Clip::new("b", "m", 10.0, 14.0),
            Clip::new("c", "m", 20.0, 22.0),
        ];
        p.clips[1].speed = 2.0; // 2 s on the timeline
        p.clips[1].blend = Some(Blend { kind: BlendKind::Dissolve, duration: 1.0 });
        p.clips[2].blend = Some(Blend { kind: BlendKind::Slide, duration: 1.0 });
        p.validate().unwrap();
        let pieces = plan(&p);
        let shape: Vec<(f64, f64, bool)> = pieces
            .iter()
            .map(|x| (x.start, x.len, x.blend.is_some()))
            .collect();
        // a[0,3) a→b[3,4) b has no middle (2 s minus 1 + 1) b→c[4,5) c[5,6)
        assert_eq!(
            shape,
            vec![(0.0, 3.0, false), (3.0, 1.0, true), (4.0, 1.0, true), (5.0, 1.0, false)]
        );
        let ab = &pieces[1];
        assert_eq!(ab.parts[0].source_offset(), 3.0);
        assert_eq!(ab.parts[1].source_offset(), 10.0);
        let bc = &pieces[2];
        assert_eq!(bc.parts[0].source_offset(), 12.0, "b is 2x speed: 1 s local = 2 s source");
        let total: f64 = pieces.iter().map(|x| x.len).sum();
        assert!((total - p.duration()).abs() < 1e-9);
    }
}
