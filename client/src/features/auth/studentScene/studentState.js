// Máy trạng thái thuần cho cảnh 3D trang đăng nhập: ba tư thế đứng / đeo ba lô /
// ngồi học, hai hành động bấm được (ba lô, bàn–ghế).
//
// Không import three, không đụng DOM: test được trong jsdom và StudentScene chỉ
// việc đọc kết quả để chạy hoạt hình. Hai cờ không bao giờ cùng bật — muốn ngồi
// thì phải bỏ ba lô xuống, muốn đeo ba lô thì phải đứng dậy.

export const SCENE_ACTIONS = Object.freeze({ BACKPACK: 'backpack', DESK: 'desk' });

export function createSceneState() {
  return { backpackOn: false, sitting: false };
}

export function reduceSceneState(state, action) {
  const backpackOn = state?.backpackOn === true;
  const sitting = state?.sitting === true;
  if (action === SCENE_ACTIONS.BACKPACK) return { backpackOn: !backpackOn, sitting: false };
  if (action === SCENE_ACTIONS.DESK) return { backpackOn: false, sitting: !sitting };
  return { backpackOn, sitting };
}

// Nhãn cho nút thật (bàn phím) và trình đọc màn hình: đổi theo trạng thái hiện
// tại để nút luôn nói đúng việc nó sắp làm.
export function sceneActionLabel(state, action) {
  if (action === SCENE_ACTIONS.BACKPACK) {
    return state?.backpackOn ? 'Bỏ ba lô xuống' : 'Đeo ba lô';
  }
  if (action === SCENE_ACTIONS.DESK) {
    return state?.sitting ? 'Đứng dậy khỏi bàn' : 'Ngồi vào bàn học';
  }
  return 'Tương tác cảnh';
}

// Câu cho aria-live sau mỗi lần đổi trạng thái.
export function describeSceneState(state) {
  if (state?.sitting) return 'Sinh viên đang ngồi học ở bàn.';
  if (state?.backpackOn) return 'Sinh viên đã đeo ba lô.';
  return 'Sinh viên đang đứng cạnh bàn.';
}
