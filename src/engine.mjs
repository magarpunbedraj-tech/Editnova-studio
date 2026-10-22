// Pure timeline operations. Every function returns a new project and never
// mutates its input. Rules here mirror src-tauri/src/model.rs exactly.
export const VERSION = 3;
export const MAX_TITLE = 80;
export const COLORS = ["#ffffff", "#ffd84a", "#ff6b6b", "#7cf0c5", "#9fd0ff", "#111111"];
export const FPS = [24, 25, 30, 60];
export const MAX_FADE = 10;
export const MAX_VOLUME = 2;

export const fresh = () => ({
  version: VERSION,
  name: "Untitled film",
  width: 1920,
  height: 1080,
  fps: 30,
  media: [],
  clips: [],
  titles: [],
  music: [],
  duckMusic: true,
});

export const clipLength = (c) => c.out - c.in;
export const duration = (p) => p.clips.reduce((s, c) => s + clipLength(c), 0);

export function makeClip(id, media, a = 0, b = media.duration) {
  return { id, mediaId: media.id, in: a, out: b, volume: 1, fadeIn: 0, fadeOut: 0 };
}

/** Upgrades an older supported project (version 1 or 2) to the current format. */
export function migrate(p) {
  if (!p || typeof p !== "object") throw Error("Not an EditNova project");
  if (p.version !== 1 && p.version !== 2) return p;
  return {
    ...p,
    version: VERSION,
    clips: (p.clips || []).map((c) => ({ volume: 1, fadeIn: 0, fadeOut: 0, ...c })),
    titles: p.titles || [],
    music: p.music || [],
    duckMusic: p.duckMusic ?? false,
  };
}

const isAudio = (m) => m && m.kind === "audio";

export function locate(p, time) {
  let start = 0;
  for (let i = 0; i < p.clips.length; i++) {
    const c = p.clips[i],
      end = start + clipLength(c);
    if (time < end - 1e-6)
      return {
        clip: c,
        index: i,
        start,
        source: c.in + Math.max(0, time - start),
      };
    start = end;
  }
  return null;
}

/** Sequence start time of each clip, in timeline order. */
export function starts(p) {
  let t = 0;
  return p.clips.map((c) => {
    const s = t;
    t += clipLength(c);
    return s;
  });
}

export function validate(p) {
  if (p.version !== VERSION) throw Error("Unsupported project version");
  if (
    !p.name ||
    p.name.length > 256 ||
    !FPS.includes(p.fps) ||
    ![p.width, p.height].every(
      (n) => Number.isInteger(n) && n >= 16 && n <= 7680 && n % 2 === 0,
    )
  )
    throw Error("Invalid project settings");
  if (
    !Array.isArray(p.media) ||
    !Array.isArray(p.clips) ||
    p.clips.length > 1000 ||
    p.media.length > 10000
  )
    throw Error("Invalid project");
  const ids = new Set();
  for (const m of p.media) {
    if (
      !m.id ||
      ids.has(m.id) ||
      typeof m.path !== "string" ||
      !Number.isFinite(m.duration) ||
      m.duration <= 0
    )
      throw Error("Invalid media");
    ids.add(m.id);
  }
  const clips = new Set();
  for (const c of p.clips) {
    const m = p.media.find((m) => m.id === c.mediaId);
    if (
      !m ||
      clips.has(c.id) ||
      !c.id ||
      ![c.in, c.out].every(Number.isFinite) ||
      c.in < 0 ||
      c.out - c.in < 1 / p.fps - 1e-6 ||
      c.out > m.duration + 0.05
    )
      throw Error("Clip in and out points must stay inside the source video");
    if (!Number.isFinite(c.volume) || c.volume < 0 || c.volume > MAX_VOLUME)
      throw Error("Clip volume must be between 0% and 200%");
    if (isAudio(m)) throw Error("Only videos can go on the video track");
    checkFades(c.fadeIn, c.fadeOut, clipLength(c));
    clips.add(c.id);
  }
  if (!Array.isArray(p.titles) || !Array.isArray(p.music) || p.titles.length > 500 || p.music.length > 500)
    throw Error("Invalid project");
  for (const t of p.titles) {
    const n = [...(t.text || "")].length;
    if (
      !t.id ||
      clips.has(t.id) ||
      !n ||
      n > MAX_TITLE ||
      /[\r\n]/.test(t.text) ||
      ![t.start, t.duration].every(Number.isFinite) ||
      t.start < 0 ||
      t.start > 36000 ||
      t.duration < 0.25 ||
      t.duration > 3600 ||
      !["top", "center", "bottom"].includes(t.placement) ||
      !["small", "medium", "large"].includes(t.size) ||
      !/^#[0-9a-fA-F]{6}$/.test(t.color) ||
      typeof t.backdrop !== "boolean"
    )
      throw Error("Each title needs 1 to 80 characters on one line, a start time and at least 0.25 s on screen");
    clips.add(t.id);
  }
  for (const u of p.music) {
    const m = p.media.find((m) => m.id === u.mediaId);
    if (
      !m ||
      !m.audio ||
      !u.id ||
      clips.has(u.id) ||
      ![u.start, u.in, u.out].every(Number.isFinite) ||
      u.start < 0 ||
      u.start > 36000 ||
      u.in < 0 ||
      u.out - u.in < 0.1 ||
      u.out > m.duration + 0.05
    )
      throw Error("Music must use a file with sound and stay inside it");
    if (!Number.isFinite(u.volume) || u.volume < 0 || u.volume > MAX_VOLUME)
      throw Error("Music volume must be between 0% and 200%");
    checkFades(u.fadeIn, u.fadeOut, u.out - u.in);
    clips.add(u.id);
  }
  return p;
}

