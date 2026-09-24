import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ViewportModal, useViewportDialog } from '../ViewportModal.jsx';
import {
  AVATAR_OUTPUT_SIZE,
  MAX_AVATAR_ZOOM,
  MIN_AVATAR_ZOOM,
  clampOffset,
  cropRect,
  displaySize
} from './avatarCropMath.js';

function renderCroppedBlob(imageElement, params) {
  const canvas = document.createElement('canvas');
  canvas.width = AVATAR_OUTPUT_SIZE;
  canvas.height = AVATAR_OUTPUT_SIZE;
  const context = canvas.getContext?.('2d');
  // Môi trường không có canvas (jsdom/trình duyệt quá cũ): trả null để dùng
  // ảnh gốc, server vẫn tự resize như trước.
  if (!context) return null;
  const { sx, sy, size } = cropRect(params);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(imageElement, sx, sy, size, size, 0, 0, AVATAR_OUTPUT_SIZE, AVATAR_OUTPUT_SIZE);
  if (typeof canvas.toBlob !== 'function') return null;
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/webp', 0.9);
  });
}

/**
 * Popup căn chỉnh + cắt ảnh đại diện kiểu Zalo: ảnh luôn phủ kín khung vuông,
 * kéo để dịch, thanh trượt để zoom. Kết quả 512×512 WebP trước khi upload.
 */
export default function AvatarCropDialog({ file, pending = false, onCancel, onConfirm }) {
  const dialogRef = useRef(null);
  const closeButtonRef = useRef(null);
  const stageRef = useRef(null);
  const imageRef = useRef(null);
  const dragRef = useRef(null);

  const [source, setSource] = useState(null);
  const [stageSize, setStageSize] = useState(300);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [error, setError] = useState('');
  const [rendering, setRendering] = useState(false);

  const open = Boolean(file);
  useViewportDialog(open, onCancel, dialogRef, closeButtonRef, null);

  useEffect(() => {
    if (!file) return undefined;
    const url = URL.createObjectURL(file);
    const image = new window.Image();
    image.decoding = 'async';
    image.onload = () => {
      imageRef.current = image;
      setSource({ url, naturalWidth: image.naturalWidth || 1, naturalHeight: image.naturalHeight || 1 });
      setZoom(1);
      setOffset({ x: 0, y: 0 });
      setError('');
    };
    image.onerror = () => setError('Không đọc được ảnh. Vui lòng chọn ảnh khác.');
    image.src = url;
    return () => {
      imageRef.current = null;
      setSource(null);
      URL.revokeObjectURL(url);
    };
  }, [file]);

  useLayoutEffect(() => {
    if (!open) return undefined;
    const measure = () => {
      const width = stageRef.current?.getBoundingClientRect().width;
      if (width) setStageSize(Math.round(width));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [open, source]);

  const displayed = source
    ? displaySize(source.naturalWidth, source.naturalHeight, stageSize, zoom)
    : { width: 0, height: 0 };

  const applyZoom = (nextZoom) => {
    const clampedZoom = Math.min(MAX_AVATAR_ZOOM, Math.max(MIN_AVATAR_ZOOM, nextZoom));
    setZoom(clampedZoom);
    if (source) {
      const next = displaySize(source.naturalWidth, source.naturalHeight, stageSize, clampedZoom);
      setOffset((current) => clampOffset(current, next.width, next.height, stageSize));
    }
  };

  const onPointerDown = (event) => {
    if (!source || pending) return;
    dragRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY, start: offset };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.id !== event.pointerId) return;
    setOffset(clampOffset(
      { x: drag.start.x + (event.clientX - drag.x), y: drag.start.y + (event.clientY - drag.y) },
      displayed.width,
      displayed.height,
      stageSize
    ));
  };

  const onPointerUp = (event) => {
    if (dragRef.current?.id === event.pointerId) dragRef.current = null;
  };

  const confirm = async () => {
    if (!source || !imageRef.current || pending || rendering) return;
    setRendering(true);
    setError('');
    try {
      const blob = await renderCroppedBlob(imageRef.current, {
        naturalWidth: source.naturalWidth,
        naturalHeight: source.naturalHeight,
        stageSize,
        zoom,
        offset
      });
      const cropped = blob
        ? new window.File([blob], 'avatar.webp', { type: blob.type || 'image/webp' })
        : file;
      onConfirm?.(cropped);
    } catch (err) {
      setError(err.message || 'Không xử lý được ảnh.');
    } finally {
      setRendering(false);
    }
  };

  if (!open) return null;

  return (
    <ViewportModal
      id="modal-avatar-crop"
      title="Chỉnh ảnh đại diện"
      onClose={onCancel}
      dialogRef={dialogRef}
      className="avatar-crop-dialog"
    >
      <div className="avatar-crop-header">
        <h3 className="avatar-crop-title">Chỉnh ảnh đại diện</h3>
        <button
          ref={closeButtonRef}
          type="button"
          className="avatar-crop-close"
          onClick={onCancel}
          aria-label="Đóng hộp thoại chỉnh ảnh"
        >
          ✕
        </button>
      </div>

      <div className="avatar-crop-body">
        <div
          ref={stageRef}
          className="avatar-crop-stage"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          role="presentation"
        >
          {source && (
            <img
              className="avatar-crop-image"
              src={source.url}
              alt=""
              draggable="false"
              style={{
                width: `${displayed.width}px`,
                height: `${displayed.height}px`,
                transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px)`
              }}
            />
          )}
          <span className="avatar-crop-guide" aria-hidden="true" />
        </div>
        <p className="avatar-crop-hint">Kéo ảnh để căn chỉnh, dùng thanh trượt để phóng to hoặc thu nhỏ.</p>
        <label className="avatar-crop-zoom">
          <span aria-hidden="true">−</span>
          <input
            type="range"
            min={MIN_AVATAR_ZOOM}
            max={MAX_AVATAR_ZOOM}
            step="0.01"
            value={zoom}
            onChange={(event) => applyZoom(Number(event.target.value))}
            aria-label="Mức phóng to ảnh đại diện"
            disabled={!source || pending}
          />
          <span aria-hidden="true">+</span>
        </label>
        {error && <p className="avatar-crop-error" role="alert">{error}</p>}
      </div>

      <div className="avatar-crop-footer">
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={pending}>
          Huỷ
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={confirm}
          disabled={!source || pending || rendering}
        >
          {pending || rendering ? 'Đang xử lý…' : 'Chọn ảnh này'}
        </button>
      </div>
    </ViewportModal>
  );
}
