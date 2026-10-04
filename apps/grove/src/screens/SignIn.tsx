import React, { useState } from 'react';
import { Trees } from 'lucide-react';

interface SignInProps {
  /** Runs the sign-in; resolves to whether the user is now signed in. */
  onSignIn: () => Promise<boolean>;
}

/** The privacy promise, in three lines. Each one is a rule the extension enforces (docs/privacy.md). */
export const PRIVACY_PROMISE = [
  'Only a tab’s site name, page title and timing are recorded. Never full addresses, page contents or what you type.',
  'Banking, health, email, password and sign-in pages are skipped entirely. They rest in the Hollow.',
  'No tab is closed without your click, and you can pause or delete everything at any time.',
] as const;

export const SignIn: React.FC<SignInProps> = ({ onSignIn }) => {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const signIn = async () => {
    setBusy(true);
    setFailed(false);
    const ok = await onSignIn();
    setBusy(false);
    if (!ok) setFailed(true);
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-forest-950 px-6 py-12 font-sans text-forest-50">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-2.5">
          <Trees className="h-6 w-6 text-forest-400" aria-hidden="true" />
          <span className="font-serif text-xl font-semibold">TabForest</span>
        </div>

        <h1 className="mt-8 font-serif text-3xl font-semibold leading-tight">
          See the goals behind your open tabs.
        </h1>
        <p className="mt-3 text-sm text-forest-300">
          Sign in so your grove is yours alone and is there when you come back.
        </p>

        <button
          type="button"
          autoFocus
          onClick={() => void signIn()}
          disabled={busy}
          className="mt-8 rounded-md bg-forest-600 px-5 py-2.5 text-sm font-medium text-forest-50 hover:bg-forest-500 disabled:opacity-60"
        >
          {busy ? 'Signing in…' : 'Sign in with Microsoft'}
        </button>
        {failed && (
          <p role="alert" className="mt-3 text-sm text-amberCanopy-light">
            Sign-in did not finish. Nothing was recorded. Try again.
          </p>
        )}

        <h2 className="mt-10 text-xs font-medium uppercase tracking-wider text-forest-400">
          Our privacy promise
        </h2>
        <ul className="mt-3 space-y-3 border-l border-forest-700 pl-4">
          {PRIVACY_PROMISE.map((line) => (
            <li key={line} className="text-sm leading-relaxed text-forest-100">
              {line}
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
};
