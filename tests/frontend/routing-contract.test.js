import { describe, expect, it } from 'vitest';
import { navigation, findRouteMeta } from '../../client/src/app/navigation.js';

describe('student route contract', () => {
  it('has one canonical route for every student navigation item', () => {
    expect(navigation).toHaveLength(12);
    expect(new Set(navigation.map((item) => item.path)).size).toBe(12);
    expect(navigation.map((item) => item.path)).toEqual(expect.arrayContaining(['/gpa', '/info', '/schedule', '/leaderboard', '/learning', '/vocab', '/clans', '/confession']));
    expect(navigation.map((item) => item.path)).not.toContain('/entertainment');
  });

  it('uses dynamic route metadata for deep links', () => {
    expect(findRouteMeta('/learning/CSC101').title).toBe('Không gian môn học');
    expect(findRouteMeta('/vocab/a1-0-3-0').title).toBe('Luyện từ vựng');
    expect(findRouteMeta('/vocab/set/abc').title).toBe('Luyện từ vựng');
    expect(findRouteMeta('/vocab/set/abc/quiz').title).toBe('Luyện từ vựng');
    expect(findRouteMeta('/clans/42').title).toBe('Kênh CLB');
    expect(findRouteMeta('/gpa/').title).toBe('Bảng điểm & GPA');
  });
});
