import { describe, expect, it } from 'vitest';
import { buildScheduleCells } from '../../client/src/features/enrollment/schedule-cells.js';

const TKB_MON = 'Thứ 2,tiết 1->5,Ph A,GV G,05/01/27 đến 26/01/27';
const TKB_TUE = 'Thứ 3,tiết 6->10,Ph B,GV G,05/01/27 đến 26/01/27';

describe('buildScheduleCells', () => {
  it('places subjects into the right weekday/session cell', () => {
    const cells = buildScheduleCells([
      { maMon: 'AAA', tkb: TKB_MON },
      { maMon: 'BBB', tkb: TKB_TUE }
    ]);
    expect([...cells.get('2:morning').keys()]).toEqual(['AAA']);
    expect([...cells.get('3:afternoon').keys()]).toEqual(['BBB']);
  });

  it('merges two subjects in the same cell so the UI can flag a conflict', () => {
    const cells = buildScheduleCells([
      { maMon: 'AAA', tkb: TKB_MON },
      { maMon: 'BBB', tkb: TKB_MON }
    ]);
    expect(cells.get('2:morning').size).toBe(2);
  });

  it('keeps the dự phòng flag for chip styling', () => {
    const cells = buildScheduleCells([{ maMon: 'AAA', tkb: TKB_MON, loai: 'du_phong' }]);
    expect(cells.get('2:morning').get('AAA')).toEqual({ maMon: 'AAA', loai: 'du_phong' });
  });

  it('ignores entries without a subject or a parseable TKB', () => {
    const cells = buildScheduleCells([{ maMon: '', tkb: TKB_MON }, { maMon: 'AAA', tkb: 'rác' }]);
    expect(cells.size).toBe(0);
  });
});
