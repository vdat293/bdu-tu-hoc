import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addCommunityPostComment, getCommunityPostComments } from '../../../api/community.js';
import { useAuth, useRealtimeRoom, useToasts } from '../../../app/providers.jsx';
import { formatRelativeTime, initials } from '../lib/format.js';

// Lazy load: component chỉ mount khi user mở bình luận.
// Optimistic add: patch cache onMutate, rollback onError.
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

  const comments = Array.isArray(query.data?.comments) ? query.data.comments : Array.isArray(query.data) ? query.data : [];

  return (
    <section className="club-comments" aria-label="Bình luận bài đăng">
      <form
        className="club-comment-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (draft.trim()) create.mutate(draft.trim());
        }}
      >
        <label className="sr-only" htmlFor={`club-comment-${postId}`}>Viết bình luận</label>
        <input
          id={`club-comment-${postId}`}
          className="form-input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          maxLength={2000}
          placeholder="Viết trao đổi trong nhóm…"
        />
        <button type="submit" className="btn btn-primary btn-sm" disabled={!draft.trim() || create.isPending}>
          {create.isPending ? 'Đang gửi…' : 'Gửi'}
        </button>
      </form>
      {query.isLoading ? (
        <p className="club-muted">Đang tải bình luận…</p>
      ) : query.isError ? (
        <button type="button" className="club-text-action" onClick={() => query.refetch()}>Tải lại bình luận</button>
      ) : comments.length === 0 ? (
        <p className="club-muted">Chưa có trao đổi nào.</p>
      ) : (
        <div className="club-comment-list">
          {comments.map((comment) => (
            <article className="club-comment" key={comment.id}>
              <span className="club-avatar club-avatar--sm" aria-hidden="true">{initials(comment.author?.name)}</span>
              <div className="club-comment__copy">
                <header><strong>{comment.author?.name || 'Thành viên CLB'}</strong><time dateTime={comment.created_at}>{formatRelativeTime(comment.created_at)}</time></header>
                <p>{comment.content}</p>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
