// Kế hoạch chạy animation cho cảnh 3D: tách khỏi three để test được và để chỗ
// chỉnh duy nhất nằm ở một file.
//
// Nhân vật dùng bộ animation CC0 của KayKit. Mỗi lần trạng thái đổi, cảnh chạy
// một clip "vào" (một lần) rồi chuyển sang clip "lặp". Các động tác nhỏ (dõi theo
// con trỏ, quay mặt đi khi gõ mật khẩu) không phải clip mà là góc xoay cộng thêm
// vào xương sau khi mixer cập nhật, nên không đụng tới clip đang chạy.

export const SCENE_CLIPS = Object.freeze({
  IDLE: 'Idle',
  PICKUP: 'PickUp',
  SIT_DOWN: 'Sit_Chair_Down',
  SIT_IDLE: 'Sit_Chair_Idle',
  SIT_UP: 'Sit_Chair_StandUp'
});

// Trạng thái trước → trạng thái sau: cần chạy clip nào.
export function transitionPlan(previous, next) {
  const was = { backpackOn: previous?.backpackOn === true, sitting: previous?.sitting === true };
  const now = { backpackOn: next?.backpackOn === true, sitting: next?.sitting === true };
  if (now.sitting && !was.sitting) return { enter: SCENE_CLIPS.SIT_DOWN, loop: SCENE_CLIPS.SIT_IDLE };
  if (!now.sitting && was.sitting) return { enter: SCENE_CLIPS.SIT_UP, loop: SCENE_CLIPS.IDLE };
  if (now.backpackOn && !was.backpackOn) return { enter: SCENE_CLIPS.PICKUP, loop: SCENE_CLIPS.IDLE };
  return { enter: null, loop: now.sitting ? SCENE_CLIPS.SIT_IDLE : SCENE_CLIPS.IDLE };
}

// Góc xoay cộng thêm vào xương khi "né" (gõ mật khẩu). Đứng thì tay phải đưa lên
// kéo cổ áo; đang ngồi học thì chỉ quay mặt đi vì cuốn sách đã che mặt rồi.
export const AWAY_BONES = Object.freeze({
  standing: {
    upperArmRight: { x: -1.15, y: -0.25, z: 0 },
    lowerArmRight: { x: -1.35, y: 0, z: 0 },
    upperArmLeft: { x: 0.2, y: 0, z: 0 },
    lowerArmLeft: { x: 0, y: 0, z: 0 }
  },
  sitting: {
    upperArmRight: { x: 0, y: 0, z: 0 },
    lowerArmRight: { x: 0, y: 0, z: 0 },
    upperArmLeft: { x: 0, y: 0, z: 0 },
    lowerArmLeft: { x: 0, y: 0, z: 0 }
  }
});

// Góc xoay cộng thêm khi NGỒI HỌC: hai tay đưa lên đỡ hai mép dưới cuốn sách. Tay
// trái của rig này có trục đối xứng nên dấu x/y ngược với tay phải (xem AWAY_BONES:
// tay phải dùng x âm, tay trái dùng x dương cho cùng một hướng đưa tay ra trước).
export const READING_BONES = Object.freeze({
  upperArmRight: { x: -0.72, y: -0.12, z: 0 },
  lowerArmRight: { x: -0.85, y: 0, z: 0 },
  upperArmLeft: { x: 0.72, y: 0.12, z: 0 },
  lowerArmLeft: { x: 0.85, y: 0, z: 0 }
});

// Góc xoay cộng thêm khi GIƠ SÁCH CHE MẶT (đang ngồi mà gõ mật khẩu): hai tay nâng
// theo cuốn sách lên trước mặt, không buông xuống bàn để sách khỏi lơ lửng.
export const COVER_BONES = Object.freeze({
  upperArmRight: { x: -1.15, y: -0.2, z: 0 },
  lowerArmRight: { x: -1.3, y: 0, z: 0 },
  upperArmLeft: { x: 1.15, y: 0.2, z: 0 },
  lowerArmLeft: { x: 1.3, y: 0, z: 0 }
});

// Mức "dùng xương tay" khi cầm sách: chỉ khi đang ngồi đọc và chưa né.
export function readingArmAmount({ away = 0, sitting = 0 } = {}) {
  return clamp01(sitting) * (1 - clamp01(away));
}

// Mức "dùng xương tay" khi giơ sách che mặt: đang ngồi và đang né.
export function coverArmAmount({ away = 0, sitting = 0 } = {}) {
  return clamp01(sitting) * clamp01(away);
}

export function awayBoneOffsets(sittingAmount) {
  return clamp01(sittingAmount) > 0.5 ? AWAY_BONES.sitting : AWAY_BONES.standing;
}

function clamp01(value) {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

function clampSigned(value) {
  return Math.min(1, Math.max(-1, Number.isFinite(value) ? value : 0));
}

// Góc cúi đầu khi chăm chú đọc sách (radian): nhìn xuống trang giấy thay vì nhìn
// thẳng ra camera.
export const READ_HEAD_PITCH = 0.46;

// Quay mặt đi khi né và dõi theo con trỏ khi bình thường; lúc đang đọc thì đầu cúi
// xuống sách và tạm ngưng dõi con trỏ để không phá tư thế học bài.
export function headOffsets({ away = 0, pointerX = 0, pointerY = 0, reading = 0 } = {}) {
  const awayAmount = clamp01(away);
  const read = clamp01(reading);
  const look = (1 - awayAmount) * (1 - read);
  const turnAway = awayAmount * (1 - read);
  return {
    y: turnAway * -0.85 + look * clampSigned(pointerX) * 0.28,
    x: read * READ_HEAD_PITCH + turnAway * 0.12 + look * clampSigned(pointerY) * 0.14
  };
}

// Mức "dùng xương tay" khi né: lúc đang ngồi thì không vung tay, chỉ có sách che.
export function armAwayAmount({ away = 0, sitting = 0 } = {}) {
  return clamp01(away) * (1 - clamp01(sitting));
}

// Trọng số nâng cuốn sách, hai tầng rời nhau để cảnh lerp qua ba tư thế:
//   - `reading`: sách rời bàn, nghiêng về phía mặt nhân vật (ngồi là đọc ngay).
//   - `cover`:   từ tư thế đọc nâng tiếp lên che kín mặt (đang ngồi mà gõ mật khẩu).
// Đứng thì cả hai bằng 0 (sách nằm trên bàn) — người đứng không cầm sách che mặt.
export function bookLiftAmounts({ away = 0, sitting = 0 } = {}) {
  const sit = clamp01(sitting);
  const cover = clamp01(away);
  return { reading: sit, cover: sit * cover };
}

// Nhịp lật trang khi đang đọc: lần đầu hơi sớm, sau đó thưa (6,5–10 giây) để nhân
// vật ngồi học trông chăm chú chứ không lật liên tục.
export const PAGE_FLIP_FIRST_DELAY = 5;
export const PAGE_FLIP_MIN_DELAY = 6.5;
export const PAGE_FLIP_MAX_EXTRA = 3.5;
export const PAGE_FLIP_HOLD = 0.45;

export function nextPageFlipDelay(random = Math.random) {
  return PAGE_FLIP_MIN_DELAY + clamp01(random()) * PAGE_FLIP_MAX_EXTRA;
}
