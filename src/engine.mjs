// Pure timeline operations. Every function returns a new project and never
// mutates its input. Rules here mirror src-tauri/src/model.rs exactly.
export const VERSION = 4;
export const MIN_SPEED = 0.25;
export const MAX_SPEED = 4;
export const MAX_BLEND = 5;
export const BLENDS = ["dissolve", "dip", "wipe", "slide"];
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

/** Seconds a clip lasts on the timeline, after its speed change. */
export const clipLength = (c) => (c.out - c.in) / (c.speed || 1);
const blendLen = (c) => (c && c.blend ? c.blend.duration : 0);
/** Timeline length: clip lengths minus transition overlaps. */
export const duration = (p) =>
  p.clips.reduce((s, c) => s + clipLength(c) - blendLen(c), 0);

export function makeClip(id, media, a = 0, b = media.duration) {
  return { id, mediaId: media.id, in: a, out: b, volume: 1, fadeIn: 0, fadeOut: 0, speed: 1, blend: null };
}

/** Upgrades an older supported project (version 1 or 2) to the current format. */
export function migrate(p) {
  if (!p || typeof p !== "object") throw Error("Not an EditNova project");
  if (!(p.version >= 1 && p.version < VERSION)) return p;
  return {
    ...p,
    version: VERSION,
    clips: (p.clips || []).map((c) => ({
      volume: 1,
      fadeIn: 0,
      fadeOut: 0,
      speed: 1,
      blend: null,
      ...c,
    })),
    titles: p.titles || [],
    music: p.music || [],
    duckMusic: p.duckMusic ?? false,
  };
}

const isAudio = (m) => m && m.kind === "audio";

/** Sequence start time of each clip, in timeline order. */
export function starts(p) {
  let t = 0,
    prev = 0;
  return p.clips.map((c) => {
    t += prev - blendLen(c);
    prev = clipLength(c);
    return t;
  });
}

/** The clip playing at a timeline time. During a transition, the outgoing clip. */
export function locate(p, time) {
  const st = starts(p);
  for (let i = 0; i < p.clips.length; i++) {
    const c = p.clips[i],
      end = st[i] + clipLength(c);
    if (time >= st[i] - 1e-9 && time < end - 1e-6)
      return {
        clip: c,
        index: i,
        start: st[i],
        source: c.in + Math.max(0, time - st[i]) * (c.speed || 1),
      };
  }
  return null;
}

/** During a transition, the incoming clip and progress 0–1; otherwise null. */
export function incoming(p, time) {
  const st = starts(p);
  for (let i = 1; i < p.clips.length; i++) {
    const c = p.clips[i];
    if (!c.blend) continue;
    const k = (time - st[i]) / c.blend.duration;
    if (k >= 0 && k < 1)
      return {
        clip: c,
        index: i,
        start: st[i],
        source: c.in + (time - st[i]) * (c.speed || 1),
        kind: c.blend.kind,
        k,
      };
  }
  return null;
}

/** Largest transition allowed into clip `i`. */
export function maxBlend(p, i) {
  if (i < 1 || i >= p.clips.length) return 0;
  return Math.min(MAX_BLEND, clipLength(p.clips[i - 1]) / 2, clipLength(p.clips[i]) / 2);
}

/**
 * Keeps transitions valid after any edit: none on the first clip, none longer
 * than half of either neighbour, and no fades on blended edges.
 */
export function fitBlends(p) {
  const q = { ...p, clips: p.clips.map((c) => ({ ...c })) };
  q.clips.forEach((c, i) => {
    if (!c.blend) return;
    if (i === 0) {
      c.blend = null;
      return;
    }
    const max = Math.floor(maxBlend(q, i) * 100) / 100;
    if (max < 0.1) {
      c.blend = null;
      return;
    }
    c.blend = { ...c.blend, duration: Math.min(c.blend.duration, max) };
    c.fadeIn = 0;
    q.clips[i - 1].fadeOut = 0;
  });
  return q;
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
      !Number.isFinite(c.speed) ||
      c.speed < MIN_SPEED ||
      c.speed > MAX_SPEED ||
      clipLength(c) < 1 / p.fps - 1e-6 ||
      c.out > m.duration + 0.05
    )
      throw Error("Clip in and out points must stay inside the source video");
    if (!Number.isFinite(c.volume) || c.volume < 0 || c.volume > MAX_VOLUME)
      throw Error("Clip volume must be between 0% and 200%");
    if (isAudio(m)) throw Error("Only videos can go on the video track");
    checkFades(c.fadeIn, c.fadeOut, clipLength(c));
    clips.add(c.id);
  }
  p.clips.forEach((c, i) => {
    const prev = p.clips[i - 1],
      next = p.clips[i + 1];
    if (c.blend) {
      if (!prev) throw Error("The first clip cannot have a transition");
      const d = c.blend.duration;
      if (
        !BLENDS.includes(c.blend.kind) ||
        !Number.isFinite(d) ||
        d < 0.1 ||
        d > maxBlend(p, i) + 1e-6
      )
        throw Error("A transition can last at most half of the shorter clip, up to 5 s");
      if (c.fadeIn > 0 || prev.fadeOut > 0)
        throw Error("Remove the fade on clips joined by a transition");
    }
    if (c.fadeIn + c.fadeOut + blendLen(c) + blendLen(next) > clipLength(c) + 1e-6)
      throw Error("Fades and transitions on this clip overlap. Shorten one.");
  });
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
  return validate(fitBlends(q));
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
  const sf = f * (at.clip.speed || 1);
  if (side === "in") {
    if (at.clip.out - at.source < sf) throw Error("Leave at least one frame in the clip");
    return trim(p, at.clip.id, at.source, at.clip.out);
  }
  if (at.source - at.clip.in < sf) throw Error("Leave at least one frame in the clip");
  return trim(p, at.clip.id, at.clip.in, at.source);
}

