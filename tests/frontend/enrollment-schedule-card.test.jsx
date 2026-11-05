import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import ScheduleCard from '../../client/src/features/enrollment/ScheduleCard.jsx';
import { buildScheduleCells } from '../../client/src/features/enrollment/schedule-cells.js';

const TKB = 'Thứ 2,tiết 1->5,Ph A,GV G,05/01/27 đến 26/01/27';

afterEach(() => cleanup());

describe('ScheduleCard', () => {
  it('renders the title, subtitle and subject chips', () => {
    const cells = buildScheduleCells([{ maMon: 'INF1143', tkb: TKB }]);
    render(<ScheduleCard title="Lịch tuần dự kiến" subtitle="1 môn trong danh sách ưu tiên" cells={cells} hasEntries emptyHint="empty" conflictHint="conflict" />);
    expect(screen.getByRole('heading', { name: 'Lịch tuần dự kiến' })).toBeInTheDocument();
    expect(screen.getByText('1 môn trong danh sách ưu tiên')).toBeInTheDocument();
    expect(screen.getByText('INF1143')).toBeInTheDocument();
    expect(screen.getByText('conflict')).toBeInTheDocument();
  });

  it('marks a cell with two subjects as a conflict', () => {
    const cells = buildScheduleCells([{ maMon: 'AAA', tkb: TKB }, { maMon: 'BBB', tkb: TKB }]);
    const { container } = render(<ScheduleCard title="Lịch tuần" subtitle="2 môn" cells={cells} hasEntries emptyHint="empty" conflictHint="conflict" />);
    expect(container.querySelectorAll('.enroll-mini-cell.is-conflict')).toHaveLength(1);
  });

  it('shows the empty hint when there are no entries', () => {
    render(<ScheduleCard title="Lịch tuần đã đăng ký" subtitle="Chưa có môn nào" cells={new Map()} hasEntries={false} emptyHint="Chưa đăng ký môn nào để dựng lịch tuần." conflictHint="conflict" />);
    expect(screen.getByText('Chưa đăng ký môn nào để dựng lịch tuần.')).toBeInTheDocument();
    expect(screen.queryByText('conflict')).not.toBeInTheDocument();
  });

  it('renders the explanatory note under the schedule', () => {
    render(<ScheduleCard title="Lịch tuần dự kiến" subtitle="0 môn" cells={new Map()} hasEntries={false} emptyHint="empty" conflictHint="conflict" note="Lịch dự kiến là lịch của các môn đang chọn để Auto đăng ký." />);
    expect(screen.getByText('Lịch dự kiến là lịch của các môn đang chọn để Auto đăng ký.')).toHaveClass('enroll-schedule-note');
  });
});
