import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCommunityPosts: vi.fn(() => Promise.resolve({ posts: [] })),
  getMyIdentityPresentation: vi.fn(() => Promise.resolve({ equipped_frame_id: null })),
  getIdentityFrames: vi.fn(() => Promise.resolve({ frames: [] })),
  getProfile: vi.fn(() => Promise.resolve({})),
  getMyAcademicRanking: vi.fn(() => Promise.resolve({}))
}));

vi.mock('../../client/src/api/community.js', () => ({
  getCommunityPosts: mocks.getCommunityPosts
}));

vi.mock('../../client/src/api/identity.js', () => ({
  getIdentityFrames: mocks.getIdentityFrames,
  getMyIdentityPresentation: mocks.getMyIdentityPresentation
}));

vi.mock('../../client/src/api/academics.js', () => ({
  getProfile: mocks.getProfile,
  getMyAcademicRanking: mocks.getMyAcademicRanking
}));

// Unit test không cần nạp cả trang Confession (100KB) chỉ để kiểm tra prefetch.
vi.mock('../../client/src/features/confession/ConfessionPage.jsx', () => ({
  default: () => null
}));

import {
  confessionFeedQueryKey,
  confessionFeedQueryOptions,
  confessionRankingQueryOptions
} from '../../client/src/features/confession/confession-queries.js';
import { prefetchConfession } from '../../client/src/app/confession-preload.js';

function createClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

beforeEach(() => {
  mocks.getCommunityPosts.mockReset().mockResolvedValue({ posts: [] });
  mocks.getMyIdentityPresentation.mockReset().mockResolvedValue({ equipped_frame_id: null });
  mocks.getProfile.mockReset().mockResolvedValue({});
  mocks.getMyAcademicRanking.mockReset().mockResolvedValue({});
});

describe('confession-queries', () => {
  it('khoá feed tách biệt theo mssv, filter và nguồn', () => {
    expect(confessionFeedQueryKey('24050126', 'all', 'web')).toEqual(['confession', '24050126', 'all', 'web']);
    expect(confessionFeedQueryKey('24050126', 'mine', 'web')).not.toEqual(confessionFeedQueryKey('24050126', 'all', 'web'));
    expect(confessionFeedQueryKey('24050126', 'all', 'facebook')).not.toEqual(confessionFeedQueryKey('24050126', 'all', 'web'));
  });

  it('gửi đúng tham số forum và chỉ gắn category cho confession ẩn danh', async () => {
    await confessionFeedQueryOptions({ token: 'token-1', mssv: '24050126', filter: 'all', sourceTab: 'web' })
      .queryFn({ signal: undefined });
    expect(mocks.getCommunityPosts).toHaveBeenLastCalledWith('token-1', expect.objectContaining({
      scope: 'forum',
      scopeId: null,
      filter: 'all',
      category: undefined,
      source: 'web',
      limit: 50
    }));

    await confessionFeedQueryOptions({ token: 'token-1', mssv: '24050126', filter: 'anon', sourceTab: 'all' })
      .queryFn({ signal: undefined });
    expect(mocks.getCommunityPosts).toHaveBeenLastCalledWith('token-1', expect.objectContaining({
      filter: 'anon',
      category: 'confession',
      source: 'all'
    }));
  });

  it('chỉ bật ranking khi chưa có khung trang bị', () => {
    expect(confessionRankingQueryOptions({ token: 't', mssv: '1', equippedFrameId: null }).enabled).toBe(true);
    expect(confessionRankingQueryOptions({ token: 't', mssv: '1', equippedFrameId: 'anime-gojo' }).enabled).toBe(false);
  });
});

describe('prefetchConfession', () => {
  it('nạp sẵn feed, danh tính và profile vào đúng cache key của trang', async () => {
    const client = createClient();

    await prefetchConfession(client, { token: 'token-1', mssv: '24050126', idsv: '123' });

    expect(mocks.getCommunityPosts).toHaveBeenCalledWith('token-1', expect.objectContaining({
      scope: 'forum',
      filter: 'all',
      source: 'web',
      limit: 50
    }));
    expect(mocks.getMyIdentityPresentation).toHaveBeenCalledWith('token-1', expect.anything());
    expect(mocks.getProfile).toHaveBeenCalledWith('token-1', expect.objectContaining({ idsv: '123', mssv: '24050126' }));
    expect(mocks.getMyAcademicRanking).toHaveBeenCalledTimes(1);

    expect(client.getQueryData(['confession', '24050126', 'all', 'web'])).toEqual({ posts: [] });
    expect(client.getQueryData(['identity-presentation', '24050126'])).toEqual({ equipped_frame_id: null });
    expect(client.getQueryData(['profile', '24050126'])).toEqual({});
  });

  it('bỏ qua ranking khi người dùng đã có khung trang bị', async () => {
    mocks.getMyIdentityPresentation.mockResolvedValue({ equipped_frame_id: 'anime-gojo' });
    const client = createClient();

    await prefetchConfession(client, { token: 'token-1', mssv: '24050126' });

    expect(mocks.getMyAcademicRanking).not.toHaveBeenCalled();
  });

  it('không gọi API khi chưa có token', async () => {
    const client = createClient();

    await prefetchConfession(client, { token: null, mssv: '24050126' });

    expect(mocks.getCommunityPosts).not.toHaveBeenCalled();
    expect(mocks.getMyIdentityPresentation).not.toHaveBeenCalled();
    expect(mocks.getProfile).not.toHaveBeenCalled();
  });
});
