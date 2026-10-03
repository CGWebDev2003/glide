// Renders the Glide app icons (PNG) from an inline SVG with Playwright.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const svg = (size, maskable) => {
  const pad = maskable ? 0.18 : 0; // maskable icons need a safe zone
  const r = maskable ? 0 : 0.22 * size;
  const s = size * (1 - 2 * pad);
  const o = size * pad;
  const k = s / 64;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff7b4d"/><stop offset="1" stop-color="#f0431a"/></linearGradient></defs>
  <rect width="${size}" height="${size}" rx="${r}" fill="url(#g)"/>
  <g transform="translate(${o} ${o}) scale(${k})" stroke="#1a0d07" stroke-linecap="round" stroke-linejoin="round" fill="none">
    <path d="M18 21h28M18 32h28M18 43h15" stroke-width="5.5"/>
    <path d="M42 38.5l5 6.5 5-6.5" stroke-width="4.5"/>
  </g></svg>`;
};

const targets = [
  ['public/icons/icon-192.png', 192, false],
  ['public/icons/icon-512.png', 512, false],
  ['public/icons/maskable-512.png', 512, true],
  ['public/icons/apple-touch-icon.png', 180, true],
];

await mkdir('public/icons', { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [file, size, maskable] of targets) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg(size, maskable)}</body></html>`);
  await page.locator('svg').screenshot({ path: file, omitBackground: true });
  console.log('wrote', file);
}
await browser.close();
