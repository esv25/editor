/**
 * Running a code snippet: external program on the desktop, a Web Worker
 * for JavaScript in the browser, and a sandboxed preview for HTML.
 */
import { platform, type RunResult } from '../../platform';
import { getSettings } from '../../settings';
import { normalizeLang, runnerFor } from './runners';

export type RunOutcome =
  | { kind: 'process'; result: RunResult }
  | { kind: 'html'; html: string }
  | { kind: 'error'; message: string };

/** Set by the app: where snippets run from, and whether they may (trusted folders). */
export const runContext = {
  /** The document's folder. */
  cwd: (): string | undefined => undefined,
  /** Whether code in the active document may run as a program (asks the user if needed). */
  allow: (): Promise<boolean> => Promise.resolve(true),
};

export type Runnability = { ok: true } | { ok: false; reason: string };

export function runnability(lang: string): Runnability {
  const id = normalizeLang(lang);
  if (!id) return { ok: false, reason: 'Velg et språk for å kunne kjøre koden' };
  if (id === 'html') return { ok: true };
  const runner = runnerFor(id);
  if (runner && platform.runProgram) return { ok: true };
  if (id === 'javascript') return { ok: true }; // Web Worker fallback
  if (runner) return { ok: false, reason: 'Kan bare kjøres i skrivebordsappen' };
  return { ok: false, reason: `Vet ikke hvordan ${lang} kjøres (kan legges til i innstillingene)` };
}

export async function runCode(lang: string, code: string): Promise<RunOutcome> {
  const id = normalizeLang(lang);
  const timeoutMs = getSettings().codeRunTimeoutMs;
  if (id === 'html') return { kind: 'html', html: code };

  const runner = runnerFor(id);
  if (runner && platform.runProgram) {
    if (!(await runContext.allow())) return { kind: 'error', message: 'Ikke kjørt: du valgte å ikke stole på mappa fila ligger i.' };
    try {
      const source = (runner.bom ? '﻿' : '') + (runner.prelude ?? '') + code;
      const result = await platform.runProgram({
        program: runner.command,
        args: runner.args,
        code: source,
        extension: runner.extension,
        cwd: runContext.cwd(),
        timeoutMs,
      });
      return { kind: 'process', result };
    } catch (err) {
      return { kind: 'error', message: String(err) };
    }
  }
  if (id === 'javascript') return { kind: 'process', result: await runInWorker(code, timeoutMs) };
  const can = runnability(lang);
  return { kind: 'error', message: can.ok ? 'Kunne ikke kjøre koden' : can.reason };
}

/** Run JavaScript in a throwaway Web Worker, capturing console output. */
function runInWorker(code: string, timeoutMs: number): Promise<RunResult> {
  const prelude = `
const fmt = (v) => typeof v === 'string' ? v : (() => { try { return JSON.stringify(v, null, 2) ?? String(v); } catch { return String(v); } })();
const out = (stream) => (...args) => postMessage({ stream, text: args.map(fmt).join(' ') + '\\n' });
console.log = console.info = console.debug = out('stdout');
console.error = console.warn = out('stderr');
`;
  const body = `${prelude}\n(async () => {\n${code}\n})().then(() => postMessage({ done: 0 }), (e) => { postMessage({ stream: 'stderr', text: String((e && e.stack) || e) + '\\n' }); postMessage({ done: 1 }); });`;

  return new Promise((resolve) => {
    const url = URL.createObjectURL(new Blob([body], { type: 'text/javascript' }));
    const worker = new Worker(url);
    const started = performance.now();
    let stdout = '';
    let stderr = '';
    const finish = (exitCode: number | null, timedOut = false) => {
      clearTimeout(timer);
      worker.terminate();
      URL.revokeObjectURL(url);
      resolve({ stdout, stderr, exitCode, timedOut, durationMs: Math.round(performance.now() - started) });
    };
    const timer = setTimeout(() => finish(null, true), timeoutMs);
    worker.onmessage = (e) => {
      const msg = e.data as { stream?: 'stdout' | 'stderr'; text?: string; done?: number };
      if (msg.done !== undefined) finish(msg.done);
      else if (msg.stream === 'stdout') stdout += msg.text;
      else stderr += msg.text;
    };
    worker.onerror = (e) => {
      e.preventDefault();
      stderr += `${e.message}\n`;
      finish(1);
    };
  });
}
