import type { FocusEvent } from 'react';
import { focusCamera, type ArenaCamera } from '@/lib/arena/camera';

/** Keyboard focus must remain visible inside a clipped, zoomable scene. */
export function revealKeyboardFocus(
  event: FocusEvent<HTMLDivElement>,
  frame: HTMLElement | null,
  camera: ArenaCamera,
  onCameraChange: (next: ArenaCamera) => void,
) {
  if (!frame || camera.zoom <= 1 || !event.target.matches(':focus-visible'))
    return;
  const clip = frame.getBoundingClientRect();
  const target = event.target.getBoundingClientRect();
  if (
    target.left >= clip.left &&
    target.right <= clip.right &&
    target.top >= clip.top &&
    target.bottom <= clip.bottom
  )
    return;
  const surface = event.currentTarget.getBoundingClientRect();
  onCameraChange(
    focusCamera(
      {
        x:
          ((target.left + target.width / 2 - surface.left) / surface.width) *
          100,
        y:
          ((target.top + target.height / 2 - surface.top) / surface.height) *
          100,
      },
      camera.zoom,
    ),
  );
}
