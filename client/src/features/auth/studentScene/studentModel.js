// Mô hình low-poly "sinh viên BDU" cho cảnh 3D trang đăng nhập.
//
// Toàn bộ hình khối dựng bằng code, không cần file model. Module này KHÔNG
// import three ở top-level: hàm nhận `THREE` từ ngoài để three chỉ được nạp
// động trong StudentScene, không lọt vào bundle chính.
//
// Bảng màu bám ảnh tham chiếu (áo khoác gió đỏ–trắng, chữ BDU vàng) và bảng màu
// sẵn có của trang: đỏ BDU #8c1515, mận #7a3141, cam #dc624f, vàng #e4bf43.

export const PALETTE = {
  jacketBase: '#fbfaf8',
  jacketRed: '#ab2126',
  jacketRedDark: '#8c1515',
  sleeveRed: '#b0272c',
  gold: '#e0b23c',
  zipper: '#cdc7c2',
  hairTop: '#eceef5',
  hairLight: '#f9fafd',
  hairUnder: '#d3d7e2',
  skin: '#f2d2ba',
  eyeRim: '#2f272b',
  eyeWhite: '#fbf9f7',
  eyeIris: '#c93a34',
  eyeShine: '#ffffff',
  trouser: '#333a52',
  shoe: '#f9f7f4',
  backpack: '#7f3346',
  backpackPocket: '#652735',
  strap: '#4a2f36',
  bookA: '#dc624f',
  bookB: '#e4bf43',
  bookC: '#8c1515',
  pages: '#fdfbf7',
  deskTop: '#b5824c',
  deskLeg: '#8a5f36',
  stool: '#7a3141',
  stoolLeg: '#3a2b2b',
  shadow: '#33242a'
};

const CHEST_W = 0.4;
const CHEST_H = 0.46;
const HIP_Y = 0.575;
const SHOULDER_LOCAL_Y = 0.41;
const HEAD_PIVOT_LOCAL_Y = 0.47;
const HEAD_RADIUS = 0.155;
const HEAD_SCALE = 1.09;
const HEAD_CENTER = Object.freeze({ x: 0, y: 0.135, z: 0 });
const UP = Object.freeze({ x: 0, y: 1, z: 0 });

// Vị trí đứng của ba lô và góc học tập; StudentScene dùng lại để biết đích đến.
// Góc học tập nằm lệch phải để khi đứng, bàn + ghế vẫn lộ ra ngoài thân nhân vật
// (nhìn thấy được thì mới bấm được), và khi ngồi thì nhân vật bước sang đó.
export const SCENE_ANCHORS = Object.freeze({
  backpackParked: { x: -0.95, y: 0.26, z: 0.3, yaw: -0.85, tilt: -0.06 },
  desk: { x: 0.45, y: 0, z: 0.46, yaw: -0.05, scale: 1.32 },
  chair: { x: 0.45, y: 0, z: -0.12, scale: 1 },
  bookParked: { x: 0.42, y: 0.6, z: 0.5, yaw: -0.16 },
  // Tư thế đọc: sách nhấc khỏi mặt bàn một chút, nghiêng về phía mặt nhân vật
  // (gáy hướng ra camera) để đọc được — khác hẳn tư thế che mặt là giơ sách ra
  // trước mặt người xem.
  bookReading: { x: 0.45, y: 0.68, z: 0.38, pitch: 0.5 },
  bookLifted: { x: 0.45, y: 1.0, z: 0.34, pitch: 1.25 }
});

// Vật liệu dùng chung theo (màu + tuỳ chọn): ~100 mesh nhưng chỉ vài material.
function createMaterialFactory(THREE) {
  const cache = new Map();
  return (color, extra = {}, kind = 'lambert') => {
    // `extra` có thể chứa Texture (không JSON hoá được) nên chỉ khoá theo việc
    // có map hay không, phần còn lại vẫn so theo giá trị.
    const key = `${kind}|${color}|${extra.map ? 'map' : ''}|${JSON.stringify({ ...extra, map: undefined })}`;
    if (!cache.has(key)) {
      // `flatShading` chỉ có nghĩa với material ăn sáng; truyền vào MeshBasicMaterial
      // chỉ tổ sinh cảnh báo của three ở mỗi lần dựng.
      const Material = kind === 'basic' ? THREE.MeshBasicMaterial : THREE.MeshLambertMaterial;
      const options = kind === 'basic' ? { ...extra } : { flatShading: true, ...extra };
      cache.set(key, new Material({ color, ...options }));
    }
    return cache.get(key);
  };
}

function createRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function directionFrom(azimuth, elevation) {
  const flat = Math.cos(elevation);
  return { x: Math.sin(azimuth) * flat, y: Math.sin(elevation), z: Math.cos(azimuth) * flat };
}

// Viền đen kiểu tranh vẽ: mỗi mesh được phủ thêm một bản sao lật mặt sau, phóng
// nhẹ. Độ dày viền tính theo bán kính mesh nên vật to hay nhỏ đều viền mảnh như
// nhau, không bị cái dày cái mỏng.
export function addToonOutline(THREE, root, { thickness = 0.014, maxScale = 1.3, color = 0x2b1f23 } = {}) {
  const material = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide });
  const targets = [];
  root.traverse((node) => {
    if (!node.isMesh || node.userData.noOutline) return;
    if (node.material?.transparent && node.material?.map) return;
    node.geometry.computeBoundingSphere();
    const radius = node.geometry.boundingSphere?.radius ?? 0;
    if (radius < 0.024) return;
    targets.push({ node, radius });
  });
  targets.forEach(({ node, radius }) => {
    const outline = new THREE.Mesh(node.geometry, material);
    outline.scale.setScalar(Math.min(maxScale, 1 + thickness / Math.max(radius, 0.02)));
    outline.renderOrder = -1;
    outline.castShadow = false;
    outline.receiveShadow = false;
    outline.userData.isOutline = true;
    node.add(outline);
  });
  return material;
}

// Mặt phẳng nhận bóng thật: chỉ vẽ phần bóng đổ, không hiện mặt sàn.
export function createShadowReceiver(THREE) {
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(8, 8),
    new THREE.ShadowMaterial({ opacity: 0.22 })
  );
  plane.rotation.x = -Math.PI / 2;
  plane.receiveShadow = true;
  return plane;
}

// Mặt trước thân áo: CHỈ vẽ panel trắng, dây kéo và chữ BDU vàng trên nền trong
// suốt, để thân áo đỏ phía dưới hiện xuyên qua. Nhờ vậy mảng trắng hoà vào khối
// thân thay vì trông như một miếng dán đè lên. Trả `null` khi canvas 2D không
// khả dụng: khi đó thân áo rơi về màu trơn.
export function createJacketTexture(THREE) {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  const width = Math.round(CHEST_W * 1400);
  const height = Math.round(CHEST_H * 1400);
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.clearRect(0, 0, width, height);

  // Panel trắng: chừa một dải đỏ ở vai (yoke) rồi mới tới mảng trắng, đáy chéo
  // thấp ở trái và cao dần sang phải như ảnh mẫu.
  ctx.fillStyle = PALETTE.jacketBase;
  ctx.beginPath();
  ctx.moveTo(width * 0.03, height * 0.13);
  ctx.lineTo(width * 0.97, height * 0.13);
  ctx.lineTo(width, height * 0.5);
  ctx.lineTo(width * 0.5, height * 0.56);
  ctx.lineTo(0, height * 0.75);
  ctx.closePath();
  ctx.fill();

  // Dây kéo chạy dọc giữa thân + con trượt nhỏ ở đầu khoá.
  ctx.strokeStyle = PALETTE.zipper;
  ctx.lineWidth = Math.max(2, width * 0.011);
  ctx.beginPath();
  ctx.moveTo(width / 2, height * 0.04);
  ctx.lineTo(width / 2, height);
  ctx.stroke();
  ctx.fillStyle = PALETTE.gold;
  ctx.fillRect(width / 2 - width * 0.018, height * 0.05, width * 0.036, height * 0.05);

  // Chữ BDU + slogan trên ngực trái (bên phải khi nhìn vào, như ảnh tham chiếu).
  ctx.fillStyle = PALETTE.gold;
  ctx.textAlign = 'center';
  ctx.font = `800 ${Math.round(width * 0.28)}px "Space Grotesk", "Segoe UI", Arial, sans-serif`;
  ctx.fillText('BDU', width * 0.66, height * 0.3);
  ctx.font = `700 ${Math.round(width * 0.056)}px "Segoe UI", Arial, sans-serif`;
  ctx.fillText('HỌC - HỎI - HIỂU - HÀNH', width * 0.66, height * 0.4);

  const texture = new THREE.CanvasTexture(canvas);
  if ('colorSpace' in texture) texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// Một chân: hông → đùi → gối → cẳng chân → giày. Dáng đứng y hệt bản cũ, chỉ
// thêm hai khớp để ngồi được.
function buildLeg(THREE, material, { side }) {
  const hip = new THREE.Group();
  hip.position.set(side * 0.088, HIP_Y, 0);

  const thigh = new THREE.Mesh(new THREE.BoxGeometry(0.125, 0.26, 0.14), material(PALETTE.trouser));
  thigh.position.y = -0.13;
  hip.add(thigh);

  const knee = new THREE.Group();
  knee.position.y = -0.26;
  hip.add(knee);

  const shin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.24, 0.135), material(PALETTE.trouser));
  shin.position.y = -0.12;
  knee.add(shin);

  const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.075, 0.25), material(PALETTE.shoe));
  shoe.position.set(0, -0.2775, 0.035);
  knee.add(shoe);

  return { hip, knee, shoe };
}

