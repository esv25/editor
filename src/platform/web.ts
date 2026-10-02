import type { Platform } from './types';

export const webPlatform: Platform = {
  isDesktop: false,

  setWindowTitle(title) {
    document.title = title;
  },

  async confirm(message) {
    return window.confirm(message);
  },

  onCloseRequested(hasUnsavedWork) {
    window.addEventListener('beforeunload', (e) => {
      if (hasUnsavedWork()) e.preventDefault();
    });
  },

  async startupFile() {
    return null;
  },

  async openWindow(page, params) {
    window.open(`${page}?${new URLSearchParams(params)}`, '_blank');
  },

  notify(event, payload) {
    channel().postMessage({ event, payload });
  },

  listen(event, handler) {
    channel().addEventListener('message', (e: MessageEvent<{ event: string; payload: unknown }>) => {
      if (e.data?.event === event) handler(e.data.payload);
    });
  },

  beforeClose(flush) {
    // Browsers can't wait for async work while closing; best effort.
    window.addEventListener('pagehide', () => void flush());
  },
};

let broadcast: BroadcastChannel | null = null;
const channel = () => (broadcast ??= new BroadcastChannel('editor'));
