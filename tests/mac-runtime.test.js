import test from 'node:test';
import assert from 'node:assert/strict';
import { createWindowCloseGuard } from '../electron/window-close.js';

function harness() {
  const calls = { save: [], close: 0, quit: 0, show: 0, prevented: 0 };
  const guard = createWindowCloseGuard({
    requestSave: payload => calls.save.push(payload),
    closeWindow: () => { calls.close += 1; },
    quitApp: () => { calls.quit += 1; },
    showWindow: () => { calls.show += 1; },
  });
  const close = () => guard.beforeClose({ preventDefault: () => { calls.prevented += 1; } });
  const acknowledge = success => guard.complete({ ...calls.save.at(-1), success });
  return { guard, calls, close, acknowledge };
}

test('native Close waits for one save then closes only the window', () => {
  const { guard, calls, close, acknowledge } = harness();
  close();
  close();
  assert.equal(calls.save.length, 1);
  assert.equal(calls.close, 0);
  guard.complete({ requestId: 'stale', success: true });
  assert.equal(calls.close, 0);
  acknowledge(true);
  assert.equal(calls.close, 1);
  assert.equal(calls.quit, 0);
  close();
  assert.equal(calls.prevented, 2, 'The acknowledged native close must be allowed.');
});

test('Command-Q resumes app.quit after the save instead of leaving macOS running without windows', () => {
  const { guard, calls, close, acknowledge } = harness();
  guard.beforeQuit();
  close();
  assert.equal(calls.quit, 0);
  acknowledge(true);
  assert.equal(calls.quit, 1);
  assert.equal(calls.close, 0);
  guard.beforeQuit();
  close();
  assert.equal(calls.prevented, 1, 'The resumed quit can close its window.');
});

test('Quit requested while a normal close is saving preserves the quit intent', () => {
  const { guard, calls, close, acknowledge } = harness();
  close();
  guard.beforeQuit();
  close();
  acknowledge(true);
  assert.equal(calls.save.length, 1);
  assert.equal(calls.quit, 1);
  assert.equal(calls.close, 0);
});

test('a failed save cancels Quit and a subsequent normal Close does not quit the macOS app', () => {
  const { guard, calls, close, acknowledge } = harness();
  guard.beforeQuit();
  close();
  const failedRequest = calls.save[0];
  acknowledge(false);
  assert.equal(calls.show, 1);
  assert.equal(calls.quit, 0);
  assert.equal(calls.close, 0);
  close();
  assert.notEqual(calls.save[1].requestId, failedRequest.requestId);
  guard.complete({ ...failedRequest, success: true });
  assert.equal(calls.close, 0);
  acknowledge(true);
  assert.equal(calls.quit, 0);
  assert.equal(calls.close, 1);
});

test('a reopened Dock window needs its own save before closing', () => {
  const { guard, calls, close, acknowledge } = harness();
  close();
  const oldRequest = calls.save[0];
  acknowledge(true);
  guard.reset();
  close();
  assert.equal(calls.save.length, 2);
  guard.complete({ ...oldRequest, success: true });
  assert.equal(calls.close, 1);
  acknowledge(true);
  assert.equal(calls.close, 2);
  assert.equal(calls.quit, 0);
});
