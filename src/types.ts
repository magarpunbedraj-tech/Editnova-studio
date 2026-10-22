export interface Media {
  id: string;
  path: string;
  name: string;
  duration: number;
  width: number;
  height: number;
  audio: boolean;
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
}
export interface Project {
  version: number;
  name: string;
  width: number;
  height: number;
  fps: number;
  media: Media[];
  clips: Clip[];
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
