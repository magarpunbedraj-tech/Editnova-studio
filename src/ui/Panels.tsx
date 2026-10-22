import React, { useEffect, useState } from "react";
import type { Clip, Media, Project, Recent } from "../types";
import { clipLength, MAX_FADE } from "../engine.mjs";
import { clock } from "../format";

export function MediaBin(props: {
  p: Project;
  thumbs: Record<string, string>;
  busy: boolean;
  onImport: () => void;
  onAdd: (m: Media) => void;
  onRemove: (m: Media) => void;
}) {
  const { p, thumbs } = props;
  const used = new Set(p.clips.map((c) => c.mediaId));
  return (
    <aside className="bin panel">
      <div className="panel-head">
        <h2>Media</h2>
        <span className="count">{p.media.length}</span>
      </div>
      <button className="import" disabled={props.busy} onClick={props.onImport}>
        <b>Import videos</b>
        <small>or drop files anywhere in the window</small>
      </button>
      <div className="bin-list">
        {!p.media.length ? (
          <p className="bin-empty">
            MP4, MOV, MKV, WebM, AVI and M4V files work. Your originals are never
            changed.
          </p>
        ) : (
          p.media.map((m) => (
            <article
              className="asset"
              key={m.id}
              onDoubleClick={() => props.onAdd(m)}
              title={m.path}
            >
              <div
                className="poster"
                style={{
                  backgroundImage: thumbs[m.id] ? `url("${thumbs[m.id]}")` : undefined,
                }}
              >
                <span>{clock(m.duration)}</span>
              </div>
              <div className="asset-meta">
                <strong>{m.name}</strong>
                <small>
                  {m.width}×{m.height}
                  {m.audio ? "" : ", no sound"}
                  {used.has(m.id) ? ", in timeline" : ""}
                </small>
              </div>
              <div className="asset-actions">
                <button
                  className="add"
                  disabled={props.busy}
                  title="Add to the end of the timeline"
                  onClick={() => props.onAdd(m)}
                >
                  Add
                </button>
                {!used.has(m.id) && (
                  <button
                    className="ghost"
                    title="Remove from this project"
                    aria-label={`Remove ${m.name} from project`}
                    onClick={() => props.onRemove(m)}
                  >
                    ✕
                  </button>
                )}
              </div>
            </article>
          ))
        )}
      </div>
    </aside>
  );
}

function NumberField(props: {
  label: string;
  value: number;
  step: number;
  min?: number;
  max?: number;
  onCommit: (v: number) => void;
}) {
  const [text, setText] = useState(props.value.toFixed(2));
  useEffect(() => setText(props.value.toFixed(2)), [props.value]);
  const commit = () => {
    const v = Number(text);
    if (Number.isFinite(v) && Math.abs(v - props.value) > 1e-6) props.onCommit(v);
    else setText(props.value.toFixed(2));
  };
  return (
    <label className="field">
      <span>{props.label}</span>
      <input
        type="number"
        value={text}
        step={props.step}
        min={props.min}
        max={props.max}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            setText(props.value.toFixed(2));
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
    </label>
  );
}

