/**
 * lib/pdf.ts
 *
 * PDF wrapper — Playwright Chromium.
 * Opens/closes one browser per job (no pool in MVP 1).
 *
 * CRITICAL: document.fonts.ready MUST be awaited before page.pdf (P10).
 * Requirements: 11.6–11.12, 11.16, 16.10
 */

import { chromium } from 'playwright';

/**
 * Renders an HTML string to a PDF buffer using Playwright Chromium.
 *
 * Sequence (mandatory):
 * 1. chromium.launch({ headless: true })
 * 2. browser.newPage()
 * 3. page.setContent(html, { waitUntil: 'load' })
 * 4. await page.evaluate(() => document.fonts.ready)   ← P10
 * 5. page.pdf({ width, height, printBackground, preferCSSPageSize })
 * 6. browser.close() in finally
 *
 * Requirements: 11.6, 11.7, 11.8, 11.9, 11.10, 11.12, 16.10 (P10)
 */
export async function renderPdf(args: {
  html: string;
  widthMm: number;
  heightMm: number;
}): Promise<Buffer> {
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage();

    // Step 3: set content and wait for 'load' (HTML is self-contained — no network deps)
    await page.setContent(args.html, { waitUntil: 'load' });

    // Step 4: P10 — await document.fonts.ready before generating PDF
    await page.evaluate(() => document.fonts.ready);

    // Step 5: generate PDF with exact physical dimensions
    const pdfBuffer = await page.pdf({
      width: `${args.widthMm}mm`,
      height: `${args.heightMm}mm`,
      printBackground: true,
      preferCSSPageSize: true,
    });

    return Buffer.from(pdfBuffer);
  } finally {
    // Step 6: always close browser, even on error
    await browser.close();
  }
}
