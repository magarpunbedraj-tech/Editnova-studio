import React, { useCallback, useEffect, useRef, useState } from "react";
import { useEditor } from "./store";
import {
  duration,
  locate,
  trim,
  split,
  reorder,
  fresh,
  validate,
  migrate,
  moveTo,
  remove,
  duplicate,
  setAudio,
  setFades,
  trimToPlayhead,
  envelope,
  removeMedia,
  makeClip,
  starts,
} from "./engine.mjs";
import type { Diagnostics, ExportOptions, Loaded, Media, Project, Recent } from "./types";
import { api, checkForUpdate, desktop, fileUrl, message, on } from "./api";
import { clock, fileName } from "./format";
import { Timeline } from "./ui/Timeline";
import { Inspector, MediaBin, Welcome } from "./ui/Panels";
import {
  AboutDialog,
  DoneDialog,
  ExportDialog,
  Modal,
  ProgressDialog,
  ShortcutsDialog,
  UnsavedDialog,
} from "./ui/Dialogs";

type Notice = { text: string; error?: boolean };
type Job = { title: string; started: number };
type DialogName = "" | "export" | "shortcuts" | "about" | "busy-quit";

const readPref = <T,>(key: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
};
const writePref = (key: string, v: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* preferences are optional */
  }
};

