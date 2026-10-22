use editnova_studio::{
    media,
    model::{self, Clip, Project},
};
use std::{path::Path, process::Command, sync::atomic::AtomicBool};
fn fixture(path: &Path, color: &str, audio: bool) {
    let mut c = Command::new("ffmpeg");
    c.args([
        "-v",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        &format!("color=c={color}:s=320x180:r=25:d=2"),
    ]);
    if audio {
        c.args([
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=2",
            "-c:a",
            "aac",
        ]);
    }
    assert!(c
        .args(["-c:v", "libx264", "-pix_fmt", "yuv420p", "-t", "2"])
        .arg(path)
        .status()
        .unwrap()
        .success());
}
#[test]
fn real_export_normalizes_audio_and_video_and_rejects_overwrite() {
    let d = tempfile::tempdir().unwrap();
    let a = d.path().join("कथा ; $clip.mp4");
    let b = d.path().join("blue.mp4");
    fixture(&a, "red", true);
    fixture(&b, "blue", false);
    let ma = media::probe(&a).unwrap();
    let mb = media::probe(&b).unwrap();
    assert!(ma.audio);
    assert!(!mb.audio);
    let p = Project {
        version: model::CURRENT_VERSION,
        name: "Integration".into(),
        width: 320,
        height: 180,
        fps: 30,
        clips: vec![
            Clip::new("a", &ma.id, 0.4, 1.4),
            Clip::new("b", &mb.id, 0.2, 1.2),
        ],
        media: vec![ma, mb],
    };
    let target = d.path().join("output.mp4");
    let cancel = AtomicBool::new(false);
    media::render(&p, &target, &cancel, |_, _| {}).unwrap();
    let out = media::probe(&target).unwrap();
    assert!((out.duration - 2.0).abs() < 0.15);
    assert!(out.audio);
    assert_eq!((out.width, out.height), (320, 180));
    let original = std::fs::read(&target).unwrap();
    assert!(media::render(&p, &target, &cancel, |_, _| {}).is_err());
    assert_eq!(original, std::fs::read(&target).unwrap());
    // Decode an RGB pixel from each clip: red then blue validates ordering and trim composition.
    for (t, channel) in [("0.5", 0usize), ("1.5", 2usize)] {
        let bytes = Command::new("ffmpeg")
            .args(["-v", "error", "-ss", t, "-i"])
            .arg(&target)
            .args([
                "-frames:v",
                "1",
                "-vf",
                "scale=1:1",
                "-f",
                "rawvideo",
                "-pix_fmt",
                "rgb24",
                "-",
            ])
            .output()
            .unwrap();
        assert!(bytes.status.success());
        assert!(bytes.stdout[channel] > 180);
    }
    let cancelled = d.path().join("cancelled.mp4");
    assert!(media::render(&p, &cancelled, &AtomicBool::new(true), |_, _| {}).is_err());
    assert!(!cancelled.exists());
    assert!(a.exists() && b.exists());
}
#[test]
fn invalid_files_fail() {
    assert!(media::probe(Path::new("/missing/editnova.mp4")).is_err());
    let f = tempfile::NamedTempFile::with_suffix(".txt").unwrap();
    assert!(media::probe(f.path()).is_err());
    let bad = tempfile::NamedTempFile::with_suffix(".mp4").unwrap();
    assert!(media::probe(bad.path()).is_err());
}
#[test]
fn repeated_cuts_keep_av_duration_aligned() {
    let d = tempfile::tempdir().unwrap();
    let source = d.path().join("av.mp4");
    fixture(&source, "green", true);
    let m = media::probe(&source).unwrap();
    let p = Project {
        version: model::CURRENT_VERSION,
        name: "Repeated cuts".into(),
        width: 320,
        height: 180,
        fps: 30,
        clips: (0..12)
            .map(|i| Clip::new(&i.to_string(), &m.id, 0.25, 0.75))
            .collect(),
        media: vec![m],
    };
    let out = d.path().join("cuts.mp4");
    media::render(&p, &out, &AtomicBool::new(false), |_, _| {}).unwrap();
    let j = Command::new("ffprobe")
        .args(["-v", "error", "-show_streams", "-of", "json"])
        .arg(&out)
        .output()
        .unwrap();
    let j: serde_json::Value = serde_json::from_slice(&j.stdout).unwrap();
    let durations: Vec<f64> = j["streams"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s["duration"].as_str().unwrap().parse().unwrap())
        .collect();
    assert!(
        (durations[0] - 6.0).abs() < 0.05,
        "Video duration {:?}",
        durations
    );
    assert!(
        (durations[1] - durations[0]).abs() < 0.05,
        "A/V drift {:?}",
        durations
    );
}

