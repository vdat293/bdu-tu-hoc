import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AWAY_BONES,
  COVER_BONES,
  READ_HEAD_PITCH,
  READING_BONES,
  SCENE_CLIPS,
  armAwayAmount,
  awayBoneOffsets,
  bookLiftAmounts,
  coverArmAmount,
  headOffsets,
  nextPageFlipDelay,
  PAGE_FLIP_FIRST_DELAY,
  PAGE_FLIP_HOLD,
  readingArmAmount,
  transitionPlan
} from '../../client/src/features/auth/studentScene/studentClip.js';
import {
  SCENE_ACTIONS,
  createSceneState,
  describeSceneState,
  reduceSceneState,
  sceneActionLabel
} from '../../client/src/features/auth/studentScene/studentState.js';

describe('máy trạng thái cảnh 3D', () => {
  afterEach(() => vi.restoreAllMocks());

  it('bắt đầu ở tư thế đứng, chưa đeo gì và chưa ngồi', () => {
    expect(createSceneState()).toEqual({ backpackOn: false, sitting: false });
  });

  it('bấm ba lô thì đeo lên, bấm lần nữa thì bỏ xuống', () => {
    const wearing = reduceSceneState(createSceneState(), SCENE_ACTIONS.BACKPACK);
    expect(wearing).toEqual({ backpackOn: true, sitting: false });
    expect(reduceSceneState(wearing, SCENE_ACTIONS.BACKPACK)).toEqual({ backpackOn: false, sitting: false });
  });

  it('bấm bàn–ghế thì ngồi xuống, bấm lần nữa thì đứng dậy', () => {
    const studying = reduceSceneState(createSceneState(), SCENE_ACTIONS.DESK);
    expect(studying).toEqual({ backpackOn: false, sitting: true });
    expect(reduceSceneState(studying, SCENE_ACTIONS.DESK)).toEqual({ backpackOn: false, sitting: false });
  });

  it('đang đeo ba lô mà bấm ghế thì phải bỏ ba lô xuống rồi mới ngồi', () => {
    const wearing = { backpackOn: true, sitting: false };
    expect(reduceSceneState(wearing, SCENE_ACTIONS.DESK)).toEqual({ backpackOn: false, sitting: true });
  });

  it('đang ngồi học mà bấm ba lô thì phải đứng dậy rồi mới đeo', () => {
    const studying = { backpackOn: false, sitting: true };
    expect(reduceSceneState(studying, SCENE_ACTIONS.BACKPACK)).toEqual({ backpackOn: true, sitting: false });
  });

  it('không bao giờ vừa đeo ba lô vừa ngồi', () => {
    const actions = [SCENE_ACTIONS.BACKPACK, SCENE_ACTIONS.DESK];
    let state = createSceneState();
    for (const first of actions) {
      for (const second of actions) {
        state = reduceSceneState(state, first);
        state = reduceSceneState(state, second);
        expect(state.sitting && state.backpackOn).toBe(false);
      }
    }
  });

  it('bỏ qua hành động lạ và state hỏng mà không vỡ', () => {
    expect(reduceSceneState(createSceneState(), 'khong-ton-tai')).toEqual({ backpackOn: false, sitting: false });
    expect(reduceSceneState(undefined, SCENE_ACTIONS.DESK)).toEqual({ backpackOn: false, sitting: true });
  });

  it('nhãn nút đổi theo trạng thái để nói đúng việc sắp xảy ra', () => {
    expect(sceneActionLabel(createSceneState(), SCENE_ACTIONS.BACKPACK)).toBe('Đeo ba lô');
    expect(sceneActionLabel({ backpackOn: true, sitting: false }, SCENE_ACTIONS.BACKPACK)).toBe('Bỏ ba lô xuống');
    expect(sceneActionLabel(createSceneState(), SCENE_ACTIONS.DESK)).toBe('Ngồi vào bàn học');
    expect(sceneActionLabel({ backpackOn: false, sitting: true }, SCENE_ACTIONS.DESK)).toBe('Đứng dậy khỏi bàn');
  });

  it('có câu mô tả cho aria-live ở cả ba trạng thái', () => {
    expect(describeSceneState(createSceneState())).toContain('đứng');
    expect(describeSceneState({ backpackOn: true, sitting: false })).toContain('ba lô');
    expect(describeSceneState({ backpackOn: false, sitting: true })).toContain('ngồi học');
  });
});

