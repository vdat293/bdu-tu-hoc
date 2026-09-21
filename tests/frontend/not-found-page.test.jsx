import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NotFoundPage, {
  FLOW_DIVIDERS,
  FLOW_STOPS,
  flowAnchors,
  flowBandWeights,
  paintFlowField
} from '../../client/src/features/NotFoundPage.jsx';

function renderPage() {
  return render(<MemoryRouter><NotFoundPage /></MemoryRouter>);
}

describe('NotFoundPage', () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    // jsdom không có canvas 2d: bắt buộc trang phải chạy tiếp mà không vỡ.
    vi.spyOn(window.HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  });

  it('giữ lời nhắn và đường quay lại cổng sinh viên', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Không tìm thấy trang' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Về bảng điểm' })).toHaveAttribute('href', '/gpa');
  });

  it('tách lớp sàn và lớp kính: manh mối chỉ nằm dưới tấm kính', () => {
    const { container } = renderPage();
    expect(container.querySelectorAll('.nf-glyph')).toHaveLength(2);
    expect(container.querySelectorAll('.nf-floor .nf-note')).toHaveLength(0);
    expect(container.querySelectorAll('.nf-found .nf-note')).toHaveLength(6);
    expect(container.querySelector('.nf-found')).toHaveAttribute('aria-hidden', 'true');
  });

  it('dựng kính lúp ba lớp và nền flow gồm canvas + grain', () => {
    const { container } = renderPage();
    expect(container.querySelector('.nf-lens-handle')).not.toBeNull();
    expect(container.querySelector('.nf-lens-glass')).not.toBeNull();
    expect(container.querySelector('.nf-lens-ring')).not.toBeNull();
    expect(container.querySelector('.nf-flow-canvas')).not.toBeNull();
    expect(container.querySelector('.nf-flow-grain')).not.toBeNull();
    expect(container.querySelectorAll('svg')).toHaveLength(0);
  });

  it('chạy vòng lặp soi manh mối mà không cần ResizeObserver hay matchMedia', () => {
    expect(window.ResizeObserver).toBeUndefined();
    renderPage();
    const page = document.querySelector('.nf-page');
    expect(page).toHaveClass('is-live');
    expect(page.style.getPropertyValue('--nf-lx')).toMatch(/px$/);
    expect(page.style.getPropertyValue('--nf-ly')).toMatch(/px$/);
  });
});

describe('paintFlowField', () => {
  it('chia band đều khi dividers là các phần tư', () => {
    expect(flowBandWeights(4, FLOW_DIVIDERS)).toEqual([1, 1, 1, 1]);
    expect(flowBandWeights(3)).toEqual([1, 1, 1]);
  });

  it('mọi ring màu nằm trong field [0,1]', () => {
    for (const [x, y] of flowAnchors(20.75, FLOW_STOPS.length)) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(1);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(1);
    }
  });

  it('vẽ đủ pixel, đục hoàn toàn và mọi kênh nằm trong dải màu của stops', () => {
    const width = 32;
    const height = 24;
    const data = new Uint8ClampedArray(width * height * 4);
    paintFlowField(data, width, height, 20.75);

    const channels = [0, 1, 2].map((channel) => {
      const values = FLOW_STOPS.map((hex) => parseInt(hex.slice(1 + channel * 2, 3 + channel * 2), 16));
      return [Math.min(...values), Math.max(...values)];
    });
    const seen = new Set();
    for (let offset = 0; offset < data.length; offset += 4) {
      expect(data[offset + 3]).toBe(255);
      for (let channel = 0; channel < 3; channel += 1) {
        const [min, max] = channels[channel];
        expect(data[offset + channel]).toBeGreaterThanOrEqual(min - 1);
        expect(data[offset + channel]).toBeLessThanOrEqual(max + 1);
      }
      seen.add(`${data[offset]},${data[offset + 1]},${data[offset + 2]}`);
    }
    expect(seen.size).toBeGreaterThan(8);
  });

  it('cùng mốc thời gian cho ra cùng một khung hình', () => {
    const first = new Uint8ClampedArray(16 * 12 * 4);
    const second = new Uint8ClampedArray(16 * 12 * 4);
    paintFlowField(first, 16, 12, 20.75);
    paintFlowField(second, 16, 12, 20.75);
    expect(Array.from(first)).toEqual(Array.from(second));
  });
});
