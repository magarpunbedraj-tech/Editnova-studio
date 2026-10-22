use serde::{Deserialize, Serialize};

/// Project format version written by this build. Older files load and are
/// upgraded in memory: version 1 (EditNova 0.1) has no audio/fade fields,
/// version 2 (EditNova 1.0) has no titles or music, version 3 (EditNova 1.1)
/// has no speed or transitions.
pub const CURRENT_VERSION: u32 = 4;
pub const MIN_SPEED: f64 = 0.25;
pub const MAX_SPEED: f64 = 4.0;
pub const MAX_BLEND: f64 = 5.0;
pub const MAX_TITLE_CHARS: usize = 80;
pub const MAX_TIMELINE: f64 = 36_000.0;
pub const MAX_FADE: f64 = 10.0;
pub const MAX_VOLUME: f64 = 2.0;

fn one() -> f64 {
    1.0
}

#[derive(Clone, Copy, PartialEq, Eq, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MediaKind {
    #[default]
    Video,
    Audio,
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
    #[serde(default)]
    pub kind: MediaKind,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Placement {
    Top,
    Center,
    Bottom,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TextSize {
    Small,
    Medium,
    Large,
}

impl TextSize {
    /// Text height as a fraction of the frame height. The editor preview uses
    /// the same numbers.
    pub fn fraction(self) -> f64 {
        match self {
            TextSize::Small => 0.045,
            TextSize::Medium => 0.07,
            TextSize::Large => 0.11,
        }
    }
}

/// On-screen text placed on the timeline independently of clips.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Title {
    pub id: String,
    pub text: String,
    /// Timeline time in seconds.
    pub start: f64,
    pub duration: f64,
    pub placement: Placement,
    pub size: TextSize,
    /// `#rrggbb`
    pub color: String,
    /// Draw a translucent dark box behind the text.
    pub backdrop: bool,
}

/// A stretch of a sound file on the music track.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Music {
    pub id: String,
    pub media_id: String,
    /// Timeline time in seconds where this music starts.
    pub start: f64,
    pub r#in: f64,
    pub out: f64,
    pub volume: f64,
    pub fade_in: f64,
    pub fade_out: f64,
}

impl Music {
    pub fn len(&self) -> f64 {
        self.out - self.r#in
    }
    pub fn end(&self) -> f64 {
        self.start + self.len()
    }
}

pub fn valid_color(c: &str) -> bool {
    c.len() == 7 && c.starts_with('#') && c[1..].chars().all(|x| x.is_ascii_hexdigit())
}

/// How one clip turns into the next.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BlendKind {
    /// Cross-dissolve.
    Dissolve,
    /// Dip to black and back.
    Dip,
    /// The next clip wipes in from the right.
    Wipe,
    /// The next clip slides in, pushing the current one out.
    Slide,
}

impl BlendKind {
    /// The FFmpeg `xfade` transition name.
    pub fn xfade(self) -> &'static str {
        match self {
            BlendKind::Dissolve => "fade",
            BlendKind::Dip => "fadeblack",
            BlendKind::Wipe => "wipeleft",
            BlendKind::Slide => "slideleft",
        }
    }
}

/// A transition from the previous clip into this one. Both clips overlap on
/// the timeline for `duration` seconds.
#[derive(Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Blend {
    pub kind: BlendKind,
    pub duration: f64,
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
    /// Playback speed: 0.25 (slow motion) to 4 (fast forward).
    #[serde(default = "one")]
    pub speed: f64,
    /// Transition from the previous clip. Never set on the first clip.
    #[serde(default)]
    pub blend: Option<Blend>,
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
            speed: 1.0,
            blend: None,
        }
    }
    /// Seconds of source footage used.
    pub fn source_len(&self) -> f64 {
        self.out - self.r#in
    }
    /// Seconds the clip lasts on the timeline, after its speed change.
    pub fn len(&self) -> f64 {
        self.source_len() / self.speed
    }
    /// Seconds this clip overlaps the previous one.
    pub fn blend_len(&self) -> f64 {
        self.blend.map(|b| b.duration).unwrap_or(0.0)
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
    #[serde(default)]
    pub titles: Vec<Title>,
    #[serde(default)]
    pub music: Vec<Music>,
    /// Lower the music automatically while clips have sound.
    #[serde(default, rename = "duckMusic")]
    pub duck_music: bool,
}

