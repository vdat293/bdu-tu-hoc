import { getCommunityPosts } from '../../api/community.js';
import { getMyIdentityPresentation } from '../../api/identity.js';
import { getMyAcademicRanking, getProfile } from '../../api/academics.js';

// Trang Confession và phần nạp trước dùng chung bộ key/options này. Nếu mỗi
// bên tự khai báo, chỉ cần lệch một phần tử key là prefetch rơi vào cache khác
// và người dùng vẫn phải chờ loading như chưa hề nạp trước.
export const CONFESSION_DEFAULT_FILTER = 'all';
export const CONFESSION_DEFAULT_SOURCE = 'web';

const IDENTITY_STALE_TIME = 5 * 60 * 1000;

export function confessionFeedQueryKey(mssv, filter = CONFESSION_DEFAULT_FILTER, sourceTab = CONFESSION_DEFAULT_SOURCE) {
  return ['confession', mssv, filter, sourceTab];
}

export function confessionFeedQueryOptions({
  token,
  mssv,
  filter = CONFESSION_DEFAULT_FILTER,
  sourceTab = CONFESSION_DEFAULT_SOURCE
}) {
  return {
    queryKey: confessionFeedQueryKey(mssv, filter, sourceTab),
    queryFn: ({ signal }) =>
      getCommunityPosts(token, {
        // The server's forum scope aggregates school, faculty, and institute
        // posts. Using `school` here made those latter posts disappear.
        scope: 'forum',
        scopeId: null,
        filter,
        category: filter === 'anon' ? 'confession' : undefined,
        // Backend map: web -> portal, facebook -> facebook, all -> không lọc.
        source: sourceTab,
        limit: 50,
        signal
      }),
    enabled: Boolean(token)
  };
}

export function confessionPresentationQueryOptions({ token, mssv }) {
  return {
    queryKey: ['identity-presentation', mssv],
    queryFn: ({ signal }) => getMyIdentityPresentation(token, { signal }),
    enabled: Boolean(token),
    staleTime: IDENTITY_STALE_TIME
  };
}

export function confessionProfileQueryOptions({ token, mssv, idsv }) {
  return {
    queryKey: ['profile', mssv],
    queryFn: ({ signal }) => getProfile(token, { idsv, mssv, signal }),
    enabled: Boolean(token),
    staleTime: IDENTITY_STALE_TIME
  };
}

export function confessionRankingQueryOptions({ token, mssv, equippedFrameId }) {
  return {
    queryKey: ['academic-ranking', mssv],
    queryFn: ({ signal }) => getMyAcademicRanking(token, { signal }),
    enabled: Boolean(token && !equippedFrameId),
    staleTime: IDENTITY_STALE_TIME
  };
}
