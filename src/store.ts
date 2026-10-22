import { create } from "zustand";
import { fresh, commit, undo, redo } from "./engine.mjs";
import type { History } from "./engine.mjs";
import type { Project } from "./types";
interface Store {
  h: History;
  set: (p: Project) => void;
  reset: (p: Project) => void;
  undo: () => void;
  redo: () => void;
}
export const useEditor = create<Store>((set) => ({
  h: { past: [], present: fresh(), future: [] },
  set: (p: Project) => set((s: Store) => ({ h: commit(s.h, p) })),
  reset: (p: Project) => set({ h: { past: [], present: p, future: [] } }),
  undo: () => set((s: Store) => ({ h: undo(s.h) })),
  redo: () => set((s: Store) => ({ h: redo(s.h) })),
}));
