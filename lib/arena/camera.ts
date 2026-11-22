import type { Vec2 } from './agentic-types';

/** Camera offsets are percentages of the unscaled world surface. */
export type ArenaCamera = { zoom: number; x: number; y: number };
export const FIT_CAMERA: ArenaCamera = { zoom: 1, x: 0, y: 0 };
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 3;

export function constrainCamera(camera: ArenaCamera): ArenaCamera {
  const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, camera.zoom));
  if (zoom === MIN_ZOOM) return { ...FIT_CAMERA };
  const limit = (zoom - 1) * 50;
  return {
    zoom,
    x: Math.max(-limit, Math.min(limit, camera.x)),
    y: Math.max(-limit, Math.min(limit, camera.y)),
  };
}

/** Zoom about a cursor measured relative to the world surface's center. */
export function zoomCamera(
  camera: ArenaCamera,
  zoom: number,
  anchor: Vec2 = { x: 0, y: 0 },
): ArenaCamera {
  const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
  const ratio = nextZoom / camera.zoom;
  return constrainCamera({
    zoom: nextZoom,
    x: anchor.x - (anchor.x - camera.x) * ratio,
    y: anchor.y - (anchor.y - camera.y) * ratio,
  });
}

/** Focus uses the same 0–100 coordinate space as authoritative positions. */
export function focusCamera(position: Vec2, zoom = 2): ArenaCamera {
  return constrainCamera({
    zoom,
    x: (50 - position.x) * zoom,
    y: (50 - position.y) * zoom,
  });
}
