import { describe, expect, it } from 'vitest';
import { navigation, findRouteMeta } from '../../client/src/app/navigation.js';

describe('student route contract', () => {
  it('has one canonical route for every student navigation item', () => {
    expect(navigation).toHaveLength(16);
    expect(new Set(navigation.map((item) => item.path)).size).toBe(16);
    expect(navigation.map((item) => item.path)).toEqual(expect.arrayContaining(['/gpa', '/info', '/schedule', '/leaderboard', '/learning', '/vocab', '/grammar', '/clans', '/confession', '/training-score', '/killer-sudoku', '/mystudent']));
    expect(navigation.map((item) => item.path)).not.toContain('/entertainment');
  });

  it('uses dynamic route metadata for deep links', () => {
    expect(findRouteMeta('/learning/CSC101').title).toBe('Không gian môn học');
    expect(findRouteMeta('/vocab/a1-0-3-0').title).toBe('Luyện từ vựng');
    expect(findRouteMeta('/vocab/set/abc').title).toBe('Luyện từ vựng');
    expect(findRouteMeta('/vocab/set/abc/quiz').title).toBe('Luyện từ vựng');
    expect(findRouteMeta('/grammar').title).toBe('Luyện ngữ pháp');
    expect(findRouteMeta('/grammar/path/abc').title).toBe('Luyện ngữ pháp');
    expect(findRouteMeta('/grammar/lesson/abc').title).toBe('Luyện ngữ pháp');
    expect(findRouteMeta('/clans/42').title).toBe('Kênh CLB');
    expect(findRouteMeta('/mystudent').title).toBe('Sinh viên của tôi');
    expect(findRouteMeta('/ttcds/groups/1').title).toBe('Trung tâm CĐS');
    expect(findRouteMeta('/gpa/').title).toBe('Bảng điểm & GPA');
  });
});
