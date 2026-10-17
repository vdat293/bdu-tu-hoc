import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AvatarContent } from '../../client/src/components/identity/Identity.jsx';

afterEach(cleanup);

describe('AvatarContent', () => {
  it('hiển thị ảnh khi tải được', () => {
    const { container } = render(
      <AvatarContent user={{ name: 'Nguyễn Văn A', photo_url: 'https://img.bdu.io.vn/avatars/1/a.webp' }} />
    );
    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://img.bdu.io.vn/avatars/1/a.webp');
  });

  it('quay về chữ cái đầu khi avatar cũ tải lỗi thay vì hiện icon vỡ', async () => {
    const { container } = render(
      <AvatarContent user={{ name: 'Nguyễn Văn A', photo_url: '/media/avatars/24050126-missing.webp' }} />
    );
    const img = container.querySelector('img');
    expect(img?.getAttribute('src')).toBe('/media/avatars/24050126-missing.webp');

    fireEvent.error(img);

    await waitFor(() => expect(container.querySelector('img')).toBeNull());
    expect(container.textContent).toBe('NA');
  });

  it('hiển thị chữ cái đầu khi không có ảnh', () => {
    const { container } = render(<AvatarContent user={{ name: 'Trần Thị B' }} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toBe('TB');
  });
});
