import type { Diagram } from './model';

/** Undo/redo as snapshots of the whole drawing (drawings are small). Also used by the board. */
export class History<T = Diagram> {
  private past: T[] = [];
  private future: T[] = [];

  constructor(private limit = 200) {}

  /** Call with the drawing as it was before a change. */
  record(before: T): void {
    this.past.push(before);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }

  undo(current: T): T | null {
    const previous = this.past.pop();
    if (!previous) return null;
    this.future.push(current);
    return previous;
  }

  redo(current: T): T | null {
    const next = this.future.pop();
    if (!next) return null;
    this.past.push(current);
    return next;
  }

  /** Take back the last `record` if it was `before` (a change that came to nothing, e.g. an empty new card). */
  forget(before: T): void {
    if (this.past[this.past.length - 1] === before) this.past.pop();
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }
}
