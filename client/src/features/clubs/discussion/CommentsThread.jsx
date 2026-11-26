import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addCommunityPostComment, getCommunityPostComments } from '../../../api/community.js';
import { useAuth, useRealtimeRoom, useToasts } from '../../../app/providers.jsx';
import { ClubAvatar } from '../components/ClubPrimitives.jsx';
import { formatRelativeTime } from '../lib/format.js';

export default function CommentsThread({ postId }) {
  const auth = useAuth();
  const { notify } = useToasts();
  const client = useQueryClient();
  const [draft, setDraft] = useState('');
  const key = ['clan-post-comments', String(postId)];

  useRealtimeRoom(postId ? `community-post:${postId}` : null, Boolean(auth.token));

  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => getCommunityPostComments(auth.token, postId, { signal }),
    enabled: Boolean(auth.token && postId)
  });

  const create = useMutation({
    mutationFn: (content) => addCommunityPostComment(auth.token, postId, { content }),
    onMutate: async (content) => {
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData(key);
      const optimistic = {
        id: `temp-${Date.now()}`,
        content,
        created_at: new Date().toISOString(),
        author: { name: auth.user?.name || 'Bạn' }
      };
      client.setQueryData(key, (old) => {
        if (Array.isArray(old)) return [...old, optimistic];
        if (old && Array.isArray(old.comments)) return { ...old, comments: [...old.comments, optimistic] };
        return [optimistic];
      });
      return { previous };
    },
    onError: (error, _vars, context) => {
      if (context?.previous !== undefined) client.setQueryData(key, context.previous);
      notify(error.message, 'error');
    },
    onSettled: () => client.invalidateQueries({ queryKey: key }),
    onSuccess: () => {
      setDraft('');
      notify('Đã gửi trao đổi.', 'success');
    }
  });

  const comments = Array.isArray(query.data?.comments)
    ? query.data.comments
    : Array.isArray(query.data)
      ? query.data
      : [];

  return (
    <section className="clb-comments" aria-label="Bình luận bài đăng">
      <form
        className="clb-comment-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (draft.trim()) create.mutate(draft.trim());
        }}
      >
        <label className="clb-sr-only" htmlFor={`club-comment-${postId}`}>Viết bình luận</label>
        <input
          id={`club-comment-${postId}`}
          className="clb-input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          maxLength={2000}
          placeholder="Viết trao đổi trong nhóm…"
        />
        <button
          type="submit"
          className="clb-btn clb-btn--primary clb-btn--sm"
          disabled={!draft.trim() || create.isPending}
        >
          {create.isPending ? 'Đang gửi…' : 'Gửi'}
        </button>
      </form>

      {query.isLoading ? (
        <p className="clb-muted">Đang tải bình luận…</p>
      ) : query.isError ? (
        <button type="button" className="clb-link-btn" onClick={() => query.refetch()}>
          Tải lại bình luận
        </button>
      ) : comments.length === 0 ? (
        <p className="clb-muted">Chưa có trao đổi nào.</p>
      ) : (
        <div className="clb-comment-list">
          {comments.map((comment) => (
            <article className="clb-comment" key={comment.id}>
              <ClubAvatar src={comment.author?.avatar_url} name={comment.author?.name} size="sm" />
              <div className="clb-comment__copy">
                <header className="clb-comment__head">
                  <strong>{comment.author?.name || 'Thành viên CLB'}</strong>
                  <time dateTime={comment.created_at}>{formatRelativeTime(comment.created_at)}</time>
                </header>
                <p>{comment.content}</p>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
