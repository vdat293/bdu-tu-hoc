import { useMemo } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { getClanDocuments, getClans, getCommunityPosts } from '../../../api/community.js';
import { useAuth } from '../../../app/providers.jsx';
import { postsFrom, safeNumber } from '../lib/format.js';

export const POSTS_PER_PAGE = 12;
export const DOCS_PER_PAGE = 12;

// Giữ backward compat queryKey ['clans', mssv] như ClansPage/ClanPage cũ.
export function useClubs() {
  const auth = useAuth();
  return useQuery({
    queryKey: ['clans', auth.user?.mssv],
    queryFn: ({ signal }) => getClans(auth.token, { signal }),
    enabled: Boolean(auth.token)
  });
}

// Resolve club từ list + role_labels (backend có thể chưa trả role_labels -> fallback ở RoleBadge).
export function useClub(clanId) {
  const query = useClubs();
  const club = useMemo(() => {
    const list = Array.isArray(query.data) ? query.data : [];
    return list.find((item) => String(item.id) === String(clanId)) || null;
  }, [query.data, clanId]);
  return { ...query, club };
}

export function feedKey(mssv, clanId) {
  return ['clan', mssv, String(clanId), 'posts'];
}

export function useFeed(clanId, { enabled = true } = {}) {
  const auth = useAuth();
  return useInfiniteQuery({
    queryKey: feedKey(auth.user?.mssv, clanId),
    queryFn: ({ pageParam = 0, signal }) =>
      getCommunityPosts(auth.token, { scope: 'clan', scopeId: clanId, limit: POSTS_PER_PAGE, offset: pageParam, signal }),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => {
      const items = postsFrom(lastPage);
      const nextOffset = safeNumber(lastPage?.offset) + items.length;
      return nextOffset < safeNumber(lastPage?.total) ? nextOffset : undefined;
    },
    enabled: Boolean(auth.token && clanId && enabled)
  });
}

export function useDocs(clanId, { type = 'all', search = '', limit = DOCS_PER_PAGE, offset = 0, enabled = true } = {}) {
  const auth = useAuth();
  return useQuery({
    queryKey: ['clan', auth.user?.mssv, String(clanId), 'documents', type, search, offset],
    queryFn: ({ signal }) => getClanDocuments(auth.token, clanId, { type, search, limit, offset, signal }),
    enabled: Boolean(auth.token && clanId && enabled)
  });
}