function buildArm(THREE, material, { side }) {
  const arm = new THREE.Group();
  arm.position.set(side * 0.205, SHOULDER_LOCAL_Y, 0);

  const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.078, 8, 6), material(PALETTE.sleeveRed));
  arm.add(shoulder);

  const upper = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.22, 0.13), material(PALETTE.sleeveRed));
  upper.position.y = -0.115;
  arm.add(upper);

  const elbow = new THREE.Group();
  elbow.position.y = -0.225;
  arm.add(elbow);

  const forearm = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.2, 0.12), material(PALETTE.sleeveRed));
  forearm.position.y = -0.105;
  elbow.add(forearm);

  const cuff = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.05, 0.13), material(PALETTE.jacketRedDark));
  cuff.position.y = -0.195;
  elbow.add(cuff);

  const hand = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), material(PALETTE.skin));
  hand.position.y = -0.245;
  elbow.add(hand);

  const thumb = new THREE.Mesh(new THREE.SphereGeometry(0.021, 6, 5), material(PALETTE.skin));
  thumb.position.set(side * -0.032, -0.232, 0.024);
  elbow.add(thumb);

  return { arm, elbow, hand };
}

function buildEye(THREE, material, x) {
  const eye = new THREE.Group();
  eye.position.set(x, 0.152, 0.113);

  // Tròng trắng + viền đen do lớp outline vẽ ra: đúng kiểu mắt tranh, không còn
  // là một hốc đen như khi dùng hẳn một khối màu tối.
  const sclera = new THREE.Mesh(new THREE.SphereGeometry(0.036, 8, 6), material(PALETTE.eyeWhite));
  sclera.scale.set(1, 0.92, 0.9);
  eye.add(sclera);

  const lash = new THREE.Mesh(new THREE.BoxGeometry(0.062, 0.013, 0.018), material(PALETTE.eyeRim));
  lash.position.set(0, 0.028, 0.016);
  eye.add(lash);

  const iris = new THREE.Mesh(new THREE.SphereGeometry(0.019, 8, 6), material(PALETTE.eyeIris, {}, 'basic'));
  iris.position.set(0, -0.002, 0.022);
  eye.add(iris);

  const shine = new THREE.Mesh(new THREE.SphereGeometry(0.0075, 6, 5), material(PALETTE.eyeShine, {}, 'basic'));
  shine.position.set(0.008, 0.008, 0.031);
  eye.add(shine);

  return { eye, iris };
}

// Chi tiết mặt còn thiếu để ra "mặt người": lông mày, sống mũi, miệng cong nhẹ.
function buildFaceExtras(THREE, material) {
  const face = new THREE.Group();

  [-1, 1].forEach((side) => {
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.011, 0.012), material(PALETTE.hairUnder));
    brow.position.set(side * 0.062, 0.196, 0.128);
    brow.rotation.z = side * 0.16;
    face.add(brow);
  });

  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.019, 0.05, 4), material(PALETTE.skin));
  nose.position.set(0, 0.118, 0.152);
  nose.rotation.set(Math.PI / 2, 0, Math.PI / 4);
  face.add(nose);

  // Miệng hai đoạn hơi chếch lên: đọc ra nụ cười nhẹ thay vì một vạch thẳng.
  [-1, 1].forEach((side) => {
    const lip = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.009, 0.012), material(PALETTE.eyeRim));
    lip.position.set(side * 0.013, 0.078 + Math.abs(side) * 0.001, 0.147);
    lip.rotation.z = side * -0.34;
    face.add(lip);
  });

  return face;
}

