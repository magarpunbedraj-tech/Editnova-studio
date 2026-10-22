import { invoke, convertFileSrc, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getVersion } from "@tauri-apps/api/app";
import type {
  Diagnostics,
  ExportOptions,
  Loaded,
  Media,
  Project,
  Recent,
} from "./types";

export const desktop = () => isTauri();
export const fileUrl = (path: string) => convertFileSrc(path);

export const api = {
  importMedia: () => invoke<Media[]>("import_media"),
  relink: () => invoke<Media | null>("relink"),
  thumbnail: (m: Media) => invoke<string | null>("thumbnail", { m }),
  save: (p: Project, path: string | null) =>
    invoke<string | null>("save_project", { p, path }),
  autosave: (p: Project) => invoke<void>("autosave", { p }),
  open: (recovery: boolean) => invoke<Loaded | null>("open_project", { recovery }),
  openPath: (path: string) => invoke<Loaded>("open_project_path", { path }),
  recent: () => invoke<Recent[]>("recent_projects"),
  forgetRecent: (path: string) => invoke<void>("forget_recent", { path }),
  startupProject: () => invoke<string | null>("startup_project"),
  hasRecovery: () => invoke<boolean>("has_recovery"),
  exportVideo: (p: Project, options: ExportOptions) =>
    invoke<{ path: string; encoder: string } | null>("export_video", {
      p,
      options,
    }),
  cancel: () => invoke<void>("cancel_export"),
  preview: (m: Media) => invoke<string>("prepare_preview", { m }),
  diagnostics: () => invoke<Diagnostics>("diagnostics"),
  reveal: (path: string) => invoke<void>("reveal", { path }),
  openLink: (which: "releases" | "website" | "ffmpeg") =>
    invoke<void>("open_link", { which }),
  setDirty: (dirty: boolean) => invoke<void>("set_dirty", { dirty }),
  quit: () => invoke<void>("quit"),
  version: () => getVersion(),
};

/** Subscribes to a backend event; returns an unsubscribe function. */
export function on<T>(event: string, fn: (payload: T) => void): () => void {
  if (!desktop()) return () => {};
  let stop: (() => void) | undefined;
  let disposed = false;
  listen<T>(event, (e) => fn(e.payload))
    .then((u) => (disposed ? u() : (stop = u)))
    .catch(() => {});
  return () => {
    disposed = true;
    stop?.();
  };
}

const REPO = "magarpunbedraj-tech/Editnova-studio";

/** Returns the newer released version, if GitHub reports one. */
export async function checkForUpdate(current: string): Promise<string | null> {
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!r.ok) return null;
    const tag = String((await r.json()).tag_name || "").replace(/^v/, "");
    return newer(tag, current) ? tag : null;
  } catch {
    return null;
  }
}

export function newer(a: string, b: string): boolean {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0),
    pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
}

export const message = (e: unknown) =>
  String(e instanceof Error ? e.message : e).replace(/^Error:\s*/, "");
