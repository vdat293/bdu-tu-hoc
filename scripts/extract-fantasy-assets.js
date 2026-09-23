// One-time asset extraction. Run with the three downloaded JPG sheet paths in
// this order: violet frames, relic frames, gem buttons.
import sharp from 'sharp';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';

const [violetSheet, relicSheet, gemSheet] = process.argv.slice(2);
if (!violetSheet || !relicSheet || !gemSheet) {
  throw new Error('Usage: node scripts/extract-fantasy-assets.js <violet.jpg> <relic.jpg> <gems.jpg>');
}

const sheets = [
  {
    source: violetSheet,
    destination: 'public/assets/frames',
    names: ['violet-1', 'violet-2', 'violet-3', 'violet-4', 'violet-5'],
    boxes: [[120, 170, 1700, 1910], [1730, 160, 1590, 1930], [3290, 130, 1790, 1990], [5160, 110, 1780, 2020], [7050, 100, 1890, 2030]],
    size: 760
  },
  {
    source: relicSheet,
    destination: 'public/assets/frames',
    names: ['relic-1', 'relic-2', 'relic-3', 'relic-4', 'relic-5'],
    boxes: [[50, 230, 1890, 2070], [1940, 250, 1820, 2060], [3810, 210, 1780, 2100], [5630, 310, 1520, 1900], [7140, 280, 1850, 1960]],
    size: 760
  },
  {
    source: gemSheet,
    destination: 'public/assets/title-tags',
    names: ['green', 'blue', 'orange', 'gold', 'pink', 'purple'],
    boxes: [[870, 165, 2480, 1040], [3760, 120, 2490, 1120], [6660, 145, 2510, 1080], [860, 1250, 2500, 1100], [3740, 1240, 2530, 1150], [6660, 1220, 2540, 1170]],
    size: 900
  }
];

function expectedBackground(x, y, width, height) {
  const dx = (x - width / 2) / (width * 0.275);
  const dy = (y - height / 2) / (height * 0.67);
  const glow = Math.exp(-(dx * dx + dy * dy));
  return [4 + glow * 16, 12 + glow * 39, 48 + glow * 96];
}

async function extract(sheet) {
  const { data, info } = await sharp(sheet.source).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  await mkdir(sheet.destination, { recursive: true });
  for (let n = 0; n < sheet.boxes.length; n++) {
    const [left, top, width, height] = sheet.boxes[n];
    const rgba = Buffer.alloc(width * height * 4);
    let minX = width, minY = height, maxX = 0, maxY = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const sourceX = x + left;
        const sourceY = y + top;
        const sourceIndex = (sourceY * info.width + sourceX) * 3;
        const targetIndex = (y * width + x) * 4;
        const [r, g, b] = data.subarray(sourceIndex, sourceIndex + 3);
        const [br, bg, bb] = expectedBackground(sourceX, sourceY, info.width, info.height);
        const distance = Math.hypot(r - br, g - bg, b - bb);
        let alpha = Math.max(0, Math.min(1, (distance - 12) / 30));
        // The JPG includes a blue radial backdrop. Blue marks that are still
        // close to that backdrop are empty aperture, even inside a closed ring.
        if (r < 32 && g < 65 && b < 166) alpha = 0;
        const a = Math.round(alpha * 255);
        if (a > 10) {
          minX = Math.min(minX, x); minY = Math.min(minY, y);
          maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
        }
        rgba[targetIndex] = a ? Math.max(0, Math.min(255, Math.round((r - br * (1 - alpha)) / Math.max(alpha, .1)))) : 0;
        rgba[targetIndex + 1] = a ? Math.max(0, Math.min(255, Math.round((g - bg * (1 - alpha)) / Math.max(alpha, .1)))) : 0;
        rgba[targetIndex + 2] = a ? Math.max(0, Math.min(255, Math.round((b - bb * (1 - alpha)) / Math.max(alpha, .1)))) : 0;
        rgba[targetIndex + 3] = a;
      }
    }
    if (maxX <= minX || maxY <= minY) throw new Error(`Empty extraction: ${sheet.names[n]}`);
    const margin = sheet.destination.includes('title-tags') ? 28 : 38;
    const cropLeft = Math.max(0, minX - margin);
    const cropTop = Math.max(0, minY - margin);
    const cropRight = Math.min(width, maxX + margin + 1);
    const cropBottom = Math.min(height, maxY + margin + 1);
    const output = path.join(sheet.destination, `${sheet.names[n]}.webp`);
    await sharp(rgba, { raw: { width, height, channels: 4 } })
      .extract({ left: cropLeft, top: cropTop, width: cropRight - cropLeft, height: cropBottom - cropTop })
      .resize({ width: sheet.size, withoutEnlargement: true })
      .webp({ quality: 92, effort: 6 })
      .toFile(output);
    console.log(`${output}: ${cropRight - cropLeft}x${cropBottom - cropTop}`);
  }
}

for (const sheet of sheets) await extract(sheet);
