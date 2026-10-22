import React, { useEffect, useRef, useState } from "react";
import type { ExportOptions, Project, Quality } from "../types";
import { duration } from "../engine.mjs";
import { clock, eta, fileName } from "../format";

export function Modal(props: {
  title: string;
  children: React.ReactNode;
  onClose?: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const first = ref.current?.querySelector<HTMLElement>("button.primary, button, select");
    first?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && props.onClose) {
        e.stopPropagation();
        props.onClose();
      }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, []);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && props.onClose?.()}>
      <div
        className={`dialog ${props.wide ? "wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
        ref={ref}
      >
        <h2>{props.title}</h2>
        {props.children}
      </div>
    </div>
  );
}

const QUALITIES: [Quality, string, string][] = [
  ["high", "Best quality", "Largest file. Good for archiving or YouTube."],
  ["standard", "Balanced", "Great picture at a sensible size. Recommended."],
  ["small", "Smaller file", "Easy to send on WhatsApp, Messenger or email."],
];

export function ExportDialog(props: {
  p: Project;
  hardware: boolean;
  initial: ExportOptions;
  onCancel: () => void;
  onExport: (o: ExportOptions) => void;
}) {
  const [o, setO] = useState<ExportOptions>({
    ...props.initial,
    hardware: props.initial.hardware && props.hardware,
  });
  return (
    <Modal title="Export video" onClose={props.onCancel}>
      <p className="lede">
        {props.p.width}×{props.p.height}, {props.p.fps} fps, {clock(duration(props.p))} long.
        MP4 with H.264 video and AAC sound plays almost everywhere.
      </p>
      <fieldset className="choices">
        <legend>Quality</legend>
        {QUALITIES.map(([q, title, text]) => (
          <label key={q} className={o.quality === q ? "on" : ""}>
            <input
              type="radio"
              name="quality"
              checked={o.quality === q}
              onChange={() => setO({ ...o, quality: q })}
            />
            <b>{title}</b>
            <small>{text}</small>
          </label>
        ))}
      </fieldset>
      <label className={`toggle ${props.hardware ? "" : "off"}`}>
        <input
          type="checkbox"
          disabled={!props.hardware}
          checked={o.hardware}
          onChange={(e) => setO({ ...o, hardware: e.target.checked })}
        />
        <span>
          <b>Use NVIDIA graphics card</b>
          <small>
            {props.hardware
              ? "Usually several times faster. Turn off if the export looks wrong."
              : "No supported NVIDIA encoder was found, so the processor is used."}
          </small>
        </span>
      </label>
      <div className="actions">
        <button onClick={props.onCancel}>Cancel</button>
        <button className="primary" onClick={() => props.onExport(o)}>
          Choose where to save…
        </button>
      </div>
    </Modal>
  );
}

export function ProgressDialog(props: {
  title: string;
  stage: string;
  fraction: number;
  started: number;
  onCancel: () => void;
}) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const elapsed = (Date.now() - props.started) / 1000;
  const remaining =
    props.fraction > 0.03 && elapsed > 3
      ? (elapsed / props.fraction) * (1 - props.fraction)
      : NaN;
  return (
    <Modal title={props.title}>
      <p className="lede">{props.stage || "Starting"}</p>
      <div className="meter" aria-hidden>
        <i style={{ width: `${Math.round(props.fraction * 100)}%` }} />
      </div>
      <p className="meter-row">
        <b>{Math.round(props.fraction * 100)}%</b>
        <span>{eta(remaining)}</span>
      </p>
      <p className="hint">
        You can keep this window open while it works. The finished file is
        checked before it is saved.
      </p>
      <div className="actions">
        <button className="danger" onClick={props.onCancel}>
          Stop
        </button>
      </div>
    </Modal>
  );
}

export function DoneDialog(props: {
  path: string;
  encoder: string;
  seconds: number;
  onReveal: () => void;
  onClose: () => void;
}) {
  return (
    <Modal title="Your video is ready" onClose={props.onClose}>
      <p className="lede">
        Saved as <b>{fileName(props.path)}</b>
      </p>
      <p className="hint">
        {props.path}
        <br />
        Rendered with {props.encoder} in {clock(props.seconds).replace(/\.\d\d$/, "")}.
      </p>
      <div className="actions">
        <button onClick={props.onClose}>Done</button>
        <button className="primary" onClick={props.onReveal}>
          Show in folder
        </button>
      </div>
    </Modal>
  );
}

export function UnsavedDialog(props: {
  quitting: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal title="Save changes first?" onClose={props.onCancel}>
      <p className="lede">
        {props.quitting
          ? "This project has edits that are not saved to a project file."
          : "Your current project has edits that are not saved to a project file."}
      </p>
      <div className="actions">
        <button onClick={props.onCancel}>Keep editing</button>
        <button className="danger" onClick={props.onDiscard}>
          {props.quitting ? "Quit without saving" : "Don't save"}
        </button>
        <button className="primary" onClick={props.onSave}>
          Save
        </button>
      </div>
    </Modal>
  );
}

const SHORTCUTS: [string, string][] = [
  ["Space", "Play or pause"],
  ["← / →", "Step one frame"],
  ["Shift + ← / →", "Jump one second"],
  ["Home / End", "Go to start or end"],
  ["S", "Split clip at playhead"],
  ["Q", "Trim clip start to playhead"],
  ["W", "Trim clip end to playhead"],
  ["Delete", "Remove selected clip, title or music"],
  ["T", "Add a title at the playhead"],
  ["M", "Add music at the playhead"],
  ["Ctrl + D", "Duplicate selected clip"],
  ["Ctrl + Z", "Undo"],
  ["Ctrl + Shift + Z or Ctrl + Y", "Redo"],
  ["Ctrl + S", "Save"],
  ["Ctrl + Shift + S", "Save as"],
  ["Ctrl + O", "Open project"],
  ["Ctrl + I", "Import videos"],
  ["Ctrl + E", "Export video"],
  ["Ctrl + = / Ctrl + −", "Zoom timeline"],
  ["Esc", "Deselect clip"],
];

export function ShortcutsDialog(props: { onClose: () => void }) {
  return (
    <Modal title="Keyboard shortcuts" onClose={props.onClose} wide>
      <dl className="shortcuts">
        {SHORTCUTS.map(([k, v]) => (
          <React.Fragment key={k}>
            <dt>
              <kbd>{k}</kbd>
            </dt>
            <dd>{v}</dd>
          </React.Fragment>
        ))}
      </dl>
      <div className="actions">
        <button className="primary" onClick={props.onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}

export function AboutDialog(props: {
  version: string;
  engine: string;
  update: string | null;
  onLink: (w: "releases" | "website" | "ffmpeg") => void;
  onClose: () => void;
}) {
  return (
    <Modal title="EditNova Studio" onClose={props.onClose}>
      <p className="lede">Version {props.version || "unknown"}</p>
      {props.update && (
        <p className="notice">
          Version {props.update} is available.{" "}
          <button className="link" onClick={() => props.onLink("releases")}>
            Download it
          </button>
        </p>
      )}
      <p className="hint">
        A free video editor that works entirely on your computer. Nothing you
        edit is uploaded.
      </p>
      <p className="hint">
        Media engine: {props.engine || "not checked yet"}. EditNova includes FFmpeg
        (GPL) as a separate program, with its license in the install folder.{" "}
        <button className="link" onClick={() => props.onLink("ffmpeg")}>
          FFmpeg legal notes
        </button>
      </p>
      <div className="actions">
        <button onClick={() => props.onLink("website")}>Website</button>
        <button className="primary" onClick={props.onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}
