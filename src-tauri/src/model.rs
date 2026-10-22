use serde::{Deserialize, Serialize};

/// Project format version written by this build. Version 1 files (EditNova
/// 0.1) load and are upgraded in memory; they contain no audio/fade fields.
pub const CURRENT_VERSION: u32 = 2;
pub const MAX_FADE: f64 = 10.0;
pub const MAX_VOLUME: f64 = 2.0;

fn one() -> f64 {
    1.0
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Media {
    pub id: String,
    pub path: String,
    pub name: String,
    pub duration: f64,
    pub width: u32,
    pub height: u32,
    pub audio: bool,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Clip {
    pub id: String,
    pub media_id: String,
    pub r#in: f64,
    pub out: f64,
    /// Linear gain, 0 (muted) to 2 (+6 dB).
    #[serde(default = "one")]
    pub volume: f64,
    /// Fade from/to black and silence, in seconds.
    #[serde(default)]
    pub fade_in: f64,
    #[serde(default)]
    pub fade_out: f64,
}

impl Clip {
    pub fn new(id: &str, media_id: &str, r#in: f64, out: f64) -> Self {
        Clip {
            id: id.into(),
            media_id: media_id.into(),
            r#in,
            out,
            volume: 1.0,
            fade_in: 0.0,
            fade_out: 0.0,
        }
    }
    pub fn len(&self) -> f64 {
        self.out - self.r#in
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Project {
    pub version: u32,
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub media: Vec<Media>,
    pub clips: Vec<Clip>,
}

impl Project {
    pub fn duration(&self) -> f64 {
        self.clips.iter().map(|c| c.len()).sum()
    }
    /// Upgrade an older supported format in place. Unknown versions are
    /// rejected by `validate`, never guessed.
    pub fn migrate(&mut self) {
        if self.version == 1 {
            self.version = CURRENT_VERSION;
        }
    }
    pub fn validate(&self) -> Result<(), String> {
        if self.version != CURRENT_VERSION
            || self.name.len() > 256
            || self.name.is_empty()
            || ![24, 25, 30, 60].contains(&self.fps)
            || [self.width, self.height]
                .iter()
                .any(|n| *n < 16 || *n > 7680 || n % 2 != 0)
            || self.clips.len() > 1000
            || self.media.len() > 10000
        {
            return Err("Invalid project settings or unsupported project version".into());
        }
        let mut ids = std::collections::HashSet::new();
        for m in &self.media {
            if m.id.is_empty() || !ids.insert(&m.id) || !m.duration.is_finite() || m.duration <= 0.0
            {
                return Err("Invalid media record".into());
            }
        }
        let mut ids = std::collections::HashSet::new();
        for c in &self.clips {
            let m = self
                .media
                .iter()
                .find(|m| m.id == c.media_id)
                .ok_or("Missing media reference")?;
            if c.id.is_empty()
                || !ids.insert(&c.id)
                || !c.r#in.is_finite()
                || !c.out.is_finite()
                || c.r#in < 0.0
                || c.len() < 1.0 / self.fps as f64 - 1e-6
                || c.out > m.duration + 0.05
            {
                return Err("Invalid trim bounds".into());
            }
            if !c.volume.is_finite() || c.volume < 0.0 || c.volume > MAX_VOLUME {
                return Err("Clip volume must be between 0% and 200%".into());
            }
            if !c.fade_in.is_finite()
                || !c.fade_out.is_finite()
                || c.fade_in < 0.0
                || c.fade_out < 0.0
                || c.fade_in > MAX_FADE
                || c.fade_out > MAX_FADE
                || c.fade_in + c.fade_out > c.len() + 1e-6
            {
                return Err("Clip fades must fit inside the clip".into());
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn base() -> Project {
        Project {
            version: CURRENT_VERSION,
            name: "x".into(),
            width: 1920,
            height: 1080,
            fps: 30,
            media: vec![Media {
                id: "m".into(),
                path: "a.mp4".into(),
                name: "a.mp4".into(),
                duration: 10.0,
                width: 1920,
                height: 1080,
                audio: true,
            }],
            clips: vec![Clip::new("c", "m", 1.0, 5.0)],
        }
    }
    #[test]
    fn rejects_unknown_version() {
        let mut p = base();
        p.version = 99;
        p.migrate();
        assert!(p.validate().is_err());
    }
    #[test]
    fn migrates_version_one_without_audio_fields() {
        let json = r#"{"version":1,"name":"Old","width":1280,"height":720,"fps":25,
            "media":[{"id":"m","path":"a.mp4","name":"a.mp4","duration":4,"width":1280,"height":720,"audio":false}],
            "clips":[{"id":"c","mediaId":"m","in":0,"out":2}]}"#;
        let mut p: Project = serde_json::from_str(json).unwrap();
        p.migrate();
        p.validate().unwrap();
        assert_eq!(p.version, CURRENT_VERSION);
        assert_eq!(p.clips[0].volume, 1.0);
        assert_eq!(p.clips[0].fade_in, 0.0);
    }
    #[test]
    fn rejects_bad_volume_and_fades() {
        let mut p = base();
        p.clips[0].volume = 2.5;
        assert!(p.validate().is_err());
        let mut p = base();
        p.clips[0].fade_in = 3.0;
        p.clips[0].fade_out = 1.5;
        assert!(p.validate().is_err());
        let mut p = base();
        p.clips[0].fade_in = f64::NAN;
        assert!(p.validate().is_err());
        let mut p = base();
        p.clips[0].fade_in = 1.0;
        p.clips[0].fade_out = 1.0;
        p.clips[0].volume = 0.0;
        p.validate().unwrap();
    }
}
