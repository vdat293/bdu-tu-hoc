// Nạp nhân vật 3D cho cảnh đăng nhập từ asset CC0 của KayKit đã cắt gọn
// (public/assets/models/bdu-student.glb, xem scripts/import-student-model.mjs).
//
// Hai việc script này làm thêm sau khi nạp, để nhân vật thành "sinh viên BDU":
//   1. Vẽ lại atlas màu: ô xanh (áo + cape) → đỏ BDU, ô nâu (tóc + đồ da) → trắng
//      bạc. Ô atlas nào là bộ phận nào đã tra bằng cách đối chiếu UV với vị trí
//      đỉnh trên mô hình, nên đổi màu theo ô là chính xác, không đoán theo màu.
//   2. Gắn huy hiệu "BDU" vàng lên xương ngực, nên nó đi theo nhân vật khi cử
//      động thay vì dán cứng vào một chỗ.
//
// Module này KHÔNG import three ở top-level: nhận THREE/GLTFLoader từ ngoài để
// three chỉ được nạp động trong StudentScene.

export const STUDENT_MODEL_URL = '/assets/models/bdu-student.glb';

// Ô atlas (cột, hàng) theo lưới 8x8 trên texture 1024px → màu mới [đầu, cuối].
const RED_GRADIENT = ['#c62b30', '#8c1515'];
const WHITE_GRADIENT = ['#fbfcff', '#ccd2e0'];
const JACKET_CELLS = ['0,2', '1,2', '0,3', '1,3'];
const HAIR_CELLS = ['1,0', '1,1'];
const LEATHER_CELLS = [
  '5,0', '5,1', '5,2', '5,3', '5,4',
  '6,0', '6,1', '6,2',
  '7,3', '3,4', '0,5'
];

function drawGradient(ctx, left, top, width, height, [from, to]) {
  const gradient = ctx.createLinearGradient(0, top, 0, top + height);
  gradient.addColorStop(0, from);
  gradient.addColorStop(1, to);
  ctx.fillStyle = gradient;
  ctx.fillRect(left, top - 1, width, height + 2);
}

// Vẽ lại atlas màu rồi trả về texture mới. Trả `null` khi không dựng được canvas
// 2D để cảnh rơi về texture gốc (nhân vật vẫn chạy, chỉ là màu gốc của KayKit).
export function recolorStudentAtlas(THREE, texture) {
  if (typeof document === 'undefined' || !texture) return null;
  const image = texture.image;
  if (!image || !image.width) return null;
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.drawImage(image, 0, 0);
  const cellWidth = image.width / 8;
  const cellHeight = image.height / 8;

  const paint = (cells, colors) => {
    cells.forEach((key) => {
      const [col, row] = key.split(',').map(Number);
      drawGradient(ctx, col * cellWidth, row * cellHeight, cellWidth, cellHeight, colors);
    });
  };
  paint(JACKET_CELLS, RED_GRADIENT);
  paint(HAIR_CELLS, WHITE_GRADIENT);
  paint(LEATHER_CELLS, WHITE_GRADIENT);

  const recolored = new THREE.CanvasTexture(canvas);
  recolored.colorSpace = texture.colorSpace;
  recolored.flipY = texture.flipY;
  recolored.needsUpdate = true;
  return recolored;
}

