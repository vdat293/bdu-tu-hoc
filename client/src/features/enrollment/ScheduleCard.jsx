const WEEK_DAYS = [
  { value: 2, label: 'T2' },
  { value: 3, label: 'T3' },
  { value: 4, label: 'T4' },
  { value: 5, label: 'T5' },
  { value: 6, label: 'T6' },
  { value: 7, label: 'T7' },
  { value: 8, label: 'CN' }
];

const WEEK_SESSIONS = [
  { value: 'morning', label: 'Sáng' },
  { value: 'afternoon', label: 'Chiều' },
  { value: 'evening', label: 'Tối' }
];

/**
 * One weekly mini-schedule card. `cells` comes from buildScheduleCells().
 */
export default function ScheduleCard({ title, subtitle, cells, hasEntries, emptyHint, conflictHint, note }) {
  return (
    <div className="enroll-card">
      <div className="enroll-card-head">
        <div>
          <h2>{title}</h2>
          <p className="enroll-sub">{subtitle}</p>
        </div>
      </div>
      <div className="enroll-mini-wrap">
        <table className="enroll-mini">
          <thead>
            <tr>
              <th className="enroll-mini-corner"><span className="sr-only">Buổi</span></th>
              {WEEK_DAYS.map((day) => <th key={day.value}>{day.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {WEEK_SESSIONS.map((session) => (
              <tr key={session.value}>
                <th scope="row">{session.label}</th>
                {WEEK_DAYS.map((day) => {
                  const entries = [...(cells.get(`${day.value}:${session.value}`)?.values() ?? [])];
                  const conflict = entries.length > 1;
                  return (
                    <td
                      key={day.value}
                      className={`enroll-mini-cell${conflict ? ' is-conflict' : ''}`}
                      title={entries.length ? entries.map((entry) => entry.maMon).join(', ') : ''}
                    >
                      {entries.length
                        ? entries.slice(0, 2).map((entry) => (
                          <span key={entry.maMon} className={`enroll-mini-chip${entry.loai === 'du_phong' ? ' is-duphong' : ''}`}>{entry.maMon}</span>
                        ))
                        : <span className="enroll-mini-empty">·</span>}
                      {entries.length > 2 ? <span className="enroll-mini-more">+{entries.length - 2}</span> : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="enroll-hint">{hasEntries ? conflictHint : emptyHint}</p>
      {note ? <p className="enroll-hint enroll-schedule-note">{note}</p> : null}
    </div>
  );
}
