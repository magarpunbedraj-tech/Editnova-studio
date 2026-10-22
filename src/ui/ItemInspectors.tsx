import React, { useEffect, useState } from "react";
import type { Blend, BlendKind, Media, Music, Project, Title } from "../types";
import { COLORS, MAX_FADE, MAX_TITLE } from "../engine.mjs";
import { clock } from "../format";

function Num(props: {
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
        }}
      />
    </label>
  );
}

function Segmented<T extends string>(props: {
  label: string;
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
}) {
  return (
    <div className="field">
      <span>{props.label}</span>
      <div className="segmented" role="radiogroup" aria-label={props.label}>
        {props.options.map(([v, l]) => (
          <button
            key={v}
            role="radio"
            aria-checked={props.value === v}
            className={props.value === v ? "on" : ""}
            onClick={() => props.onChange(v)}
          >
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}

export function TitleInspector(props: {
  title: Title;
  onChange: (patch: Partial<Title>) => void;
  onRemove: () => void;
  onDuplicate: () => void;
}) {
  const t = props.title;
  const [text, setText] = useState(t.text);
  useEffect(() => setText(t.text), [t.id, t.text]);
  const commitText = () => {
    const v = text.replace(/[\r\n]+/g, " ").trim();
    if (v && v !== t.text) props.onChange({ text: v });
    else setText(t.text);
  };
  return (
    <>
      <section>
        <h3>Text</h3>
        <label className="field">
          <span>
            Words on screen <output>{[...text].length}/{MAX_TITLE}</output>
          </span>
          <input
            value={text}
            maxLength={MAX_TITLE}
            autoFocus={t.text === "Your title"}
            onFocus={(e) => t.text === "Your title" && e.target.select()}
            onChange={(e) => setText(e.target.value)}
            onBlur={commitText}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
          />
        </label>
        <p className="hint">Nepali (Devanagari) text works too.</p>
      </section>
      <section>
        <h3>Look</h3>
        <Segmented
          label="Position"
          value={t.placement}
          options={[
            ["top", "Top"],
            ["center", "Middle"],
            ["bottom", "Bottom"],
          ]}
          onChange={(placement) => props.onChange({ placement })}
        />
        <Segmented
          label="Size"
          value={t.size}
          options={[
            ["small", "Small"],
            ["medium", "Medium"],
            ["large", "Large"],
          ]}
          onChange={(size) => props.onChange({ size })}
        />
        <div className="field">
          <span>Colour</span>
          <div className="swatches">
            {COLORS.map((c) => (
              <button
                key={c}
                className={`swatch ${t.color.toLowerCase() === c ? "on" : ""}`}
                style={{ background: c }}
                aria-label={`Colour ${c}`}
                onClick={() => props.onChange({ color: c })}
              />
            ))}
            <label className="swatch custom" title="Pick any colour">
              <input
                type="color"
                value={t.color}
                aria-label="Custom colour"
                onChange={(e) => props.onChange({ color: e.target.value })}
              />
            </label>
          </div>
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={t.backdrop}
            onChange={(e) => props.onChange({ backdrop: e.target.checked })}
          />
          Dark box behind the text
        </label>
      </section>
      <section>
        <h3>Timing</h3>
        <div className="two">
          <Num
            label="Appears at (s)"
            value={t.start}
            step={0.1}
            min={0}
            onCommit={(start) => props.onChange({ start })}
          />
          <Num
            label="Stays for (s)"
            value={t.duration}
            step={0.25}
            min={0.25}
            onCommit={(duration) => props.onChange({ duration })}
          />
        </div>
        <p className="hint">Titles fade in and out over a split second. Drag them on the timeline to move them.</p>
      </section>
      <section>
        <div className="two">
          <button onClick={props.onDuplicate}>Duplicate</button>
          <button className="danger" onClick={props.onRemove}>
            Remove title
          </button>
        </div>
      </section>
    </>
  );
}

export function MusicInspector(props: {
  music: Music;
  media: Media;
  p: Project;
  onChange: (patch: Partial<Music>) => void;
  onRemove: () => void;
}) {
  const u = props.music;
  const len = u.out - u.in;
  const [vol, setVol] = useState(u.volume);
  useEffect(() => setVol(u.volume), [u.id, u.volume]);
  return (
    <>
      <p className="clip-title" title={props.media.path}>
        {props.media.name}
      </p>
      <section>
        <h3>Volume</h3>
        <label className="field">
          <span>
            Music volume <output>{Math.round(vol * 100)}%</output>
          </span>
          <input
            type="range"
            min={0}
            max={2}
            step={0.05}
            value={vol}
            onChange={(e) => setVol(+e.target.value)}
            onPointerUp={() => props.onChange({ volume: vol })}
            onKeyUp={() => props.onChange({ volume: vol })}
          />
        </label>
        <p className="hint">
          {props.p.duckMusic
            ? "Music gets quieter while your clips have sound. Change this in Project settings."
            : "Music plays at this level the whole time. Turn on ducking in Project settings to lower it under speech."}
        </p>
      </section>
      <section>
        <h3>Timing</h3>
        <div className="two">
          <Num
            label="Starts on timeline (s)"
            value={u.start}
            step={0.1}
            min={0}
            onCommit={(start) => props.onChange({ start })}
          />
          <Num
            label="Length (s)"
            value={len}
            step={0.5}
            min={0.1}
            max={props.media.duration - u.in}
            onCommit={(v) => props.onChange({ out: Math.min(props.media.duration, u.in + v) })}
          />
          <Num
            label="Skip song intro (s)"
            value={u.in}
            step={0.5}
            min={0}
            onCommit={(v) =>
              props.onChange({ in: v, out: Math.min(props.media.duration, v + len) })
            }
          />
        </div>
        <p className="hint">
          Song length {clock(props.media.duration)}. Music that runs past the end of your
          last clip is cut off in the export.
        </p>
      </section>
      <section>
        <h3>Fade</h3>
        <div className="two">
          <Num
            label="Fade in (s)"
            value={u.fadeIn}
            step={0.5}
            min={0}
            max={MAX_FADE}
            onCommit={(fadeIn) => props.onChange({ fadeIn })}
          />
          <Num
            label="Fade out (s)"
            value={u.fadeOut}
            step={0.5}
            min={0}
            max={MAX_FADE}
            onCommit={(fadeOut) => props.onChange({ fadeOut })}
          />
        </div>
      </section>
      <section>
        <button className="danger wide" onClick={props.onRemove}>
          Remove music
        </button>
      </section>
    </>
  );
}

const BLEND_LABELS: [BlendKind, string, string][] = [
  ["dissolve", "Dissolve", "The two clips melt into each other."],
  ["dip", "Dip to black", "Fades to black, then up into the next clip."],
  ["wipe", "Wipe", "The next clip sweeps in from the right."],
  ["slide", "Slide", "The next clip pushes the current one off to the left."],
];

export function BlendInspector(props: {
  from: string;
  to: string;
  blend: Blend | null;
  max: number;
  onSet: (kind: BlendKind | null, duration: number) => void;
}) {
  const b = props.blend;
  const d = b?.duration ?? Math.min(1, props.max);
  return (
    <>
      <p className="clip-title">
        {props.from} → {props.to}
      </p>
      <section>
        <h3>Style</h3>
        <div className="blend-list" role="radiogroup" aria-label="Transition style">
          <button
            role="radio"
            aria-checked={!b}
            className={!b ? "on" : ""}
            onClick={() => props.onSet(null, d)}
          >
            <b>Cut</b>
            <small>Jump straight to the next clip.</small>
          </button>
          {BLEND_LABELS.map(([k, label, text]) => (
            <button
              key={k}
              role="radio"
              aria-checked={b?.kind === k}
              className={b?.kind === k ? "on" : ""}
              disabled={props.max < 0.1}
              onClick={() => props.onSet(k, d)}
            >
              <b>{label}</b>
              <small>{text}</small>
            </button>
          ))}
        </div>
        {props.max < 0.1 && <p className="hint">These clips are too short for a transition.</p>}
      </section>
      {b && (
        <section>
          <h3>Length</h3>
          <Num
            label={`Seconds (up to ${props.max.toFixed(1)})`}
            value={b.duration}
            step={0.25}
            min={0.1}
            max={props.max}
            onCommit={(v) => props.onSet(b.kind, v)}
          />
          <div className="chips">
            {[0.5, 1, 2].map((v) => (
              <button key={v} disabled={v > props.max + 1e-6} onClick={() => props.onSet(b.kind, v)}>
                {v} s
              </button>
            ))}
          </div>
          <p className="hint">
            The clips overlap for this long, so the film gets {b.duration.toFixed(2)} s shorter.
          </p>
        </section>
      )}
    </>
  );
}