impl Project {
    pub fn new(name: &str, width: u32, height: u32, fps: u32) -> Self {
        Project {
            version: CURRENT_VERSION,
            name: name.into(),
            width,
            height,
            fps,
            media: vec![],
            clips: vec![],
            titles: vec![],
            music: vec![],
            duck_music: false,
        }
    }
    /// Timeline length: every clip's length minus the transition overlaps.
    pub fn duration(&self) -> f64 {
        self.clips.iter().map(|c| c.len() - c.blend_len()).sum()
    }
    /// Timeline start time of each clip.
    pub fn starts(&self) -> Vec<f64> {
        let mut t = 0.0;
        let mut prev = 0.0;
        self.clips
            .iter()
            .map(|c| {
                t += prev - c.blend_len();
                prev = c.len();
                t
            })
            .collect()
    }
    /// Upgrade an older supported format in place. Unknown versions are
    /// rejected by `validate`, never guessed.
    pub fn migrate(&mut self) {
        if (1..CURRENT_VERSION).contains(&self.version) {
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
            || self.titles.len() > 500
            || self.music.len() > 500
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
                || !c.speed.is_finite()
                || c.speed < MIN_SPEED
                || c.speed > MAX_SPEED
                || c.len() < 1.0 / self.fps as f64 - 1e-6
                || c.out > m.duration + 0.05
            {
                return Err("Invalid trim bounds".into());
            }
            if !c.volume.is_finite() || c.volume < 0.0 || c.volume > MAX_VOLUME {
                return Err("Clip volume must be between 0% and 200%".into());
            }
            if m.kind != MediaKind::Video {
                return Err("Only videos can go on the video track".into());
            }
            fades_ok(c.fade_in, c.fade_out, c.len())?;
        }
        for (i, c) in self.clips.iter().enumerate() {
            let Some(b) = c.blend else { continue };
            if i == 0 {
                return Err("The first clip cannot have a transition".into());
            }
            let prev = &self.clips[i - 1];
            if !b.duration.is_finite()
                || b.duration < 0.1
                || b.duration > MAX_BLEND
                || b.duration > prev.len() / 2.0 + 1e-6
                || b.duration > c.len() / 2.0 + 1e-6
            {
                return Err(
                    "A transition can last at most half of the shorter clip, up to 5 s".into(),
                );
            }
            if c.fade_in > 0.0 || prev.fade_out > 0.0 {
                return Err("Remove the fade on clips joined by a transition".into());
            }
        }
        for (i, c) in self.clips.iter().enumerate() {
            let tail = self.clips.get(i + 1).map(|n| n.blend_len()).unwrap_or(0.0);
            if c.fade_in + c.fade_out + c.blend_len() + tail > c.len() + 1e-6 {
                return Err("Fades and transitions on this clip overlap. Shorten one.".into());
            }
        }
        let mut ids = std::collections::HashSet::new();
        for t in &self.titles {
            let chars = t.text.chars().count();
            if t.id.is_empty()
                || !ids.insert(&t.id)
                || chars == 0
                || chars > MAX_TITLE_CHARS
                || t.text.contains(['\n', '\r'])
                || !t.start.is_finite()
                || !t.duration.is_finite()
                || t.start < 0.0
                || t.start > MAX_TIMELINE
                || t.duration < 0.25
                || t.duration > 3600.0
                || !valid_color(&t.color)
            {
                return Err("Each title needs 1 to 80 characters on one line, a start time and at least 0.25 s on screen".into());
            }
        }
        for mu in &self.music {
            let m = self
                .media
                .iter()
                .find(|m| m.id == mu.media_id)
                .ok_or("Missing music reference")?;
            if mu.id.is_empty()
                || !ids.insert(&mu.id)
                || !m.audio
                || ![mu.start, mu.r#in, mu.out].iter().all(|v| v.is_finite())
                || mu.start < 0.0
                || mu.start > MAX_TIMELINE
                || mu.r#in < 0.0
                || mu.len() < 0.1
                || mu.out > m.duration + 0.05
            {
                return Err("Music must use a file with sound and stay inside it".into());
            }
            if !mu.volume.is_finite() || mu.volume < 0.0 || mu.volume > MAX_VOLUME {
                return Err("Music volume must be between 0% and 200%".into());
            }
            fades_ok(mu.fade_in, mu.fade_out, mu.len())?;
        }
        Ok(())
    }
}

fn fades_ok(fade_in: f64, fade_out: f64, len: f64) -> Result<(), String> {
    if !fade_in.is_finite()
        || !fade_out.is_finite()
        || fade_in < 0.0
        || fade_out < 0.0
        || fade_in > MAX_FADE
        || fade_out > MAX_FADE
        || fade_in + fade_out > len + 1e-6
    {
        return Err("Fades must fit inside the clip".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn base() -> Project {
        let mut p = Project::new("x", 1920, 1080, 30);
        p.media.push(Media {
            id: "m".into(),
            path: "a.mp4".into(),
            name: "a.mp4".into(),
            duration: 10.0,
            width: 1920,
            height: 1080,
            audio: true,
            kind: MediaKind::Video,
        });
        p.clips.push(Clip::new("c", "m", 1.0, 5.0));
        p
    }
    fn title() -> Title {
        Title {
            id: "t".into(),
            text: "नमस्ते Pokhara".into(),
            start: 0.5,
            duration: 2.0,
            placement: Placement::Bottom,
            size: TextSize::Medium,
            color: "#ffffff".into(),
            backdrop: true,
        }
    }
    fn song() -> Music {
        Music {
            id: "s".into(),
            media_id: "song".into(),
            start: 1.0,
            r#in: 0.0,
            out: 3.0,
            volume: 0.5,
            fade_in: 1.0,
            fade_out: 1.0,
        }
    }
    #[test]
    fn titles_and_music_validate() {
        let mut p = base();
        p.titles.push(title());
        p.media.push(Media {
            id: "song".into(),
            path: "a.mp3".into(),
            name: "a.mp3".into(),
            duration: 5.0,
            width: 0,
            height: 0,
            audio: true,
            kind: MediaKind::Audio,
        });
        p.music.push(song());
        p.validate().unwrap();
        let mut q = p.clone();
        q.titles[0].text = "two\nlines".into();
        assert!(q.validate().is_err());
        let mut q = p.clone();
        q.titles[0].color = "white".into();
        assert!(q.validate().is_err());
        let mut q = p.clone();
        q.music[0].out = 9.0;
        assert!(q.validate().is_err());
        let mut q = p.clone();
        q.clips[0].media_id = "song".into();
        assert!(q.validate().is_err(), "audio cannot sit on the video track");
        let mut q = p.clone();
        q.music[0].id = "t".into();
        assert!(q.validate().is_err(), "ids are unique across titles and music");
    }
    #[test]
    fn speed_and_transitions_shape_the_timeline() {
        let mut p = base();
        p.media[0].duration = 30.0;
        p.clips = vec![
            Clip::new("a", "m", 0.0, 8.0),
            Clip::new("b", "m", 0.0, 6.0),
            Clip::new("c", "m", 0.0, 4.0),
        ];
        p.clips[1].speed = 2.0; // 3 s on the timeline
        p.clips[1].blend = Some(Blend {
            kind: BlendKind::Dissolve,
            duration: 1.0,
        });
        p.clips[2].blend = Some(Blend {
            kind: BlendKind::Wipe,
            duration: 1.5,
        });
        p.validate().unwrap();
        assert_eq!(p.starts(), vec![0.0, 7.0, 8.5]);
        assert!((p.duration() - 12.5).abs() < 1e-9);
        let mut q = p.clone();
        q.clips[0].blend = q.clips[1].blend;
        assert!(q.validate().is_err(), "first clip cannot blend");
        let mut q = p.clone();
        q.clips[2].blend.as_mut().unwrap().duration = 1.6;
        assert!(q.validate().is_err(), "longer than half of a 3 s clip");
        let mut q = p.clone();
        q.clips[1].fade_out = 0.5;
        assert!(q.validate().is_err(), "fade on a blended edge");
        let mut q = p.clone();
        q.clips[0].speed = 5.0;
        assert!(q.validate().is_err());
    }
    #[test]
    fn version_two_upgrades_without_titles() {
        let json = r#"{"version":2,"name":"V2","width":1280,"height":720,"fps":30,"media":[],"clips":[]}"#;
        let mut p: Project = serde_json::from_str(json).unwrap();
        p.migrate();
        p.validate().unwrap();
        assert!(p.titles.is_empty() && p.music.is_empty() && !p.duck_music);
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
