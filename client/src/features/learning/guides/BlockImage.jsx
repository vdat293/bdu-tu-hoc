import { useState } from 'react';

export default function BlockImage({ block }) {
  const [failed, setFailed] = useState(false);
  if (!block?.src) return null;
  if (failed) {
    return (
      <div className="guide-block-image-fallback">
        <span className="guide-block-image-fallback-icon" aria-hidden="true">🖼</span>
        <div className="guide-block-image-fallback-text">
          {block?.title && <p className="guide-block-image-fallback-title">{block.title}</p>}
          <a href={block.src} target="_blank" rel="noopener noreferrer" className="guide-block-image-fallback-link">
            {block?.alt || block?.caption || block.src}
          </a>
          {block?.caption && <p className="guide-block-image-fallback-caption">{block.caption}</p>}
        </div>
      </div>
    );
  }
  return (
    <figure className="guide-block-image">
      {block?.title && <figcaption className="guide-block-image-title">{block.title}</figcaption>}
      <img
        src={block.src}
        alt={block?.alt || block?.title || 'Ảnh minh họa hướng dẫn'}
        loading="lazy"
        onError={() => setFailed(true)}
      />
      {block?.caption && <figcaption className="guide-block-image-caption">{block.caption}</figcaption>}
    </figure>
  );
}
