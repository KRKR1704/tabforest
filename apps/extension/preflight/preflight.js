const baseInput = document.getElementById('api-base');
document.getElementById('extension-id').textContent = chrome.runtime.id;

function healthUrl(base) {
  const url = new URL(base.trim());
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('Enter an HTTPS API base URL without credentials, query or fragment.');
  }
  url.pathname = url.pathname.replace(/\/+$/, '') + '/health';
  return url.href;
}

function showResult(element, result) {
  element.textContent = result.error
    ? `Error: ${result.error}`
    : `HTTP ${result.status}\n${result.body}`;
}

document.getElementById('page-fetch').addEventListener('click', async () => {
  const output = document.getElementById('page-result');
  output.textContent = 'Fetching…';
  try {
    const response = await fetch(healthUrl(baseInput.value));
    showResult(output, { status: response.status, body: await response.text() });
  } catch (error) {
    showResult(output, { error: error.message });
  }
});

document.getElementById('worker-fetch').addEventListener('click', async () => {
  const output = document.getElementById('worker-result');
  output.textContent = 'Fetching…';
  try {
    healthUrl(baseInput.value);
    const result = await chrome.runtime.sendMessage({
      type: 'PREFLIGHT_HEALTH', baseUrl: baseInput.value,
    });
    showResult(output, result);
  } catch (error) {
    showResult(output, { error: error.message });
  }
});
