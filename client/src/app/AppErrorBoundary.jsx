import { Component } from 'react';
import { isChunkLoadError, reloadForStaleChunk } from './chunk-recovery.js';

export default class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    // Lazy route chunks renaming after a deploy throw here; a guarded reload
    // picks up the new index.html. If the guard blocks (reload loop), the
    // fallback below offers the manual button instead.
    if (isChunkLoadError(error)) reloadForStaleChunk();
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const stale = isChunkLoadError(error);
    return (
      <div className="app-recovery" role="alert">
        <h1>{stale ? 'Ứng dụng vừa được cập nhật' : 'Đã xảy ra lỗi hiển thị'}</h1>
        <p>
          {stale
            ? 'Trang đang dùng phiên bản cũ. Tải lại để nhận bản mới nhất.'
            : 'Tải lại trang để tiếp tục. Nếu lỗi lặp lại, hãy báo cho ban quản trị.'}
        </p>
        <button type="button" onClick={() => window.location.reload()}>Tải lại trang</button>
      </div>
    );
  }
}