// Mắt nhân vật là HÌNH HỌC được tô đen bằng ô màu tối trong atlas (texture không
// vẽ hình con mắt), nên "nhắm mắt" làm bằng chính các tam giác mắt:
//   - một bản sao phủ màu da để che mắt, và
//   - một bản sao bẹp theo phương đứng, màu mắt, làm gạch mí.
// Cả hai dùng đúng hình học + vị trí của mắt nên khớp tuyệt đối (không lệch như
// miếng dán tự đặt), gắn vào xương đầu nên đi theo mọi cử động (clip + khớp phụ).
// Màu da quanh mắt và màu mắt lấy mẫu ngay từ atlas.
export function createEyelids(THREE, { headBone, headMesh }) {
  if (!headBone || !headMesh?.geometry) return null;
  const { position, uv } = headMesh.geometry.attributes;
  const texture = headMesh.material?.map;
  const image = texture?.image;
  const textureWidth = image?.width;
  const textureHeight = image?.height;
  const context = image?.getContext?.('2d');
  if (!position || !uv || !context || !textureWidth || !textureHeight) return null;
  const pixels = context.getImageData(0, 0, textureWidth, textureHeight).data;

  // Ảnh atlas của glTF có flipY=false (gốc UV ở trên) — khác mặc định của canvas.
  const pixelAt = (u, v) => {
    const x = Math.min(textureWidth - 1, Math.max(0, Math.round(u * (textureWidth - 1))));
    const y = texture.flipY
      ? Math.min(textureHeight - 1, Math.max(0, Math.round((1 - v) * (textureHeight - 1))))
      : Math.min(textureHeight - 1, Math.max(0, Math.round(v * (textureHeight - 1))));
    const offset = (y * textureWidth + x) * 4;
    return { r: pixels[offset] / 255, g: pixels[offset + 1] / 255, b: pixels[offset + 2] / 255 };
  };
  const luminance = ({ r, g, b }) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

  // Đỉnh "tối" = mắt (mắt được tô bằng ô màu tối trong atlas). Đồng thời gom mẫu
  // màu da quanh mắt để tô mi.
  const meshMatrix = headMesh.matrixWorld;
  const world = new THREE.Vector3();
  const dark = [];
  const skinSamples = [];
  for (let index = 0; index < position.count; index += 1) {
    const color = pixelAt(uv.getX(index), uv.getY(index));
    if (luminance(color) < 0.3) {
      world.set(position.getX(index), position.getY(index), position.getZ(index)).applyMatrix4(meshMatrix);
      dark.push({ index, world: world.clone(), color });
    } else if (color.r > color.b + 0.04 && luminance(color) > 0.25 && luminance(color) < 0.9) {
      skinSamples.push(color);
    }
  }
  if (dark.length < 6) return null;

  // Gom các đỉnh tối theo vị trí. Ngưỡng rộng (9cm) để các mảnh của cùng một mắt
  // (trong/ngoài, trên/dưới) nhập thành một cụm; mỗi bên lấy cụm to nhất — nhờ đó
  // mi chỉ dựng từ hình học quanh mắt, không vơ cả tam giác rác ở nơi khác.
  const clusters = [];
  dark.forEach((item) => {
    const near = clusters.find((cluster) => cluster.some((other) => other.world.distanceTo(item.world) < 0.09));
    if (near) near.push(item);
    else clusters.push([item]);
  });
  const clusterCenter = (cluster) => cluster.reduce((sum, item) => sum.add(item.world), new THREE.Vector3()).multiplyScalar(1 / cluster.length);
  const eyeClusters = [-1, 1]
    .map((side) => clusters
      .filter((cluster) => cluster.length >= 3 && clusterCenter(cluster).x * side > 0)
      .sort((a, b) => b.length - a.length)[0] ?? null)
    .filter(Boolean);
  if (eyeClusters.length === 0) return null;
  const eyeVertices = new Set(eyeClusters.flat().map((item) => item.index));

  // Tam giác mắt: chỉ cần MỘT đỉnh thuộc cụm mắt (các tam giác ở viền mắt có đỉnh
  // da + đỉnh mắt; nếu đòi cả ba đỉnh thì mi phủ sẽ hở viền, mắt vẫn lộ).
  const source = headMesh.geometry.index;
  const triangles = [];
  if (source) {
    for (let i = 0; i < source.count; i += 3) {
      const a = source.getX(i);
      const b = source.getX(i + 1);
      const c = source.getX(i + 2);
      if (eyeVertices.has(a) || eyeVertices.has(b) || eyeVertices.has(c)) triangles.push([a, b, c]);
    }
  }
  if (triangles.length === 0) return null;

  const localOf = (index) => {
    world.set(position.getX(index), position.getY(index), position.getZ(index)).applyMatrix4(meshMatrix);
    return headBone.worldToLocal(world.clone());
  };

  // Vị trí của mắt trong hệ cục bộ của xương đầu + tâm mắt + tâm đầu (để biết
  // hướng "ra ngoài" của mắt).
  const eyePositions = [];
  triangles.forEach((triangle) => triangle.forEach((index) => eyePositions.push(localOf(index))));
  const center = eyePositions.reduce((sum, point) => sum.add(point), new THREE.Vector3()).multiplyScalar(1 / eyePositions.length);
  const headCenter = new THREE.Vector3();
  let headCount = 0;
  for (let index = 0; index < position.count; index += 1) {
    headCenter.add(localOf(index));
    headCount += 1;
  }
  headCenter.multiplyScalar(1 / Math.max(1, headCount));
  const outward = center.clone().sub(headCenter).normalize();

  // Hình học dùng chung: đúng các tam giác mắt, quy về gốc là tâm mắt.
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(eyePositions.length * 3);
  eyePositions.forEach((point, index) => {
    positions[index * 3] = point.x - center.x;
    positions[index * 3 + 1] = point.y - center.y;
    positions[index * 3 + 2] = point.z - center.z;
  });
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.computeVertexNormals();

  const average = (list) => {
    const sum = list.reduce((acc, color) => ({ r: acc.r + color.r, g: acc.g + color.g, b: acc.b + color.b }), { r: 0, g: 0, b: 0 });
    return { r: sum.r / list.length, g: sum.g / list.length, b: sum.b / list.length };
  };
  const skin = skinSamples.length >= 3 ? average(skinSamples) : { r: 0.85, g: 0.72, b: 0.6 };
  const ink = average([...eyeVertices].map((index) => pixelAt(uv.getX(index), uv.getY(index))));
  const lidMaterial = new THREE.MeshLambertMaterial({
    color: new THREE.Color().setRGB(skin.r, skin.g, skin.b, THREE.SRGBColorSpace),
    transparent: true,
    opacity: 0
  });
  const lashMaterial = new THREE.MeshLambertMaterial({
    color: new THREE.Color().setRGB(ink.r, ink.g, ink.b, THREE.SRGBColorSpace),
    transparent: true,
    opacity: 0
  });

  const group = new THREE.Group();
  group.name = 'eyelids';
  group.visible = false;
  headBone.add(group);

  // Mi phủ che mắt (hơi nhô ra để không z-fighting với mắt) …
  const lid = new THREE.Mesh(geometry, lidMaterial);
  lid.position.copy(center).addScaledVector(outward, 0.004);
  group.add(lid);

  // … và gạch mí: cùng hình mắt nhưng bẹp theo phương đứng, nhô ra hơn một chút.
  const lash = new THREE.Mesh(geometry, lashMaterial);
  lash.position.copy(center).addScaledVector(outward, 0.007);
  lash.scale.set(1, 0.22, 1);
  group.add(lash);

  return { group, materials: [lidMaterial, lashMaterial] };
}

