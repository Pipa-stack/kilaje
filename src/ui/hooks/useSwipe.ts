/**
 * Swipe left/right to change day.
 *
 * Never the only way to do something: the previous/next buttons stay, because
 * a gesture is invisible, undiscoverable and unavailable to anyone using a
 * keyboard or a screen reader.
 *
 * The decision is split out as a pure function so the tricky part — when a
 * drag counts as a swipe rather than as a scroll — is tested without a DOM.
 */

import { useEffect, useRef } from 'react';

/** How far the finger must travel horizontally, in CSS pixels. */
export const SWIPE_DISTANCE = 64;

/**
 * How much more horizontal than vertical the movement must be.
 *
 * A page of set inputs is scrolled constantly, and a scroll that drifts
 * sideways must not be read as a swipe.
 */
export const SWIPE_RATIO = 1.5;

/** Anything slower is somebody dragging, not swiping. */
export const SWIPE_MAX_MS = 800;

export type SwipeDirection = 'left' | 'right' | null;

export interface Movement {
  dx: number;
  dy: number;
  elapsedMs: number;
}

/** Whether a finger movement counts as a swipe, and which way. */
export function decideSwipe({ dx, dy, elapsedMs }: Movement): SwipeDirection {
  if (elapsedMs > SWIPE_MAX_MS) return null;
  if (Math.abs(dx) < SWIPE_DISTANCE) return null;
  if (Math.abs(dx) < Math.abs(dy) * SWIPE_RATIO) return null;
  return dx < 0 ? 'left' : 'right';
}

/**
 * Elements a swipe must never start on.
 *
 * Number fields and the notes box are dragged to select text; the day and
 * week chips scroll sideways on their own; and a stray swipe that changed the
 * day mid-edit would be maddening.
 */
const IGNORED = 'input, textarea, select, [data-no-swipe]';

interface SwipeHandlers {
  onSwipeLeft: () => void;
  onSwipeRight: () => void;
  /** Off while another view is on screen. */
  enabled?: boolean;
}

export function useSwipe<T extends HTMLElement>({
  onSwipeLeft,
  onSwipeRight,
  enabled = true,
}: SwipeHandlers) {
  const ref = useRef<T>(null);
  const handlers = useRef({ onSwipeLeft, onSwipeRight });
  handlers.current = { onSwipeLeft, onSwipeRight };

  useEffect(() => {
    const element = ref.current;
    if (!element || !enabled) return;

    let start: { x: number; y: number; at: number } | null = null;

    const onPointerDown = (event: PointerEvent) => {
      // Touch only: on a desktop a drag is a text selection, not a swipe.
      if (event.pointerType !== 'touch') return;
      if (event.target instanceof Element && event.target.closest(IGNORED)) return;
      start = { x: event.clientX, y: event.clientY, at: Date.now() };
    };

    const onPointerUp = (event: PointerEvent) => {
      if (!start) return;
      const movement = {
        dx: event.clientX - start.x,
        dy: event.clientY - start.y,
        elapsedMs: Date.now() - start.at,
      };
      start = null;

      const direction = decideSwipe(movement);
      // Swiping left moves forward, the way pages turn.
      if (direction === 'left') handlers.current.onSwipeLeft();
      else if (direction === 'right') handlers.current.onSwipeRight();
    };

    const onPointerCancel = () => {
      start = null;
    };

    element.addEventListener('pointerdown', onPointerDown, { passive: true });
    element.addEventListener('pointerup', onPointerUp, { passive: true });
    element.addEventListener('pointercancel', onPointerCancel, { passive: true });

    return () => {
      element.removeEventListener('pointerdown', onPointerDown);
      element.removeEventListener('pointerup', onPointerUp);
      element.removeEventListener('pointercancel', onPointerCancel);
    };
  }, [enabled]);

  return ref;
}
