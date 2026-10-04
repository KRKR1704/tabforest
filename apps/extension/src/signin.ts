// The sign-in popup. It only sends AUTH_* messages to the service worker and shows a short message.
const MESSAGES: Record<string, string> = {
  invalid_credentials: 'Email or password is incorrect.',
  not_available: 'This sign-in is not turned on for this server. Try Microsoft sign-in.',
  rate_limited: 'Too many attempts. Wait a minute and try again.',
  network: 'Could not reach the server. Check your connection.',
  bad_response: 'The server answered in an unexpected way.',
  provider_error: 'Sign-in did not complete. Try again.',
  state_mismatch: 'The sign-in could not be verified. Try again.',
  cancelled: 'Sign-in was cancelled.',
  invalid_payload: 'Enter your email and password.',
  no_sign_in_in_progress: 'This window is not waiting for a sign-in. Close it and start again.',
  forbidden: 'This window cannot sign you in.',
};

const form = document.getElementById('login') as HTMLFormElement;
const email = document.getElementById('email') as HTMLInputElement;
const password = document.getElementById('password') as HTMLInputElement;
const error = document.getElementById('error') as HTMLElement;
const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('button'));

function busy(on: boolean): void { for (const button of buttons) button.disabled = on; }

async function send(message: Record<string, unknown>): Promise<void> {
  error.textContent = '';
  busy(true);
  try {
    const reply = await chrome.runtime.sendMessage(message) as { ok?: boolean; error?: string } | undefined;
    if (reply?.ok) { window.close(); return; }
    error.textContent = MESSAGES[reply?.error ?? ''] ?? 'Sign-in did not complete. Try again.';
  } catch {
    error.textContent = MESSAGES.provider_error;
  } finally {
    password.value = '';
    busy(false);
  }
}

form.addEventListener('submit', event => {
  event.preventDefault();
  void send({ type: 'AUTH_FALLBACK', email: email.value, password: password.value });
});
document.getElementById('microsoft')!.addEventListener('click', () => { void send({ type: 'AUTH_ENTRA' }); });
document.getElementById('cancel')!.addEventListener('click', () => {
  void chrome.runtime.sendMessage({ type: 'AUTH_CANCEL' }).finally(() => window.close());
});