// Huy hiệu BDU vàng: tấm phẳng nhỏ gắn vào xương ngực.
function createBadge(THREE) {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#e0b23c';
  ctx.textAlign = 'center';
  ctx.font = '800 92px "Space Grotesk", "Segoe UI", Arial, sans-serif';
  ctx.fillText('BDU', canvas.width / 2, 84);
  ctx.font = '700 26px "Segoe UI", Arial, sans-serif';
  ctx.fillText('HỌC - HỎI - HIỂU - HÀNH', canvas.width / 2, 116);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const badge = new THREE.Mesh(
    new THREE.PlaneGeometry(0.24, 0.12),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false })
  );
  badge.userData.noOutline = true;
  return badge;
}

// Ba chữ cái tên trong GLB là "upperarm.r" nhưng GLTFLoader đặt lại tên nút theo
// PropertyBinding.sanitizeNodeName (bỏ dấu chấm) nên lúc chạy xương tên
// "upperarmr". So tên đã chuẩn hoá (bỏ mọi ký tự không phải chữ/số) để khớp cả hai
// kiểu — nếu không, các xương tay sẽ không bao giờ được tìm thấy.
export function normalizeBoneName(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function findBone(skeleton, targetName) {
  const wanted = normalizeBoneName(targetName);
  return skeleton.bones.find((bone) => normalizeBoneName(bone.name) === wanted) ?? null;
}

// Bọc một xương bằng "khớp phụ" để cảnh đặt góc xoay cộng thêm (dõi theo con trỏ,
// né khi gõ mật khẩu) lên đó thay vì sửa thẳng vào xương.
//
// Vì sao không sửa thẳng: mixer chỉ ghi lại giá trị của một xương khi giá trị
// animation ĐỔI so với lần ghi trước (PropertyMixer.apply so hai vùng đệm rồi mới
// setValue). Clip giữ xương đứng yên — như xương head của clip Idle — thì mixer
// không ghi lại nữa, nên phép `bone.rotation.y += ...` mỗi frame sẽ cộng dồn mãi
// và đầu nhân vật xoay vô hạn khi con trỏ lệch khỏi tâm.
//
// Khớp phụ nằm ngoài mọi track của clip nên góc đặt vào nó là TUYỆT ĐỐI: mỗi frame
// đặt lại một lần, không bao giờ trôi, và không phụ thuộc vào việc mixer có ghi
// lại xương hay không. Xương giữ nguyên tên nên mixer vẫn bind đúng như thường;
// pivot đặt giữa xương và cha của nó nhưng ở gốc toạ độ (transform đồng nhất) nên
// tư thế bind và khớp xương của skinning không đổi.
export function wrapBoneWithPivot(THREE, bone) {
  if (!bone?.parent) return null;
  const pivot = new THREE.Group();
  pivot.name = `${bone.name}-offset`;
  bone.parent.add(pivot);
  pivot.add(bone);
  return pivot;
}

// Bỏ hẳn skinning trên GPU: mỗi khung hình tự tính lại vị trí đỉnh trên CPU rồi
// ghi vào geometry. Đường GPU (three gửi ma trận xương qua texture float cho
// vertex shader) chạy đúng trên GPU phần mềm và trên NVIDIA/D3D11 nhưng hỏng trên
// một số máy macOS/Metal — mà hậu quả thì rất khó lần ra từ xa. Tính trên CPU thì
// mọi máy ra cùng một kết quả.
//
// Mesh gốc (có xương) được giữ lại nhưng ẩn: nó là thứ cung cấp bindMatrix và
// boneInverses cho phép tính, còn mesh thật chỉ là Mesh thường dùng chung geometry.
export function installCpuSkinning(THREE, root) {
  const sources = [];
  root.traverse((node) => {
    if (node.isSkinnedMesh) sources.push(node);
  });
  if (sources.length === 0) return null;

  const vector = new THREE.Vector3();
  const boneMatrix = new THREE.Matrix4();
  const normalMatrix = new THREE.Matrix3();
  const entries = sources.map((source) => {
    const geometry = source.geometry;
    const position = geometry.attributes.position;
    const normal = geometry.attributes.normal;
    const skinIndex = geometry.attributes.skinIndex;
    const skinWeight = geometry.attributes.skinWeight;
    // Attribute trong GLB bị interleave (nhiều thuộc tính chung một buffer) nên
    // phải đọc qua API của attribute, không được đọc thẳng mảng thô.
    const basePositions = new Float32Array(position.count * 3);
    for (let i = 0; i < position.count; i += 1) {
      basePositions[i * 3] = position.getX(i);
      basePositions[i * 3 + 1] = position.getY(i);
      basePositions[i * 3 + 2] = position.getZ(i);
    }
    let baseNormals = null;
    if (normal) {
      baseNormals = new Float32Array(normal.count * 3);
      for (let i = 0; i < normal.count; i += 1) {
        baseNormals[i * 3] = normal.getX(i);
        baseNormals[i * 3 + 1] = normal.getY(i);
        baseNormals[i * 3 + 2] = normal.getZ(i);
      }
    }

    const baked = new THREE.Mesh(geometry, source.material);
    baked.position.copy(source.position);
    baked.quaternion.copy(source.quaternion);
    baked.scale.copy(source.scale);
    baked.frustumCulled = false;
    baked.castShadow = true;
    source.parent.add(baked);
    source.visible = false;

    return { source, baked, position, normal, skinIndex, skinWeight, basePositions, baseNormals, count: position.count };
  });

  let dominantBone = 0;
  let dominantWeight = 0;

  const update = () => {
    root.updateMatrixWorld(true);
    for (const entry of entries) {
      const { source, position, normal, skinIndex, skinWeight, basePositions, baseNormals, count } = entry;
      for (let index = 0; index < count; index += 1) {
        vector.set(basePositions[index * 3], basePositions[index * 3 + 1], basePositions[index * 3 + 2]);
        source.applyBoneTransform(index, vector);
        position.setXYZ(index, vector.x, vector.y, vector.z);

        if (normal && baseNormals) {
          // Pháp tuyến: dùng xương có trọng số lớn nhất, đủ tốt cho mô hình chibi.
          dominantBone = 0;
          dominantWeight = -1;
          for (let i = 0; i < 4; i += 1) {
            const weight = skinWeight.getComponent(index, i);
            if (weight > dominantWeight) {
              dominantWeight = weight;
              dominantBone = skinIndex.getComponent(index, i);
            }
          }
          boneMatrix.multiplyMatrices(
            source.skeleton.bones[dominantBone].matrixWorld,
            source.skeleton.boneInverses[dominantBone]
          );
          normalMatrix.getNormalMatrix(boneMatrix);
          vector.set(baseNormals[index * 3], baseNormals[index * 3 + 1], baseNormals[index * 3 + 2]);
          vector.applyMatrix3(normalMatrix).normalize();
          normal.setXYZ(index, vector.x, vector.y, vector.z);
        }
      }
      position.needsUpdate = true;
      if (normal) normal.needsUpdate = true;
    }
  };

  return { update, meshes: entries.map((entry) => entry.baked) };
}

// Nạp GLB, đổi màu, gắn huy hiệu; trả về gốc cảnh đã chuẩn hoá chiều cao.
export async function loadStudentAsset({ THREE, GLTFLoader, url = STUDENT_MODEL_URL }) {
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(url);
  const root = gltf.scene;

  // Dao găm của bộ Rogue: cảnh đăng nhập không cần vũ khí.
  const knife = root.getObjectByName('Knife') ?? root.getObjectByName('knife');
  if (knife) knife.visible = false;

  // Bộ Rogue có kèm vũ khí (nỏ, dao, bom khói...) là các mesh KHÔNG gắn xương,
  // nằm đống ở gốc mô hình. Cảnh đăng nhập chỉ cần thân nhân vật.
  let skeleton = null;
  let mesh = null;
  root.traverse((node) => {
    if (node.isSkinnedMesh) {
      if (!skeleton) {
        skeleton = node.skeleton;
        mesh = node;
      }
      return;
    }
    if (node.isMesh) node.visible = false;
  });
  if (!mesh) throw new Error('Mô hình không có mesh gắn xương');
  root.updateMatrixWorld(true);

  // Chiều cao chuẩn hoá: đo trên chính mesh thân (các mesh vũ khí đã ẩn nhưng
  // vẫn nằm trong hộp bao nếu tính cả chúng).
  const box = new THREE.Box3();
  root.traverse((node) => {
    if (node.isSkinnedMesh && node.visible) {
      node.geometry.computeBoundingBox();
      box.union(node.geometry.boundingBox.clone().applyMatrix4(node.matrixWorld));
    }
  });
  if (box.isEmpty()) box.setFromObject(root);
  const size = new THREE.Vector3();
  box.getSize(size);
  const scale = 1.62 / Math.max(size.y, 0.001);
  root.scale.setScalar(scale);
  root.position.y = -box.min.y * scale;
  root.position.x = 0;
  root.position.z = 0;

  if (mesh.material?.map) {
    const recolored = recolorStudentAtlas(THREE, mesh.material.map);
    if (recolored) {
      mesh.material.map.dispose();
      mesh.material.map = recolored;
      mesh.material.needsUpdate = true;
    }
  }

  // Tính biến dạng xương trên CPU: xem chú thích ở installCpuSkinning.
  const skinning = installCpuSkinning(THREE, root);

  const chestBone = skeleton ? findBone(skeleton, 'chest') : null;
  const handRight = skeleton ? findBone(skeleton, 'hand.r') : null;
  const badge = createBadge(THREE);

  // Các khớp phụ nhận góc xoay cộng thêm; xem chú thích ở wrapBoneWithPivot.
  const headPivot = wrapBoneWithPivot(THREE, skeleton ? findBone(skeleton, 'head') : null);
  const upperArmRightPivot = wrapBoneWithPivot(THREE, skeleton ? findBone(skeleton, 'upperarm.r') : null);
  const lowerArmRightPivot = wrapBoneWithPivot(THREE, skeleton ? findBone(skeleton, 'lowerarm.r') : null);
  const upperArmLeftPivot = wrapBoneWithPivot(THREE, skeleton ? findBone(skeleton, 'upperarm.l') : null);
  const lowerArmLeftPivot = wrapBoneWithPivot(THREE, skeleton ? findBone(skeleton, 'lowerarm.l') : null);

  // Mí mắt nhắm cho lúc gõ mật khẩu: mí gắn vào xương đầu nên đi theo mọi cử động.
  root.updateMatrixWorld(true);
  let headMesh = null;
  root.traverse((node) => {
    if (!headMesh && node.isSkinnedMesh && /head/i.test(node.name)) headMesh = node;
  });
  const eyelids = createEyelids(THREE, {
    headBone: skeleton ? findBone(skeleton, 'head') : null,
    headMesh
  });

  const mixer = new THREE.AnimationMixer(root);
  const actions = new Map();
  for (const clip of gltf.animations) {
    const action = mixer.clipAction(clip);
    action.enabled = true;
    actions.set(clip.name, action);
  }

  return {
    root,
    mixer,
    actions,
    node: mesh,
    skeleton,
    badge,
    headPivot,
    upperArmRightPivot,
    lowerArmRightPivot,
    upperArmLeftPivot,
    lowerArmLeftPivot,
    handRight,
    chestBone,
    eyelids,
    skinning,
    debug: {
      scale: +scale.toFixed(4),
      modelHeight: +size.y.toFixed(3),
      modelMinY: +box.min.y.toFixed(3),
      bones: skeleton ? skeleton.bones.length : 0
    },
    height: 1.62
  };
}