// Tóc: một chỏm cầu phủ đỉnh đầu, một vỏ ôm gáy, rồi các lọn DẸT vuốt lên và ra
// sau (không còn kiểu gai nhím toả đều), cộng mái chia ngôi lệch phủ trán và hai
// lọn hai bên dài tới gò má. Ngẫu nhiên có seed nên lần dựng nào cũng giống nhau.
function buildHair(THREE, material) {
  const hair = new THREE.Group();
  hair.position.set(HEAD_CENTER.x, HEAD_CENTER.y, HEAD_CENTER.z);

  const cap = new THREE.Mesh(
    new THREE.SphereGeometry(HEAD_RADIUS * 1.07, 10, 7, 0, Math.PI * 2, 0, Math.PI * 0.46),
    material(PALETTE.hairTop)
  );
  cap.scale.set(1.03, 1.06, 1.03);
  hair.add(cap);

  const back = new THREE.Mesh(
    new THREE.SphereGeometry(HEAD_RADIUS * 1.08, 10, 7, 0, Math.PI * 2, 0, Math.PI * 0.62),
    material(PALETTE.hairUnder)
  );
  back.position.y = -0.012;
  back.rotation.x = -0.62;
  hair.add(back);

  const random = createRandom(20261);
  const up = new THREE.Vector3(UP.x, UP.y, UP.z);

  // Lọn dẹt: nón bị ép theo phương ngang nên đọc ra "tảng tóc" chứ không phải gai.
  const addLock = ({ anchorAz, anchorEl, dirAz, dirEl, length, radius, flatten = 0.5, roll = 0, color = PALETTE.hairTop }) => {
    const anchor = directionFrom(anchorAz, anchorEl);
    const point = directionFrom(dirAz, dirEl);
    const lock = new THREE.Mesh(new THREE.ConeGeometry(radius, length, 5), material(color));
    lock.position.set(anchor.x, anchor.y, anchor.z).multiplyScalar(HEAD_RADIUS * 0.8);
    lock.quaternion.setFromUnitVectors(up, new THREE.Vector3(point.x, point.y, point.z).normalize());
    lock.scale.set(1, 1, flatten);
    lock.rotateY(roll);
    hair.add(lock);
  };

  // Chùm trên đỉnh: 9 lọn lớn, lệch về bên phải (ngôi lệch) và hơi ngả ra sau.
  for (let index = 0; index < 9; index += 1) {
    const spread = -1.7 + index * 0.45;
    addLock({
      anchorAz: spread * 0.5 + 0.2,
      anchorEl: 0.58 + random() * 0.12,
      dirAz: spread * 0.7 + 0.35,
      dirEl: 0.45 + random() * 0.4,
      length: 0.24 + random() * 0.12,
      radius: 0.08 + random() * 0.022,
      flatten: 0.45,
      roll: 0.2 + random() * 0.3
    });
  }
  // Vài lọn sáng hơn nằm trên cùng: bắt sáng như tóc có highlight.
  for (let index = 0; index < 4; index += 1) {
    const spread = -1.1 + index * 0.75;
    addLock({
      anchorAz: spread,
      anchorEl: 0.86 + random() * 0.1,
      dirAz: spread * 0.8,
      dirEl: 0.95 + random() * 0.3,
      length: 0.16 + random() * 0.08,
      radius: 0.055 + random() * 0.012,
      flatten: 0.45,
      color: PALETTE.hairLight
    });
  }
  // Mái: chia ngôi lệch, phủ ngang trán thành từng lọn rủ xuống.
  [
    { az: -0.15, dir: -0.45, length: 0.26, radius: 0.078 },
    { az: 0.3, dir: -0.6, length: 0.24, radius: 0.072 },
    { az: -0.62, dir: -0.4, length: 0.22, radius: 0.07 },
    { az: 0.78, dir: -0.45, length: 0.2, radius: 0.065 },
    { az: -1.05, dir: -0.35, length: 0.2, radius: 0.062 }
  ].forEach((bang) => {
    addLock({
      anchorAz: bang.az,
      anchorEl: 0.34,
      dirAz: bang.az + bang.dir * 0.55,
      dirEl: -0.42,
      length: bang.length,
      radius: bang.radius,
      flatten: 0.5,
      roll: bang.dir
    });
  });
  // Lọn hai bên dài tới gò má + hai lọn sau gáy.
  addLock({ anchorAz: 1.5, anchorEl: 0.1, dirAz: 1.65, dirEl: -0.62, length: 0.26, radius: 0.07, flatten: 0.55 });
  addLock({ anchorAz: -1.5, anchorEl: 0.1, dirAz: -1.65, dirEl: -0.62, length: 0.26, radius: 0.07, flatten: 0.55 });
  addLock({ anchorAz: 2.6, anchorEl: -0.2, dirAz: 2.6, dirEl: -1.05, length: 0.22, radius: 0.075, flatten: 0.5 });
  addLock({ anchorAz: -2.6, anchorEl: -0.2, dirAz: -2.6, dirEl: -1.05, length: 0.22, radius: 0.075, flatten: 0.5 });
  // Một lọn dựng ngược hẳn lên trên cho có dáng "tóc dựng".
  addLock({ anchorAz: 0.9, anchorEl: 0.95, dirAz: 1.15, dirEl: 1.2, length: 0.3, radius: 0.06, flatten: 0.4 });
  addLock({ anchorAz: -0.6, anchorEl: 1.05, dirAz: -0.35, dirEl: 1.3, length: 0.26, radius: 0.055, flatten: 0.4 });

  return hair;
}

