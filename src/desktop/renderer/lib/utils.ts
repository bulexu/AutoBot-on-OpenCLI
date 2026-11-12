import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merges class names, letting later Tailwind utilities win over earlier ones.
 * The registry components rely on this so a caller-supplied `class` prop can
 * override a component's own defaults.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
