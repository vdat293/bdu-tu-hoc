import { useCallback, useEffect, useRef, useState } from 'react';
import { loadStudentAsset } from './studentAsset.js';
import {
  armAwayAmount,
  awayBoneOffsets,
  bookLiftAmounts,
  COVER_BONES,
  coverArmAmount,
  headOffsets,
  nextPageFlipDelay,
  PAGE_FLIP_FIRST_DELAY,
  PAGE_FLIP_HOLD,
  READING_BONES,
  readingArmAmount,
  SCENE_CLIPS,
  transitionPlan
} from './studentClip.js';
import {
  addToonOutline,
  buildProps,
  createChestStrap,
  createContactShadow,
  createContactShadowMap,
  createShadowReceiver,
  SCENE_ANCHORS
} from './studentModel.js';
import {
  SCENE_ACTIONS,
  createSceneState,
  describeSceneState,
  reduceSceneState,
  sceneActionLabel
} from './studentState.js';

// Cảnh 3D cho panel trái trang đăng nhập: sinh viên BDU (mô hình CC0 của KayKit
// đã đổi màu, xem studentAsset.js) đứng cạnh bàn học, bấm được vào ba lô để đeo
// lên và vào bàn–ghế để ngồi học.
//
// three.js + GLTFLoader được nạp ĐỘNG nên chúng nằm ở chunk riêng; mô hình .glb
// chỉ tải khi panel đủ rộng và máy chạy được WebGL. Mọi thất bại (thiếu WebGL,
// chunk lỗi, mất context, .glb không tải được) đều báo qua `onUnsupported` để
// AuthLayout quay về 4 blob CSS.
const CAMERA_FOV = 30;
const CAMERA_DISTANCE = 3.7;
const CAMERA_HEIGHT = 1.22;
const LOOK_TARGET_Y = 0.86;
const STAGE_ASPECT = 470 / 300;
const MAX_PIXEL_RATIO = 2;

const HOVER_SCALE = 1.045;
const SIT_ANCHOR_X = 0.45;

const PROP_ACTIONS = {
  backpack: SCENE_ACTIONS.BACKPACK,
  desk: SCENE_ACTIONS.DESK,
  chair: SCENE_ACTIONS.DESK
};

function easeInOut(value) {
  const t = Math.min(1, Math.max(0, value));
  return t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2;
}