function checkFades(a, b, len) {
  if (
    ![a, b].every(Number.isFinite) ||
    a < 0 ||
    b < 0 ||
    a > MAX_FADE ||
    b > MAX_FADE ||
    a + b > len + 1e-6
  )
    throw Error(`Fades here can total at most ${len.toFixed(2)} s`);
}

function withClip(p, id, fn) {
  const q = structuredClone(p);
  const c = q.clips.find((c) => c.id === id);
  if (!c) throw Error("Select a clip first");
  fn(c, q);
  return validate(q);
}

/** Keeps fades inside a clip whose length just changed. */
function fitFades(c) {
  const len = clipLength(c);
  if (c.fadeIn + c.fadeOut > len) {
    const k = len / (c.fadeIn + c.fadeOut);
    c.fadeIn = +(c.fadeIn * k).toFixed(3);
    c.fadeOut = Math.max(0, +(len - c.fadeIn).toFixed(3));
    if (c.fadeIn + c.fadeOut > len) c.fadeOut = Math.max(0, len - c.fadeIn - 1e-4);
  }
}

export function trim(p, id, a, b) {
  return withClip(p, id, (c) => {
    c.in = a;
    c.out = b;
    fitFades(c);
  });
}

/** Moves a clip's in point (side "in") or out point ("out") to the playhead. */
export function trimToPlayhead(p, time, side) {
  const at = locate(p, time);
  if (!at) throw Error("Move the playhead over a clip first");
  const f = 1 / p.fps;
  if (side === "in") {
    if (at.clip.out - at.source < f) throw Error("Leave at least one frame in the clip");
    return trim(p, at.clip.id, at.source, at.clip.out);
  }
  if (at.source - at.clip.in < f) throw Error("Leave at least one frame in the clip");
  return trim(p, at.clip.id, at.clip.in, at.source);
}

export function split(p, time, id) {
  const at = locate(p, time);
  if (
    !at ||
    at.source - at.clip.in < 1 / p.fps ||
    at.clip.out - at.source < 1 / p.fps
  )
    throw Error("Split must leave at least one frame on each side");
  const q = structuredClone(p);
  const left = { ...at.clip, out: at.source, fadeOut: 0 },
    right = { ...at.clip, id, in: at.source, fadeIn: 0 };
  fitFades(left);
  fitFades(right);
  q.clips.splice(at.index, 1, left, right);
  return validate(q);
}

export function reorder(p, id, delta) {
  const q = structuredClone(p),
    i = q.clips.findIndex((c) => c.id === id),
    j = i + delta;
  if (i >= 0 && j >= 0 && j < q.clips.length)
    [q.clips[i], q.clips[j]] = [q.clips[j], q.clips[i]];
  return q;
}

/** Moves a clip so it ends up at position `to` (0-based) in the sequence. */
export function moveTo(p, id, to) {
  const q = structuredClone(p),
    i = q.clips.findIndex((c) => c.id === id);
  if (i < 0) return q;
  const [c] = q.clips.splice(i, 1);
  q.clips.splice(Math.max(0, Math.min(to, q.clips.length)), 0, c);
  return q;
}

export function remove(p, id) {
  return { ...p, clips: p.clips.filter((c) => c.id !== id) };
}

export function duplicate(p, id, newId) {
  const q = structuredClone(p),
    i = q.clips.findIndex((c) => c.id === id);
  if (i < 0) throw Error("Select a clip first");
  q.clips.splice(i + 1, 0, { ...q.clips[i], id: newId });
  return validate(q);
}

export function setAudio(p, id, volume) {
  return withClip(p, id, (c) => {
    c.volume = Math.round(Math.min(MAX_VOLUME, Math.max(0, volume)) * 100) / 100;
  });
}

export function setFades(p, id, fadeIn, fadeOut) {
  return withClip(p, id, (c) => {
    const len = clipLength(c);
    c.fadeIn = Math.min(MAX_FADE, Math.max(0, fadeIn));
    c.fadeOut = Math.min(MAX_FADE, Math.max(0, fadeOut));
    if (c.fadeIn + c.fadeOut > len)
      throw Error(`Fades on this clip can total at most ${len.toFixed(2)} s`);
  });
}

