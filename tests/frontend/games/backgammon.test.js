// Test UI Backgammon (Vitest + jsdom): export hợp đồng, mount/update state rỗng,
// chặn click khi interactive=false, chọn quân -> đích và gửi onMove({ from, die })
// đúng dạng engine yêu cầu (từ điểm, từ bar, bear-off qua khay).
import { afterEach, describe, expect, it, vi } from 'vitest';
import backgammon from '../../../public/games/js/games/backgammon.js';

function emptyState(overrides = {}) {
  return {
    points: Array(24).fill(0),
    bar: { 1: 0, 2: 0 },
    off: { 1: 0, 2: 0 },
    dice: { remaining: [] },
    current_seat: 1,
    winner_seat: null,
    result: null,
    skipped: false,
    ...overrides
  };
}

function setup({ interactive = false, legalMoves = null, state = emptyState(), status = 'active', mySeat = 1, role = 'player', winnerSeat = null } = {}) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const onMove = vi.fn();
  const showToast = vi.fn();
  const sound = vi.fn();
  const board = backgammon.mount(root, { onMove, showToast, sound });
  board.update({
    state,
    mySeat,
    role,
    interactive,
    legalMoves,
    lastMove: null,
    status,
    winnerSeat,
    players: [],
    roomCode: 'TEST1234',
    turnSeconds: 0
  });
  return { root, board, onMove, showToast, sound };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('backgammon UI module', () => {
  it('export đúng meta/preview/mount theo hợp đồng', () => {
    expect(backgammon.meta.id).toBe('backgammon');
    expect(typeof backgammon.meta.label).toBe('string');
    expect(typeof backgammon.meta.tagline).toBe('string');
    expect(typeof backgammon.preview).toBe('function');
    expect(backgammon.preview()).toContain('bkg-preview');
    expect(backgammon.preview()).not.toContain('<script');

    const root = document.createElement('div');
    const board = backgammon.mount(root, { onMove: vi.fn() });
    expect(typeof board.update).toBe('function');
    expect(typeof board.destroy).toBe('function');
    board.destroy();
    expect(root.innerHTML).toBe('');
  });

  it('mount + update state rỗng render 24 điểm, bar, 2 khay, 2 xúc xắc, không lỗi', () => {
    const { root, board } = setup({ state: emptyState({ dice: { remaining: [3, 5] } }) });
    expect(root.querySelectorAll('.bkg-point')).toHaveLength(24);
    expect(root.querySelectorAll('.bkg-quad')).toHaveLength(4);
    expect(root.querySelectorAll('.bkg-bar-zone')).toHaveLength(2);
    expect(root.querySelectorAll('.bkg-tray')).toHaveLength(2);
    expect(root.querySelectorAll('.bkg-die')).toHaveLength(2);

    // update với state thiếu field cũng không được vỡ.
    expect(() => board.update({ state: {}, interactive: false, legalMoves: null })).not.toThrow();
    expect(root.querySelectorAll('.bkg-point')).toHaveLength(24);
  });

  it('interactive=false thì mọi nút bị chặn và click không gọi onMove', () => {
    const { root, onMove } = setup({ interactive: false, legalMoves: [{ from: 13, to: 10, die: 3 }] });
    const points = [...root.querySelectorAll('.bkg-point')];
    expect(points.every((point) => point.disabled)).toBe(true);
    points.forEach((point) => point.click());
    root.querySelector('[data-bar-zone="1"]').click();
    root.querySelector('[data-tray="1"]').click();
    expect(onMove).not.toHaveBeenCalled();
  });

  it('interactive=true: click quân rồi click đích gọi onMove({ from, die }) từ điểm', () => {
    const state = emptyState({ points: Array.from({ length: 24 }, (_, index) => (index === 12 ? 5 : 0)), dice: { remaining: [3] } });
    const { root, onMove, sound } = setup({ interactive: true, legalMoves: [{ from: 13, to: 10, die: 3 }], state });

    const source = root.querySelector('[data-point="13"]');
    const target = root.querySelector('[data-point="10"]');
    expect(source.classList.contains('is-source')).toBe(true);
    source.click();
    expect(source.classList.contains('is-selected')).toBe(true);
    expect(target.classList.contains('is-target')).toBe(true);
    target.click();

    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove).toHaveBeenCalledWith({ from: 13, die: 3 });
    expect(sound).toHaveBeenCalledWith('move');
  });

  it('interactive=true: vào bar được gửi với from="bar"', () => {
    const state = emptyState({ bar: { 1: 1, 2: 0 }, dice: { remaining: [3] } });
    const { root, onMove } = setup({ interactive: true, legalMoves: [{ from: 'bar', to: 22, die: 3 }], state });

    const zone = root.querySelector('[data-bar-zone="1"]');
    expect(zone.disabled).toBe(false);
    zone.click();
    expect(zone.classList.contains('is-selected')).toBe(true);
    const target = root.querySelector('[data-point="22"]');
    expect(target.classList.contains('is-target')).toBe(true);
    target.click();

    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove).toHaveBeenCalledWith({ from: 'bar', die: 3 });
  });

  it('interactive=true: bear-off qua khay gửi onMove({ from, die })', () => {
    const state = emptyState({ points: Array.from({ length: 24 }, (_, index) => (index === 3 ? 1 : 0)), off: { 1: 4, 2: 0 }, dice: { remaining: [4] } });
    const { root, onMove } = setup({ interactive: true, legalMoves: [{ from: 4, to: 'off', die: 4 }], state });

    root.querySelector('[data-point="4"]').click();
    const tray = root.querySelector('[data-tray="1"]');
    expect(tray.classList.contains('is-target')).toBe(true);
    tray.click();
    expect(onMove).toHaveBeenCalledWith({ from: 4, die: 4 });
  });

  it('hiển thị xúc xắc còn lại và chọn xúc xắc được làm nổi', () => {
    const { root } = setup({ interactive: true, legalMoves: [], state: emptyState({ dice: { remaining: [4, 4, 4] } }) });
    const dice = [...root.querySelectorAll('.bkg-die')];
    expect(dice).toHaveLength(1);
    expect(dice[0].textContent).toContain('×3');
    dice[0].click();
    expect(root.querySelector('.bkg-die').classList.contains('is-selected')).toBe(true);

    const { root: root2 } = setup({ interactive: true, legalMoves: [], state: emptyState({ dice: { remaining: [3, 5] } }) });
    expect(root2.querySelectorAll('.bkg-die')).toHaveLength(2);
  });

  it('update lại nhiều lần tái sử dụng node, không nhân đôi điểm', () => {
    const { root, board } = setup({ interactive: true, legalMoves: [], state: emptyState({ dice: { remaining: [2, 6] } }) });
    const first = root.querySelector('[data-point="1"]');
    board.update({
      state: emptyState({ points: Array.from({ length: 24 }, (_, index) => (index === 0 ? -2 : 0)), dice: { remaining: [2, 6] } }),
      interactive: true,
      legalMoves: [],
      mySeat: 1,
      role: 'player',
      status: 'active'
    });
    expect(root.querySelectorAll('.bkg-point')).toHaveLength(24);
    expect(root.querySelector('[data-point="1"]')).toBe(first);
    expect(first.classList.contains('is-p2')).toBe(true);
    expect(first.querySelectorAll('.bkg-checker')).toHaveLength(2);
  });
});
