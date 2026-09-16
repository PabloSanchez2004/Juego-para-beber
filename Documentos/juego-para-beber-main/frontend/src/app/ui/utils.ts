import { ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Combina clases condicionales mediante clsx y resuelve conflictos de Tailwind con twMerge.
 * Sigue el estándar de shadcn/ui y Spartan en Angular.
 */
export function hlm(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export const cn = hlm;
