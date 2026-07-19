import type { LucideIcon } from 'lucide-react';

/**
 * The single icon wrapper (docs/06 rule 1).
 *
 * Every icon in the product goes through here, which is what keeps stroke
 * weight and sizing consistent across surfaces. Emoji are banned everywhere in
 * the interface, including empty states and toasts, so this is also the reason
 * there is never a reach for one.
 *
 * Icons are decorative by default and hidden from assistive technology. Pass a
 * `label` only when the icon is the sole carrier of meaning, which on a data
 * product should be rare.
 */

export type IconSize = 'xs' | 'sm' | 'md' | 'lg';

const SIZES: Record<IconSize, number> = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 20,
};

interface IconProps {
  icon: LucideIcon;
  size?: IconSize;
  label?: string;
  className?: string;
}

export function Icon({ icon: Glyph, size = 'md', label, className = '' }: IconProps) {
  const px = SIZES[size];
  return (
    <Glyph
      width={px}
      height={px}
      // 1.5 throughout. Lucide's 2px default reads heavy beside condensed type.
      strokeWidth={1.5}
      className={`inline-block shrink-0 ${className}`}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
      focusable="false"
    />
  );
}
