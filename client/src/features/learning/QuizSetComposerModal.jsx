import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth, useToasts } from '../../app/providers.jsx';
import { useViewportDialog } from '../../components/ViewportModal.jsx';
import { createQuizSet } from '../../api/community.js';
import {
  QUIZ_MAX_BYTES,
  QUIZ_SET_DEFAULT_MAX_PER_PART,
  QUIZ_SET_DEFAULT_MINUTES_PER_PART,
  QUIZ_SET_MAX_PER_PART,
  QUIZ_SET_MIN_PER_PART,
  QUIZ_SET_MIN_MINUTES_PER_PART,
  QUIZ_SET_MAX_MINUTES_PER_PART,
  QUIZ_SET_MAX_QUESTIONS,
  parseQuizJson,
  buildQuizSet
} from '../../../../src/utils/quiz-data.js';
import './quiz.css';

const TOTAL_BYTES_LIMIT = 2.5 * 1024 * 1024;
const MAX_FILES = 10;
const MAX_QUESTIONS_PER_FILE = 100;

async function readFileText(file) {
  if (file && typeof file.text === 'function') {
    return file.text();
  }
  return new Promise((resolve, reject) => {
    const reader = new window.FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Không đọc được file.'));
    reader.readAsText(file);
  });
}

export default function QuizSetComposerModal({ courseCode, token: tokenProp, onClose, onCreated }) {
  const auth = useAuth();
  const token = tokenProp || auth?.token;
  const { notify } = useToasts();
  const client = useQueryClient();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [files, setFiles] = useState([]);
  const [fileError, setFileError] = useState('');
  const [maxPerPart, setMaxPerPart] = useState(QUIZ_SET_DEFAULT_MAX_PER_PART);
  const [minutes, setMinutes] = useState(QUIZ_SET_DEFAULT_MINUTES_PER_PART);
  const [submitError, setSubmitError] = useState('');
  // Validation must not shout at an empty form: the title error appears once
  // the field has been edited (or a submit was attempted), and the
  // "questions phải có 1-500 câu" error only once files were actually picked
  // (or a submit was attempted).
  const [titleTouched, setTitleTouched] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const inputRef = useRef(null);
  const dialogRef = useRef(null);
  const titleRef = useRef(null);
  useViewportDialog(true, onClose || (() => {}), dialogRef, titleRef);

  const titleError = title.trim() === '' ? 'Tiêu đề là bắt buộc.' : title.trim().length > 180 ? 'Tiêu đề tối đa 180 ký tự.' : '';
  const descriptionError = description.length > 5000 ? 'Mô tả tối đa 5000 ký tự.' : '';

  const validFiles = files.filter((f) => !f.error && Array.isArray(f.questions));
  const allQuestions = validFiles.flatMap((f) => f.questions);
  const totalBytes = files.reduce((sum, f) => sum + (f.size || 0), 0);

  const hasFileErrors = files.some((f) => f.error) || Boolean(fileError);
  const tooManyQuestions = allQuestions.length > QUIZ_SET_MAX_QUESTIONS;

  const buildResult = buildQuizSet({
    questions: allQuestions.length ? allQuestions : [],
    maxQuestionsPerPart: Number(maxPerPart),
    minutesPerPart: Number(minutes)
  });

  const previewSet = buildResult.ok ? buildResult.set : null;
  const buildErrors = buildResult.ok ? [] : buildResult.errors || [];
  // An empty form is not an error state: only surface the build errors once
  // there is something to build (files picked) or the user tried to submit.
  const showBuildErrors = submitAttempted || files.length > 0;
  const showTitleError = (titleTouched || submitAttempted) && Boolean(titleError);

  const canSubmit =
    !titleError &&
    !descriptionError &&
    !hasFileErrors &&
    !fileError &&
    allQuestions.length > 0 &&
    allQuestions.length <= QUIZ_SET_MAX_QUESTIONS &&
    !tooManyQuestions &&
    buildResult.ok;

  const handleFilesChange = async (event) => {
    const selected = Array.from(event.target.files || []);
    event.target.value = '';
    setFileError('');
    setSubmitError('');

    if (files.length + selected.length > MAX_FILES) {
      setFileError(`Tối đa ${MAX_FILES} file JSON.`);
      return;
    }

    const newEntries = [];
    let nextTitle = title;
    let nextDescription = description;
    let totalSize = totalBytes;

    for (const file of selected) {
      totalSize += file.size || 0;
      if ((file.size || 0) > QUIZ_MAX_BYTES) {
        newEntries.push({ name: file.name, size: file.size, error: 'File vượt quá 256 KB.', questions: null });
        continue;
      }
      if (totalSize > TOTAL_BYTES_LIMIT) {
        newEntries.push({ name: file.name, size: file.size, error: 'Tổng dung lượng vượt quá 2.5 MB.', questions: null });
        continue;
      }

      let text = '';
      try {
        text = await readFileText(file);
      } catch (err) {
        newEntries.push({ name: file.name, size: file.size, error: err?.message || 'Không đọc được file.', questions: null });
        continue;
      }

      const parsed = parseQuizJson(text);
      if (!parsed.ok) {
        const msg = (parsed.errors || []).map((e) => e.message).join(' ') || 'JSON không hợp lệ.';
        newEntries.push({ name: file.name, size: file.size, error: msg, questions: null });
        continue;
      }

      const qs = parsed.quiz.questions || [];
      if (qs.length > MAX_QUESTIONS_PER_FILE) {
        newEntries.push({ name: file.name, size: file.size, error: `File chứa tối đa ${MAX_QUESTIONS_PER_FILE} câu.`, questions: null });
        continue;
      }
      if (qs.length < 1) {
        newEntries.push({ name: file.name, size: file.size, error: 'File không có câu hỏi.', questions: null });
        continue;
      }

      newEntries.push({ name: file.name, size: file.size, error: '', questions: qs, count: qs.length });

      // Prefill from first valid file only when empty.
      if (nextTitle.trim() === '' && parsed.quiz.title) {
        nextTitle = parsed.quiz.title;
      }
      if (nextDescription.trim() === '' && parsed.quiz.description) {
        nextDescription = parsed.quiz.description;
      }
    }

    setFiles((prev) => [...prev, ...newEntries]);
    setTitle(nextTitle);
    setDescription(nextDescription);
  };

  const removeFile = (index) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!buildResult.ok) throw new Error((buildResult.errors || []).map((e) => e.message).join(' '));
      const payload = {
        title: title.trim(),
        description: description.trim(),
        questions: buildResult.set.questions,
        sourceFiles: validFiles.map((f) => ({ name: f.name, questionCount: f.questions.length })),
        maxQuestionsPerPart: Number(maxPerPart),
        minutesPerPart: Number(minutes)
      };
      return createQuizSet(token, courseCode, payload);
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['quiz-sets', courseCode] });
      notify('Đã tạo bộ đề trắc nghiệm.', 'success');
      if (onCreated) onCreated();
      if (onClose) onClose();
    },
    onError: (error) => {
      setSubmitError(error?.message || 'Không thể tạo bộ đề.');
    }
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    setSubmitError('');
    setSubmitAttempted(true);
    if (!canSubmit) return;
    submitMutation.mutate();
  };

  return createPortal(
    <div
      className="modal-backdrop learning-modal-backdrop"
      onClick={(e) => {
        if (e.target.classList && e.target.classList.contains('modal-backdrop') && onClose) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="learning-composer-dialog glass-panel quiz-set-composer"
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
      >
        <form onSubmit={handleSubmit}>
          <div className="learning-composer-header">
            <div>
              <h3 className="composer-headline">Tạo bộ đề trắc nghiệm</h3>
              <p className="composer-subline">Môn: {courseCode}</p>
            </div>
            <button type="button" className="composer-close-btn" onClick={onClose} title="Đóng">
              ×
            </button>
          </div>

          <div className="composer-inputs-group">
            <div className="composer-field">
              <label className="composer-label" htmlFor="quiz-set-title">
                Tiêu đề <span className="req">*</span>
              </label>
              <input
                id="quiz-set-title"
                ref={titleRef}
                className="form-input composer-input"
                type="text"
                maxLength={180}
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  setTitleTouched(true);
                }}
                onBlur={() => setTitleTouched(true)}
              />
              {showTitleError && <p className="quiz-runner-error">{titleError}</p>}
            </div>

            <div className="composer-field">
              <label className="composer-label" htmlFor="quiz-set-description">
                Mô tả
              </label>
              <textarea
                id="quiz-set-description"
                className="form-input composer-textarea"
                rows={3}
                maxLength={5000}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
              {descriptionError && <p className="quiz-runner-error">{descriptionError}</p>}
            </div>

            <div className="composer-field">
              <label className="composer-label">File JSON</label>
              <div className="quiz-composer-actions">
                <label className="quiz-file-btn">
                  Chọn file .json
                  <input
                    ref={inputRef}
                    type="file"
                    accept=".json,application/json"
                    multiple
                    hidden
                    onChange={handleFilesChange}
                  />
                </label>
              </div>
              {fileError && <p className="quiz-runner-error">{fileError}</p>}
              {totalBytes > TOTAL_BYTES_LIMIT && !fileError && (
                <p className="quiz-runner-error">Tổng dung lượng vượt quá 2.5 MB.</p>
              )}

              {files.length > 0 && (
                <ul className="quiz-set-file-list">
                  {files.map((f, idx) => (
                    <li key={idx} className={`quiz-set-file-item ${f.error ? 'is-error' : ''}`}>
                      <span className="quiz-set-file-name">{f.name}</span>
                      {f.error ? (
                        <span className="quiz-set-file-error">{f.error}</span>
                      ) : (
                        <span className="quiz-set-file-count">{f.count} câu</span>
                      )}
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => removeFile(idx)}>
                        Xóa
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="quiz-set-config-grid">
              <div className="composer-field">
                <label className="composer-label" htmlFor="quiz-set-max">
                  Số câu tối đa/phần
                </label>
                <input
                  id="quiz-set-max"
                  className="form-input composer-input"
                  type="number"
                  min={QUIZ_SET_MIN_PER_PART}
                  max={QUIZ_SET_MAX_PER_PART}
                  value={maxPerPart}
                  onChange={(e) => setMaxPerPart(e.target.value)}
                />
              </div>
              <div className="composer-field">
                <label className="composer-label" htmlFor="quiz-set-minutes">
                  Số phút/phần
                </label>
                <input
                  id="quiz-set-minutes"
                  className="form-input composer-input"
                  type="number"
                  min={QUIZ_SET_MIN_MINUTES_PER_PART}
                  max={QUIZ_SET_MAX_MINUTES_PER_PART}
                  value={minutes}
                  onChange={(e) => setMinutes(e.target.value)}
                />
              </div>
            </div>

            {previewSet && (
              <div className="quiz-preview">
                <p className="quiz-preview-title">
                  {previewSet.partCount} phần · {previewSet.questionCount} câu · {previewSet.partSizes.join('/')} · {previewSet.minutesPerPart} phút/phần
                </p>
                <p className="quiz-preview-title">
                  {previewSet.partSizes.join(', ')} câu/phần
                </p>
                <p className="quiz-preview-title">3 câu đầu:</p>
                {previewSet.questions.slice(0, 3).map((q) => (
                  <div key={q.id} className="quiz-preview-question">
                    <p className="quiz-preview-q">{q.question}</p>
                    <ul className="quiz-preview-options">
                      {q.options.map((opt) => (
                        <li key={opt} className={opt === q.correct ? 'quiz-option-correct' : ''}>
                          {opt}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}

            {((showBuildErrors && buildErrors.length > 0) || submitError) && (
              <div className="quiz-errors">
                {[
                  ...(showBuildErrors ? buildErrors : []),
                  ...(submitError ? [{ message: submitError }] : [])
                ].map((e, i) => (
                  <p key={i} className="quiz-error-item">{e.message}</p>
                ))}
              </div>
            )}
          </div>

          <div className="composer-modal-footer">
            <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
              Hủy
            </button>
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={!canSubmit || submitMutation.isPending}
              title={!canSubmit && !submitMutation.isPending
                ? 'Nhập tiêu đề và ít nhất một file JSON hợp lệ để tạo bộ đề.'
                : undefined}
            >
              {submitMutation.isPending ? 'Đang tạo...' : 'Tạo bộ đề'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}