export default function App() {
  const { h, set, reset, undo, redo } = useEditor();
  const p = h.present;
  const [path, setPath] = useState<string | null>(null);
  const [dirty, setDirtyState] = useState(false);
  const [selected, select] = useState("");
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [zoom, setZoom] = useState<number>(() => readPref("zoom", 60));
  const [theme, setTheme] = useState<string>(() => readPref("theme", "dark"));
  const [busy, setBusy] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  const [progress, setProgress] = useState({ fraction: 0, stage: "" });
  const [notice, setNotice] = useState<Notice>({
    text: "Ready. Everything stays on this computer.",
  });
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [dialog, setDialog] = useState<DialogName>("");
  const [done, setDone] = useState<null | { path: string; encoder: string; seconds: number }>(null);
  const [pending, setPending] = useState<null | { action: () => void; quitting: boolean }>(null);
  const [diag, setDiag] = useState<Diagnostics | null>(null);
  const [recent, setRecent] = useState<Recent[]>([]);
  const [recovery, setRecovery] = useState(false);
  const [hover, setHover] = useState(false);
  const [version, setVersion] = useState("");
  const [update, setUpdate] = useState<string | null>(null);
  const [videoFailed, setVideoFailed] = useState(false);
  const [exportOptions, setExportOptions] = useState<ExportOptions>(() =>
    readPref("export", { quality: "standard", hardware: true }),
  );
  const autosaveOn = useRef(false);
  const video = useRef<HTMLVideoElement>(null);
  const latest = useRef({ p, dirty });
  latest.current = { p, dirty };

  const total = duration(p);
  const at = locate(p, Math.min(time, Math.max(0, total - 1e-5)));
  const active = at ? p.media.find((m) => m.id === at.clip.mediaId) : undefined;
  const clip = p.clips.find((c) => c.id === selected);
  const clipMedia = clip ? p.media.find((m) => m.id === clip.mediaId) : undefined;
  const empty = !p.media.length && !p.clips.length;

  const say = (text: string) => setNotice({ text });
  const fail = (e: unknown) => setNotice({ text: message(e), error: true });

  const markDirty = (v: boolean) => {
    setDirtyState(v);
    if (desktop()) api.setDirty(v).catch(() => {});
  };

  function change(next: Project) {
    validate(next);
    setPlaying(false);
    set(next);
    markDirty(true);
    autosaveOn.current = true;
  }
  function edit(fn: () => void) {
    try {
      fn();
    } catch (e) {
      fail(e);
    }
  }
  async function task(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try {
      if (!desktop())
        throw Error("This is a browser preview. Install the EditNova app to work with files.");
      await fn();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  // ----- Startup -----
  const refreshRecent = () => {
    if (!desktop()) return;
    api.recent().then(setRecent).catch(() => {});
    api.hasRecovery().then(setRecovery).catch(() => {});
  };
  useEffect(() => {
    if (!desktop()) return;
    refreshRecent();
    api.diagnostics().then(setDiag).catch((e) =>
      setDiag({ ready: false, hardware: false, bundled: false, version: "", message: message(e) }),
    );
    api
      .version()
      .then((v) => {
        setVersion(v);
        return checkForUpdate(v);
      })
      .then((u) => u && setUpdate(u))
      .catch(() => {});
    api
      .startupProject()
      .then((file) => {
        if (file) openPath(file);
      })
      .catch(fail);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    writePref("theme", theme);
  }, [theme]);
  useEffect(() => writePref("zoom", zoom), [zoom]);

  // ----- Autosave recovery checkpoint -----
  useEffect(() => {
    if (!desktop() || !autosaveOn.current) return;
    const id = setTimeout(() => {
      api.autosave(p).catch((e) => fail(`Recovery checkpoint failed: ${message(e)}`));
    }, 1500);
    return () => clearTimeout(id);
  }, [p]);

  // ----- Poster frames -----
  const requested = useRef(new Set<string>());
  useEffect(() => {
    if (!desktop()) return;
    let stop = false;
    (async () => {
      for (const m of p.media) {
        const key = `${m.id}|${m.path}`;
        if (requested.current.has(key)) continue;
        requested.current.add(key);
        const t = await api.thumbnail(m).catch(() => null);
        if (stop) return;
        if (t) setThumbs((x) => ({ ...x, [m.id]: fileUrl(t) }));
      }
    })();
    return () => {
      stop = true;
    };
  }, [p.media]);

  // ----- Backend events -----
  useEffect(() => {
    const offs = [
      on<{ fraction: number; stage: string }>("render-progress", setProgress),
      on<boolean>("drag-hover", setHover),
      on<{ items: Media[]; errors: string[] }>("media-dropped", ({ items, errors }) => {
        const cur = latest.current.p;
        if (items.length) {
          const clips = items.map((m) => makeClip(crypto.randomUUID(), m));
          edit(() =>
            change({ ...cur, media: [...cur.media, ...items], clips: [...cur.clips, ...clips] }),
          );
        }
        if (errors.length) setNotice({ text: errors.join(" "), error: true });
        else if (items.length)
          say(`Added ${items.length} video${items.length > 1 ? "s" : ""} to the timeline.`);
      }),
      on<string>("project-dropped", (file) => guard(() => openPath(file))),
      on<null>("close-requested", () => {
        if (jobRef.current) setDialog("busy-quit");
        else if (latest.current.dirty) setPending({ action: () => api.quit(), quitting: true });
        else api.quit();
      }),
    ];
    return () => offs.forEach((f) => f());
  }, []);
  const jobRef = useRef<Job | null>(null);
  jobRef.current = job;

  // ----- Playback -----
  function seek(n: number) {
    const t = Math.min(Math.max(n, 0), total);
    setTime(t);
    const pos = locate(p, Math.min(t, Math.max(0, total - 1 / p.fps)));
    if (pos && video.current && at?.clip.id === pos.clip.id)
      video.current.currentTime = pos.source;
  }
  useEffect(() => {
    if (time > total) {
      setTime(total);
      setPlaying(false);
    }
  }, [total, time]);
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    if (playing)
      v.play().catch((e) => {
        setPlaying(false);
        fail(`This video cannot play in the preview (${message(e)}). Build a smooth preview for it.`);
      });
    else v.pause();
  }, [playing, at?.clip.id]);
  function advance() {
    if (!at) return;
    const end = at.start + at.clip.out - at.clip.in;
    if (end >= total - 0.001) {
      setPlaying(false);
      setTime(total);
    } else setTime(end + 0.000001);
  }
  useEffect(() => {
    if (!playing || !at) return;
    let id = 0;
    const tick = () => {
      const v = video.current;
      if (v && !v.seeking && v.readyState >= 2) {
        if (v.currentTime >= at.clip.out - 0.005) {
          advance();
          return;
        }
        setTime(at.start + Math.max(0, v.currentTime - at.clip.in));
      }
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [playing, at?.clip.id]);

  // Fade and volume preview.
  const level = at ? envelope(at.clip, time - at.start) : 1;
  useEffect(() => {
    if (video.current && at) video.current.volume = Math.min(1, at.clip.volume * level);
  }, [level, at?.clip.volume, at?.clip.id]);

  // ----- Project files -----
  function load(result: Loaded, recovered: boolean) {
    setPlaying(false);
    reset(validate(migrate(result.project)));
    select("");
    setTime(0);
    setPath(result.path);
    markDirty(recovered);
    autosaveOn.current = recovered;
    setPreviews({});
    refreshRecent();
    if (result.missing.length)
      setNotice({
        text: `Can't find ${result.missing.join(", ")}. Select each affected clip and choose Replace or relink source.`,
        error: true,
      });
    else
      say(
        recovered
          ? "Recovered your last session. Save it to keep it."
          : `Opened ${fileName(result.path || "")}`,
      );
  }
  const openDialog = (recovered = false) =>
    task(async () => {
      const r = await api.open(recovered);
      if (r) load(r, recovered);
      else if (recovered) say("There is no session to recover.");
    });
  const openPath = (file: string) =>
    task(async () => load(await api.openPath(file), false));

  async function save(asNew = false): Promise<boolean> {
    if (!desktop()) {
      fail("Install the EditNova app to save projects.");
      return false;
    }
    try {
      setBusy(true);
      const saved = await api.save(latest.current.p, asNew ? null : path);
      if (!saved) return false;
      setPath(saved);
      markDirty(false);
      refreshRecent();
      say(`Saved ${fileName(saved)}`);
      return true;
    } catch (e) {
      fail(e);
      return false;
    } finally {
      setBusy(false);
    }
  }
  const guard = (action: () => void) => {
    if (latest.current.dirty) setPending({ action, quitting: false });
    else action();
  };
  const newProject = () =>
    guard(() => {
      reset(fresh());
      setPath(null);
      setTime(0);
      select("");
      markDirty(false);
      autosaveOn.current = false;
      setPlaying(false);
      refreshRecent();
      say("New project");
    });

  const importMedia = () =>
    task(async () => {
      const items = await api.importMedia();
      if (!items.length) return;
      const cur = latest.current.p;
      const firstTime = !cur.clips.length;
      const next = { ...cur, media: [...cur.media, ...items] };
      if (firstTime) next.clips = items.map((m) => makeClip(crypto.randomUUID(), m));
      change(next);
      say(
        firstTime
          ? `Imported ${items.length} video${items.length > 1 ? "s" : ""} and placed them on the timeline.`
          : `Imported ${items.length} video${items.length > 1 ? "s" : ""}. Click Add to place them on the timeline.`,
      );
    });

  // ----- Media jobs -----
  async function runJob(title: string, fn: () => Promise<void>) {
    setPlaying(false);
    setProgress({ fraction: 0, stage: "Preparing" });
    const j = { title, started: Date.now() };
    setJob(j);
    try {
      await task(fn);
    } finally {
      setJob(null);
    }
  }
  const startExport = (o: ExportOptions) => {
    setDialog("");
    setExportOptions(o);
    writePref("export", o);
    const began = Date.now();
    runJob("Exporting your video", async () => {
      const r = await api.exportVideo(latest.current.p, o);
      if (r) {
        setDone({ ...r, seconds: (Date.now() - began) / 1000 });
        say(`Exported ${fileName(r.path)}`);
      } else say("Export cancelled.");
    });
  };
  const buildPreview = (m: Media) =>
    runJob("Building a smooth preview", async () => {
      const file = await api.preview(m);
      setPreviews((v) => ({ ...v, [m.path]: file }));
      setVideoFailed(false);
      say("Smooth preview ready. Your export still uses the original file.");
    });

  // ----- Editing -----
  const splitHere = () =>
    edit(() => change(split(p, Math.round(time * p.fps) / p.fps, crypto.randomUUID())));
  const removeSelected = () => {
    if (!clip) return;
    edit(() => change(remove(p, clip.id)));
    select("");
  };
  const doUndo = () => {
    setPlaying(false);
    undo();
    markDirty(true);
    autosaveOn.current = true;
  };
  const doRedo = () => {
    setPlaying(false);
    redo();
    markDirty(true);
    autosaveOn.current = true;
  };
  const openExport = () => {
    if (!p.clips.length) return fail("Add at least one clip to the timeline before exporting.");
    if (diag && !diag.ready) return fail(diag.message);
    setDialog("export");
  };
  const zoomBy = (k: number) => setZoom((z) => Math.min(400, Math.max(4, Math.round(z * k * 10) / 10)));
  const fit = useCallback(() => {
    const w = (document.querySelector(".tl")?.clientWidth || 900) - 80;
    setZoom(total ? Math.min(400, Math.max(4, Math.round((w / total) * 10) / 10)) : 60);
  }, [total]);

  // ----- Keyboard -----
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.matches("input:not([type=range]),textarea,select") || busy || job || dialog || pending || done)
        return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      const frame = 1 / p.fps;
      if (mod && k === "s") {
        e.preventDefault();
        save(e.shiftKey);
      } else if (mod && (k === "z" || k === "y")) {
        e.preventDefault();
        e.shiftKey || k === "y" ? doRedo() : doUndo();
      } else if (mod && k === "o") {
        e.preventDefault();
        guard(() => openDialog());
      } else if (mod && k === "i") {
        e.preventDefault();
        importMedia();
      } else if (mod && k === "e") {
        e.preventDefault();
        openExport();
      } else if (mod && k === "d") {
        e.preventDefault();
        if (clip) edit(() => change(duplicate(p, clip.id, crypto.randomUUID())));
      } else if (mod && (k === "=" || k === "+")) {
        e.preventDefault();
        zoomBy(1.25);
      } else if (mod && k === "-") {
        e.preventDefault();
        zoomBy(0.8);
      } else if (mod) {
        return;
      } else if (e.code === "Space") {
        e.preventDefault();
        if (total) {
          if (!playing && time >= total - frame) seek(0);
          setPlaying((v) => !v);
        }
      } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        setPlaying(false);
        const d = e.shiftKey ? 1 : frame;
        seek(time + (e.key === "ArrowRight" ? d : -d));
      } else if (e.key === "Home") {
        setPlaying(false);
        seek(0);
      } else if (e.key === "End") {
        setPlaying(false);
        seek(total);
      } else if (k === "s") splitHere();
      else if (k === "q") edit(() => change(trimToPlayhead(p, time, "in")));
      else if (k === "w") edit(() => change(trimToPlayhead(p, time, "out")));
      else if (e.key === "Delete" || e.key === "Backspace") removeSelected();
      else if (e.key === "Escape") select("");
      else if (e.key === "?") setDialog("shortcuts");
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  const src = active ? previews[active.path] || active.path : "";
  const previewing = !!(clipMedia && previews[clipMedia.path]);
  const engineBad = diag && !diag.ready;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <b className="logo" aria-hidden>
            N
          </b>
          <span>EditNova Studio</span>
        </div>
        <div className="file" title={path || undefined}>
          <strong>{p.name}</strong>
          <small>{dirty ? "Edited, not saved" : path ? "Saved" : "Not saved yet"}</small>
        </div>
        <nav className="menu">
          <button disabled={busy} onClick={newProject}>
            New
          </button>
          <button disabled={busy} onClick={() => guard(() => openDialog())}>
            Open
          </button>
          <button disabled={busy} onClick={() => save(false)}>
            Save
          </button>
          <button disabled={busy} onClick={() => save(true)}>
            Save as
          </button>
          <span className="sep" />
          <button title="Keyboard shortcuts (?)" onClick={() => setDialog("shortcuts")}>
            Shortcuts
          </button>
          <button onClick={() => setDialog("about")} className={update ? "has-update" : ""}>
            {update ? "Update available" : "About"}
          </button>
          <button
            aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            title="Switch theme"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            {theme === "dark" ? "☀" : "☾"}
          </button>
          <button className="primary" disabled={busy || !p.clips.length} onClick={openExport}>
            Export video
          </button>
        </nav>
      </header>

      {engineBad && (
        <div className="banner" role="alert">
          {diag!.message}
        </div>
      )}

      <div className="workspace">
        <MediaBin
          p={p}
          thumbs={thumbs}
          busy={busy}
          onImport={importMedia}
          onAdd={(m) =>
            edit(() => {
              const c = makeClip(crypto.randomUUID(), m);
              change({ ...p, clips: [...p.clips, c] });
              select(c.id);
            })
          }
          onRemove={(m) => edit(() => change(removeMedia(p, m.id)))}
        />
        <section className="monitor panel">
          {empty ? (
            <Welcome
              recent={recent}
              recovery={recovery}
              busy={busy}
              onNew={newProject}
              onOpen={() => openDialog()}
              onOpenRecent={(r) => openPath(r.path)}
              onForget={(r) =>
                api.forgetRecent(r.path).then(refreshRecent).catch(fail)
              }
              onRecover={() => openDialog(true)}
              onImport={importMedia}
            />
          ) : (
            <>
              <div className="stage">
                <div className="screen" style={{ "--ar": p.width / p.height } as React.CSSProperties}>
                  {active && at ? (
                    <>
                      <video
                        key={at.clip.id + src}
                        ref={video}
                        src={fileUrl(src)}
                        playsInline
                        preload="auto"
                        onLoadedMetadata={() => {
                          setVideoFailed(false);
                          const v = video.current;
                          if (v) {
                            v.currentTime = at.source;
                            v.volume = Math.min(1, at.clip.volume * level);
                            if (playing) v.play().catch(() => setPlaying(false));
                          }
                        }}
                        onEnded={() => playing && advance()}
                        onError={() => {
                          setPlaying(false);
                          setVideoFailed(true);
                        }}
                      />
                      <div className="fade-veil" style={{ opacity: 1 - level }} />
                      {videoFailed && (
                        <div className="screen-msg">
                          <p>The preview can't play {active.name}.</p>
                          <button
                            className="primary"
                            disabled={busy}
                            onClick={() => buildPreview(active)}
                          >
                            Build smooth preview
                          </button>
                          <small>Exports always use the original file.</small>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="screen-msg">
                      <p>Add a clip to the timeline to see it here.</p>
                    </div>
                  )}
                </div>
              </div>
              <div className="transport">
                <span className="timecode">
                  {clock(time)}
                  <i> / {clock(total)}</i>
                </span>
                <div className="buttons">
                  <button disabled={!total} title="Go to start (Home)" aria-label="Go to start" onClick={() => { setPlaying(false); seek(0); }}>
                    ⏮
                  </button>
                  <button disabled={!total} title="Previous frame (←)" aria-label="Previous frame" onClick={() => { setPlaying(false); seek(time - 1 / p.fps); }}>
                    ◂
                  </button>
                  <button
                    className="play"
                    disabled={!total}
                    aria-label={playing ? "Pause" : "Play"}
                    title="Play or pause (Space)"
                    onClick={() => {
                      if (!playing && time >= total - 1 / p.fps) seek(0);
                      setPlaying(!playing);
                    }}
                  >
                    {playing ? "❚❚" : "▶"}
                  </button>
                  <button disabled={!total} title="Next frame (→)" aria-label="Next frame" onClick={() => { setPlaying(false); seek(time + 1 / p.fps); }}>
                    ▸
                  </button>
                  <button disabled={!total} title="Go to end (End)" aria-label="Go to end" onClick={() => { setPlaying(false); seek(total); }}>
                    ⏭
                  </button>
                </div>
                <span className="format">
                  {p.width}×{p.height}, {p.fps} fps
                </span>
              </div>
            </>
          )}
        </section>
        <Inspector
          p={p}
          clip={clip}
          media={clipMedia}
          busy={busy}
          previewing={previewing}
          onProject={(q) => edit(() => change(q))}
          onTrim={(a, b) => edit(() => change(trim(p, clip!.id, a, b)))}
          onVolume={(v) => edit(() => change(setAudio(p, clip!.id, v)))}
          onFades={(a, b) => edit(() => change(setFades(p, clip!.id, a, b)))}
          onAction={(a) => {
            if (!clip || !clipMedia) return;
            if (a === "earlier" || a === "later")
              edit(() => change(reorder(p, clip.id, a === "earlier" ? -1 : 1)));
            else if (a === "duplicate")
              edit(() => change(duplicate(p, clip.id, crypto.randomUUID())));
            else if (a === "remove") removeSelected();
            else if (a === "preview") buildPreview(clipMedia);
            else if (a === "relink")
              task(async () => {
                const r = await api.relink();
                if (!r) return;
                const used = p.clips
                  .filter((c) => c.mediaId === clipMedia.id)
                  .reduce((m, c) => Math.max(m, c.out), 0);
                if (r.duration + 0.05 < used)
                  throw Error(
                    `${r.name} is ${clock(r.duration)} long, but clips use this source up to ${clock(used)}. Trim those clips first.`,
                  );
                change({
                  ...p,
                  media: p.media.map((m) => (m.id === clipMedia.id ? { ...r, id: m.id } : m)),
                });
                setVideoFailed(false);
                say(`Now using ${r.name}`);
              });
          }}
        />
      </div>

      <section className="timeline panel">
        <div className="tl-tools">
          <div className="group">
            <button disabled={!h.past.length || busy} onClick={doUndo} title="Undo (Ctrl+Z)">
              Undo
            </button>
            <button disabled={!h.future.length || busy} onClick={doRedo} title="Redo (Ctrl+Shift+Z)">
              Redo
            </button>
            <span className="sep" />
            <button disabled={!total || busy} onClick={splitHere} title="Split at playhead (S)">
              Split <kbd>S</kbd>
            </button>
            <button disabled={!clip || busy} onClick={removeSelected} title="Remove clip (Delete)">
              Delete <kbd>Del</kbd>
            </button>
          </div>
          <div className="group">
            <span className="meta">
              {p.clips.length} clip{p.clips.length === 1 ? "" : "s"}, {clock(total)}
            </span>
            <button aria-label="Zoom out" title="Zoom out (Ctrl −)" onClick={() => zoomBy(0.8)}>
              −
            </button>
            <input
              type="range"
              aria-label="Timeline zoom"
              min={4}
              max={400}
              value={zoom}
              onChange={(e) => setZoom(+e.target.value)}
            />
            <button aria-label="Zoom in" title="Zoom in (Ctrl +)" onClick={() => zoomBy(1.25)}>
              +
            </button>
            <button disabled={!total} onClick={fit} title="Fit the whole sequence">
              Fit
            </button>
          </div>
        </div>
        <Timeline
          p={p}
          time={time}
          zoom={zoom}
          playing={playing}
          selected={selected}
          thumbs={thumbs}
          disabled={busy}
          onSeek={(t) => {
            setPlaying(false);
            seek(t);
          }}
          onSelect={select}
          onMove={(id, to) => {
            edit(() => change(moveTo(p, id, to)));
            const q = moveTo(p, id, to);
            const i = q.clips.findIndex((c) => c.id === id);
            setTime(starts(q)[i]);
          }}
          onZoom={setZoom}
        />
      </section>

      <footer className={`status ${notice.error ? "error" : ""}`} role="status">
        <span>{notice.text}</span>
        <span className="engine">{diag ? (diag.ready ? (diag.hardware ? "GPU export ready" : "CPU export ready") : "Media engine missing") : ""}</span>
      </footer>

      {hover && (
        <div className="drop-zone" aria-hidden>
          <p>Drop videos to add them to the timeline</p>
        </div>
      )}
      {dialog === "export" && (
        <ExportDialog
          p={p}
          hardware={!!diag?.hardware}
          initial={exportOptions}
          onCancel={() => setDialog("")}
          onExport={startExport}
        />
      )}
      {job && (
        <ProgressDialog
          title={job.title}
          stage={progress.stage}
          fraction={progress.fraction}
          started={job.started}
          onCancel={() => api.cancel().catch(fail)}
        />
      )}
      {done && (
        <DoneDialog
          {...done}
          onClose={() => setDone(null)}
          onReveal={() => {
            api.reveal(done.path).catch(fail);
            setDone(null);
          }}
        />
      )}
      {pending && (
        <UnsavedDialog
          quitting={pending.quitting}
          onCancel={() => setPending(null)}
          onDiscard={() => {
            const a = pending.action;
            setPending(null);
            markDirty(false);
            a();
          }}
          onSave={async () => {
            const a = pending.action;
            setPending(null);
            if (await save(false)) a();
          }}
        />
      )}
      {dialog === "busy-quit" && (
        <Modal title="Stop and quit?" onClose={() => setDialog("")}>
          <p className="lede">A video is still being rendered. Quitting stops it and nothing is saved.</p>
          <div className="actions">
            <button onClick={() => setDialog("")}>Keep working</button>
            <button className="danger" onClick={() => api.quit()}>
              Stop and quit
            </button>
          </div>
        </Modal>
      )}
      {dialog === "shortcuts" && <ShortcutsDialog onClose={() => setDialog("")} />}
      {dialog === "about" && (
        <AboutDialog
          version={version}
          engine={diag ? `${diag.version || "FFmpeg"}${diag.hardware ? ", NVIDIA NVENC available" : ""}` : ""}
          update={update}
          onLink={(w) => api.openLink(w).catch(fail)}
          onClose={() => setDialog("")}
        />
      )}
    </div>
  );
}
