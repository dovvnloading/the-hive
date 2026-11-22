import type { CSSProperties } from 'react';

export type HiveIconName =
  | 'residents'
  | 'journal'
  | 'research'
  | 'dispatch'
  | 'plus'
  | 'minus'
  | 'home'
  | 'follow'
  | 'sound-on'
  | 'sound-off'
  | 'labels'
  | 'keyboard'
  | 'eye-open'
  | 'eye-closed'
  | 'close'
  | 'next';

export function HiveIcon({
  name,
  size = 28,
  className = '',
}: {
  name: HiveIconName;
  size?: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={`hive-art-icon ${className}`}
      style={
        {
          '--hive-icon-url': `url('/assets/homestead-v1/interiors/icon-${name}.png')`,
          '--hive-icon-size': `${size}px`,
        } as CSSProperties
      }
    />
  );
}
