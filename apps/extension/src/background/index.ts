import { registerCapture } from './capture';

chrome.action.onClicked.addListener(() => {
  void chrome.tabs.create({ url: chrome.runtime.getURL('grove.html') });
});

const capture = registerCapture();
Object.assign(globalThis, { hollowCount: capture.hollowCount });
