import '@testing-library/jest-dom';
import { vi } from 'vitest';
import { setGroveMotion } from '../viz/motionSwitch';

// The grove motion layer is off unless a test turns it on, so every other test
// sees the plain drawing.
setGroveMotion(false);

// Polyfill window.open and other browser mocks for test runner
if (typeof window !== 'undefined') {
  window.open = vi.fn();
  // jsdom has no matchMedia. Tests run as a reduced-motion user, so a grow shows
  // its result at once; the grow-animation tests switch to full motion themselves.
  window.matchMedia = vi.fn((query: string) => ({
    matches: query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}
