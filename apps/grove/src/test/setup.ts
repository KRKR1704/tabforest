import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Polyfill window.open and other browser mocks for test runner
if (typeof window !== 'undefined') {
  window.open = vi.fn();
}
