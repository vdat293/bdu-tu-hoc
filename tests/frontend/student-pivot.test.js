import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  findBone,
  normalizeBoneName,
  wrapBoneWithPivot
} from '../../client/src/features/auth/studentScene/studentAsset.js';

// GLTFLoader đặt lại tên nút theo PropertyBinding.sanitizeNodeName nên "upperarm.r"
// lúc chạy thành "upperarmr". Lỗi cũ: tìm xương bằng regex có dấu chấm nên các xương
// tay không bao giờ được tìm thấy → pivot tay null → tay không có hoạt ảnh "né".
describe('tìm xương theo tên đã chuẩn hoá', () => {
  const skeleton = {
    bones: [
      { name: 'head' },
      { name: 'upperarmr' },
      { name: 'upperarml' },
      { name: 'lowerarmr' },
      { name: 'handr' }
    ]
  };

  it('khớp tên có dấu chấm trong GLB với tên đã bị bỏ dấu chấm lúc chạy', () => {
    expect(normalizeBoneName('upperarm.r')).toBe('upperarmr');
    expect(findBone(skeleton, 'upperarm.r')).toBe(skeleton.bones[1]);
    expect(findBone(skeleton, 'lowerarm.r')).toBe(skeleton.bones[3]);
    expect(findBone(skeleton, 'hand.r')).toBe(skeleton.bones[4]);
  });

  it('vẫn khớp tên đơn giản và không phân biệt hoa thường', () => {
    expect(findBone(skeleton, 'HEAD')).toBe(skeleton.bones[0]);
    expect(findBone(skeleton, 'upperarm.l')).toBe(skeleton.bones[2]);
  });

  it('không có xương thì trả null', () => {
    expect(findBone(skeleton, 'foot.l')).toBeNull();
  });
});

// Lỗi gốc: cảnh cộng dồn góc xoay trực tiếp lên xương sau mixer.update. Mixer chỉ
// ghi lại giá trị xương khi giá trị animation ĐỔI, nên khi clip giữ xương đứng yên
// (clip Idle giữ nguyên xương head) thì góc cộng dồn không bao giờ bị ghi đè và
// đầu nhân vật xoay vô hạn. Khớp phụ (pivot) tách góc cộng thêm ra khỏi xương.
describe('khớp phụ cho xương', () => {
  it('chèn pivot mà không đổi vị trí thế giới của xương', () => {
    const parent = new THREE.Group();
    parent.position.set(1, 2, 3);
    const bone = new THREE.Bone();
    bone.name = 'head';
    bone.position.set(0, 0.5, 0);
    bone.rotation.set(0.3, -0.2, 0.1);
    parent.add(bone);
    parent.updateMatrixWorld(true);
    const before = bone.getWorldPosition(new THREE.Vector3());

    const pivot = wrapBoneWithPivot(THREE, bone);
    parent.updateMatrixWorld(true);

    expect(pivot.parent).toBe(parent);
    expect(bone.parent).toBe(pivot);
    expect(pivot.rotation.toArray().slice(0, 3)).toEqual([0, 0, 0]);
    expect(bone.getWorldPosition(new THREE.Vector3()).distanceTo(before)).toBeLessThan(1e-9);
    // Xương phải giữ nguyên tên: mixer bind track theo tên, chỉ pivot có hậu tố.
    expect(bone.name).toBe('head');
    expect(pivot.name).not.toBe('head');
  });

  it('xoay pivot là xoay cả xương theo, còn góc riêng của xương giữ nguyên', () => {
    const parent = new THREE.Group();
    const bone = new THREE.Bone();
    bone.name = 'head';
    parent.add(bone);
    const pivot = wrapBoneWithPivot(THREE, bone);

    pivot.rotation.set(0.14, 0.28, 0);
    parent.updateMatrixWorld(true);

    // Góc cộng thêm nằm trên pivot nên frame nào đặt lại cũng không trôi; xương
    // vẫn là nơi clip ghi giá trị animation của nó.
    expect(bone.rotation.y).toBe(0);
    const world = bone.getWorldQuaternion(new THREE.Quaternion());
    const euler = new THREE.Euler().setFromQuaternion(world, 'XYZ');
    expect(euler.y).toBeCloseTo(0.28);
    expect(euler.x).toBeCloseTo(0.14);
  });

  it('đặt lại pivot về 0 là tư thế trở về đúng clip, không giữ góc cũ', () => {
    const parent = new THREE.Group();
    const bone = new THREE.Bone();
    bone.name = 'head';
    parent.add(bone);
    const pivot = wrapBoneWithPivot(THREE, bone);

    pivot.rotation.set(0.4, -0.9, 0);
    pivot.rotation.set(0, 0, 0);
    parent.updateMatrixWorld(true);

    const world = bone.getWorldQuaternion(new THREE.Quaternion());
    expect(new THREE.Euler().setFromQuaternion(world, 'XYZ').y).toBeCloseTo(0);
  });

  it('không có xương (hoặc xương chưa gắn vào cây) thì trả null thay vì vỡ cảnh', () => {
    expect(wrapBoneWithPivot(THREE, null)).toBeNull();
    expect(wrapBoneWithPivot(THREE, undefined)).toBeNull();
    expect(wrapBoneWithPivot(THREE, new THREE.Bone())).toBeNull();
  });
});