/** Removes media that no clip or music item uses. */
export function removeMedia(p, mediaId) {
  if (p.clips.some((c) => c.mediaId === mediaId) || p.music.some((u) => u.mediaId === mediaId))
    throw Error("Remove this file from the timeline first");
  return { ...p, media: p.media.filter((m) => m.id !== mediaId) };
}

/**
 * Brightness (0–1) and gain multiplier for a moment inside a clip, matching
 * the export's fade-from-black and audio fade.
 */
export function envelope(c, offset) {
  const len = clipLength(c);
  let k = 1;
  if (c.fadeIn > 0 && offset < c.fadeIn) k = Math.min(k, offset / c.fadeIn);
  if (c.fadeOut > 0 && offset > len - c.fadeOut)
    k = Math.min(k, (len - offset) / c.fadeOut);
  return Math.max(0, Math.min(1, k));
}

// ----- Titles -----
export function makeTitle(id, start, text = "Your title") {
  return {
    id,
    text,
    start: Math.max(0, start),
    duration: 3,
    placement: "bottom",
    size: "medium",
    color: "#ffffff",
    backdrop: true,
  };
}
export function addTitle(p, t) {
  return validate({ ...p, titles: [...p.titles, t] });
}
export function updateTitle(p, id, patch) {
  if (!p.titles.some((t) => t.id === id)) throw Error("Select a title first");
  const next = { ...patch };
  if ("text" in next) next.text = String(next.text).replace(/[\r\n]+/g, " ").slice(0, MAX_TITLE);
  if ("start" in next) next.start = Math.max(0, next.start);
  return validate({ ...p, titles: p.titles.map((t) => (t.id === id ? { ...t, ...next } : t)) });
}
/** Titles visible at a timeline time. */
export const titlesAt = (p, time) =>
  p.titles.filter((t) => time >= t.start && time < t.start + t.duration);
/** Opacity of a title at a timeline time, matching the export's 0.3 s fade. */
export function titleAlpha(t, time) {
  const f = Math.min(0.3, t.duration / 3),
    s = t.start,
    e = t.start + t.duration;
  if (time < s || time >= e) return 0;
  return Math.max(0, Math.min(1, (time - s) / f, (e - time) / f));
}

// ----- Music -----
export const musicEnd = (u) => u.start + u.out - u.in;
export function makeMusic(id, media, start, total) {
  const room = total > start + 1 ? total - start : media.duration;
  const out = Math.min(media.duration, room);
  return {
    id,
    mediaId: media.id,
    start: Math.max(0, start),
    in: 0,
    out,
    volume: 0.6,
    fadeIn: Math.min(1, out / 4),
    fadeOut: Math.min(2, out / 4),
  };
}
export function addMusic(p, u) {
  return validate({ ...p, music: [...p.music, u] });
}
export function updateMusic(p, id, patch) {
  const cur = p.music.find((u) => u.id === id);
  if (!cur) throw Error("Select a music item first");
  const next = { ...cur, ...patch };
  next.start = Math.max(0, next.start);
  next.volume = Math.round(Math.min(MAX_VOLUME, Math.max(0, next.volume)) * 100) / 100;
  const len = next.out - next.in;
  if (next.fadeIn + next.fadeOut > len) {
    const k = len / (next.fadeIn + next.fadeOut);
    next.fadeIn = +(next.fadeIn * k).toFixed(3);
    next.fadeOut = Math.max(0, +(len - next.fadeIn - 1e-4).toFixed(3));
  }
  return validate({ ...p, music: p.music.map((u) => (u.id === id ? next : u)) });
}
/** The music item playing at a timeline time, if any (the first one wins). */
export const musicAt = (p, time) =>
  p.music.find((u) => time >= u.start && time < musicEnd(u)) || null;
/** Gain of a music item at a timeline time, matching the export. */
export function musicGain(u, time) {
  let k = 1;
  if (u.fadeIn > 0) k = Math.min(k, (time - u.start) / u.fadeIn);
  if (u.fadeOut > 0) k = Math.min(k, (musicEnd(u) - time) / u.fadeOut);
  return u.volume * Math.max(0, Math.min(1, k));
}

/** Removes a clip, title or music item by id. */
export function removeItem(p, id) {
  return {
    ...p,
    clips: p.clips.filter((c) => c.id !== id),
    titles: p.titles.filter((t) => t.id !== id),
    music: p.music.filter((u) => u.id !== id),
  };
}

export function commit(history, next) {
  validate(next);
  return {
    past: [...history.past, history.present].slice(-100),
    present: structuredClone(next),
    future: [],
  };
}
export function undo(h) {
  return h.past.length
    ? {
        past: h.past.slice(0, -1),
        present: h.past.at(-1),
        future: [h.present, ...h.future],
      }
    : h;
}
export function redo(h) {
  return h.future.length
    ? {
        past: [...h.past, h.present],
        present: h.future[0],
        future: h.future.slice(1),
      }
    : h;
}
