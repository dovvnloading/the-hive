import type { AvatarDirection } from './agentic-types';

export type SeatedMotion = 'sit' | 'sit2' | 'sit_back' | 'sit_front';

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
  // Back/front source frames come from the canonical standing sheet. Cropping
  // the five foot rows preserves the authored identity and creates the hidden
  // lower body expected when the resident is actually in a chair.
  return motion === 'sit_back' || motion === 'sit_front' ? 27 : 32;
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