async function startStudentScene({ THREE, GLTFLoader, host, getState, onAction, onUnsupported, debugRef, debugEnabled }) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  } catch {
    // Máy không tạo được WebGL: báo rõ lý do để `?scene3d-debug` hiện được.
    onUnsupported?.('webgl');
    return () => {};
  }
  renderer.setClearAlpha(0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const canvas = renderer.domElement;
  canvas.className = 'student-scene-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  host.appendChild(canvas);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(CAMERA_FOV, STAGE_ASPECT, 0.1, 40);
  const lookTarget = new THREE.Vector3(0, LOOK_TARGET_Y, 0);
  camera.position.set(0, CAMERA_HEIGHT, CAMERA_DISTANCE);
  camera.lookAt(lookTarget);

  scene.add(new THREE.HemisphereLight(0xfff5ef, 0xd7c0c6, 1.25));
  const keyLight = new THREE.DirectionalLight(0xfff1e6, 1.5);
  keyLight.position.set(2.6, 3.4, 2.9);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(1024, 1024);
  keyLight.shadow.camera.left = -1.8;
  keyLight.shadow.camera.right = 1.8;
  keyLight.shadow.camera.top = 1.9;
  keyLight.shadow.camera.bottom = -0.7;
  keyLight.shadow.camera.near = 1;
  keyLight.shadow.camera.far = 12;
  keyLight.shadow.bias = -0.0006;
  keyLight.shadow.normalBias = 0.014;
  scene.add(keyLight);
  const rimLight = new THREE.DirectionalLight(0xcfd8ff, 0.45);
  rimLight.position.set(-2.8, 1.9, -2.4);
  scene.add(rimLight);

  const stage = new THREE.Group();
  scene.add(stage);

  // Mô hình + animation của nhân vật.
  let student;
  try {
    student = await loadStudentAsset({ THREE, GLTFLoader });
  } catch {
    // .glb không tải/không đọc được (mạng, proxy, file thiếu): trả panel về blob CSS
    // và báo đúng lý do.
    onUnsupported?.('model');
    renderer.dispose();
    if (canvas.parentNode === host) host.removeChild(canvas);
    return () => {};
  }
  stage.add(student.root);
  // Hook chẩn đoán khi mở kèm ?scene3d-debug: cho phép bật/tắt trạng thái mí mắt
  // và đọc số liệu ngay trong console mà không phải sửa mã.
  if (debugEnabled) window.__studentScene = student;
  if (debugEnabled) window.__studentCamera = camera;

  // Huy hiệu BDU: đặt trong không gian cảnh (không phải trong hệ trục xương, vì
  // xương của rig này xoay theo trục khác), mỗi khung hình bám theo xương ngực.
  if (student.badge && student.chestBone) stage.add(student.badge);
  const chestStrap = createChestStrap(THREE);
  stage.add(chestStrap);

  const props = buildProps(THREE);
  stage.add(props.group);

  const ground = createShadowReceiver(THREE);
  stage.add(ground);

  [student.root, props.group].forEach((root) => {
    root.traverse((node) => {
      if (!node.isMesh || node.userData.isOutline) return;
      if (node.userData.noOutline) return;
      node.castShadow = !node.material?.transparent;
    });
  });
  addToonOutline(THREE, props.group);
  // Nhân vật là skinned mesh: phóng to cả mesh để làm viền sẽ ra một bóng đen
  // khổng lồ, nên nhân vật giữ nguyên chất phẳng của bộ asset gốc.

  const shadowMap = createContactShadowMap(THREE);
  if (shadowMap) {
    [...props.contact].forEach((point) => stage.add(createContactShadow(THREE, shadowMap, point)));
  }

  const player = {
    sitAmount: 0,
    wear: 0,
    lookAway: 0,
    appliedSit: false,
    appliedWear: false,
    currentLoop: null,
    enterAction: null,
    pendingLoop: null
  };
  const raw = { x: 0, y: 0 };
  const pointer = { x: 0, y: 0 };
  const rootPosition = new THREE.Vector3(0, 0, 0);
  const clockStartedAt = performance.now() / 1000;
  let lastTick = 0;
  let raf = 0;
  let hoveredProp = null;

  const startLoop = (name, fade = 0.35) => {
    const next = student.actions.get(name);
    if (!next || next === player.currentLoop) return;
    next.enabled = true;
    next.setEffectiveTimeScale(1);
    next.setEffectiveWeight(1);
    next.setLoop(THREE.LoopRepeat, Infinity);
    next.clampWhenFinished = false;
    next.reset().play();
    if (player.currentLoop) player.currentLoop.crossFadeTo(next, fade, false);
    player.currentLoop = next;
  };

  const playTransition = (enterName, loopName) => {
    const enter = student.actions.get(enterName);
    if (!enter) {
      startLoop(loopName);
      return;
    }
    enter.enabled = true;
    enter.setLoop(THREE.LoopOnce, 1);
    enter.clampWhenFinished = true;
    enter.reset().play();
    if (player.currentLoop && player.currentLoop !== enter) player.currentLoop.crossFadeTo(enter, 0.2, false);
    player.currentLoop = enter;
    player.enterAction = enter;
    player.pendingLoop = loopName;
  };

  student.mixer.addEventListener('finished', (event) => {
    if (event.action !== player.enterAction) return;
    player.enterAction = null;
    const loopName = player.pendingLoop;
    player.pendingLoop = null;
    if (loopName) startLoop(loopName, 0.3);
  });

  const parkedBackpack = SCENE_ANCHORS.backpackParked;
  const parkedBackpackPosition = new THREE.Vector3(parkedBackpack.x, parkedBackpack.y, parkedBackpack.z);
  const parkedBackpackQuaternion = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(0, parkedBackpack.yaw, parkedBackpack.tilt)
  );
  const parkedBook = SCENE_ANCHORS.bookParked;
  const readingBook = SCENE_ANCHORS.bookReading;
  const liftedBook = SCENE_ANCHORS.bookLifted;
  const parkedBookPosition = new THREE.Vector3(parkedBook.x, parkedBook.y, parkedBook.z);
  const parkedBookQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, parkedBook.yaw, 0));
  const readingBookPosition = new THREE.Vector3(readingBook.x, readingBook.y, readingBook.z);
  const readingBookQuaternion = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(readingBook.pitch, parkedBook.yaw, 0)
  );
  const liftedBookPosition = new THREE.Vector3(liftedBook.x, liftedBook.y, liftedBook.z);
  const liftedBookQuaternion = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(liftedBook.pitch, parkedBook.yaw, 0)
  );

  const carryPosition = new THREE.Vector3();
  const backPosition = new THREE.Vector3();
  const carryQuaternion = new THREE.Quaternion();
  const backQuaternion = new THREE.Quaternion();
  const bookRestPosition = new THREE.Vector3();
  const bookRestPathEnd = new THREE.Vector3();
  const bookRestQuaternion = new THREE.Quaternion();
  const workingPosition = new THREE.Vector3();
  const workingQuaternion = new THREE.Quaternion();
  const upAxis = new THREE.Vector3(0, 1, 0);
  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();
  const tiltQuaternion = new THREE.Quaternion();

  // Kích thước canvas: đo lại mỗi khi khung chứa đổi kích thước, không chỉ một
  // lần lúc khởi động. Nếu lúc khởi động panel chưa có bố cục (CSS chưa áp xong,
  // khung đang ẩn) thì bỏ qua, vòng lặp frame sẽ thử lại cho tới khi có số hợp lệ —
  // nếu không sẽ render vào buffer 1x1 và bị CSS kéo giãn thành một đám nhoè.
  let hasValidSize = false;
  const resize = () => {
    const width = host.clientWidth;
    const height = host.clientHeight;
    if (width < 2 || height < 2) return false;
    const aspect = width / height;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
    renderer.setSize(width, height, false);
    camera.aspect = aspect;
    camera.position.z = CAMERA_DISTANCE * Math.min(1.45, Math.max(1, STAGE_ASPECT / aspect));
    camera.updateProjectionMatrix();
    hasValidSize = true;
    return true;
  };

  // Chẩn đoán khi mở kèm ?scene3d-debug: hiện vài con số then chốt để soi từ xa.
  let debugLast = 0;
  const updateDebug = () => {
    if (!debugEnabled || !debugRef?.current) return;
    const now = performance.now();
    if (now - debugLast < 400) return;
    debugLast = now;
    const gl = renderer.getContext();
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const position = student.node?.geometry?.attributes?.position;
    const sample = position ? [position.getX(0), position.getY(0), position.getZ(0)].map((v) => v.toFixed(2)).join(', ') : 'n/a';
    const bookLift = bookLiftAmounts({ away: player.lookAway, sitting: player.sitAmount });
    debugRef.current.textContent = [
      `gpu=${info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'n/a'}`,
      `webgl2=${renderer.capabilities.isWebGL2} maxVertexTextures=${renderer.capabilities.maxVertexTextures} precision=${renderer.capabilities.precision}`,
      `stage=${host.clientWidth}x${host.clientHeight} buffer=${canvas.width}x${canvas.height} dpr=${window.devicePixelRatio}`,
      `scale=${student.debug.scale} modelHeight=${student.debug.modelHeight} minY=${student.debug.modelMinY} bones=${student.debug.bones}`,
      `skinMeshes=${student.skinning?.meshes.length ?? 0} clip=${player.currentLoop?.getClip()?.name ?? 'none'} t=${(player.currentLoop?.time ?? 0).toFixed(2)}`,
      `dinh 0 sau skin=${sample}`,
      `sach doc=${bookLift.reading.toFixed(2)} che=${bookLift.cover.toFixed(2)} cho=${(player.pageCooldown ?? 0).toFixed(1)} giu=${Math.max(0, player.pageHold ?? 0).toFixed(2)} lat=${(player.page ?? 0).toFixed(2)}`
    ].join('\n  ');
  };

  const readPointer = (event) => {    const bounds = host.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const centerX = bounds.left + bounds.width / 2;
    const centerY = bounds.top + bounds.height / 2;
    raw.x = Math.max(-1, Math.min(1, (event.clientX - centerX) / (bounds.width * 0.75)));
    raw.y = Math.max(-1, Math.min(1, (event.clientY - centerY) / (bounds.height * 0.75)));
  };

  const propUnderPointer = (event) => {
    const bounds = canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return null;
    pointerNdc.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    pointerNdc.y = -(((event.clientY - bounds.top) / bounds.height) * 2 - 1);
    raycaster.setFromCamera(pointerNdc, camera);
    const hits = raycaster.intersectObjects(props.interactive.map((entry) => entry.group), true);
    if (hits.length === 0) return null;
    let node = hits[0].object;
    while (node) {
      if (node.userData?.sceneProp) return node.userData.sceneProp;
      node = node.parent;
    }
    return null;
  };

  const onCanvasPointerMove = (event) => {
    hoveredProp = propUnderPointer(event);
    canvas.style.cursor = hoveredProp ? 'pointer' : '';
  };
  const onCanvasPointerLeave = () => {
    hoveredProp = null;
    canvas.style.cursor = '';
  };
  const onCanvasClick = (event) => {
    const prop = propUnderPointer(event);
    const action = prop ? PROP_ACTIONS[prop] : null;
    if (action) onAction(action);
  };

  const frame = () => {
    raf = window.requestAnimationFrame(frame);
    try {
      renderFrame();
    } catch {
      // Lỗi trong một khung hình không được phép spam cả console lẫn GPU: dừng
      // vòng lặp và trả panel về blob CSS.
      stop();
      onUnsupported?.('frame');
    }
  };

  const renderFrame = () => {
    // Bố cục chưa sẵn sàng thì chưa render, tránh vẽ vào buffer 1x1.
    if (!hasValidSize && !resize()) return;
    const now = performance.now() / 1000;
    const dt = lastTick ? Math.min(now - lastTick, 0.05) : 0.016;
    lastTick = now;
    const damp = (current, target, lambda) => THREE.MathUtils.damp(current, target, lambda, dt);

    pointer.x = damp(pointer.x, raw.x, 5);
    pointer.y = damp(pointer.y, raw.y, 5);
    player.lookAway = damp(player.lookAway, document.body.classList.contains('password-active') ? 1 : 0, 5);

    // Trạng thái mong muốn, có xếp hàng: muốn ngồi thì phải cởi ba lô xuống
    // trước, muốn đeo ba lô thì phải đứng dậy trước.
    const desired = getState();
    const wantSit = desired.sitting === true;
    const wantWear = desired.backpackOn === true;

    if (!player.appliedSit && wantSit && player.wear < 0.18) {
      playTransition(SCENE_CLIPS.SIT_DOWN, SCENE_CLIPS.SIT_IDLE);
      player.appliedSit = true;
      player.appliedWear = false;
    } else if (player.appliedSit && !wantSit) {
      playTransition(SCENE_CLIPS.SIT_UP, SCENE_CLIPS.IDLE);
      player.appliedSit = false;
    } else if (!player.appliedWear && wantWear && !player.appliedSit && !player.enterAction) {
      playTransition(SCENE_CLIPS.PICKUP, SCENE_CLIPS.IDLE);
      player.appliedWear = true;
    } else if (player.appliedWear && !wantWear) {
      player.appliedWear = false;
    }

    if (!player.currentLoop && !player.enterAction && !player.appliedSit) startLoop(SCENE_CLIPS.IDLE);

    player.sitAmount = damp(player.sitAmount, player.appliedSit ? 1 : 0, 2.2);
    player.wear = damp(player.wear, player.appliedWear ? 1 : 0, 2.4);

    // Nhân vật bước sang ghế khi ngồi: clip ngồi tại chỗ nên dịch gốc cảnh.
    rootPosition.x = damp(rootPosition.x, player.appliedSit || player.sitAmount > 0.05 ? SIT_ANCHOR_X : 0, 3.2);
    student.root.position.x = rootPosition.x;
    student.root.position.z = 0;

    student.mixer.update(dt);
    student.skinning?.update();

    // Góc xoay cộng thêm sau mixer: dõi theo con trỏ, cúi đầu đọc sách khi ngồi,
    // quay mặt đi khi gõ mật khẩu lúc còn đứng. Đặt lên khớp phụ với giá trị TUYỆT
    // ĐỐI mỗi frame — không cộng dồn lên xương, vì mixer không phải lúc nào cũng
    // ghi lại xương (xem wrapBoneWithPivot trong studentAsset.js).
    const away = player.lookAway;
    if (student.headPivot) {
      const offsets = headOffsets({
        away,
        pointerX: pointer.x,
        pointerY: pointer.y,
        reading: player.sitAmount
      });
      student.headPivot.rotation.set(offsets.x, offsets.y, 0);
    }
    // Nhắm mắt khi gõ mật khẩu: mi phủ + gạch mí dựng từ chính tam giác mắt, hiện
    // dần theo mức "né" (xem createEyelids).
    if (student.eyelids) {
      const lids = THREE.MathUtils.clamp((away - 0.35) / 0.3, 0, 1);
      student.eyelids.materials.forEach((material) => { material.opacity = lids; });
      student.eyelids.group.visible = lids > 0.02;
    }
    // Tay: ba bộ góc cộng thêm loại trừ nhau theo trạng thái — "né" khi gõ mật khẩu
    // lúc đứng, "đỡ sách" khi ngồi đọc, "giữ sách che mặt" khi ngồi mà gõ mật khẩu.
    // Vì loại trừ nhau nên cộng thẳng ba bộ là an toàn.
    const armAway = armAwayAmount({ away, sitting: player.sitAmount });
    const armReading = readingArmAmount({ away, sitting: player.sitAmount });
    const armCover = coverArmAmount({ away, sitting: player.sitAmount });
    const awayOffsets = awayBoneOffsets(player.sitAmount);
    [
      [student.upperArmRightPivot, awayOffsets.upperArmRight, READING_BONES.upperArmRight, COVER_BONES.upperArmRight],
      [student.lowerArmRightPivot, awayOffsets.lowerArmRight, READING_BONES.lowerArmRight, COVER_BONES.lowerArmRight],
      [student.upperArmLeftPivot, awayOffsets.upperArmLeft, READING_BONES.upperArmLeft, COVER_BONES.upperArmLeft],
      [student.lowerArmLeftPivot, awayOffsets.lowerArmLeft, READING_BONES.lowerArmLeft, COVER_BONES.lowerArmLeft]
    ].forEach(([pivot, awayOffset, readingOffset, coverOffset]) => {
      if (!pivot) return;
      pivot.rotation.set(
        awayOffset.x * armAway + readingOffset.x * armReading + coverOffset.x * armCover,
        awayOffset.y * armAway + readingOffset.y * armReading + coverOffset.y * armCover,
        awayOffset.z * armAway + readingOffset.z * armReading + coverOffset.z * armCover
      );
    });

    // Huy hiệu BDU bám trước ngực, luôn hướng ra ngoài như mặt trước nhân vật.
    const wearT = Math.min(1, Math.max(0, player.wear));
    const chestPos = new THREE.Vector3();
    if (student.chestBone) student.chestBone.getWorldPosition(chestPos);
    else chestPos.set(0, 0.9, 0);
    if (student.badge && student.chestBone) {
      student.badge.position.set(chestPos.x, chestPos.y + 0.06, chestPos.z + 0.26);
      student.badge.quaternion.setFromEuler(new THREE.Euler(0, pointer.x * 0.1, 0));
    }
    // Dây đeo ngang ngực chỉ hiện khi ba lô đã lên lưng.
    const strapOn = wearT > 0.5;
    chestStrap.visible = strapOn;
    if (strapOn) {
      chestStrap.scale.setScalar(THREE.MathUtils.damp(chestStrap.scale.x, 1, 9, dt));
      chestStrap.position.set(chestPos.x, chestPos.y - 0.1, chestPos.z + 0.24);
      // Nghiêng nhẹ theo thân để dây không nằm chỏng chơ trước ngực.
      chestStrap.rotation.set(0.12, 0, -0.06);
    }

    // Ba lô: dưới đất → theo tay → lên lưng. Đặt theo không gian cảnh (trục của
    // rig này khác trục nhân vật nên không dùng hệ trục xương để tính vị trí).
    if (wearT <= 0.001) {
      workingPosition.copy(parkedBackpackPosition);
      workingQuaternion.copy(parkedBackpackQuaternion);
    } else {
      const chestPosWorn = chestPos;
      backPosition.set(chestPosWorn.x, chestPosWorn.y + 0.08, chestPosWorn.z - 0.42);
      backQuaternion.copy(student.root.quaternion).multiply(tiltQuaternion.setFromAxisAngle(upAxis, Math.PI));
      if (student.handRight) {
        student.handRight.getWorldPosition(carryPosition);
      } else {
        carryPosition.copy(backPosition);
      }
      carryPosition.y += 0.05;
      carryQuaternion
        .copy(student.root.quaternion)
        .multiply(tiltQuaternion.setFromAxisAngle(upAxis, Math.PI * 0.5))
        .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.3));

      const split = 0.45;
      if (wearT < split) {
        const k = easeInOut(wearT / split);
        workingPosition.lerpVectors(parkedBackpackPosition, carryPosition, k);
        workingQuaternion.slerpQuaternions(parkedBackpackQuaternion, carryQuaternion, k);
      } else {
        const k = easeInOut((wearT - split) / (1 - split));
        workingPosition.lerpVectors(carryPosition, backPosition, k);
        workingQuaternion.slerpQuaternions(carryQuaternion, backQuaternion, k);
      }
    }
    props.backpack.position.copy(workingPosition);
    props.backpack.quaternion.copy(workingQuaternion);

    // Vở: khi ba lô đang đeo thì vở nằm TRONG cặp (khuất trong thân cặp), cởi cặp
    // ra là vở rời khỏi cặp về mặt bàn — nhờ vậy nhịp "cởi ba lô để lấy vở ra rồi
    // mới ngồi học" diễn ra trước khi nhân vật ngồi xuống. Đeo cặp lúc đang đứng
    // cũng thành nhịp "cất vở vào cặp" theo chiều ngược lại.
    //
    // Đường đi cong qua bàn tay phải (De Casteljau) thay vì đường thẳng, để vở
    // không xuyên qua thân nhân vật mà trông như đang được cầm đưa ra/vào cặp.
    bookRestPathEnd.lerpVectors(carryPosition, props.backpack.position, wearT);
    bookRestPosition.lerpVectors(parkedBookPosition, carryPosition, wearT).lerp(bookRestPathEnd, wearT);
    bookRestQuaternion.copy(parkedBookQuaternion);

    // Sách ba tư thế: nghỉ (trên bàn / trong cặp) → nghiêng lên đọc (ngồi) → giơ
    // che mặt (đang ngồi mà gõ mật khẩu). Trọng số từ bookLiftAmounts, lerp hai
    // tầng nên sách không bao giờ nhảy giữa các tư thế.
    const bookLift = bookLiftAmounts({ away, sitting: player.sitAmount });
    workingPosition.lerpVectors(bookRestPosition, readingBookPosition, bookLift.reading);
    workingQuaternion.slerpQuaternions(bookRestQuaternion, readingBookQuaternion, bookLift.reading);
    workingPosition.lerp(liftedBookPosition, bookLift.cover);
    workingQuaternion.slerp(liftedBookQuaternion, bookLift.cover);
    props.book.group.position.copy(workingPosition);
    props.book.group.quaternion.copy(workingQuaternion);

    // Lật trang khi đang chăm chú đọc; lúc đưa sách lên che mặt thì dừng. Nhịp thưa
    // để không ồn ào khi nhân vật ngồi học lâu.
    if (player.sitAmount > 0.6 && bookLift.cover < 0.2) {
      player.pageCooldown = (player.pageCooldown ?? PAGE_FLIP_FIRST_DELAY) - dt;
      if (player.pageCooldown <= 0) {
        player.pageCooldown = nextPageFlipDelay();
        player.pageHold = PAGE_FLIP_HOLD;
      }
    }
    // Đếm ngược đặt ngoài nhánh trên: đứng dậy giữa lúc lật thì trang phải hạ
    // xuống, không kẹt dựng đứng trên bàn.
    if (player.pageHold > 0) player.pageHold -= dt;
    const flipping = player.pageHold > 0;
    player.page = damp(player.page ?? 0, flipping ? 1 : 0, flipping ? 7 : 3.5);
    props.book.page.rotation.z = player.page * Math.PI * 0.92;

    props.interactive.forEach(({ id, group }) => {
      const target = id === hoveredProp ? HOVER_SCALE : 1;
      group.scale.setScalar(damp(group.scale.x, target, 9));
    });

    camera.position.x = damp(camera.position.x, pointer.x * 0.4, 2.4);
    camera.position.y = damp(camera.position.y, CAMERA_HEIGHT - pointer.y * 0.17, 2.4);
    camera.lookAt(lookTarget);

    renderer.render(scene, camera);
    updateDebug();
  };

  const stop = () => {
    if (!raf) return;
    window.cancelAnimationFrame(raf);
    raf = 0;
  };
  const start = () => {
    if (raf) return;
    lastTick = 0;
    frame();
  };
  const onVisibilityChange = () => {
    if (document.hidden) stop();
    else start();
  };
  const onContextLost = (event) => {
    event.preventDefault();
    onUnsupported?.('context-lost');
  };

  resize();
  const resizeObserver = typeof window.ResizeObserver === 'function' ? new window.ResizeObserver(resize) : null;
  resizeObserver?.observe(host);
  window.addEventListener('resize', resize);
  window.addEventListener('pointermove', readPointer, { passive: true });
  document.addEventListener('visibilitychange', onVisibilityChange);
  canvas.addEventListener('pointermove', onCanvasPointerMove);
  canvas.addEventListener('pointerleave', onCanvasPointerLeave);
  canvas.addEventListener('click', onCanvasClick);
  canvas.addEventListener('webglcontextlost', onContextLost);
  start();

  return function teardown() {
    stop();
    resizeObserver?.disconnect();
    window.removeEventListener('resize', resize);
    window.removeEventListener('pointermove', readPointer);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    canvas.removeEventListener('pointermove', onCanvasPointerMove);
    canvas.removeEventListener('pointerleave', onCanvasPointerLeave);
    canvas.removeEventListener('click', onCanvasClick);
    canvas.removeEventListener('webglcontextlost', onContextLost);
    stage.traverse((node) => {
      node.geometry?.dispose?.();
      const materials = Array.isArray(node.material) ? node.material : node.material ? [node.material] : [];
      materials.forEach((material) => {
        material.map?.dispose?.();
        material.dispose?.();
      });
    });
    shadowMap?.dispose?.();
    renderer.dispose();
    if (canvas.parentNode === host) host.removeChild(canvas);
  };
}