describe('kế hoạch animation', () => {
  const idleState = { backpackOn: false, sitting: false };

  it('đứng yên thì chỉ lặp clip Idle', () => {
    expect(transitionPlan(idleState, idleState)).toEqual({ enter: null, loop: SCENE_CLIPS.IDLE });
  });

  it('vừa đeo ba lô thì chạy clip nhặt một lần rồi về Idle', () => {
    const plan = transitionPlan(idleState, { backpackOn: true, sitting: false });
    expect(plan.enter).toBe(SCENE_CLIPS.PICKUP);
    expect(plan.loop).toBe(SCENE_CLIPS.IDLE);
  });

  it('bỏ ba lô xuống thì không cần clip riêng, chỉ về Idle', () => {
    const plan = transitionPlan({ backpackOn: true, sitting: false }, idleState);
    expect(plan.enter).toBeNull();
    expect(plan.loop).toBe(SCENE_CLIPS.IDLE);
  });

  it('ngồi xuống thì chạy clip ngồi rồi lặp tư thế ngồi', () => {
    const plan = transitionPlan(idleState, { backpackOn: false, sitting: true });
    expect(plan.enter).toBe(SCENE_CLIPS.SIT_DOWN);
    expect(plan.loop).toBe(SCENE_CLIPS.SIT_IDLE);
  });

  it('đứng dậy thì chạy clip đứng lên rồi lặp Idle', () => {
    const plan = transitionPlan({ backpackOn: false, sitting: true }, idleState);
    expect(plan.enter).toBe(SCENE_CLIPS.SIT_UP);
    expect(plan.loop).toBe(SCENE_CLIPS.IDLE);
  });

  it('đang ngồi mà đổi sang đeo ba lô vẫn phải đứng dậy trước', () => {
    const plan = transitionPlan({ backpackOn: false, sitting: true }, { backpackOn: true, sitting: false });
    expect(plan.enter).toBe(SCENE_CLIPS.SIT_UP);
  });

  it('state hỏng vẫn trả về kế hoạch an toàn', () => {
    expect(transitionPlan(undefined, undefined)).toEqual({ enter: null, loop: SCENE_CLIPS.IDLE });
  });
});

describe('góc xoay thêm sau mixer', () => {
  it('né thì quay mặt đi, bình thường thì dõi theo con trỏ', () => {
    expect(headOffsets({ away: 1 }).y).toBeCloseTo(-0.85);
    expect(headOffsets({ away: 0, pointerX: 1 }).y).toBeCloseTo(0.28);
    expect(headOffsets({ away: 0, pointerX: -1 }).y).toBeCloseTo(-0.28);
    expect(headOffsets({ away: 0, pointerY: 0.5 }).x).toBeCloseTo(0.07);
  });

  it('đang ngồi thì không vung tay, chỉ còn sách che mặt', () => {
    expect(armAwayAmount({ away: 1, sitting: 1 })).toBe(0);
    expect(armAwayAmount({ away: 1, sitting: 0 })).toBe(1);
    expect(armAwayAmount({ away: 0.5, sitting: 0.5 })).toBeCloseTo(0.25);
  });

  it('kẹp giá trị ngoài khoảng 0..1', () => {
    expect(armAwayAmount({ away: 5, sitting: 0 })).toBe(1);
    expect(armAwayAmount({ away: -2, sitting: 0 })).toBe(0);
    expect(headOffsets({ away: -1, pointerX: 0 }).y).toBeCloseTo(0);
  });

  it('đang đọc thì cúi đầu xuống sách và tạm ngưng dõi con trỏ', () => {
    const reading = headOffsets({ away: 0, pointerX: 1, pointerY: 1, reading: 1 });
    expect(reading.x).toBeCloseTo(READ_HEAD_PITCH);
    expect(reading.y).toBeCloseTo(0);
    expect(READ_HEAD_PITCH).toBeGreaterThan(0.3);
  });

  it('đang đọc mà né thì vẫn cúi vào sách, không quay mặt đi', () => {
    const covered = headOffsets({ away: 1, reading: 1 });
    expect(covered.x).toBeCloseTo(READ_HEAD_PITCH);
    expect(covered.y).toBeCloseTo(0);
  });

  it('chọn bộ góc tay theo tư thế đứng hay ngồi', () => {
    expect(awayBoneOffsets(0)).toBe(AWAY_BONES.standing);
    expect(awayBoneOffsets(1)).toBe(AWAY_BONES.sitting);
    expect(AWAY_BONES.standing.upperArmRight.x).toBeLessThan(0);
    expect(AWAY_BONES.sitting.upperArmRight.x).toBe(0);
  });

  it('đang ngồi đọc thì tay có góc "đỡ sách", đang né thì nhả ra', () => {
    expect(readingArmAmount({ away: 0, sitting: 1 })).toBe(1);
    expect(readingArmAmount({ away: 1, sitting: 1 })).toBe(0);
    expect(readingArmAmount({ away: 0, sitting: 0 })).toBe(0);
    expect(readingArmAmount({ away: 0.5, sitting: 1 })).toBeCloseTo(0.5);
    expect(readingArmAmount({ away: 5, sitting: -2 })).toBe(0);
    // Tay trái của rig đối xứng nên dấu ngược với tay phải cho cùng hướng đưa ra trước.
    expect(READING_BONES.upperArmRight.x).toBeLessThan(0);
    expect(READING_BONES.upperArmLeft.x).toBeGreaterThan(0);
    expect(READING_BONES.lowerArmRight.x).toBeLessThan(0);
    expect(READING_BONES.lowerArmLeft.x).toBeGreaterThan(0);
  });

  it('ngồi mà gõ mật khẩu thì tay giữ sách che mặt, không buông xuống bàn', () => {
    expect(coverArmAmount({ away: 1, sitting: 1 })).toBe(1);
    expect(coverArmAmount({ away: 0, sitting: 1 })).toBe(0);
    expect(coverArmAmount({ away: 1, sitting: 0 })).toBe(0);
    expect(coverArmAmount({ away: 0.5, sitting: 1 })).toBeCloseTo(0.5);
    expect(coverArmAmount({ away: 5, sitting: 5 })).toBe(1);
    // Hai tay cùng giữ sách: dấu đối xứng, và phải cao hơn tư thế đọc.
    expect(COVER_BONES.upperArmRight.x).toBeLessThan(READING_BONES.upperArmRight.x);
    expect(COVER_BONES.upperArmLeft.x).toBeGreaterThan(READING_BONES.upperArmLeft.x);
    expect(COVER_BONES.lowerArmRight.x).toBeLessThan(READING_BONES.lowerArmRight.x);
    expect(COVER_BONES.lowerArmLeft.x).toBeGreaterThan(READING_BONES.lowerArmLeft.x);
  });
});

