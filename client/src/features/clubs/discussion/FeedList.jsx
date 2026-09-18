import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  createCommunityPost,
  deleteCommunityPost,
  toggleCommunityPostLike,
  voteClanPoll
} from '../../../api/community.js';
import { useAuth, useToasts } from '../../../app/providers.jsx';
import InlineComposer from '../components/InlineComposer.jsx';
import PostCard from '../components/PostCard.jsx';
import { PostSkeleton } from '../components/Skeleton.jsx';
import EmptyState from '../components/EmptyState.jsx';
import CommentsThread from './CommentsThread.jsx';
import { feedKey, useFeed } from '../hooks/useClubs.js';
import { postsFrom, safeNumber } from '../lib/format.js';

const FILTERS = [
  { id: 'all', label: 'Tất cả' },
  { id: 'discussion', label: 'Thảo luận' },
  { id: 'poll', label: 'Bình chọn' },
  { id: 'mine', label: 'Của tôi' }
];

function applyFilter(rawPosts, filter) {
  if (filter === 'discussion') return rawPosts.filter((post) => post.category !== 'poll' && !post.poll);
  if (filter === 'poll') return rawPosts.filter((post) => post.category === 'poll' || post.poll);
  if (filter === 'mine') return rawPosts.filter((post) => Boolean(post.is_mine));
  return rawPosts;
}

function patchPostInCache(client, key, postId, patch) {
  client.setQueryData(key, (old) => {
    if (!old?.pages) return old;
    return {
      ...old,
      pages: old.pages.map((page) => {
        const items = postsFrom(page);
        if (!items.some((p) => String(p.id) === String(postId))) return page;
        const nextPosts = items.map((p) => (String(p.id) === String(postId) ? { ...p, ...patch(p) } : p));
        if (Array.isArray(page?.posts)) return { ...page, posts: nextPosts };
        if (Array.isArray(page)) return nextPosts;
        return page;
      })
    };
  });
}

