import { useCallback, useEffect, useRef, useState } from 'react';
import { uploadCommunityMedia } from '../../api/community.js';

export const MAX_POST_IMAGES = 5;
export const MAX_COMMENT_IMAGES = 3;
export const STILL_IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp';
export const ALL_IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif';

/**
 * Quản lý danh sách ảnh người dùng đang chọn (trước khi upload):
 * - Tạo object URL để xem trước, thu hồi khi xoá/đóng để không rò rỉ bộ nhớ.
 * - Giới hạn số ảnh theo từng ngữ cảnh (bài viết 5, bình luận 3).
 */
export function useImageDraft(maxImages) {
  const [images, setImages] = useState([]);
  const imagesRef = useRef(images);

  useEffect(() => {
    imagesRef.current = images;
  }, [images]);

  const addFiles = useCallback((fileList) => {
    const incoming = Array.from(fileList || []).filter((file) => /^image\//.test(file.type || ''));
    if (incoming.length === 0) return { added: 0, skipped: 0 };
    const room = Math.max(0, maxImages - imagesRef.current.length);
    const accepted = incoming.slice(0, room).map((file) => ({
      id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
      file,
      previewUrl: URL.createObjectURL(file)
    }));
    if (accepted.length > 0) setImages((current) => [...current, ...accepted]);
    return { added: accepted.length, skipped: incoming.length - accepted.length };
  }, [maxImages]);

  const removeImage = useCallback((id) => {
    setImages((current) => {
      const target = current.find((image) => image.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return current.filter((image) => image.id !== id);
    });
  }, []);

  const clear = useCallback(() => {
    setImages((current) => {
      current.forEach((image) => URL.revokeObjectURL(image.previewUrl));
      return [];
    });
  }, []);

  useEffect(() => () => {
    imagesRef.current.forEach((image) => URL.revokeObjectURL(image.previewUrl));
  }, []);

  return { images, addFiles, removeImage, clear };
}

/**
 * Upload tuần tự các ảnh đang chờ lên R2 rồi trả về descriptor để gắn vào
 * attachments của bài viết/bình luận. Ảnh đã upload nhưng bước tạo nội dung
 * thất bại sẽ thành object mồ côi (dọn định kỳ sau).
 */
export async function uploadDraftImages(token, images, kind = 'post') {
  const uploaded = [];
  for (const image of images) {
    uploaded.push(await uploadCommunityMedia(token, image.file, kind));
  }
  return uploaded;
}

export function MediaFileInput({ id, accept = ALL_IMAGE_ACCEPT, multiple = true, disabled = false, onFiles }) {
  const inputRef = useRef(null);
  return (
    <input
      ref={inputRef}
      id={id}
      className="media-file-input"
      type="file"
      accept={accept}
      multiple={multiple}
      hidden
      disabled={disabled}
      onChange={(event) => {
        onFiles?.(event.target.files);
        event.target.value = '';
      }}
    />
  );
}

export function ImageDraftGrid({ images, onRemove, disabled = false }) {
  if (!images?.length) return null;
  return (
    <div className={`media-draft-grid is-count-${Math.min(images.length, 4)}`}>
      {images.map((image) => (
        <div className="media-draft-item" key={image.id}>
          <img src={image.previewUrl} alt="" />
          {!disabled && (
            <button
              type="button"
              className="media-draft-remove"
              onClick={() => onRemove?.(image.id)}
              aria-label="Xoá ảnh khỏi bài viết"
            >
              ✕
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * Hiển thị ảnh/GIF đã đăng trong bình luận. GIF giữ nguyên animation và có
 * nhãn nhỏ để người đọc phân biệt với ảnh tĩnh.
 */
export function CommentMedia({ attachments }) {
  const photos = (Array.isArray(attachments) ? attachments : [])
    .filter((item) => item?.type === 'image' && item.url);
  if (photos.length === 0) return null;
  return (
    <div className={`fbc-comment-media is-count-${Math.min(photos.length, 3)}`}>
      {photos.map((photo, index) => (
        <a
          key={`${photo.key || photo.url}-${index}`}
          className="fbc-comment-photo"
          href={photo.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          <img src={photo.url} alt={photo.title || 'Ảnh bình luận'} loading="lazy" decoding="async" />
          {photo.animated && <span className="fbc-gif-badge">GIF</span>}
        </a>
      ))}
    </div>
  );
}
