import type { AvatarDirection } from './agentic-types';

export type SeatedMotion = 'sit' | 'sit2' | 'sit_back' | 'sit_front';

export const NORTH_CHAIR_FOREGROUND_HEIGHT = 32;

export function isSeatedMotion(motion: string): motion is SeatedMotion {
  return (
    motion === 'sit' ||
    motion === 'sit2' ||
    motion === 'sit_back' ||
    motion === 'sit_front'
  );
}

export function seatedMotionFor(
  direction: AvatarDirection,
  activeTool: boolean,
): SeatedMotion {
  if (direction === 'north') return 'sit_back';
  if (direction === 'south') return 'sit_front';
  return activeTool ? 'sit2' : 'sit';
}

export function seatedFrameWidth(motion: SeatedMotion) {
  return motion === 'sit_back' || motion === 'sit_front' ? 16 : 32;
}

export function seatedFrameHeight(motion: SeatedMotion) {
  // The north-facing pose sits behind a chair back, so its lower five source
  // rows are deliberately hidden. A south-facing resident is visible in front
  // of the seat and must retain the complete frame; sharing the north crop was
  // visibly cutting off the feet and shifting the whole body downward.
  return motion === 'sit_back' ? 27 : 32;
}

export function seatedSheetMotion(motion: SeatedMotion) {
  return motion === 'sit_back' || motion === 'sit_front' ? 'idle_anim' : motion;
}

export function seatedFrameOffset(
  motion: SeatedMotion,
  direction: AvatarDirection,
) {
  if (motion === 'sit_back') return 6;
  if (motion === 'sit_front') return 18;
  return direction === 'west' ? 6 : 0;
}
