export interface Media {
  id: string;
  path: string;
  name: string;
  duration: number;
  width: number;
  height: number;
  audio: boolean;
  /** "audio" for sound files (music); videos may omit it. */
  kind?: "video" | "audio";
}
export interface Clip {
  id: string;
  mediaId: string;
  in: number;
  out: number;
  /** Linear gain: 0 = muted, 1 = original, 2 = +6 dB. */
  volume: number;
  fadeIn: number;
  fadeOut: number;
  /** 0.25 (slow motion) to 4 (fast forward). */
  speed: number;
  /** Transition from the previous clip; never on the first clip. */
  blend: Blend | null;
}
export type BlendKind = "dissolve" | "dip" | "wipe" | "slide";
export interface Blend {
  kind: BlendKind;
  duration: number;
}
export interface Project {
  version: number;
  name: string;
  width: number;
  height: number;
  fps: number;
  media: Media[];
  clips: Clip[];
  titles: Title[];
  music: Music[];
  /** Lower the music while clips have sound. */
  duckMusic: boolean;
}
export interface Title {
  id: string;
  text: string;
  start: number;
  duration: number;
  placement: "top" | "center" | "bottom";
  size: "small" | "medium" | "large";
  color: string;
  backdrop: boolean;
}
export interface Music {
  id: string;
  mediaId: string;
  start: number;
  in: number;
  out: number;
  volume: number;
  fadeIn: number;
  fadeOut: number;
}
export interface Loaded {
  project: Project;
  path: string | null;
  missing: string[];
}
export interface Recent {
  path: string;
  name: string;
  folder: string;
  exists: boolean;
}
export interface Diagnostics {
  ready: boolean;
  hardware: boolean;
  bundled: boolean;
  version: string;
  message: string;
}
export type Quality = "high" | "standard" | "small";
export interface ExportOptions {
  quality: Quality;
  hardware: boolean;
}
