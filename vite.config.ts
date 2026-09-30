import { defineConfig } from 'vite';

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
  },
  test: { environment: 'node' },
} as any);