// Quai ba lô phía trước ngực: chỉ hiện khi đã đeo, để nhìn từ trước vẫn thấy rõ
// là đang đeo ba lô (thân ba lô nằm sau lưng nên bị che).
function buildWearStraps(THREE, material) {
  const straps = new THREE.Group();
  [-1, 1].forEach((side) => {
    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.3, 0.035), material(PALETTE.strap));
    strap.position.set(side * 0.125, 0.3, 0.125);
    strap.rotation.z = side * 0.1;
    straps.add(strap);
  });
  straps.visible = false;
  return straps;
}

export function buildStudent(THREE) {
  const material = createMaterialFactory(THREE);
  const group = new THREE.Group();

  const leftLeg = buildLeg(THREE, material, { side: -1 });
  const rightLeg = buildLeg(THREE, material, { side: 1 });
  group.add(leftLeg.hip, rightLeg.hip);

  // Cột sống: mọi thứ từ hông trở lên nằm trong group này để xoay cả thân trên.
  const spine = new THREE.Group();
  spine.position.y = HIP_Y;
  group.add(spine);

  const chestTexture = createJacketTexture(THREE);

  // Thân áo đỏ; panel trắng + dây kéo + chữ BDU nằm trong texture suốt phủ mặt
  // trước. Không có canvas 2D thì thân áo trắng trơn, vẫn ra chiếc áo hợp lý.
  const jacket = new THREE.Mesh(
    new THREE.BoxGeometry(CHEST_W, CHEST_H, 0.215),
    material(chestTexture ? PALETTE.jacketRed : PALETTE.jacketBase)
  );
  jacket.position.y = CHEST_H / 2;
  spine.add(jacket);

  if (chestTexture) {
    const chest = new THREE.Mesh(
      new THREE.PlaneGeometry(CHEST_W, CHEST_H),
      material(PALETTE.jacketBase, { map: chestTexture, transparent: true })
    );
    chest.position.set(0, CHEST_H / 2, 0.1085);
    chest.userData.noOutline = true;
    spine.add(chest);
  }

  const hem = new THREE.Mesh(new THREE.BoxGeometry(CHEST_W * 1.015, 0.115, 0.222), material(PALETTE.jacketRedDark));
  hem.position.y = 0.0575;
  spine.add(hem);

  // Túi áo hai bên + mũ trùm sau gáy: chi tiết nhỏ nhưng làm áo khoác ra chất áo khoác.
  [-1, 1].forEach((side) => {
    const pocket = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.085, 0.016), material(PALETTE.jacketRedDark));
    pocket.position.set(side * 0.125, 0.15, 0.114);
    pocket.rotation.z = side * 0.04;
    spine.add(pocket);
  });
  const hood = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 7), material(PALETTE.jacketRedDark));
  hood.position.set(0, 0.46, -0.13);
  hood.scale.set(1.25, 0.42, 0.75);
  spine.add(hood);

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.062, 0.1, 10), material(PALETTE.skin));
  neck.position.y = 0.475;
  spine.add(neck);

  const collar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.118, 0.132, 0.14, 14, 1, true),
    material(PALETTE.jacketRedDark, { side: THREE.DoubleSide })
  );
  collar.position.y = 0.5;
  spine.add(collar);

  const head = new THREE.Group();
  head.position.y = HEAD_PIVOT_LOCAL_Y;
  head.scale.setScalar(HEAD_SCALE);
  spine.add(head);

  const skull = new THREE.Mesh(new THREE.SphereGeometry(HEAD_RADIUS, 10, 8), material(PALETTE.skin));
  skull.position.set(HEAD_CENTER.x, HEAD_CENTER.y, HEAD_CENTER.z);
  skull.scale.set(0.94, 1.1, 0.98);
  head.add(skull);

  const left = buildEye(THREE, material, -0.066);
  const right = buildEye(THREE, material, 0.066);
  head.add(left.eye, right.eye);
  head.add(buildFaceExtras(THREE, material));

  head.add(buildHair(THREE, material));

  const leftArm = buildArm(THREE, material, { side: -1 });
  const rightArm = buildArm(THREE, material, { side: 1 });
  spine.add(leftArm.arm, rightArm.arm);

  const wearStraps = buildWearStraps(THREE, material);
  spine.add(wearStraps);

  return {
    group,
    joints: {
      spine,
      head,
      collar,
      wearStraps,
      leftArm: leftArm.arm,
      leftElbow: leftArm.elbow,
      rightArm: rightArm.arm,
      rightElbow: rightArm.elbow,
      rightHand: rightArm.hand,
      leftHip: leftLeg.hip,
      leftKnee: leftLeg.knee,
      leftShoe: leftLeg.shoe,
      rightHip: rightLeg.hip,
      rightKnee: rightLeg.knee,
      rightShoe: rightLeg.shoe,
      leftEye: left.eye,
      rightEye: right.eye,
      leftIris: left.iris,
      rightIris: right.iris
    },
    // Vị trí gốc để animation thở dao động quanh đó thay vì lệch dần.
    base: { spineY: HIP_Y, headY: HEAD_PIVOT_LOCAL_Y, collarY: 0.5, rootY: 0, rootZ: 0 },
    contact: { x: -0.02, z: 0.06, radius: 0.33, opacity: 0.12 }
  };
}

