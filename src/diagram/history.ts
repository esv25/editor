import type { Diagram } from './model';

/** Undo/redo as snapshots of the whole drawing (drawings are small). */
export class History {
  private past: Diagram[] = [];
  private future: Diagram[] = [];

  constructor(private limit = 200) {}

  /** Call with the drawing as it was before a change. */
  record(before: Diagram): void {
    this.past.push(before);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }

  undo(current: Diagram): Diagram | null {
    const previous = this.past.pop();
    if (!previous) return null;
    this.future.push(current);
    return previous;
  }

  redo(current: Diagram): Diagram | null {
    const next = this.future.pop();
    if (!next) return null;
    this.past.push(current);
    return next;
  }
}
