use crate::model::{Media, Project};
use std::{
    hash::{Hash, Hasher},
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant},
};

pub const VIDEO_EXTENSIONS: [&str; 6] = ["mp4", "mov", "mkv", "webm", "avi", "m4v"];

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
    if !VIDEO_EXTENSIONS.contains(&ext.as_str()) {
        return Err(format!(
            "{} is not a supported video. EditNova opens MP4, MOV, MKV, WebM, AVI and M4V files.",
            path.file_name().unwrap_or_default().to_string_lossy()
        ));
    }
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
                    "{} could not be read as video. {}",
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
    let v = streams
        .iter()
        .find(|v| v["codec_type"] == "video" && v["disposition"]["attached_pic"] != 1)
        .ok_or("This file has no video picture")?;
    let duration = j["format"]["duration"]
        .as_str()
        .and_then(|s| s.parse::<f64>().ok())
        .filter(|v| v.is_finite() && *v > 0.0)
        .ok_or("This video has no readable duration")?;
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
        name: path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into(),
        duration,
        width,
        height,
        audio: streams.iter().any(|v| v["codec_type"] == "audio"),
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
    let target = cache_dir.join(format!("{}.jpg", file_key(Path::new(&m.path))?));
    if target
        .metadata()
        .map(|x| x.is_file() && x.len() > 0)
        .unwrap_or(false)
    {
        return Ok(target);
    }
    let at = (m.duration * 0.1).min(3.0);
    let tmp = cache_dir.join(format!("{}.part.jpg", uuid::Uuid::new_v4()));
    let mut c = command("ffmpeg");
    c.args([
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-y",
        "-protocol_whitelist",
        "file,pipe",
        "-ss",
        &format!("{at:.3}"),
        "-i",
    ])
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
    ])
    .arg(&tmp);
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

pub fn video_filter(p: &Project, len: f64, fade_in: f64, fade_out: f64) -> String {
    let mut vf = format!(
        "setpts=PTS-STARTPTS,scale={w}:{h}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps={f},tpad=stop_mode=clone:stop_duration=1,format=yuv420p",
        w = p.width,
        h = p.height,
        f = p.fps
    );
    if fade_in > 0.0 {
        vf.push_str(&format!(",fade=t=in:st=0:d={fade_in:.3}"));
    }
    if fade_out > 0.0 {
        vf.push_str(&format!(
            ",fade=t=out:st={:.3}:d={fade_out:.3}",
            (len - fade_out).max(0.0)
        ));
    }
    vf
}

pub fn audio_filter(volume: f64, len: f64, fade_in: f64, fade_out: f64) -> String {
    let mut af = String::from("aresample=48000:async=1:first_pts=0");
    if (volume - 1.0).abs() > 1e-6 {
        af.push_str(&format!(",volume={volume:.4}"));
    }
    af.push_str(",apad");
    if fade_in > 0.0 {
        af.push_str(&format!(",afade=t=in:st=0:d={fade_in:.3}"));
    }
    if fade_out > 0.0 {
        af.push_str(&format!(
            ",afade=t=out:st={:.3}:d={fade_out:.3}",
            (len - fade_out).max(0.0)
        ));
    }
    af
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
    for (i, clip) in p.clips.iter().enumerate() {
        let m = p
            .media
            .iter()
            .find(|m| m.id == clip.media_id)
            .ok_or("Unknown clip media")?;
        let actual = probe(Path::new(&m.path))?;
        if clip.out > actual.duration + 0.05 {
            return Err(format!(
                "{} is shorter than when it was added. Relink or re-trim it.",
                m.name
            ));
        }
        let len = clip.len();
        let stage = format!("Rendering clip {} of {}", i + 1, p.clips.len());
        progress(0.9 * done / total, stage.clone());
        let output = dir.path().join(format!("seg{i}.mp4"));
        let _ = std::fs::remove_file(&report);
        let mut c = command("ffmpeg");
        c.args([
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
        .arg(&report)
        .args(["-ss", &format!("{:.6}", clip.r#in), "-i"])
        .arg(&actual.path);
        if !actual.audio {
            c.args([
                "-f",
                "lavfi",
                "-i",
                "anullsrc=channel_layout=stereo:sample_rate=48000",
            ]);
        }
        c.args([
            "-map",
            "0:V:0",
            "-map",
            if actual.audio { "0:a:0" } else { "1:a:0" },
            "-t",
            &format!("{len:.6}"),
            // An exact frame count keeps every segment, and so the joined
            // video, precisely as long as the timeline says.
            "-frames:v",
            &frame_count(len, p.fps).to_string(),
            "-vf",
            &video_filter(p, len, clip.fade_in, clip.fade_out),
            "-af",
            &audio_filter(clip.volume, len, clip.fade_in, clip.fade_out),
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
    if (check.duration - p.duration()).abs() > 0.2 + p.clips.len() as f64 * 2.0 / p.fps as f64 {
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
    #[test]
    fn filters_include_volume_and_fades_only_when_needed() {
        let af = audio_filter(1.0, 4.0, 0.0, 0.0);
        assert!(!af.contains("volume") && !af.contains("afade"));
        let af = audio_filter(0.5, 4.0, 1.0, 0.5);
        assert!(af.contains("volume=0.5000"));
        assert!(af.contains("afade=t=in:st=0:d=1.000"));
        assert!(af.contains("afade=t=out:st=3.500:d=0.500"));
    }
}
