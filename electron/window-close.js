import { randomUUID } from 'node:crypto';

/** Keep native Close and Quit waiting for the renderer's pending local save. */
export function createWindowCloseGuard({ requestSave, closeWindow, quitApp, showWindow }) {
  let allowClose = false;
  let requestId = null;
  let quitting = false;

  return {
    reset() {
      allowClose = false;
      requestId = null;
      quitting = false;
    },
    beforeQuit() { quitting = true; },
    beforeClose(event) {
      if (allowClose) return;
      event.preventDefault();
      if (requestId) return;
      requestId = randomUUID();
      requestSave({ requestId });
    },
    complete(payload) {
      if (!requestId || payload?.requestId !== requestId) return;
      requestId = null;
      if (payload.success !== true) {
        quitting = false;
        showWindow();
        return;
      }
      allowClose = true;
      // A prevented window close also cancels app.quit(). Resume the original
      // intent explicitly: on macOS closing the last window keeps the app alive.
      if (quitting) quitApp();
      else closeWindow();
    },
  };
}
