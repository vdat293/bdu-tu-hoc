import { describe, expect, it } from 'vitest';
import { navigation, findRouteMeta } from '../../client/src/app/navigation.js';

describe('student route contract', () => {
  it('has one canonical route for every student navigation item', () => {
    expect(navigation).toHaveLength(11);
    expect(new Set(navigation.map((item) => item.path)).size).toBe(11);
    expect(navigation.map((item) => item.path)).toEqual(expect.arrayContaining(['/gpa', '/info', '/schedule', '/leaderboard', '/learning', '/clans', '/confession']));
    expect(navigation.map((item) => item.path)).not.toContain('/entertainment');
  });

  it('uses dynamic route metadata for deep links', () => {
    expect(findRouteMeta('/learning/CSC101').title).toBe('Không gian môn học');
    expect(findRouteMeta('/clans/42').title).toBe('Kênh CLB');
    expect(findRouteMeta('/gpa/').title).toBe('Bảng điểm & GPA');
  });
});