function buildBackpack(THREE, material) {
  // Gốc nhóm đặt ở TÂM ba lô để lúc đeo lên lưng chỉ cần đặt đúng tâm. Ba lô được
  // làm to hơn tỉ lệ thường một chút cho cân với dáng chibi và để nhìn từ trước
  // vẫn thấy nó nhô ra sau lưng.
  const backpack = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.54, 0.27), material(PALETTE.backpack));
  backpack.add(body);
  const hood = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.3, 10), material(PALETTE.backpack));
  hood.rotation.z = Math.PI / 2;
  hood.position.y = 0.27;
  backpack.add(hood);
  const pocket = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.22, 0.1), material(PALETTE.backpackPocket));
  pocket.position.set(0, -0.07, 0.16);
  backpack.add(pocket);
  [-1, 1].forEach((side) => {
    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.42, 0.045), material(PALETTE.strap));
    strap.position.set(side * 0.15, 0.05, -0.16);
    backpack.add(strap);
  });
  const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.05, 0.03), material(PALETTE.gold));
  buckle.position.set(0, -0.18, 0.21);
  backpack.add(buckle);
  return backpack;
}

// Ghế có tựa lưng: mặt ghế + bốn chân + lưng dựa. Kích thước rộng hơn thân nhân
// vật một chút để nhìn từ trước vẫn thấy ghế — vừa rõ là có ghế, vừa bấm trúng được.
function buildChair(THREE, material) {
  const chair = new THREE.Group();
  const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.06, 12), material(PALETTE.stool));
  seat.position.y = 0.375;
  chair.add(seat);
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([x, z]) => {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.375, 6), material(PALETTE.stoolLeg));
    leg.position.set(x * 0.21, 0.1875, z * 0.21);
    leg.rotation.set(z * 0.07, 0, -x * 0.07);
    chair.add(leg);
  });
  [-1, 1].forEach((side) => {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.6, 0.04), material(PALETTE.stoolLeg));
    post.position.set(side * 0.26, 0.68, -0.2);
    chair.add(post);
  });
  // Ghế nằm lệch phải nhân vật nên lưng tựa cỡ thường cũng đã lộ ra ngoài tay áo.
  const backrest = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.34, 0.05), material(PALETTE.stool));
  backrest.position.set(0, 0.88, -0.2);
  chair.add(backrest);
  const backSlat = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.06, 0.06), material(PALETTE.stoolLeg));
  backSlat.position.set(0, 0.66, -0.2);
  chair.add(backSlat);
  return chair;
}

