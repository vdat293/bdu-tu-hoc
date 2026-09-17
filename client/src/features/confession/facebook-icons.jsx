/**
 * Bộ icon vẽ bằng SVG cho giao diện Confession kiểu Facebook.
 *
 * Không dùng thư viện icon ngoài vì portal chỉ cần đúng vài hình này; giữ
 * `currentColor` để icon ăn theo màu chữ/nút của từng trạng thái.
 */

function Icon({ size = 20, className = '', children, ...rest }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      focusable="false"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export function ThumbIcon({ size = 20, filled = false, className = '' }) {
  return (
    <Icon size={size} className={className} fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={filled ? 0 : 1.8}>
      <path
        d="M7 20V9.6l4.2-7.1c.28-.47.83-.66 1.32-.45.62.27.94.96.73 1.6L12.2 9H18a2.3 2.3 0 0 1 2.26 2.75l-1.2 6.1A2.3 2.3 0 0 1 16.8 20H7Z"
        strokeLinejoin="round"
      />
      <path d="M7 10H4.6A.6.6 0 0 0 4 10.6v8.8c0 .33.27.6.6.6H7" strokeLinejoin="round" />
    </Icon>
  );
}

export function CommentIcon({ size = 20, className = '' }) {
  return (
    <Icon size={size} className={className} fill="none" stroke="currentColor" strokeWidth={1.8}>
      <path d="M12 3.6c-4.7 0-8.5 3.1-8.5 7 0 2.2 1.2 4.1 3 5.4v3.4l3.3-1.8c.7.15 1.4.23 2.2.23 4.7 0 8.5-3.1 8.5-7s-3.8-7-8.5-7Z" strokeLinejoin="round" />
    </Icon>
  );
}

export function ShareIcon({ size = 20, className = '' }) {
  return (
    <Icon size={size} className={className} fill="none" stroke="currentColor" strokeWidth={1.8}>
      <path d="M13.5 7.5V4.2L21 11l-7.5 6.8v-3.4c-5 0-8 1.2-11 4.6.9-5.6 3.6-10 11-11.5Z" strokeLinejoin="round" />
    </Icon>
  );
}

export function GlobeIcon({ size = 12, className = '' }) {
  return (
    <Icon size={size} className={className} fill="none" stroke="currentColor" strokeWidth={1.9}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.4 2.5 3.6 5.5 3.6 9S14.4 18.5 12 21c-2.4-2.5-3.6-5.5-3.6-9S9.6 5.5 12 3Z" />
    </Icon>
  );
}

export function DotsIcon({ size = 20, className = '' }) {
  return (
    <Icon size={size} className={className} fill="currentColor">
      <circle cx="5" cy="12" r="1.9" />
      <circle cx="12" cy="12" r="1.9" />
      <circle cx="19" cy="12" r="1.9" />
    </Icon>
  );
}

export function ChevronDownIcon({ size = 14, className = '' }) {
  return (
    <Icon size={size} className={className} fill="none" stroke="currentColor" strokeWidth={2.2}>
      <path d="m5 8.5 7 7 7-7" strokeLinecap="round" strokeLinejoin="round" />
    </Icon>
  );
}

export function EmojiIcon({ size = 20, className = '' }) {
  return (
    <Icon size={size} className={className} fill="none" stroke="currentColor" strokeWidth={1.8}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 14.2c.9 1.2 2.1 1.8 3.5 1.8s2.6-.6 3.5-1.8" strokeLinecap="round" />
      <circle cx="9" cy="9.6" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="9.6" r="1.1" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function PhotoIcon({ size = 20, className = '' }) {
  return (
    <Icon size={size} className={className} fill="none" stroke="currentColor" strokeWidth={1.8}>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <circle cx="8.5" cy="10" r="1.4" />
      <path d="m4 17 4.6-4.3a1.6 1.6 0 0 1 2.2 0L15 17M14.2 14.6l1.5-1.4a1.6 1.6 0 0 1 2.2 0L20 15" strokeLinecap="round" />
    </Icon>
  );
}

export function GifIcon({ size = 20, className = '' }) {
  return (
    <Icon size={size} className={className} fill="none" stroke="currentColor" strokeWidth={1.7}>
      <rect x="2.5" y="6" width="19" height="12" rx="2.5" />
      <path d="M10.4 10.6H8.7a1.6 1.6 0 0 0-1.6 1.6v.4c0 .9.7 1.6 1.6 1.6h1.1v-1.4M15.4 10.6h-1.9v3.8M12.6 10.6v3.8M17.2 14.4v-3.8h2.3M17.2 12.6h1.6" strokeLinecap="round" />
    </Icon>
  );
}

export function StickerIcon({ size = 20, className = '' }) {
  return (
    <Icon size={size} className={className} fill="none" stroke="currentColor" strokeWidth={1.8}>
      <path d="M3.5 9.5A6 6 0 0 1 9.5 3.5h5A6 6 0 0 1 20.5 9.5v2.2c0 .5-.2.9-.5 1.2l-7.1 7.1c-.3.3-.7.5-1.2.5H9.5a6 6 0 0 1-6-6v-5Z" strokeLinejoin="round" />
      <path d="M20.4 12.6h-3.7a2.6 2.6 0 0 0-2.6 2.6v3.7" strokeLinejoin="round" />
    </Icon>
  );
}

export function SendIcon({ size = 18, className = '' }) {
  return (
    <Icon size={size} className={className} fill="currentColor">
      <path d="M20.9 3.3 3.6 10.2c-.9.36-.86 1.64.06 1.94l6.3 2.05 2.05 6.3c.3.92 1.58.96 1.94.06L20.9 3.3Z" />
    </Icon>
  );
}

export function TrashIcon({ size = 18, className = '' }) {
  return (
    <Icon size={size} className={className} fill="none" stroke="currentColor" strokeWidth={1.8}>
      <path d="M4.5 7h15M9.5 7V5.2c0-.66.54-1.2 1.2-1.2h2.6c.66 0 1.2.54 1.2 1.2V7M6.5 7l.8 11.2c.05.73.66 1.3 1.4 1.3h6.6c.74 0 1.35-.57 1.4-1.3L17.5 7" strokeLinecap="round" strokeLinejoin="round" />
    </Icon>
  );
}

export function EditIcon({ size = 18, className = '' }) {
  return (
    <Icon size={size} className={className} fill="none" stroke="currentColor" strokeWidth={1.8}>
      <path d="M4 20h4.2l9.9-9.9a2.1 2.1 0 0 0 0-2.97l-1.23-1.23a2.1 2.1 0 0 0-2.97 0L4 15.8V20Z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m13.2 6.6 4.2 4.2" strokeLinecap="round" />
    </Icon>
  );
}
