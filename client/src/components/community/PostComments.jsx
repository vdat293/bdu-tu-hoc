import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  addCommunityPostComment,
  addCoursePostComment,
  getCommunityPostComments,
  getCoursePostComments
} from '../../api/community.js';
import { useToasts } from '../../app/providers.jsx';
import { AsyncState } from '../feedback/Loading.jsx';

function formatDate(value) {
  return value ? new Date(value).toLocaleString('vi-VN') : '';
}

export default function PostComments({ token, postId, courseCode = null }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const client = useQueryClient();
  const { notify } = useToasts();
  const queryKey = ['post-comments', courseCode || 'community', postId];
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => courseCode
      ? getCoursePostComments(token, courseCode, postId, { signal })
      : getCommunityPostComments(token, postId, { signal }),
    enabled: Boolean(open && token && postId)
  });
  const add = useMutation({
    mutationFn: ({ content, parentId }) => courseCode
      ? addCoursePostComment(token, courseCode, postId, { content, parentId })
      : addCommunityPostComment(token, postId, { content, parentId }),
    onSuccess: () => {
      setDraft('');
      setReplyTo(null);
      client.invalidateQueries({ queryKey });
      notify('Đã thêm bình luận.', 'success');
    },
    onError: (error) => notify(error.message, 'error')
  });
  const comments = Array.isArray(query.data) ? query.data : Array.isArray(query.data?.comments) ? query.data.comments : [];
  const roots = comments.filter((comment) => !comment.parent_id);
  const children = comments.reduce((map, comment) => {
    if (comment.parent_id) {
      const key = String(comment.parent_id);
      map.set(key, [...(map.get(key) || []), comment]);
    }
    return map;
  }, new Map());

  const submit = (event, parentId = replyTo?.id || null) => {
    event.preventDefault();
    const content = draft.trim();
    if (!content || add.isPending) return;
    add.mutate({ content, parentId });
  };

  const renderComment = (comment, depth = 0) => (
    <div className="comment" key={comment.id} style={{ marginLeft: `${Math.min(depth, 1) * 1.25}rem` }}>
      <div className="comment-heading">
        <strong>{comment.author?.is_anonymous ? 'Sinh viên giấu tên' : comment.author?.name || 'Sinh viên BDU'}</strong>
        <small>{formatDate(comment.created_at)}{comment.edited_at ? ' · đã sửa' : ''}</small>
      </div>
      <p>{comment.content}</p>
      <button type="button" className="button link-button" onClick={() => setReplyTo(comment)}>Trả lời</button>
      {(children.get(String(comment.id)) || []).map((child) => renderComment(child, depth + 1))}
    </div>
  );

  return <div className="comments">
    <button type="button" className="button ghost" onClick={() => setOpen((value) => !value)}>
      💬 {open ? 'Ẩn bình luận' : 'Xem / thêm bình luận'}{comments.length ? ` (${comments.length})` : ''}
    </button>
    {open && <div className="comments-panel">
      <AsyncState query={query} empty="Chưa có bình luận nào.">
        {roots.length ? <div className="comment-list">{roots.map((comment) => renderComment(comment))}</div> : <p className="muted">Chưa có bình luận nào.</p>}
      </AsyncState>
      {replyTo && <div className="reply-context">Đang trả lời {replyTo.author?.name || 'bình luận'} <button type="button" className="button link-button" onClick={() => setReplyTo(null)}>Hủy</button></div>}
      <form className="comment-form" onSubmit={submit}>
        <textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows="2" maxLength="4000" placeholder={replyTo ? 'Viết câu trả lời…' : 'Viết bình luận…'} aria-label="Nội dung bình luận" />
        <button type="submit" className="button secondary" disabled={add.isPending || !draft.trim()}>Gửi</button>
      </form>
    </div>}
  </div>;
}
