import assert from 'node:assert/strict';
import {
  cohortYearFromMssv,
  resolveSchedule,
  getSemesterOptions,
  DEFAULT_SEMESTER_KEY
} from '../src/modules/enrollment/enrollment-schedule.js';

const section = (name, fn) => {
  try { fn(); console.log('  ok -', name); } catch (error) { console.error('  FAIL -', name); throw error; }
};

console.log('enrollment-schedule');

section('cohort year comes from the first two MSSV digits', () => {
  assert.equal(cohortYearFromMssv('24050126'), 2024);
  assert.equal(cohortYearFromMssv('23010001'), 2023);
  assert.equal(cohortYearFromMssv('25123456'), 2025);
  assert.equal(cohortYearFromMssv('26000001'), 2026);
  assert.equal(cohortYearFromMssv(''), null);
  assert.equal(cohortYearFromMssv('abc'), null);
});

section('2024 and earlier cohorts open on 05/11, 09:00-20:00', () => {
  for (const mssv of ['24050126', '23010001', '21010001']) {
    const schedule = resolveSchedule(mssv);
    assert.equal(schedule.semesterKey, DEFAULT_SEMESTER_KEY);
    assert.equal(schedule.primary.label, 'Khóa 2024 trở về trước');
    assert.equal(schedule.primary.opensAt, '2026-11-05T09:00');
    assert.equal(schedule.primary.closesAt, '2026-11-05T20:00');
    assert.deepEqual(schedule.hours, { open: '09:00', close: '20:00' });
  }
});

section('2025 and 2026 cohorts get their own dates', () => {
  assert.equal(resolveSchedule('25000001').primary.opensAt, '2026-11-06T09:00');
  assert.equal(resolveSchedule('26000001').primary.opensAt, '2026-11-07T09:00');
});

section('unknown cohort falls back to the common window 10/11', () => {
  assert.equal(resolveSchedule('').primary.opensAt, '2026-11-10T09:00');
  assert.equal(resolveSchedule('99999999').primary.label, 'Các khóa đăng ký chung');
});

section('supplementary round is 30/11 - 01/12, same hours', () => {
  const schedule = resolveSchedule('24050126');
  assert.equal(schedule.supplementary.opensAt, '2026-11-30T09:00');
  assert.equal(schedule.supplementary.closesAt, '2026-12-01T20:00');
});

section('semester catalogue exposes the configured semester', () => {
  const options = getSemesterOptions();
  assert.ok(options.some((option) => option.key === DEFAULT_SEMESTER_KEY));
});

console.log('OK');
