import React, { useEffect, useRef, useState } from "react";
import type { Project } from "../types";
import { clipLength, duration, musicEnd, starts } from "../engine.mjs";
import { clock, rulerStep } from "../format";

interface Props {
  p: Project;
  time: number;
  zoom: number;
  playing: boolean;
  selected: string;
  thumbs: Record<string, string>;
  disabled: boolean;
  onSeek: (t: number) => void;
  onSelect: (id: string) => void;
  onMove: (id: string, to: number) => void;
  onMoveItem: (id: string, start: number) => void;
  onZoom: (z: number) => void;
}

const PAD = 16;

export function Timeline(props: Props) {
  const { p, time, zoom, selected, thumbs } = props;
  const scroller = useRef<HTMLDivElement>(null);
  const total = duration(p);
  const [slide, setSlide] = useState<null | { id: string; x0: number; dx: number; moved: boolean }>(
    null,
  );
  /** Pointer handlers for titles and music: click selects, drag moves in time. */
  const slider = (id: string, start: number) => ({
    onPointerDown: (e: React.PointerEvent) => {
      if (props.disabled || e.button !== 0) return;
      e.stopPropagation();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      setSlide({ id, x0: e.clientX, dx: 0, moved: false });
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (!slide || slide.id !== id) return;
      const dx = e.clientX - slide.x0;
      if (slide.moved || Math.abs(dx) > 5) setSlide({ ...slide, dx, moved: true });
    },
    onPointerUp: (e: React.PointerEvent) => {
      if (!slide || slide.id !== id) return;
      if (slide.moved) {
        props.onMoveItem(id, Math.max(0, start + slide.dx / zoom));
        props.onSelect(id);
      } else {
        props.onSelect(id);
        props.onSeek(toTime(e.clientX));
      }
      setSlide(null);
    },
    onPointerCancel: () => setSlide(null),
  });
  const shift = (id: string) => (slide?.id === id && slide.moved ? slide.dx : 0);
  const width = Math.max(
    total * zoom + 240,
    900,
    ...p.titles.map((t) => (t.start + t.duration) * zoom + 120),
    ...p.music.map((u) => musicEnd(u) * zoom + 120),
  );
  const begin = starts(p);
  const step = rulerStep(zoom);
  const [drag, setDrag] = useState<null | {
    id: string;
    x0: number;
    dx: number;
    moved: boolean;
  }>(null);

  const toTime = (clientX: number) => {
    const el = scroller.current!;
    const x = clientX - el.getBoundingClientRect().left + el.scrollLeft - PAD;
    return Math.max(0, Math.min(total, x / zoom));
  };

  // Keep the playhead in view while playing.
  useEffect(() => {
    const el = scroller.current;
    if (!el || !props.playing) return;
    const x = time * zoom + PAD;
    if (x > el.scrollLeft + el.clientWidth - 60 || x < el.scrollLeft)
      el.scrollLeft = Math.max(0, x - 120);
  }, [time, zoom, props.playing]);

  // Ctrl/⌘ + wheel zooms around the pointer.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const next = Math.min(400, Math.max(4, zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      props.onZoom(Math.round(next * 10) / 10);
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [zoom, props.onZoom]);

  const scrub = (e: React.PointerEvent) => {
    if (!total || props.disabled) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    props.onSeek(toTime(e.clientX));
  };

  // Where a dragged clip would land, as an insertion index.
  const dropIndex = (() => {
    if (!drag?.moved) return -1;
    const i = p.clips.findIndex((c) => c.id === drag.id);
    if (i < 0) return -1;
    const center = (begin[i] + clipLength(p.clips[i]) / 2) * zoom + drag.dx;
    let to = 0;
    p.clips.forEach((c, j) => {
      if (j !== i && (begin[j] + clipLength(c) / 2) * zoom < center) to++;
    });
    return to;
  })();
  const markerX = (() => {
    if (dropIndex < 0 || !drag) return 0;
    const others = p.clips.filter((c) => c.id !== drag.id);
    return others.slice(0, dropIndex).reduce((s, c) => s + clipLength(c), 0) * zoom;
  })();

  return (
    <div className="tl" ref={scroller}>
      <div className="tl-inner" style={{ width }}>
        <div
          className="tl-ruler"
          onPointerDown={scrub}
          onPointerMove={(e) => e.buttons === 1 && scrub(e)}
          role="slider"
          aria-label="Playhead position"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={time}
        >
          {Array.from(
            { length: Math.min(600, Math.ceil((width - PAD) / zoom / step) + 1) },
            (_, i) => (
              <span key={i} className="tick" style={{ left: PAD + i * step * zoom }}>
                {i * step >= 1 || i === 0 ? clock(i * step).replace(/\.00$/, "") : ""}
              </span>
            ),
          )}
        </div>
        <div className="tl-lanes" onPointerDown={(e) => {
          if (e.target === e.currentTarget) scrub(e);
        }}>
          <div className="lane title-lane">
            {p.titles.map((t) => (
              <div
                key={t.id}
                className={`ttl ${selected === t.id ? "selected" : ""} ${shift(t.id) ? "dragging" : ""}`}
                style={{
                  left: PAD + t.start * zoom + shift(t.id),
                  width: Math.max(14, t.duration * zoom - 2),
                }}
                title={`${t.text} (${clock(t.start)} to ${clock(t.start + t.duration)})`}
                {...slider(t.id, t.start)}
              >
                <b>T</b>
                <span>{t.text}</span>
              </div>
            ))}
            {!p.titles.length && (
              <p className="lane-hint">Titles: press T to add text at the playhead</p>
            )}
          </div>
          <div className="lane video-lane">
            {p.clips.map((c, i) => {
              const m = p.media.find((m) => m.id === c.mediaId);
              const len = clipLength(c);
              const isDrag = drag?.id === c.id && drag.moved;
              const thumb = thumbs[c.mediaId];
              return (
                <div
                  key={c.id}
                  className={`clip ${selected === c.id ? "selected" : ""} ${isDrag ? "dragging" : ""}`}
                  style={{
                    left: PAD + begin[i] * zoom + (isDrag ? drag.dx : 0),
                    width: Math.max(4, len * zoom - 2),
                    backgroundImage: thumb ? `url("${thumb}")` : undefined,
                  }}
                  title={`${m?.name ?? "Missing"} · ${clock(len)}`}
                  onPointerDown={(e) => {
                    if (props.disabled || e.button !== 0) return;
                    e.stopPropagation();
                    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                    setDrag({ id: c.id, x0: e.clientX, dx: 0, moved: false });
                  }}
                  onPointerMove={(e) => {
                    if (!drag || drag.id !== c.id) return;
                    const dx = e.clientX - drag.x0;
                    if (drag.moved || Math.abs(dx) > 6)
                      setDrag({ ...drag, dx, moved: true });
                  }}
                  onPointerUp={(e) => {
                    if (!drag || drag.id !== c.id) return;
                    if (drag.moved && dropIndex >= 0) props.onMove(c.id, dropIndex);
                    else {
                      props.onSelect(c.id);
                      props.onSeek(toTime(e.clientX));
                    }
                    setDrag(null);
                  }}
                  onPointerCancel={() => setDrag(null)}
                >
                  {c.fadeIn > 0 && (
                    <i className="fade in" style={{ width: c.fadeIn * zoom }} />
                  )}
                  {c.fadeOut > 0 && (
                    <i className="fade out" style={{ width: c.fadeOut * zoom }} />
                  )}
                  {c.blend && (
                    <i
                      className="blend-zone"
                      style={{ width: c.blend.duration * zoom }}
                      aria-hidden
                    />
                  )}
                  <span
                    className="clip-label"
                    style={c.blend ? { left: 7 + c.blend.duration * zoom } : undefined}
                  >
                    <b>
                      {c.speed !== 1 && <em className="speed">{c.speed}×</em>}
                      {m?.name ?? "Missing media"}
                    </b>
                    <small>{clock(len)}</small>
                  </span>
                </div>
              );
            })}
            {p.clips.map((c, i) => {
              if (i === 0 || drag?.moved) return null;
              const x = PAD + (begin[i] + (c.blend ? c.blend.duration / 2 : 0)) * zoom;
              const id = `tr:${c.id}`;
              return (
                <button
                  key={id}
                  className={`cut ${c.blend ? "has" : ""} ${selected === id ? "selected" : ""}`}
                  style={{ left: x }}
                  title={c.blend ? `${c.blend.kind} transition, ${c.blend.duration} s` : "Add a transition"}
                  aria-label={c.blend ? `Edit ${c.blend.kind} transition` : "Add a transition between these clips"}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => props.onSelect(id)}
                >
                  <span>{c.blend ? "⧓" : "+"}</span>
                </button>
              );
            })}
            {!p.clips.length && (
              <p className="lane-empty">
                Drop videos here or add them from Media. Clips play left to right.
              </p>
            )}
          </div>
          <div className="lane audio-lane">
            {p.clips.map((c, i) => {
              const m = p.media.find((m) => m.id === c.mediaId);
              const isDrag = drag?.id === c.id && drag.moved;
              const silent = !m?.audio || c.volume === 0;
              return (
                <div
                  key={c.id}
                  className={`audio ${selected === c.id ? "selected" : ""} ${silent ? "silent" : ""}`}
                  style={{
                    left: PAD + begin[i] * zoom + (isDrag ? drag.dx : 0),
                    width: Math.max(4, clipLength(c) * zoom - 2),
                  }}
                >
                  <i
                    className="level"
                    style={{ height: `${Math.min(100, c.volume * 50)}%` }}
                  />
                  <small>
                    {!m?.audio ? "No sound" : c.volume === 0 ? "Muted" : `${Math.round(c.volume * 100)}%`}
                  </small>
                </div>
              );
            })}
          </div>
          <div className="lane music-lane">
            {p.music.map((u) => {
              const m = p.media.find((m) => m.id === u.mediaId);
              const thumb = thumbs[u.mediaId];
              const beyond = u.start + (u.out - u.in) > total + 1e-3;
              return (
                <div
                  key={u.id}
                  className={`song ${selected === u.id ? "selected" : ""} ${shift(u.id) ? "dragging" : ""}`}
                  style={{
                    left: PAD + u.start * zoom + shift(u.id),
                    width: Math.max(14, (u.out - u.in) * zoom - 2),
                    backgroundImage: thumb ? `url("${thumb}")` : undefined,
                  }}
                  title={`${m?.name ?? "Missing"}${beyond ? " (runs past the end of the video)" : ""}`}
                  {...slider(u.id, u.start)}
                >
                  {u.fadeIn > 0 && <i className="fade in" style={{ width: u.fadeIn * zoom }} />}
                  {u.fadeOut > 0 && <i className="fade out" style={{ width: u.fadeOut * zoom }} />}
                  <span>
                    ♪ {m?.name ?? "Missing"} · {Math.round(u.volume * 100)}%
                  </span>
                </div>
              );
            })}
            {!p.music.length && (
              <p className="lane-hint">Music: press M or use Add music</p>
            )}
            {total > 0 && <div className="end-mark" style={{ left: PAD + total * zoom }} />}
          </div>
          {dropIndex >= 0 && (
            <div className="drop-marker" style={{ left: PAD + markerX - 1 }} />
          )}
        </div>
        <div className="playhead" style={{ left: PAD + time * zoom }}>
          <span />
        </div>
      </div>
    </div>
  );
}
