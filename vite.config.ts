import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { configDefaults } from 'vitest/config';

export default defineConfig({
  // Relative asset paths so the build works when loaded by Tauri.
  base: './',
  // Keep Tauri's (Rust) output visible when running `npm run app`.
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  build: {
    // WebView2 on Windows is Chromium-based.
    target: 'chrome105',
    // Two pages: the editor and the drawing window.
    rolldownOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        diagram: resolve(import.meta.dirname, 'diagram.html'),
      },
    },
  },
  test: {
    environment: 'node',
    // Only this checkout's tests: other git worktrees (parallel sessions) live
    // under .claude/worktrees/ and would otherwise be picked up as well.
    include: ['tests/**/*.test.ts'],
    exclude: [...configDefaults.exclude, '**/.claude/**'],
  },
} as any);
