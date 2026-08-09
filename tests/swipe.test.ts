import { describe, expect, it } from 'vitest';

import {
  SWIPE_DISTANCE,
  SWIPE_MAX_MS,
  SWIPE_RATIO,
  decideSwipe,
} from '../src/ui/hooks/useSwipe';

const quick = (dx: number, dy: number) => decideSwipe({ dx, dy, elapsedMs: 200 });

describe('decideSwipe', () => {
  it('reads a clear horizontal drag as a swipe', () => {
    expect(quick(-120, 5)).toBe('left');
    expect(quick(120, -5)).toBe('right');
  });

  it('ignores a movement that is too short to be deliberate', () => {
    expect(quick(-(SWIPE_DISTANCE - 1), 0)).toBeNull();
    expect(quick(SWIPE_DISTANCE, 0)).toBe('right');
  });

  it('ignores a scroll that drifted sideways', () => {
    // The page of set inputs is scrolled constantly; a vertical gesture that
    // wanders must not change the day out from under the user.
    expect(quick(-90, 200)).toBeNull();
    expect(quick(90, -200)).toBeNull();
  });

  it('needs the horizontal movement to dominate by the whole ratio', () => {
    const dy = 40;
    expect(quick(-(dy * SWIPE_RATIO - 1), dy)).toBeNull();
    expect(quick(-(dy * SWIPE_RATIO + 10), dy)).toBe('left');
  });

  it('ignores a slow drag', () => {
    expect(decideSwipe({ dx: -200, dy: 0, elapsedMs: SWIPE_MAX_MS + 1 })).toBeNull();
    expect(decideSwipe({ dx: -200, dy: 0, elapsedMs: SWIPE_MAX_MS - 1 })).toBe('left');
  });

  it('ignores a tap', () => {
    expect(quick(0, 0)).toBeNull();
  });

  it('treats a diagonal that is mostly horizontal as a swipe', () => {
    expect(quick(-150, 30)).toBe('left');
  });
});