export default function StudentScene({ onUnsupported }) {
  const canvasHostRef = useRef(null);
  const debugRef = useRef(null);
  const [sceneState, setSceneState] = useState(createSceneState);
  const [announcement, setAnnouncement] = useState('');
  const debugEnabled = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).has('scene3d-debug');
  const stateRef = useRef(sceneState);
  const onActionRef = useRef(null);

  const handleAction = useCallback((action) => {
    const next = reduceSceneState(stateRef.current, action);
    stateRef.current = next;
    setSceneState(next);
    setAnnouncement(describeSceneState(next));
  }, []);
  onActionRef.current = handleAction;

  useEffect(() => {
    const canvasHost = canvasHostRef.current;
    if (!canvasHost) return undefined;
    let disposed = false;
    let notified = false;
    let teardown = null;

    const fail = (reason) => {
      if (disposed || notified) return;
      notified = true;
      teardown?.();
      teardown = null;
      onUnsupported?.(reason);
    };

    (async () => {
      let THREE;
      let GLTFLoader;
      try {
        THREE = await import('three');
        ({ GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js'));
      } catch {
        fail('three-import');
        return;
      }
      if (disposed || notified) return;
      try {
        teardown = await startStudentScene({
          THREE,
          GLTFLoader,
          host: canvasHost,
          getState: () => stateRef.current,
          onAction: (action) => onActionRef.current?.(action),
          onUnsupported: fail,
          debugRef,
          debugEnabled
        });
      } catch {
        fail('start');
      }
    })();

    return () => {
      disposed = true;
      teardown?.();
      teardown = null;
    };
    // debugEnabled chỉ đọc một lần lúc mount và debugRef là ref ổn định, không cần
    // đưa vào danh sách phụ thuộc (đưa vào sẽ dựng lại cảnh 3D mỗi lần render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onUnsupported]);

  return (
    <div className="student-scene">
      <div className="student-scene-canvas-host" ref={canvasHostRef} />
      {debugEnabled && <pre className="student-scene-debug" ref={debugRef} />}
      <div className="student-scene-controls">
        <button
          type="button"
          className="scene-control"
          onClick={() => handleAction(SCENE_ACTIONS.BACKPACK)}
        >
          {sceneActionLabel(sceneState, SCENE_ACTIONS.BACKPACK)}
        </button>
        <button
          type="button"
          className="scene-control"
          onClick={() => handleAction(SCENE_ACTIONS.DESK)}
        >
          {sceneActionLabel(sceneState, SCENE_ACTIONS.DESK)}
        </button>
      </div>
      <p className="scene-status" role="status" aria-live="polite">{announcement}</p>
    </div>
  );
}
