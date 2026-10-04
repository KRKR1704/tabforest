import { registerCapture } from './capture';
import { emit } from './emit';
import { EventQueue } from './queue';
import { EventSync } from './sync';
import { registerBridge } from './bridge';

const queue = new EventQueue(chrome.storage.local);
const sync = new EventSync(queue, chrome.storage.local);

chrome.action.onClicked.addListener(() => {
  void chrome.tabs.create({ url: chrome.runtime.getURL('grove.html') });
  void sync.flushNow();
});

const capture = registerCapture(chrome, async event => {
  await queue.enqueue(event);
  emit(event);
  // Do not hold capture's serialized callback chain while sending.
  void sync.onEvent();
});
registerBridge(chrome, {
  settled: capture.settled,
  sendPreview: () => sync.sendPreview(),
  wipeLocal: () => sync.reset(() => capture.reset()),
});
sync.start();
Object.assign(globalThis, {
  hollowCount: capture.hollowCount,
  flushNow: () => sync.flushNow(),
  resendLastBatch: () => sync.resendLastBatch(),
  sendPreview: () => sync.sendPreview(),
});
