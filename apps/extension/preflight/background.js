chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('preflight.html') });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'PREFLIGHT_HEALTH') return;

  (async () => {
    let result;
    try {
      const url = new URL(message.baseUrl.trim());
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
        throw new Error('Enter an HTTPS API base URL without credentials, query or fragment.');
      }
      url.pathname = url.pathname.replace(/\/+$/, '') + '/health';
      const response = await fetch(url.href);
      result = { status: response.status, body: await response.text() };
    } catch (error) {
      result = { error: error.message };
    }
    console.log('TabForest preflight /health:', result);
    sendResponse(result);
  })();

  // Keep the reply channel open while fetch completes.
  return true;
});
