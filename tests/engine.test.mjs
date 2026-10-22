import test from "node:test";
import assert from "node:assert/strict";
import {
  fresh,
  validate,
  duration,
  locate,
  trim,
  split,
  reorder,
  commit,
  undo,
  redo,
  migrate,
  moveTo,
  remove,
  duplicate,
  setAudio,
  setFades,
  trimToPlayhead,
  envelope,
  removeMedia,
  starts,
  makeClip,
} from "../src/engine.mjs";
const sample = () => ({
  ...fresh(),
  media: [
    { id: "m", path: "C:\\Footage\\कथा.mp4", duration: 10, name: "कथा.mp4" },
  ],
  clips: [
    { id: "a", mediaId: "m", in: 1, out: 5, volume: 1, fadeIn: 0, fadeOut: 0 },
    { id: "b", mediaId: "m", in: 6, out: 9, volume: 1, fadeIn: 0, fadeOut: 0 },
  ],
});
test("empty project is valid", () =>
  assert.equal(duration(validate(fresh())), 0));
test("trim leaves original unchanged and updates duration", () => {
  const p = sample(),
    q = trim(p, "a", 2, 4);
  assert.equal(p.clips[0].in, 1);
  assert.equal(duration(q), 5);
});
test("rejects negative, reversed, out of range and nonfinite trims", () => {
  for (const [a, b] of [
    [-1, 3],
    [3, 2],
    [0, 11],
    [NaN, 3],
    [0, Infinity],
  ])
    assert.throws(() => trim(sample(), "a", a, b));
});
test("timeline boundary uses next clip and source offset", () => {
  assert.equal(locate(sample(), 4).clip.id, "b");
  assert.equal(locate(sample(), 5).source, 7);
  assert.equal(locate(sample(), 7), null);
});
test("split preserves duration and contiguous source ranges", () => {
  const p = sample(),
    q = split(p, 2, "new");
  assert.equal(duration(p), duration(q));
  assert.equal(q.clips[0].out, q.clips[1].in);
  assert.equal(q.clips[1].out, 5);
});
test("split rejects endpoints and subframe clips", () => {
  for (const n of [0, 0.001, 7, 100])
    assert.throws(() => split(sample(), n, "x"));
});
test("reorder preserves duration and leaves input untouched", () => {
  const p = sample(),
    q = reorder(p, "a", 1);
  assert.equal(q.clips[0].id, "b");
  assert.equal(p.clips[0].id, "a");
  assert.equal(duration(q), duration(p));
});
test("undo redo restores exact state, new change clears redo", () => {
  const p = sample(),
    h = { past: [], present: p, future: [] },
    q = commit(h, trim(p, "a", 2, 3));
  assert.deepEqual(undo(q).present, p);
  assert.deepEqual(redo(undo(q)).present, q.present);
  assert.equal(commit(undo(q), fresh()).future.length, 0);
});
test("project JSON roundtrip preserves unicode and editing decisions", () =>
  assert.deepEqual(validate(JSON.parse(JSON.stringify(sample()))), sample()));
test("rejects unknown project versions and invalid references", () => {
  assert.throws(() => validate({ ...sample(), version: 99 }));
  const p = sample();
  p.clips[0].mediaId = "missing";
  assert.throws(() => validate(p));
});
test("rejects duplicate identifiers, odd sizes and unsupported FPS", () => {
  let p = sample();
  p.clips[1].id = "a";
  assert.throws(() => validate(p));
  assert.throws(() => validate({ ...sample(), width: 1919 }));
  assert.throws(() => validate({ ...sample(), fps: 0 }));
});
test("history is bounded to 100 operations", () => {
  let h = { past: [], present: fresh(), future: [] };
  for (let i = 0; i < 130; i++) h = commit(h, { ...fresh(), name: String(i) });
  assert.equal(h.past.length, 100);
});

test("version 1 projects migrate with default audio settings", () => {
  const old = { ...sample(), version: 1 };
  old.clips = old.clips.map(({ id, mediaId, in: a, out: b }) => ({ id, mediaId, in: a, out: b }));
  const p = validate(migrate(old));
  assert.equal(p.version, 2);
  assert.deepEqual(
    [p.clips[0].volume, p.clips[0].fadeIn, p.clips[0].fadeOut],
    [1, 0, 0],
  );
  assert.equal(migrate(sample()).version, 2);
});
test("moveTo places a clip at the requested index", () => {
  let p = sample();
  p = duplicate(p, "b", "c");
  assert.deepEqual(moveTo(p, "c", 0).clips.map((c) => c.id), ["c", "a", "b"]);
  assert.deepEqual(moveTo(p, "a", 99).clips.map((c) => c.id), ["b", "c", "a"]);
  assert.deepEqual(p.clips.map((c) => c.id), ["a", "b", "c"]);
});
test("remove and duplicate keep the sequence valid", () => {
  const p = duplicate(sample(), "a", "a2");
  assert.equal(duration(p), 11);
  assert.equal(remove(p, "a2").clips.length, 2);
  assert.throws(() => duplicate(sample(), "zzz", "q"));
});
test("volume is clamped and fades must fit", () => {
  assert.equal(setAudio(sample(), "a", 5).clips[0].volume, 2);
  assert.equal(setAudio(sample(), "a", -1).clips[0].volume, 0);
  const f = setFades(sample(), "a", 1, 1.5);
  assert.deepEqual([f.clips[0].fadeIn, f.clips[0].fadeOut], [1, 1.5]);
  assert.throws(() => setFades(sample(), "b", 2, 2));
});
test("trimming shrinks fades that no longer fit", () => {
  const f = setFades(sample(), "a", 2, 2);
  const t = trim(f, "a", 1, 3);
  const c = t.clips[0];
  assert.ok(c.fadeIn + c.fadeOut <= 2 + 1e-6);
});
test("split keeps the outer fades only", () => {
  const f = setFades(sample(), "a", 1, 1);
  const q = split(f, 2, "n");
  assert.deepEqual([q.clips[0].fadeIn, q.clips[0].fadeOut], [1, 0]);
  assert.deepEqual([q.clips[1].fadeIn, q.clips[1].fadeOut], [0, 1]);
});
test("trim to playhead moves the nearest edit point", () => {
  const p = sample();
  assert.deepEqual(
    [trimToPlayhead(p, 1, "in").clips[0].in, trimToPlayhead(p, 1, "out").clips[0].out],
    [2, 2],
  );
  assert.throws(() => trimToPlayhead(p, 100, "in"));
});
test("envelope follows fades and starts track sequence times", () => {
  const c = { ...sample().clips[0], fadeIn: 1, fadeOut: 2 };
  assert.equal(envelope(c, 0), 0);
  assert.equal(envelope(c, 0.5), 0.5);
  assert.equal(envelope(c, 2), 1);
  assert.equal(envelope(c, 3), 0.5);
  assert.deepEqual(starts(sample()), [0, 4]);
});
test("unused media can be removed, used media cannot", () => {
  assert.throws(() => removeMedia(sample(), "m"));
  assert.equal(removeMedia({ ...sample(), clips: [] }, "m").media.length, 0);
});
test("makeClip covers the whole source by default", () => {
  const c = makeClip("x", { id: "m", duration: 10 });
  assert.deepEqual([c.in, c.out, c.volume], [0, 10, 1]);
});
