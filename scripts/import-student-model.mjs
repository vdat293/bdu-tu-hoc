// Nhập nhân vật 3D cho cảnh đăng nhập từ bộ asset CC0 của KayKit.
//
// Nguồn: KayKit Character Pack: Adventurers (Kay Lousberg) — CC0, không cần ghi
// nguồn, dùng cho cả dự án thương mại. GLB gốc có 76 animation (~3.5MB) nhưng
// cảnh đăng nhập chỉ dùng 5 clip, nên script này cắt bỏ phần còn lại rồi ghi ra
// public/assets/models/. Chạy lại bất cứ lúc nào bằng:
//
//   npm run assets:student
//
// Script tự tải GLB gốc về thư mục tạm và cache lại, không cần commit file gốc.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { dedup, prune, resample } from '@gltf-transform/functions';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_BASE = 'https://raw.githubusercontent.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0/main';
const SOURCE_FILES = {
  'Rogue.glb': `${SOURCE_BASE}/addons/kaykit_character_pack_adventures/Characters/gltf/Rogue.glb`,
  'LICENSE-KayKit.txt': `${SOURCE_BASE}/LICENSE.txt`
};
const KEEP_ANIMATIONS = new Set([
  'Idle',
  'PickUp',
  'Sit_Chair_Down',
  'Sit_Chair_Idle',
  'Sit_Chair_StandUp'
]);
const OUT_DIR = path.join(root, 'public', 'assets', 'models');
const OUT_MODEL = path.join(OUT_DIR, 'bdu-student.glb');
const CACHE_DIR = path.join(os.tmpdir(), 'bdu-kaykit-cache');

async function fetchCached(fileName, url) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const target = path.join(CACHE_DIR, fileName);
  if (fs.existsSync(target) && fs.statSync(target).size > 0) return target;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Tải ${url} thất bại: HTTP ${response.status}`);
  fs.writeFileSync(target, Buffer.from(await response.arrayBuffer()));
  return target;
}

const sourcePath = await fetchCached('Rogue.glb', SOURCE_FILES['Rogue.glb']);
const licensePath = await fetchCached('LICENSE-KayKit.txt', SOURCE_FILES['LICENSE-KayKit.txt']);

fs.mkdirSync(OUT_DIR, { recursive: true });

const io = new NodeIO();
const document = await io.read(sourcePath);
const rootNode = document.getRoot();

const removed = [];
rootNode.listAnimations().forEach((animation) => {
  if (!KEEP_ANIMATIONS.has(animation.getName())) {
    removed.push(animation.getName());
    animation.dispose();
  }
});
const kept = rootNode.listAnimations().map((animation) => animation.getName());

await document.transform(
  dedup(),
  resample(),
  prune({ keepLeaves: true })
);

// `prune` không dọn hết accessor của các animation đã bỏ (chúng vẫn nằm trong
// buffer và chiếm ~1.2MB), nên dọn tay: giữ lại đúng những accessor còn được
// mesh / skin / animation tham chiếu.
const usedAccessors = new Set();
for (const mesh of rootNode.listMeshes()) {
  for (const primitive of mesh.listPrimitives()) {
    for (const attribute of primitive.listAttributes()) usedAccessors.add(attribute);
    const indices = primitive.getIndices();
    if (indices) usedAccessors.add(indices);
  }
}
for (const skin of rootNode.listSkins()) {
  const inverseBind = skin.getInverseBindMatrices();
  if (inverseBind) usedAccessors.add(inverseBind);
}
for (const animation of rootNode.listAnimations()) {
  for (const sampler of animation.listSamplers()) {
    usedAccessors.add(sampler.getInput());
    usedAccessors.add(sampler.getOutput());
  }
}
const droppedAccessors = rootNode.listAccessors().filter((accessor) => !usedAccessors.has(accessor));
droppedAccessors.forEach((accessor) => accessor.dispose());
await document.transform(prune({ keepLeaves: true }));

await io.write(OUT_MODEL, document);
fs.copyFileSync(licensePath, path.join(OUT_DIR, 'LICENSE-KayKit.txt'));

const sourceSize = fs.statSync(sourcePath).size;
const outputSize = fs.statSync(OUT_MODEL).size;
console.log(`[assets:student] giữ ${kept.length} animation: ${kept.join(', ')}`);
console.log(`[assets:student] bỏ ${removed.length} animation không dùng`);
console.log(`[assets:student] ${path.relative(root, OUT_MODEL)}: ${(outputSize / 1024).toFixed(0)}KB (gốc ${(sourceSize / 1024).toFixed(0)}KB)`);
console.log(`[assets:student] giấy phép: ${path.relative(root, path.join(OUT_DIR, 'LICENSE-KayKit.txt'))}`);