export function split(p, time, id) {
  const at = locate(p, time);
  const sf = (at ? at.clip.speed || 1 : 1) / p.fps;
  if (!at || at.source - at.clip.in < sf || at.clip.out - at.source < sf)
    throw Error("Split must leave at least one frame on each side");
  const q = structuredClone(p);
  const left = { ...at.clip, out: at.source, fadeOut: 0 },
    right = { ...at.clip, id, in: at.source, fadeIn: 0, blend: null };
  fitFades(left);
  fitFades(right);
  q.clips.splice(at.index, 1, left, right);
  return validate(fitBlends(q));
}

export function reorder(p, id, delta) {
  const q = structuredClone(p),
    i = q.clips.findIndex((c) => c.id === id),
    j = i + delta;
  if (i >= 0 && j >= 0 && j < q.clips.length)
    [q.clips[i], q.clips[j]] = [q.clips[j], q.clips[i]];
  return fitBlends(q);
}

/** Moves a clip so it ends up at position `to` (0-based) in the sequence. */
export function moveTo(p, id, to) {
  const q = structuredClone(p),
    i = q.clips.findIndex((c) => c.id === id);
  if (i < 0) return q;
  const [c] = q.clips.splice(i, 1);
  q.clips.splice(Math.max(0, Math.min(to, q.clips.length)), 0, c);
  return fitBlends(q);
}

export function remove(p, id) {
  return fitBlends({ ...p, clips: p.clips.filter((c) => c.id !== id) });
}

export function duplicate(p, id, newId) {
  const q = structuredClone(p),
    i = q.clips.findIndex((c) => c.id === id);
  if (i < 0) throw Error("Select a clip first");
  q.clips.splice(i + 1, 0, { ...q.clips[i], id: newId, blend: null, fadeIn: 0 });
  return validate(fitBlends(q));
}

export function setAudio(p, id, volume) {
  return withClip(p, id, (c) => {
    c.volume = Math.round(Math.min(MAX_VOLUME, Math.max(0, volume)) * 100) / 100;
  });
}

export function setFades(p, id, fadeIn, fadeOut) {
  const i = p.clips.findIndex((c) => c.id === id);
  if (i >= 0 && ((fadeIn > 0 && p.clips[i].blend) || (fadeOut > 0 && p.clips[i + 1]?.blend)))
    throw Error("This edge has a transition. Remove the transition to use a fade.");
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

// ----- Speed and transitions -----
export const SPEEDS = [0.25, 0.5, 0.75, 1, 1.5, 2, 4];
export function setSpeed(p, id, speed) {
  return withClip(p, id, (c) => {
    c.speed = Math.round(Math.min(MAX_SPEED, Math.max(MIN_SPEED, speed)) * 100) / 100;
  });
}
/** Sets (or with kind null removes) the transition into clip `id`. */
export function setBlend(p, id, kind, d = 1) {
  const i = p.clips.findIndex((c) => c.id === id);
  if (i < 1) throw Error("Transitions go between two clips");
  const q = { ...p, clips: p.clips.map((c) => ({ ...c })) };
  if (!kind) {
    q.clips[i].blend = null;
    return validate(q);
  }
  const max = maxBlend(q, i);
  if (max < 0.1) throw Error("These clips are too short for a transition");
  q.clips[i].blend = { kind, duration: Math.round(Math.min(Math.max(0.1, d), max) * 100) / 100 };
  q.clips[i].fadeIn = 0;
  q.clips[i - 1].fadeOut = 0;
  return validate(q);
}

/** Removes a clip, title or music item by id. */
export function removeItem(p, id) {
  return fitBlends({
    ...p,
    clips: p.clips.filter((c) => c.id !== id),
    titles: p.titles.filter((t) => t.id !== id),
    music: p.music.filter((u) => u.id !== id),
  });
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