fn pixel(path: &Path, t: &str) -> Vec<u8> {
    let out = Command::new("ffmpeg")
        .args(["-v", "error", "-ss", t, "-i"])
        .arg(path)
        .args([
            "-frames:v", "1", "-vf", "scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
        ])
        .output()
        .unwrap();
    assert!(out.status.success());
    out.stdout
}

fn max_volume_db(path: &Path) -> f64 {
    let out = Command::new("ffmpeg")
        .args(["-hide_banner", "-nostats", "-i"])
        .arg(path)
        .args(["-map", "0:a:0", "-af", "volumedetect", "-f", "null", "-"])
        .output()
        .unwrap();
    let log = String::from_utf8_lossy(&out.stderr);
    let i = log.find("max_volume:").expect("volumedetect output");
    log[i + 11..]
        .trim_start()
        .split_whitespace()
        .next()
        .unwrap()
        .parse()
        .unwrap()
}

#[test]
fn fades_volume_and_progress_are_rendered() {
    let d = tempfile::tempdir().unwrap();
    let source = d.path().join("red.mp4");
    fixture(&source, "red", true);
    let m = media::probe(&source).unwrap();
    let mut faded = Clip::new("f", &m.id, 0.0, 2.0);
    faded.fade_in = 0.5;
    faded.fade_out = 0.5;
    let mut muted = Clip::new("m", &m.id, 0.0, 1.0);
    muted.volume = 0.0;
    let p = Project {
        version: model::CURRENT_VERSION,
        name: "Fades".into(),
        width: 320,
        height: 180,
        fps: 25,
        clips: vec![faded],
        media: vec![m.clone()],
    };
    let out = d.path().join("fades.mp4");
    let seen = std::sync::Mutex::new(Vec::<f64>::new());
    media::render(&p, &out, &AtomicBool::new(false), |f, _| {
        seen.lock().unwrap().push(f)
    })
    .unwrap();
    let seen = seen.into_inner().unwrap();
    assert!(seen.windows(2).all(|w| w[1] >= w[0] - 1e-9), "{seen:?}");
    assert_eq!(*seen.last().unwrap(), 1.0);
    assert!(pixel(&out, "0.02")[0] < 60, "fade-in starts dark");
    assert!(pixel(&out, "1.0")[0] > 180, "middle is full red");
    assert!(pixel(&out, "1.97")[0] < 90, "fade-out ends dark");

    let p = Project {
        clips: vec![muted],
        name: "Muted".into(),
        ..p
    };
    let out = d.path().join("muted.mp4");
    media::render(&p, &out, &AtomicBool::new(false), |_, _| {}).unwrap();
    assert!(max_volume_db(&out) < -60.0);
    assert!(max_volume_db(&source) > -20.0);
}

#[test]
fn thumbnail_is_created_and_reused() {
    let d = tempfile::tempdir().unwrap();
    let source = d.path().join("green.mp4");
    fixture(&source, "green", false);
    let m = media::probe(&source).unwrap();
    let cache = d.path().join("thumbs");
    let first = media::thumbnail(&m, &cache).unwrap();
    assert!(first.is_file());
    let modified = std::fs::metadata(&first).unwrap().modified().unwrap();
    let second = media::thumbnail(&m, &cache).unwrap();
    assert_eq!(first, second);
    assert_eq!(modified, std::fs::metadata(&second).unwrap().modified().unwrap());
}
