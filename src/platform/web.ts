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
};
