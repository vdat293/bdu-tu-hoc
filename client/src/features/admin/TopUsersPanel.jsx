export default function TopUsersPanel({ users, onSelectUser, isLoading }) {
  const userList = users || [];

  return (
    <div className="admin-panel top-users-panel">
      <div className="panel-header">
        <div className="panel-title-group">
          <span className="panel-title">Sinh Viên Hoạt Động Tích Cực Nhất</span>
          <span className="panel-subtitle">Xếp hạng theo khối lượng yêu cầu gửi lên máy chủ</span>
        </div>
      </div>

      <div className="table-responsive-wrapper">
        <table className="admin-table users-table">
          <thead>
            <tr>
              <th style={{ width: '60px' }}>Hạng</th>
              <th>Mã Sinh Viên (MSSV)</th>
              <th>Họ & Tên</th>
              <th>Lượt Yêu Cầu</th>
              <th>Lượt Lỗi</th>
              <th>Tính Năng Thường Dùng</th>
              <th>Hoạt Động Gần Nhất</th>
              <th style={{ textAlign: 'right' }}>Thao Tác</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && userList.length === 0 ? (
              <tr>
                <td colSpan="8" className="table-loading-cell">Đang tải dữ liệu sinh viên...</td>
              </tr>
            ) : userList.length === 0 ? (
              <tr>
                <td colSpan="8" className="table-empty-cell">Chưa ghi nhận sinh viên nào trong khoảng thời gian này.</td>
              </tr>
            ) : (
              userList.map((u, index) => {
                const rank = index + 1;
                const lastActiveDate = u.lastActive ? new Date(u.lastActive) : null;
                const formattedTime = lastActiveDate
                  ? lastActiveDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' ' +
                    lastActiveDate.toLocaleDateString([], { day: '2-digit', month: '2-digit' })
                  : '--';

                return (
                  <tr key={u.mssv} className="user-row">
                    <td>
                      <span className={`rank-pill rank-pill-${rank <= 3 ? rank : 'other'}`}>
                        {rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : rank}
                      </span>
                    </td>
                    <td>
                      <span className="mssv-badge">{u.mssv}</span>
                    </td>
                    <td>
                      <span className="student-name">{u.fullName || 'Chưa định danh'}</span>
                    </td>
                    <td>
                      <span className="req-count-badge">{(u.requestCount || 0).toLocaleString()} req</span>
                    </td>
                    <td>
                      {u.errorCount > 0 ? (
                        <span className="error-count-badge">⚠ {u.errorCount}</span>
                      ) : (
                        <span className="text-muted-clean">0</span>
                      )}
                    </td>
                    <td>
                      <code className="feature-code">{u.topPath || '/'}</code>
                    </td>
                    <td>
                      <span className="time-text">{formattedTime}</span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        type="button"
                        className="btn-filter-user"
                        onClick={() => onSelectUser && onSelectUser(u.mssv)}
                        title={`Lọc tất cả log của ${u.mssv}`}
                      >
                        🔍 Lọc Log
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
