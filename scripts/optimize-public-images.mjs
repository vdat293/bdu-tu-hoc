import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve('public/assets/images');
const targets = [
  { input: 'logo-hao-quang-transparent.png', name: 'logo-hao-quang', widths: [256, 512] },
  { input: 'logo-bdu-eng.png', name: 'logo-bdu-eng', widths: [512, 1024] },
  { input: 'gojo-six-eyes-awakening.png', name: 'gojo-six-eyes-awakening', widths: [256, 512] },
  { input: 'gojo-six-eyes-closed-v2.png', name: 'gojo-six-eyes-closed-v2', widths: [256, 512] },
  { input: 'gojo-six-eyes-half-v2.png', name: 'gojo-six-eyes-half-v2', widths: [256, 512] },
  { input: 'itachi-sharingan-awakening.png', name: 'itachi-sharingan-awakening', widths: [256, 512] },
  { input: 'itachi-sharingan-closed-v2.png', name: 'itachi-sharingan-closed-v2', widths: [256, 512] },
  { input: 'itachi-sharingan-half-v2.png', name: 'itachi-sharingan-half-v2', widths: [256, 512] },
  { input: 'frame-gojo-limitless-art.png', name: 'frame-gojo-limitless-art', widths: [256, 512] },
  { input: 'frame-itachi-genjutsu-art.png', name: 'frame-itachi-genjutsu-art', widths: [256, 512] },
  { input: 'chibi-gojo-signature.png', name: 'chibi-gojo-signature', widths: [256, 512] },
  { input: 'chibi-itachi-signature.png', name: 'chibi-itachi-signature', widths: [256, 512] }
];

const manifest = { generatedAt: new Date().toISOString(), assets: [] };
for (const target of targets) {
  const source = path.join(root, target.input);
  const metadata = await sharp(source).metadata();
  const asset = { input: target.input, width: metadata.width, height: metadata.height, variants: [] };
  for (const width of target.widths) {
    const output = path.join(root, `${target.name}-${width}.webp`);
    await sharp(source).resize({ width, withoutEnlargement: true }).webp({ quality: target.name.startsWith('logo') ? 86 : 82 }).toFile(output);
    asset.variants.push({ src: path.relative(path.resolve('public'), output).replaceAll('\\', '/'), width, bytes: (await fs.stat(output)).size });
  }
  manifest.assets.push(asset);
}
await fs.writeFile(path.resolve('public/assets/images/manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify(manifest, null, 2));