// Bàn học: mặt bàn + hai hông + thanh giằng, trên mặt có sách mở, chồng sách nhỏ
// và một cây bút. Sách mở tách riêng khỏi bàn để còn nâng lên che mặt được.
function buildDesk(THREE, material) {
  const desk = new THREE.Group();
  const top = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.05, 0.4), material(PALETTE.deskTop));
  top.position.y = 0.415;
  desk.add(top);
  [-1, 1].forEach((side) => {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.39, 0.38), material(PALETTE.deskLeg));
    panel.position.set(side * 0.325, 0.195, 0);
    desk.add(panel);
  });
  const brace = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.04, 0.05), material(PALETTE.deskLeg));
  brace.position.set(0, 0.16, -0.14);
  desk.add(brace);

  const stackLow = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.045, 0.15), material(PALETTE.bookC));
  stackLow.position.set(-0.22, 0.4625, -0.02);
  stackLow.rotation.y = 0.22;
  desk.add(stackLow);
  const stackTop = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.04, 0.14), material(PALETTE.bookA));
  stackTop.position.set(-0.22, 0.505, -0.02);
  stackTop.rotation.y = 0.12;
  desk.add(stackTop);

  const pencil = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.16, 5), material(PALETTE.bookB));
  pencil.position.set(-0.16, 0.447, 0.14);
  pencil.rotation.set(Math.PI / 2, 0, 0.5);
  desk.add(pencil);
  return desk;
}

// Sách mở đặt trên bàn: hai tấm bìa nghiêng + ruột giấy trắng + một trang lật
// được (nhịp "đang đọc"). Gốc nhóm ở gáy sách, sách nằm phẳng theo mặt bàn.
export function buildOpenBook(THREE, material) {
  const book = new THREE.Group();
  const boardGeometry = new THREE.BoxGeometry(0.17, 0.012, 0.24);
  const pageGeometry = new THREE.BoxGeometry(0.16, 0.008, 0.225);

  const leftBoard = new THREE.Mesh(boardGeometry, material(PALETTE.bookC));
  leftBoard.position.set(-0.085, 0, 0);
  leftBoard.rotation.z = 0.08;
  book.add(leftBoard);
  const rightBoard = new THREE.Mesh(boardGeometry, material(PALETTE.bookC));
  rightBoard.position.set(0.085, 0, 0);
  rightBoard.rotation.z = -0.08;
  book.add(rightBoard);

  const leftPages = new THREE.Mesh(pageGeometry, material(PALETTE.pages));
  leftPages.position.set(-0.085, 0.011, 0);
  leftPages.rotation.z = 0.08;
  book.add(leftPages);
  const rightPages = new THREE.Mesh(pageGeometry, material(PALETTE.pages));
  rightPages.position.set(0.085, 0.011, 0);
  rightPages.rotation.z = -0.08;
  book.add(rightPages);

  const spine = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.016, 0.24), material(PALETTE.bookC));
  book.add(spine);

  // Trang đang lật: nhóm ở gáy để xoay quanh gáy như sách thật.
  const page = new THREE.Group();
  const turningPage = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.006, 0.225), material(PALETTE.pages));
  turningPage.position.set(0.08, 0.014, 0);
  turningPage.userData.noOutline = true;
  page.add(turningPage);
  book.add(page);

  const ribbon = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.008, 0.12), material(PALETTE.gold));
  ribbon.position.set(0.02, 0.016, 0.12);
  book.add(ribbon);

  return { book, page };
}

