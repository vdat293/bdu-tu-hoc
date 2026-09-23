import { describe, expect, it } from 'vitest';
import {
  calcTK,
  computeCumulativeSimulation,
  computeSemesterSimulation,
  convert10toGrade,
  formulaDescription,
  getFormula,
  isExcludedCourse,
  isSimulatable,
  isValidScore,
  loadSimState,
  makeSimKey,
  parseScore,
  projectedCredits,
  resolveSimulatedCourse,
  saveSimState
} from '../../client/src/features/gpa/simulate.js';

function memoryStorage(initial = {}) {
  const store = { ...initial };
  return {
    getItem: (key) => (key in store ? store[key] : null),
    setItem: (key, value) => { store[key] = String(value); },
    store
  };
}

describe('gpa simulation core', () => {
  it('computes TK as 40% midterm + 60% final', () => {
    expect(calcTK(8, 7)).toBe(7.4);
    expect(calcTK(10, 10)).toBe(10);
    expect(calcTK(0, 0)).toBe(0);
    expect(calcTK(9, 7)).toBe(7.8);
  });

  it('supports per-course formulas: 50-50 and final-only', () => {
    expect(calcTK(8, 6, '55')).toBe(7.0);
    expect(calcTK(8, 6, '100')).toBe(6);
    expect(calcTK(8, 6, 'unknown-id')).toBe(6.8);
    expect(getFormula('nope').id).toBe('46');
    expect(formulaDescription('46')).toContain('40%');
    expect(formulaDescription('55')).toContain('50%');
    expect(formulaDescription('100')).toBe('Tổng kết = điểm thi');
  });

  it('final-only courses need just the exam score and ignore real midterm', () => {
    const resolved = resolveSimulatedCourse({ ma_mon: 'X', diem_giua_ky: 9 }, { ck: '7', formula: '100' });
    expect(resolved).toMatchObject({ complete: true, formulaId: '100', gk: null, ck: 7, tk10: 7, he4: 3.0, chu: 'B', usesRealGk: false });
    expect(resolveSimulatedCourse({ ma_mon: 'X' }, { ck: '', formula: '100' }).complete).toBe(false);
    const half = resolveSimulatedCourse({ ma_mon: 'X' }, { gk: '8', ck: '6', formula: '55' });
    expect(half).toMatchObject({ complete: true, tk10: 7.0, he4: 3.0, chu: 'B' });
  });

  it('maps thang 10 to he 4 / diem chu on exact boundaries', () => {
    expect(convert10toGrade(10)).toEqual({ he4: 4.0, chu: 'A' });
    expect(convert10toGrade(8.5)).toEqual({ he4: 4.0, chu: 'A' });
    expect(convert10toGrade(8.49)).toEqual({ he4: 3.5, chu: 'B+' });
    expect(convert10toGrade(8.0)).toEqual({ he4: 3.5, chu: 'B+' });
    expect(convert10toGrade(7.99)).toEqual({ he4: 3.0, chu: 'B' });
    expect(convert10toGrade(6.5)).toEqual({ he4: 2.5, chu: 'C+' });
    expect(convert10toGrade(6.49)).toEqual({ he4: 2.0, chu: 'C' });
    expect(convert10toGrade(5.0)).toEqual({ he4: 1.5, chu: 'D+' });
    expect(convert10toGrade(4.99)).toEqual({ he4: 1.0, chu: 'D' });
    expect(convert10toGrade(4.0)).toEqual({ he4: 1.0, chu: 'D' });
    expect(convert10toGrade(3.99)).toEqual({ he4: 0, chu: 'F' });
  });

  it('locks only courses that already have a final grade', () => {
    expect(isSimulatable({ ma_mon: 'INF0303', diem_tk: 8.5, diem_tk_so: 3.5, diem_tk_chu: 'A' })).toBe(false);
    expect(isSimulatable({ ma_mon: 'INF0303', diem_tk_chu: 'B' })).toBe(false);
    expect(isSimulatable({ ma_mon: 'INF0303', diem_giua_ky: 9 })).toBe(true);
    expect(isSimulatable({ ma_mon: 'INF0303', diem_giua_ky: 9, diem_thi: 7 })).toBe(true);
    expect(isSimulatable({ ma_mon: 'INF0303' })).toBe(true);
  });

  it('detects excluded courses case-insensitively', () => {
    expect(isExcludedCourse({ ma_mon: 'SKI0011' })).toBe(true);
    expect(isExcludedCourse({ ma_mon: 'mil0022' })).toBe(true);
    expect(isExcludedCourse({ ma_mon: ' PHE0251 ' })).toBe(true);
    expect(isExcludedCourse({ ma_mon: 'INF0303' })).toBe(false);
  });

  it('keeps the real midterm and simulates only the missing final', () => {
    const resolved = resolveSimulatedCourse({ ma_mon: 'X', diem_giua_ky: 9 }, { gk: '5', ck: '7' });
    expect(resolved).toMatchObject({ complete: true, gk: 9, ck: 7, tk10: 7.8, he4: 3.0, chu: 'B', usesRealGk: true });
    expect(resolveSimulatedCourse({ ma_mon: 'X' }, { gk: '', ck: '' }).complete).toBe(false);
    expect(resolveSimulatedCourse({ ma_mon: 'X' }, { gk: '8', ck: '' }).complete).toBe(false);
  });

  it('accepts Vietnamese decimal comma and validates 0-10', () => {
    expect(parseScore('8,5')).toBe(8.5);
    expect(isValidScore('10')).toBe(true);
    expect(isValidScore('10.01')).toBe(false);
    expect(isValidScore('-1')).toBe(false);
    expect(isValidScore('abc')).toBe(false);
    expect(isValidScore('')).toBe(false);
  });

  it('simulates the 5-course semester: 4 graded + 1 missing', () => {
    const courses = [
      { ma_mon: 'A101', so_tin_chi: 3, diem_tk: 8.0 },
      { ma_mon: 'B101', so_tin_chi: 3, diem_tk: 7.0 },
      { ma_mon: 'C101', so_tin_chi: 2, diem_tk: 6.0 },
      { ma_mon: 'D101', so_tin_chi: 2, diem_tk: 9.0 },
      { ma_mon: 'E101', so_tin_chi: 3 }
    ];
    const idle = computeSemesterSimulation(courses, {}, '20253');
    expect(idle.simulatableCount).toBe(1);
    expect(idle.hasSimulation).toBe(false);

    const entries = { [makeSimKey('20253', 'E101')]: { gk: '8', ck: '7' } };
    const sim = computeSemesterSimulation(courses, entries, '20253');
    expect(sim.hasSimulation).toBe(true);
    expect(sim.simulatedCompleteCount).toBe(1);
    // TK thử = 7.4 → B (3.0); GPA4 = (3.5*3 + 3.0*3 + 2.0*2 + 4.0*2 + 3.0*3) / 13
    expect(sim.sim.gpa4).toBeCloseTo(40.5 / 13, 2);
    expect(sim.real.gpa4).toBeCloseTo(31.5 / 10, 2);
    expect(sim.sim.rank).toBe('Khá');
  });

  it('excludes SKI/MIL/PHE courses from GPA but keeps pass/fail', () => {
    const courses = [
      { ma_mon: 'INF0303', so_tin_chi: 3, diem_tk: 8.0 },
      { ma_mon: 'SKI0011', so_tin_chi: 2 }
    ];
    const entries = { [makeSimKey('20253', 'SKI0011')]: { gk: '10', ck: '10' } };
    const sim = computeSemesterSimulation(courses, entries, '20253');
    expect(sim.excludedCount).toBe(1);
    expect(sim.hasSimulation).toBe(true);
    expect(sim.sim.gpa4).toBe(sim.real.gpa4);
    expect(sim.real.earnedCredits).toBe(3);
    expect(sim.sim.earnedCredits).toBe(5);
  });

  it('estimates cumulative GPA across semesters', () => {
    const semesters = [
      { hoc_ky: '20252', ds_diem_mon_hoc: [{ ma_mon: 'A101', so_tin_chi: 3, diem_tk: 8.0 }] },
      { hoc_ky: '20253', ds_diem_mon_hoc: [{ ma_mon: 'B101', so_tin_chi: 3 }] }
    ];
    const entries = { [makeSimKey('20253', 'B101')]: { gk: '6', ck: '6' } };
    const result = computeCumulativeSimulation(semesters, entries);
    expect(result.hasSimulation).toBe(true);
    // (3.5*3 + 2.0*3) / 6 = 2.75
    expect(result.sim.gpa4).toBeCloseTo(2.75, 2);
    expect(result.real.gpa4).toBeCloseTo(3.5, 2);
  });

  it('projects earned credits only when simulation adds passed courses', () => {
    const semesters = [
      { hoc_ky: '20253', ds_diem_mon_hoc: [{ ma_mon: 'B101', so_tin_chi: 3 }] }
    ];
    const entries = { [makeSimKey('20253', 'B101')]: { gk: '6', ck: '6' } };
    const cumulative = computeCumulativeSimulation(semesters, entries);
    expect(projectedCredits(101, cumulative)).toBe(104);
    expect(projectedCredits(101, computeCumulativeSimulation(semesters, {}))).toBe(null);
    expect(projectedCredits('--', cumulative)).toBe(null);
  });

  it('mixes formulas within one semester simulation', () => {
    const courses = [
      { ma_mon: 'A101', so_tin_chi: 3, diem_tk: 8.0 },
      { ma_mon: 'B101', so_tin_chi: 2 },
      { ma_mon: 'C101', so_tin_chi: 2 }
    ];
    const entries = {
      [makeSimKey('20253', 'B101')]: { gk: '6', ck: '6', formula: '55' },
      [makeSimKey('20253', 'C101')]: { ck: '8', formula: '100' }
    };
    const sim = computeSemesterSimulation(courses, entries, '20253');
    expect(sim.simulatedCompleteCount).toBe(2);
    // B: TK 6.0 → C (2.0); C: TK 8.0 → B+ (3.5); thực tế A: 8.0 → B+ (3.5)
    expect(sim.sim.gpa4).toBeCloseTo((3.5 * 3 + 2.0 * 2 + 3.5 * 2) / 7, 2);
  });

  it('persists simulation state per student and tolerates corrupt data', () => {
    const storage = memoryStorage();
    saveSimState(storage, '23012345', { ack: true, entries: { '20253::E101': { gk: '8', ck: '7' } } });
    expect(loadSimState(storage, '23012345')).toEqual({ ack: true, entries: { '20253::E101': { gk: '8', ck: '7' } } });
    expect(loadSimState(storage, 'other').entries).toEqual({});
    expect(loadSimState(memoryStorage({ 'bdu:gpa-sim:23012345': 'not-json' }), '23012345')).toEqual({ ack: false, entries: {} });
  });

  it('keeps valid per-course formulas in storage and drops unknown ones', () => {
    const storage = memoryStorage();
    saveSimState(storage, '23012345', {
      ack: true,
      entries: {
        '20253::A': { gk: '8', ck: '7', formula: '55' },
        '20253::B': { ck: '9', formula: 'weird' }
      }
    });
    expect(loadSimState(storage, '23012345')).toEqual({
      ack: true,
      entries: {
        '20253::A': { gk: '8', ck: '7', formula: '55' },
        '20253::B': { gk: '', ck: '9' }
      }
    });
  });
});