export function Inspector(props: {
  p: Project;
  clip: Clip | undefined;
  media: Media | undefined;
  busy: boolean;
  previewing: boolean;
  onProject: (p: Project) => void;
  onTrim: (a: number, b: number) => void;
  onVolume: (v: number) => void;
  onFades: (a: number, b: number) => void;
  onAction: (a: "earlier" | "later" | "duplicate" | "remove" | "relink" | "preview") => void;
}) {
  const { p, clip, media } = props;
  const sizes: [string, string][] = [
    ["1920x1080", "1080p landscape (16:9)"],
    ["1280x720", "720p landscape (16:9)"],
    ["3840x2160", "4K landscape (16:9)"],
    ["1080x1920", "Vertical for Reels, Shorts, TikTok (9:16)"],
    ["1080x1080", "Square (1:1)"],
    ["1080x1350", "Portrait post (4:5)"],
  ];
  const size = `${p.width}x${p.height}`;
  const [vol, setVol] = useState(clip?.volume ?? 1);
  useEffect(() => setVol(clip?.volume ?? 1), [clip?.id, clip?.volume]);
  return (
    <aside className="inspector panel">
      <div className="panel-head">
        <h2>{clip ? "Clip" : "Project"}</h2>
      </div>
      <div className="inspector-body">
        {clip && media ? (
          <>
            <p className="clip-title" title={media.path}>
              {media.name}
            </p>
            <section>
              <h3>Timing</h3>
              <div className="two">
                <NumberField
                  label="Starts at (s)"
                  value={clip.in}
                  step={1 / p.fps}
                  min={0}
                  onCommit={(v) => props.onTrim(v, clip.out)}
                />
                <NumberField
                  label="Ends at (s)"
                  value={clip.out}
                  step={1 / p.fps}
                  min={0}
                  max={media.duration}
                  onCommit={(v) => props.onTrim(clip.in, v)}
                />
              </div>
              <p className="hint">
                Length {clock(clipLength(clip))} of {clock(media.duration)}. Press{" "}
                <kbd>Q</kbd> or <kbd>W</kbd> to trim the start or end to the
                playhead.
              </p>
            </section>
            <section>
              <h3>Sound</h3>
              {media.audio ? (
                <>
                  <label className="field">
                    <span>
                      Volume <output>{Math.round(vol * 100)}%</output>
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={2}
                      step={0.05}
                      value={vol}
                      onChange={(e) => setVol(+e.target.value)}
                      onPointerUp={() => props.onVolume(vol)}
                      onKeyUp={() => props.onVolume(vol)}
                    />
                  </label>
                  <div className="chips">
                    <button onClick={() => props.onVolume(clip.volume === 0 ? 1 : 0)}>
                      {clip.volume === 0 ? "Unmute" : "Mute"}
                    </button>
                    <button onClick={() => props.onVolume(1)} disabled={clip.volume === 1}>
                      Reset to 100%
                    </button>
                  </div>
                  {vol > 1 && (
                    <p className="hint">
                      Boosts above 100% are applied in the export; the preview
                      plays at full volume.
                    </p>
                  )}
                </>
              ) : (
                <p className="hint">This video has no sound. The export adds silence.</p>
              )}
            </section>
            <section>
              <h3>Fade</h3>
              <div className="two">
                <NumberField
                  label="Fade in (s)"
                  value={clip.fadeIn}
                  step={0.25}
                  min={0}
                  max={MAX_FADE}
                  onCommit={(v) => props.onFades(v, clip.fadeOut)}
                />
                <NumberField
                  label="Fade out (s)"
                  value={clip.fadeOut}
                  step={0.25}
                  min={0}
                  max={MAX_FADE}
                  onCommit={(v) => props.onFades(clip.fadeIn, v)}
                />
              </div>
              <div className="chips">
                {[0.5, 1, 2].map((d) => (
                  <button
                    key={d}
                    disabled={d * 2 > clipLength(clip)}
                    onClick={() => props.onFades(d, d)}
                  >
                    {d} s both
                  </button>
                ))}
                <button
                  disabled={!clip.fadeIn && !clip.fadeOut}
                  onClick={() => props.onFades(0, 0)}
                >
                  None
                </button>
              </div>
              <p className="hint">Fades go to and from black, with the sound.</p>
            </section>
            <section>
              <h3>Arrange</h3>
              <div className="two">
                <button onClick={() => props.onAction("earlier")}>Move earlier</button>
                <button onClick={() => props.onAction("later")}>Move later</button>
                <button onClick={() => props.onAction("duplicate")}>Duplicate</button>
                <button className="danger" onClick={() => props.onAction("remove")}>
                  Remove clip
                </button>
              </div>
            </section>
            <section>
              <h3>Source file</h3>
              <div className="stack">
                <button disabled={props.busy} onClick={() => props.onAction("relink")}>
                  Replace or relink source…
                </button>
                <button
                  disabled={props.busy || props.previewing}
                  onClick={() => props.onAction("preview")}
                >
                  {props.previewing ? "Smooth preview in use" : "Build smooth preview"}
                </button>
              </div>
              <p className="hint">
                Use a smooth preview if this video stutters or will not play. Your
                export always uses the original file.
              </p>
            </section>
          </>
        ) : (
          <>
            <section>
              <label className="field">
                <span>Project name</span>
                <input
                  value={p.name}
                  maxLength={256}
                  onChange={(e) => props.onProject({ ...p, name: e.target.value || "Untitled" })}
                />
              </label>
              <label className="field">
                <span>Video size</span>
                <select
                  value={size}
                  onChange={(e) => {
                    const [width, height] = e.target.value.split("x").map(Number);
                    props.onProject({ ...p, width, height });
                  }}
                >
                  {!sizes.some(([v]) => v === size) && (
                    <option value={size}>
                      {p.width}×{p.height}
                    </option>
                  )}
                  {sizes.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Frame rate</span>
                <select
                  value={p.fps}
                  onChange={(e) => props.onProject({ ...p, fps: +e.target.value })}
                >
                  {[24, 25, 30, 60].map((n) => (
                    <option key={n} value={n}>
                      {n} frames per second
                    </option>
                  ))}
                </select>
              </label>
              <p className="hint">
                Videos with a different shape are fitted inside the frame with black
                bars, never stretched or cropped.
              </p>
            </section>
            <section>
              <h3>Getting around</h3>
              <ul className="tips">
                <li>Click a clip to edit its timing, sound and fades.</li>
                <li>Drag clips along the timeline to reorder them.</li>
                <li>
                  Press <kbd>S</kbd> to split at the playhead, <kbd>Delete</kbd> to
                  remove the selected clip.
                </li>
                <li>
                  Press <kbd>?</kbd> for every shortcut.
                </li>
              </ul>
            </section>
          </>
        )}
      </div>
    </aside>
  );
}

export function Welcome(props: {
  recent: Recent[];
  recovery: boolean;
  busy: boolean;
  onNew: () => void;
  onOpen: () => void;
  onOpenRecent: (r: Recent) => void;
  onForget: (r: Recent) => void;
  onRecover: () => void;
  onImport: () => void;
}) {
  return (
    <div className="welcome">
      <div className="welcome-card">
        <div className="welcome-mark" aria-hidden>
          N
        </div>
        <h1>Start a film</h1>
        <p>Bring in your clips, cut them into a story, and export an MP4.</p>
        <div className="welcome-actions">
          <button className="primary" disabled={props.busy} onClick={props.onImport}>
            Import videos
          </button>
          <button disabled={props.busy} onClick={props.onOpen}>
            Open project…
          </button>
          {props.recovery && (
            <button disabled={props.busy} onClick={props.onRecover}>
              Recover last session
            </button>
          )}
        </div>
        {props.recent.length > 0 && (
          <div className="recent">
            <h3>Recent projects</h3>
            <ul>
              {props.recent.map((r) => (
                <li key={r.path} className={r.exists ? "" : "gone"}>
                  <button
                    className="recent-open"
                    disabled={!r.exists || props.busy}
                    onClick={() => props.onOpenRecent(r)}
                    title={r.path}
                  >
                    <b>{r.name}</b>
                    <small>{r.exists ? r.folder : "Moved or deleted"}</small>
                  </button>
                  <button
                    className="ghost"
                    aria-label={`Remove ${r.name} from recent projects`}
                    title="Remove from this list"
                    onClick={() => props.onForget(r)}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
