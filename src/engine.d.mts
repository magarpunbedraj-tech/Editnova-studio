import type { Clip, Media, Project } from "./types";
export type History = { past: Project[]; present: Project; future: Project[] };
export const VERSION: number;
export const FPS: number[];
export const MAX_FADE: number;
export const MAX_VOLUME: number;
export function fresh(): Project;
export function clipLength(c: Clip): number;
export function duration(p: Project): number;
export function makeClip(id: string, media: Media, a?: number, b?: number): Clip;
export function migrate(p: Project): Project;
export function locate(
  p: Project,
  time: number,
): { clip: Clip; index: number; start: number; source: number } | null;
export function starts(p: Project): number[];
export function validate(p: Project): Project;
export function trim(p: Project, id: string, a: number, b: number): Project;
export function trimToPlayhead(p: Project, time: number, side: "in" | "out"): Project;
export function split(p: Project, time: number, id: string): Project;
export function reorder(p: Project, id: string, delta: number): Project;
export function moveTo(p: Project, id: string, to: number): Project;
export function remove(p: Project, id: string): Project;
export function duplicate(p: Project, id: string, newId: string): Project;
export function setAudio(p: Project, id: string, volume: number): Project;
export function setFades(p: Project, id: string, fadeIn: number, fadeOut: number): Project;
export function removeMedia(p: Project, mediaId: string): Project;
export function envelope(c: Clip, offset: number): number;
export function commit(h: History, next: Project): History;
export function undo(h: History): History;
export function redo(h: History): History;
