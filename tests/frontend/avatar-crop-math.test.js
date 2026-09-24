import { describe, expect, it } from 'vitest';
import {
  clampOffset,
  coverScale,
  cropRect,
  displaySize
} from '../../client/src/components/identity/avatarCropMath.js';

describe('avatarCropMath', () => {
  it('coverScale chọn tỉ lệ phủ kín khung vuông', () => {
    expect(coverScale(1000, 500, 300)).toBeCloseTo(0.6, 6);
    expect(coverScale(500, 1000, 300)).toBeCloseTo(0.6, 6);
    expect(coverScale(0, 0, 300)).toBe(1);
  });

  it('displaySize nhân thêm mức zoom', () => {
    const one = displaySize(1000, 500, 300, 1);
    expect(one.width).toBeCloseTo(600, 6);
    expect(one.height).toBeCloseTo(300, 6);
    const two = displaySize(1000, 500, 300, 2);
    expect(two.width).toBeCloseTo(1200, 6);
    expect(two.height).toBeCloseTo(600, 6);
  });

  it('clampOffset giữ ảnh không hở khỏi khung', () => {
    const displayed = displaySize(1000, 500, 300, 1);
    expect(clampOffset({ x: 999, y: 999 }, displayed.width, displayed.height, 300)).toEqual({ x: 150, y: 0 });
    expect(clampOffset({ x: -999, y: -999 }, displayed.width, displayed.height, 300)).toEqual({ x: -150, y: -0 });
  });

  it('cropRect khớp vùng đang thấy khi zoom', () => {
    const rect = cropRect({
      naturalWidth: 1000,
      naturalHeight: 1000,
      stageSize: 300,
      zoom: 2,
      offset: { x: 0, y: 0 }
    });
    expect(rect.size).toBeCloseTo(500, 6);
    expect(rect.sx).toBeCloseTo(250, 6);
    expect(rect.sy).toBeCloseTo(250, 6);
  });

  it('cropRect luôn nằm trong biên ảnh gốc dù kéo lệch', () => {
    const rect = cropRect({
      naturalWidth: 400,
      naturalHeight: 400,
      stageSize: 300,
      zoom: 1,
      offset: { x: 300, y: -300 }
    });
    expect(rect.sx).toBeGreaterThanOrEqual(0);
    expect(rect.sy).toBeGreaterThanOrEqual(0);
    expect(rect.sx + rect.size).toBeLessThanOrEqual(400 + 1e-6);
    expect(rect.sy + rect.size).toBeLessThanOrEqual(400 + 1e-6);
  });
});
