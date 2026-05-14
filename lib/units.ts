/**
 * lib/units.ts
 *
 * Unit conversion utilities.
 * Requirements: 10.3 (mmToPx for preview scale-to-fit)
 */

/**
 * Converts millimetres to pixels at 96 DPI.
 * Formula: mm * 96 / 25.4
 */
export function mmToPx(mm: number): number {
  return (mm * 96) / 25.4;
}
