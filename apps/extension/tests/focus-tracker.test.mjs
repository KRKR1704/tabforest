import { expect, test } from 'vitest';
import { FocusTracker } from '../src/background/focus-tracker';

test('counts only focused, active time through switch, window blur, idle and resume', () => {
  let time = 0;
  const tracker = new FocusTracker(() => time);
  tracker.setWindowFocused(true);
  tracker.select('a');
  time = 1000; tracker.setWindowFocused(false);
  time = 5000; tracker.setActive(false);
  time = 6000; tracker.setWindowFocused(true); // Still idle.
  time = 8000; tracker.setActive(true);
  time = 10000;
  expect(tracker.take('a')).toBe(3000);
  tracker.select('b');
  time = 10500;
  expect(tracker.take('b')).toBe(500);
  expect(tracker.take('b')).toBe(0);
});

test('window switching preserves per-tab intervals without counting the inactive window', () => {
  let time = 0;
  const tracker = new FocusTracker(() => time);
  tracker.setWindowFocused(true); tracker.select('a');
  time = 100; tracker.select('b');
  time = 300; tracker.select('a');
  time = 350;
  expect(tracker.take('a')).toBe(150);
  expect(tracker.take('b')).toBe(200);
  tracker.remove('a');
  expect(tracker.tabRef).toBeNull();
});

test('returns nonnegative integer milliseconds and handles no focused tab', () => {
  let time = 100;
  const tracker = new FocusTracker(() => time);
  tracker.setActive(false); tracker.setActive(true);
  expect(tracker.tabRef).toBeNull();
  tracker.setWindowFocused(true); tracker.select('a');
  time = 112.9;
  expect(tracker.take('a')).toBe(12);
  time = 110;
  expect(tracker.take('a')).toBe(0);
});
