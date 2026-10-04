// GET /api/me (contracts/me.example.json, C2). The first call for a new user
// provisions the account and says first_sign_in: true, which is what starts the
// first-run onboarding. Later calls say false.
import meContract from '@contracts/me.example.json';
import { apiBaseUrl, authHeaders, isMockMode } from './grove';

export interface Account {
  id: string;
  display_name: string;
  email: string;
  first_sign_in: boolean;
}

interface WireMe {
  user: { id: string; display_name: string; email: string };
  first_sign_in: boolean;
}

const example = (name: string): WireMe => {
  const found = meContract.examples.find((item) => item.name === name);
  if (!found) throw new Error(`me contract has no example "${name}"`);
  return found.response.body as unknown as WireMe;
};

const normalize = (wire: WireMe): Account => ({
  id: wire.user.id,
  display_name: wire.user.display_name,
  email: wire.user.email,
  first_sign_in: wire.first_sign_in === true,
});

// The stand-in server knows the demo user already. After "Delete all" the
// account is gone, so the next call provisions it again, as the contract says.
let provisioned = true;

export function resetAccountStandIn(): void {
  provisioned = true;
}

/** The stand-in's side of DELETE /api/me. */
export function forgetStandInAccount(): void {
  provisioned = false;
}

/**
 * The signed-in user's account. Null when the server cannot be reached: a
 * first run is never assumed, so onboarding is not shown on a guess.
 */
export async function getAccount(): Promise<Account | null> {
  if (isMockMode('me')) {
    const wire = example(provisioned ? 'later_call' : 'first_call_provisions');
    provisioned = true;
    return normalize(wire);
  }
  try {
    const response = await fetch(`${apiBaseUrl()}/api/me`, {
      method: 'GET',
      headers: await authHeaders(),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return normalize((await response.json()) as WireMe);
  } catch (err) {
    console.warn('[Me] GET /api/me failed:', err);
    return null;
  }
}