// Infinite query wrapper + filter + optimistic like/vote.
export default function FeedList({ clanId, roleLabels, canPost, canDeleteAny, canPoll, myRole }) {
  const auth = useAuth();
  const { notify } = useToasts();
  const client = useQueryClient();
  const [filter, setFilter] = useState('all');
  const [openComments, setOpenComments] = useState({});
  const key = feedKey(auth.user?.mssv, clanId);

  const feed = useFeed(clanId, { enabled: true });
  const rawPosts = useMemo(() => feed.data?.pages?.flatMap(postsFrom) || [], [feed.data]);
  const posts = useMemo(() => applyFilter(rawPosts, filter), [rawPosts, filter]);
  const total = safeNumber(feed.data?.pages?.[0]?.total);

  const createPost = useMutation({
    mutationFn: (payload) => {
      if (payload.mode === 'poll') {
        return createCommunityPost(auth.token, {
          title: payload.question,
          content: payload.content,
          scope: 'clan',
          scopeId: clanId,
          category: 'poll',
          poll: { question: payload.question, options: payload.options }
        });
      }
      return createCommunityPost(auth.token, {
        title: payload.title,
        content: payload.content,
        scope: 'clan',
        scopeId: clanId,
        category: payload.url ? 'material' : 'discussion',
        attachments: payload.url ? [{ url: payload.url, title: payload.title || 'Tài liệu CLB' }] : []
      });
    },
    onSuccess: (_data, payload, context) => {
      context?.reset?.();
      client.invalidateQueries({ queryKey: key });
      notify('Đã đăng bài trong CLB.', 'success');
    },
    onError: (error) => notify(error.message, 'error')
  });

  const like = useMutation({
    mutationFn: (postId) => toggleCommunityPostLike(auth.token, postId),
    onMutate: async (postId) => {
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData(key);
      patchPostInCache(client, key, postId, (post) => ({
        is_liked: !post.is_liked,
        like_count: safeNumber(post.like_count) + (post.is_liked ? -1 : 1)
      }));
      return { previous };
    },
    onError: (error, _vars, context) => {
      if (context?.previous !== undefined) client.setQueryData(key, context.previous);
      notify(error.message, 'error');
    },
    onSettled: () => client.invalidateQueries({ queryKey: key })
  });

  const vote = useMutation({
    mutationFn: ({ pollId, optionId }) => voteClanPoll(auth.token, pollId, optionId),
    onMutate: async ({ pollId, optionId }) => {
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData(key);
      client.setQueryData(key, (old) => {
        if (!old?.pages) return old;
        return {
          ...old,
          pages: old.pages.map((page) => {
            const items = postsFrom(page);
            const nextPosts = items.map((post) => {
              if (!post.poll || String(post.poll.id) !== String(pollId)) return post;
              const options = (post.poll.options || []).map((option) => {
                if (String(option.id) === String(optionId)) {
                  return { ...option, is_voted: true, vote_count: safeNumber(option.vote_count) + 1 };
                }
                return option.is_voted ? { ...option, is_voted: false, vote_count: Math.max(0, safeNumber(option.vote_count) - 1) } : option;
              });
              return { ...post, poll: { ...post.poll, options } };
            });
            if (Array.isArray(page?.posts)) return { ...page, posts: nextPosts };
            if (Array.isArray(page)) return nextPosts;
            return page;
          })
        };
      });
      return { previous };
    },
    onError: (error, _vars, context) => {
      if (context?.previous !== undefined) client.setQueryData(key, context.previous);
      notify(error.message, 'error');
    },
    onSettled: () => client.invalidateQueries({ queryKey: key })
  });

  const removePost = useMutation({
    mutationFn: (postId) => deleteCommunityPost(auth.token, postId),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: key });
      notify('Đã xóa bài viết.', 'success');
    },
    onError: (error) => notify(error.message, 'error')
  });

  const submitComposer = (payload, helpers) => {
    if (payload.mode === 'poll') {
      if (!payload.question) return notify('Vui lòng nhập câu hỏi bình chọn.', 'warning');
      if (payload.options.length < 2) return notify('Bình chọn cần ít nhất hai phương án.', 'warning');
    } else if (!payload.title && !payload.content) {
      return notify('Vui lòng nhập tiêu đề hoặc nội dung bài viết.', 'warning');
    }
    createPost.mutate(payload, { onSuccess: () => helpers?.reset?.() });
  };

  return (
    <div className="club-feed">
      {canPost && (
        <div className="club-panel">
          <InlineComposer user={auth.user} canPoll={canPoll} isPending={createPost.isPending} onSubmit={submitComposer} />
        </div>
      )}
      <div className="club-feed-filter">
        <div className="club-segmented" role="group" aria-label="Lọc bản tin">
          {FILTERS.map((item) => (
            <button key={item.id} type="button" className={filter === item.id ? 'is-active' : ''} aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>
              {item.label}
            </button>
          ))}
        </div>
        {feed.isSuccess && <span className="club-feed-summary">Đã tải {rawPosts.length}/{total} bài</span>}
      </div>
      {feed.isLoading ? (
        <div className="club-feed-list"><PostSkeleton /><PostSkeleton /></div>
      ) : feed.isError ? (
        <div className="club-empty" role="alert"><h2>Chưa thể tải bản tin</h2><p>{feed.error?.message}</p><button type="button" className="btn btn-secondary" onClick={() => feed.refetch()}>Thử lại</button></div>
      ) : posts.length === 0 ? (
        <EmptyState title="Chưa có bài đăng phù hợp" hint={filter === 'all' ? 'Hãy bắt đầu cuộc trao đổi đầu tiên của CLB.' : 'Hãy thử bộ lọc khác hoặc đăng một nội dung mới.'} />
      ) : (
        <div className="club-feed-list">
          {posts.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              roleLabels={roleLabels}
              likePending={like.isPending}
              votePending={vote.isPending}
              commentsOpen={Boolean(openComments[post.id])}
              commentCount={post.comment_count}
              canDelete={Boolean(post.is_mine || canDeleteAny)}
              onLike={(target) => like.mutate(target.id)}
              onVote={(pollId, optionId) => vote.mutate({ pollId, optionId })}
              onDelete={(target) => removePost.mutate(target.id)}
              onToggleComments={(target) => setOpenComments((cur) => ({ ...cur, [target.id]: !cur[target.id] }))}
              comments={openComments[post.id] ? <CommentsThread postId={post.id} /> : null}
            />
          ))}
        </div>
      )}
      {feed.hasNextPage && (
        <div className="club-load-more">
          <button type="button" className="btn btn-secondary" onClick={() => feed.fetchNextPage()} disabled={feed.isFetchingNextPage}>
            {feed.isFetchingNextPage ? 'Đang tải…' : 'Tải thêm bài đăng'}
          </button>
        </div>
      )}
      <span className="club-visually-hidden" data-testid="club-my-role">{myRole || ''}</span>
    </div>
  );
}
