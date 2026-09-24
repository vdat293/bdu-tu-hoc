import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { deleteMyAvatar, uploadMyAvatar } from '../../api/identity.js';
import { useAuth, useToasts } from '../../app/providers.jsx';

/**
 * Một nguồn duy nhất cho thao tác ảnh đại diện: Confession và trang GPA đều
 * dùng hook này nên ảnh upload từ kênh nào cũng đồng bộ sang kênh kia (cùng
 * query key `identity-presentation`, cùng API `/api/me/avatar`).
 *
 * Luồng chọn ảnh: startCrop(file) -> popup căn chỉnh/cắt -> confirmCrop(file).
 */
export function useAvatarUpload() {
  const auth = useAuth();
  const client = useQueryClient();
  const { notify } = useToasts();
  const [cropFile, setCropFile] = useState(null);

  const invalidate = () => {
    client.invalidateQueries({ queryKey: ['identity-presentation', auth.user?.mssv] });
    client.invalidateQueries({ queryKey: ['confession'] });
  };

  const upload = useMutation({
    mutationFn: (file) => uploadMyAvatar(auth.token, file),
    onSuccess: () => {
      invalidate();
      notify('Đã cập nhật ảnh đại diện.', 'success');
    },
    onError: (error) => notify(error.message, 'error')
  });

  const remove = useMutation({
    mutationFn: () => deleteMyAvatar(auth.token),
    onSuccess: () => {
      invalidate();
      notify('Đã gỡ ảnh đại diện, dùng lại ảnh từ cổng BDU.', 'success');
    },
    onError: (error) => notify(error.message, 'error')
  });

  const startCrop = (file) => {
    if (!file) return false;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      notify('Chỉ hỗ trợ ảnh JPG, PNG hoặc WebP.', 'warning');
      return false;
    }
    if (file.size > 3 * 1024 * 1024) {
      notify('Ảnh đại diện tối đa 3MB.', 'warning');
      return false;
    }
    setCropFile(file);
    return true;
  };

  const cancelCrop = () => setCropFile(null);

  const confirmCrop = (croppedFile) => {
    setCropFile(null);
    if (croppedFile) upload.mutate(croppedFile);
  };

  return { upload, remove, startCrop, cancelCrop, confirmCrop, cropFile };
}