// Dây đeo ngang ngực: ba lô nằm sau lưng nên nhìn từ trước phải có dây mới biết
// là đang đeo. Đặt theo không gian cảnh (trước ngực nhân vật), hiện khi đã đeo.
export function createChestStrap(THREE) {
  const strap = new THREE.Group();
  const band = new THREE.Mesh(
    new THREE.BoxGeometry(0.44, 0.06, 0.05),
    new THREE.MeshLambertMaterial({ color: PALETTE.strap, flatShading: true })
  );
  strap.add(band);
  const buckle = new THREE.Mesh(
    new THREE.BoxGeometry(0.07, 0.075, 0.055),
    new THREE.MeshLambertMaterial({ color: PALETTE.gold, flatShading: true })
  );
  strap.add(buckle);
  strap.visible = false;
  return strap;
}

export function buildProps(THREE) {
  const material = createMaterialFactory(THREE);
  const group = new THREE.Group();

  const backpack = buildBackpack(THREE, material);
  const parked = SCENE_ANCHORS.backpackParked;
  backpack.position.set(parked.x, parked.y, parked.z);
  backpack.rotation.set(0, parked.yaw, parked.tilt);
  group.add(backpack);

  const desk = buildDesk(THREE, material);
  desk.position.set(SCENE_ANCHORS.desk.x, SCENE_ANCHORS.desk.y, SCENE_ANCHORS.desk.z);
  desk.rotation.y = SCENE_ANCHORS.desk.yaw;
  // Bàn được phóng lên cho cân với nhân vật chibi (bàn gốc dựng theo tỉ lệ người thường).
  desk.scale.setScalar(SCENE_ANCHORS.desk.scale);
  group.add(desk);

  const chair = buildChair(THREE, material);
  chair.position.set(SCENE_ANCHORS.chair.x, SCENE_ANCHORS.chair.y, SCENE_ANCHORS.chair.z);
  chair.rotation.y = -0.06;
  chair.scale.setScalar(SCENE_ANCHORS.chair.scale);
  group.add(chair);

  const { book, page } = buildOpenBook(THREE, material);
  const bookParked = SCENE_ANCHORS.bookParked;
  book.position.set(bookParked.x, bookParked.y, bookParked.z);
  book.rotation.set(0, bookParked.yaw, 0);
  group.add(book);

  // Chồng sách dưới đất bên phải, quyển vàng trên cùng để có điểm sáng.
  const books = new THREE.Group();
  books.position.set(1.15, 0, 0.16);
  [
    { w: 0.3, h: 0.062, d: 0.22, y: 0.031, turn: 0.14, color: PALETTE.bookC },
    { w: 0.28, h: 0.058, d: 0.21, y: 0.09, turn: -0.08, color: PALETTE.bookA },
    { w: 0.26, h: 0.05, d: 0.2, y: 0.14, turn: 0.2, color: PALETTE.bookB }
  ].forEach((item) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(item.w, item.h, item.d), material(item.color));
    mesh.position.set(0, item.y, 0);
    mesh.rotation.y = item.turn;
    books.add(mesh);
  });
  group.add(books);

  // Ba thứ bấm được: đánh dấu lên từng mesh để raycast biết trúng vật nào.
  const interactive = [
    { id: 'backpack', group: backpack },
    { id: 'chair', group: chair },
    { id: 'desk', group: desk }
  ];
  interactive.forEach(({ id, group: propGroup }) => {
    propGroup.traverse((node) => {
      if (node.isMesh) node.userData.sceneProp = id;
    });
  });

  return {
    group,
    interactive,
    backpack,
    book: { group: book, page },
    contact: [
      { x: -0.95, z: 0.3, radius: 0.23, opacity: 0.09 },
      { x: 1.15, z: 0.16, radius: 0.24, opacity: 0.08 },
      { x: 0.45, z: -0.12, radius: 0.24, opacity: 0.07 },
      { x: 0.45, z: 0.42, radius: 0.3, opacity: 0.06 }
    ]
  };
}

// Bóng tiếp xúc mờ dưới chân: rẻ hơn shadow map và hợp chất low-poly phẳng.
export function createContactShadowMap(THREE) {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const gradient = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.55, 'rgba(255,255,255,0.75)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

export function createContactShadow(THREE, map, { x, z, radius, opacity }) {
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 20),
    new THREE.MeshBasicMaterial({
      color: PALETTE.shadow,
      map,
      transparent: true,
      opacity,
      depthWrite: false
    })
  );
  disc.rotation.x = -Math.PI / 2;
  disc.position.set(x, 0.004, z);
  return disc;
}
