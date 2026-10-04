import { registerCapture } from './capture';
import { emit } from './emit';
import { EventQueue, QUEUE_KEY } from './queue';
import { EventSync, API_BASE, SYNC_KEY } from './sync';
import { AuthStore } from './auth';
import { createAuthService } from './signin';
import { createWorkContext } from './work-context';
import { registerBridge } from './bridge';

const queue = new EventQueue(chrome.storage.local);
const auth = createAuthService({
  api: chrome, store: new AuthStore(chrome.storage.session),
  fetchFn: (input, init) => fetch(input, init), apiBase: API_BASE,
});
const workContext = createWorkContext({ api: chrome });
workContext.register();
const sync = new EventSync(queue, chrome.storage.local, { token: () => auth.token() });

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
  auth,
  workItems: workContext,
  // Signing out clears the token and everything waiting to be sent; capture keeps running locally.
  signOut: async () => {
    await auth.signOut();
    await sync.reset(async () => {
      await chrome.storage.local.remove([QUEUE_KEY, 'last_sent_batch', SYNC_KEY, 'rejected_events']);
    });
  },
});
sync.start();
Object.assign(globalThis, {
  hollowCount: capture.hollowCount,
  flushNow: () => sync.flushNow(),
  resendLastBatch: () => sync.resendLastBatch(),
  sendPreview: () => sync.sendPreview(),
  signIn: () => auth.signIn(),
  addToWorkContext: (selectionText?: string) => workContext.addActiveTab(selectionText),
});
