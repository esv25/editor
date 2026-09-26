import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths so the build also works when loaded by Tauri later.
  base: './',
  server: { port: 5173 },
  test: { environment: 'node' },
} as any);