describe('mức nâng sách khi ngồi học', () => {
  it('đứng thì sách nằm trên bàn', () => {
    expect(bookLiftAmounts({ away: 0, sitting: 0 })).toEqual({ reading: 0, cover: 0 });
  });

  it('vừa ngồi là chuyển sang tư thế đọc, chưa cần gõ mật khẩu', () => {
    expect(bookLiftAmounts({ away: 0, sitting: 1 })).toEqual({ reading: 1, cover: 0 });
  });

  it('đang ngồi mà gõ mật khẩu thì nâng tiếp tới che mặt', () => {
    expect(bookLiftAmounts({ away: 1, sitting: 1 })).toEqual({ reading: 1, cover: 1 });
  });

  it('chỉ né lúc còn đứng thì sách vẫn nằm trên bàn', () => {
    expect(bookLiftAmounts({ away: 1, sitting: 0 })).toEqual({ reading: 0, cover: 0 });
  });

  it('kẹp giá trị ngoài khoảng và chịu được đầu vào hỏng', () => {
    expect(bookLiftAmounts({ away: 5, sitting: 5 })).toEqual({ reading: 1, cover: 1 });
    expect(bookLiftAmounts({ away: -2, sitting: -2 })).toEqual({ reading: 0, cover: 0 });
    expect(bookLiftAmounts()).toEqual({ reading: 0, cover: 0 });
    expect(bookLiftAmounts({ away: Number.NaN, sitting: Number.NaN })).toEqual({ reading: 0, cover: 0 });
  });

  it('đi từ đọc sang che mặt là tăng đơn điệu theo mức né', () => {
    const reading = bookLiftAmounts({ away: 0, sitting: 1 });
    const middle = bookLiftAmounts({ away: 0.5, sitting: 1 });
    const cover = bookLiftAmounts({ away: 1, sitting: 1 });
    expect(middle.reading).toBe(reading.reading);
    expect(middle.cover).toBeGreaterThan(reading.cover);
    expect(middle.cover).toBeLessThan(cover.cover);
  });
});

describe('nhịp lật trang khi đọc', () => {
  it('lần lật sau cách nhau 6,5–10 giây và chậm hơn nhịp lần đầu', () => {
    expect(nextPageFlipDelay(() => 0)).toBeCloseTo(6.5);
    expect(nextPageFlipDelay(() => 1)).toBeCloseTo(10);
    expect(nextPageFlipDelay(() => 0.5)).toBeCloseTo(8.25);
    expect(PAGE_FLIP_FIRST_DELAY).toBeLessThan(6.5);
  });

  it('kẹp giá trị random hỏng để nhịp không bao giờ vượt trần', () => {
    expect(nextPageFlipDelay(() => 5)).toBeCloseTo(10);
    expect(nextPageFlipDelay(() => -3)).toBeCloseTo(6.5);
    expect(PAGE_FLIP_HOLD).toBeGreaterThan(0);
    expect(PAGE_FLIP_HOLD).toBeLessThan(PAGE_FLIP_FIRST_DELAY);
  });
});
