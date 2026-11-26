import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  downloadWordFmt,
  formatDocx,
  previewDocxStructure
} from '../../api/tools.js';
import { useAuth, useToasts } from '../../app/providers.jsx';
import { useConfirm } from '../../components/feedback/ConfirmDialog.jsx';
import { getToolRun, startToolRun, subscribeToolRun } from '../../services/tool-runs.js';
import DocxReviewWorkspace from './DocxReviewWorkspace.jsx';
import AiSkillPanel from './AiSkillPanel.jsx';
import { ImpactButton, ImpactProgress } from '../../lib/bdu-vfx/index.js';
import { trackAction } from '../../services/telemetry.js';
import '../../styles/wordfmt-status.css';
import '../../styles/wordfmt-preview.css';

const WORD_FMT_STAGES = [
  { title: 'Kiểm tra tệp', inProgress: 'Đang kiểm tra tệp DOCX', description: 'Đang ước tính khả năng đọc tệp và mức độ tương thích.' },
  { title: 'Xác định số chương', inProgress: 'Đang xác định số chương', description: 'Đang nhận diện cấu trúc tiêu đề trong tài liệu.' },
  { title: 'Nhận diện bảng & hình', inProgress: 'Đang nhận diện bảng & hình', description: 'Đang rà soát các đối tượng và chú thích có trong tài liệu.' },
  { title: 'Rà soát bìa/front-matter', inProgress: 'Đang rà soát bìa/front-matter', description: 'Đang đối chiếu các tùy chọn phần đầu tài liệu đã chọn.' },
  { title: 'Áp dụng định dạng', inProgress: 'Đang áp dụng định dạng', description: 'Đang xử lý các quy tắc định dạng theo cấu hình hiện tại.' },
  { title: 'Hoàn thiện', inProgress: 'Đang hoàn thiện tài liệu', description: 'Đang chuẩn bị tài liệu đầu ra và các thành phần liên quan.' },
  { title: 'Kiểm tra kết quả', inProgress: 'Đang kiểm tra kết quả', description: 'Đang chờ xác thực cuối cùng trước khi trả tài liệu cho bạn.' }
];

const SAFE_ERROR_MESSAGE = 'Không thể hoàn tất việc định dạng file. Vui lòng kiểm tra file DOCX hoặc kết nối rồi thử lại.';

const INITIAL_DOC_STATE = {
  roleOverrides: {},
  paragraphNotes: {},
  textEdits: {},
  deletedItems: [],
  insertedItems: []
};

function buildParagraphMutationsPayload(docState) {
  if (!docState) return null;
  const deletedSet = new Set((docState.deletedItems || []).map(String));
  const edits = {};
  for (const [k, val] of Object.entries(docState.textEdits || {})) {
    const keyStr = String(k);
    if (!deletedSet.has(keyStr) && typeof val === 'string') {
      edits[keyStr] = val;
    }
  }
  const inserts = (docState.insertedItems || [])
    .filter((ins) => ins && !deletedSet.has(String(ins.id)))
    .map((ins) => {
      const idStr = String(ins.id);
      return {
        id: idStr,
        afterKey: ins.afterKey ? String(ins.afterKey) : '',
        beforeKey: ins.beforeKey ? String(ins.beforeKey) : '',
        role: docState.roleOverrides?.[idStr] || ins.role || 'body',
        text: Object.prototype.hasOwnProperty.call(edits, idStr)
          ? edits[idStr]
          : String(ins.text ?? '')
      };
    });
  const deletes = (docState.deletedItems || [])
    .map(String)
    .filter((k) => /^\d+$/.test(k));

  if (!Object.keys(edits).length && !inserts.length && !deletes.length) {
    return null;
  }
  return { edits, deletes, inserts };
}

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function asCount(value) {
  const count = Number(value);
  return Number.isInteger(count) && count >= 0 ? count : null;
}

function reportWarnings(structure, outputNormalization) {
  const sources = [structure?.warnings, outputNormalization?.warnings];
  return [...new Set(sources.flatMap((warnings) => (Array.isArray(warnings) ? warnings : []))
    .filter((warning) => typeof warning === 'string' && warning.trim()))];
}

function requestedOptions(choices) {
  if (!asRecord(choices)) return [];
  return [
    choices.includeCover && 'bìa',
    choices.includeComments && 'nhận xét',
    choices.includeThanks && 'lời cảm ơn',
    choices.onlyExistingCaptions && 'chỉ chú thích Bảng/Hình sẵn có',
    choices.skipProposal && 'giữ nguyên đề cương'
  ].filter(Boolean);
}

export function buildCompletionCards(result, choices) {
  const report = asRecord(result?.report);
  const structure = asRecord(report?.structure);
  const outputNormalization = asRecord(report?.outputNormalization);
  const compliance = asRecord(outputNormalization?.compliance);
  const cards = [];

  const chapterCount = asCount(structure?.chapterCount);
  if (chapterCount !== null) {
    cards.push({
      tone: 'info',
      title: 'Cấu trúc tài liệu',
      description: `Đã nhận diện ${chapterCount} chương trong tài liệu.`
    });
  }

  const manualRoleOverrides = asCount(structure?.manualRoleOverrides);
  const manualNotes = asCount(structure?.manualNotes);
  const manualContentEdits = asCount(structure?.manualContentEdits);
  if (manualRoleOverrides || manualNotes || manualContentEdits) {
    cards.push({
      tone: 'info',
      title: 'Chỉnh sửa từ bản xem trước',
      description: [
        manualContentEdits && `Đã áp dụng ${manualContentEdits} chỉnh sửa nội dung trực tiếp trên trang giấy.`,
        manualRoleOverrides && `Đã áp dụng ${manualRoleOverrides} đoạn đổi kiểu theo bạn chọn.`,
        manualNotes && `Đã chèn ${manualNotes} ghi chú dạng comment vào file Word.`
      ].filter(Boolean).join(' ')
    });
  }

  const captionsRenumbered = asCount(outputNormalization?.captionsRenumbered);
  if (captionsRenumbered !== null) {
    cards.push({
      tone: 'info',
      title: 'Bảng & hình',
      description: captionsRenumbered
        ? `Đã chuẩn hóa ${captionsRenumbered} chú thích Bảng/Hình.`
        : 'Không có chú thích Bảng/Hình nào được chuẩn hóa.'
    });
  }

  const equationsFormatted = asCount(outputNormalization?.equationsFormatted);
  if (equationsFormatted) {
    cards.push({
      tone: 'info',
      title: 'Công thức toán học',
      description: `Đã chuyển đổi chuẩn Word Equation (OMML) và căn giữa ${equationsFormatted} công thức toán học.`
    });
  }

  const tablesResized = asCount(outputNormalization?.tablesResized);
  if (tablesResized !== null) {
    cards.push({
      tone: 'info',
      title: 'Bảng dữ liệu',
      description: tablesResized
        ? `Đã điều chỉnh ${tablesResized} bảng theo khổ trang.`
        : 'Không có bảng dữ liệu nào được điều chỉnh.'
    });
  }

  const coversAdded = asCount(structure?.coversAdded);
  if (coversAdded !== null) {
    cards.push({
      tone: 'info',
      title: 'Trang bìa',
      description: coversAdded
        ? `Đã thêm ${coversAdded} trang bìa theo cấu trúc tài liệu.`
        : 'Không có trang bìa nào được thêm.'
    });
  }

  if (outputNormalization?.frontMatterReordered === true) {
    cards.push({
      tone: 'info',
      title: 'Phần đầu tài liệu',
      description: 'Đã sắp xếp lại thứ tự phần đầu tài liệu.'
    });
  }

  if (compliance?.proposalSkipped === true) {
    cards.push({
      tone: 'info',
      title: 'Đề cương',
      description: 'Đề cương được giữ nguyên theo tùy chọn đã chọn.'
    });
  }

  if (structure?.hasAppendix === true || compliance?.appendixPreserved === true) {
    cards.push({
      tone: 'info',
      title: 'Phụ lục',
      description: 'Phần phụ lục được mặc định giữ nguyên cấu trúc và nội dung gốc.'
    });
  }

  const verifiedChecks = [
    compliance?.a4Portrait === true && 'khổ A4',
    compliance?.margins === true && 'lề trang',
    compliance?.headingStructure === true && 'cấu trúc tiêu đề'
  ].filter(Boolean);
  if (verifiedChecks.length) {
    cards.push({
      tone: 'success',
      title: 'Kiểm tra đầu ra',
      description: `Đã xác thực: ${verifiedChecks.join(', ')}.`
    });
  }

  const warnings = reportWarnings(structure, outputNormalization);
  if (warnings.length) {
    cards.push({
      tone: 'warning',
      title: 'Lưu ý cần xem lại',
      description: `Báo cáo đầu ra có ${warnings.length} lưu ý. Hãy mở tài liệu đã tải xuống để kiểm tra các vị trí liên quan.`
    });
  } else if (report && (structure || outputNormalization)) {
    cards.push({
      tone: 'success',
      title: 'Lưu ý',
      description: 'Báo cáo đầu ra không ghi nhận lưu ý cần xem lại.'
    });
  }

  const options = requestedOptions(choices);
  if (options.length) {
    cards.push({
      tone: 'muted',
      title: 'Tùy chọn đã gửi',
      description: options.join(' · ')
    });
  }

  return cards;
}

function getSafeDownloadUrl(result) {
  const candidate = typeof result?.downloadUrl === 'string' ? result.downloadUrl.trim() : '';
  if (!candidate) return null;
  try {
    const url = new URL(candidate, window.location.origin);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    const isRelativePath = candidate.startsWith('/') && !candidate.startsWith('//');
    if (url.origin !== window.location.origin && !isRelativePath) return null;
    return candidate;
  } catch {
    return null;
  }
}

export default function WordFmtPage() {
  const auth = useAuth();
  const { notify } = useToasts();
  const inputRef = useRef(null);
  const courseworkOptionsRef = useRef(null);

  const [file, setFile] = useState(null);
  const [documentType, setDocumentType] = useState('tieu_luan');
  const [instructor, setInstructor] = useState('');
  const [student, setStudent] = useState('');
  const [studentId, setStudentId] = useState('');
  const [className, setClassName] = useState('');
  const [topic, setTopic] = useState('');
  const [docTitle, setDocTitle] = useState('TIỂU LUẬN MÔN HỌC');
  const [institution, setInstitution] = useState('TRƯỜNG ĐẠI HỌC BÌNH DƯƠNG');
  const [faculty, setFaculty] = useState('KHOA CÔNG NGHỆ THÔNG TIN, ROBOT VÀ TRÍ TUỆ NHÂN TẠO');
  const [course, setCourse] = useState('');
  const [location, setLocation] = useState('Thành phố Hồ Chí Minh');
  const [mode, setMode] = useState('digital_document');
  const [month, setMonth] = useState('');
  const [year, setYear] = useState('');

  const [includeCover, setIncludeCover] = useState(true);
  const [includeComments, setIncludeComments] = useState(true);
  const [includeThanks, setIncludeThanks] = useState(true);
  const [onlyExistingCaptions, setOnlyExistingCaptions] = useState(true);
  const [skipProposal, setSkipProposal] = useState(false);

  const [run, setRun] = useState(() => getToolRun('wordfmt') || { status: 'idle', result: null });
  const [dismissedCompletedRun, setDismissedCompletedRun] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadDoneCount, setDownloadDoneCount] = useState(0);
  const [confirmUI, askConfirm] = useConfirm();

  // Google Docs Review Workspace & Direct Word Editing state (with bounded Undo/Redo)
  const [inReview, setInReview] = useState(false);
  const [skillOpen, setSkillOpen] = useState(false);
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [previewDirty, setPreviewDirty] = useState(false);
  const [editHistory, setEditHistory] = useState({
    current: INITIAL_DOC_STATE,
    past: [],
    future: [],
    lastCoalesceKey: null
  });
  const previewRequestRef = useRef(0);
  const insertSeqRef = useRef(0);

  const {
    roleOverrides,
    paragraphNotes,
    textEdits,
    deletedItems,
    insertedItems
  } = editHistory.current;
  const canUndo = editHistory.past.length > 0;
  const canRedo = editHistory.future.length > 0;

  const commitEdit = useCallback((updater, coalesceKey = null) => {
    setEditHistory((prev) => {
      const nextDoc = updater(prev.current);
      if (nextDoc === prev.current) return prev;
      const shouldCoalesce = Boolean(coalesceKey && prev.lastCoalesceKey === coalesceKey && prev.past.length > 0);
      return {
        current: nextDoc,
        past: shouldCoalesce ? prev.past : [...prev.past.slice(-49), prev.current],
        future: [],
        lastCoalesceKey: coalesceKey
      };
    });
  }, []);

  const coverInfo = useMemo(() => ({
    includeCover,
    documentType,
    documentMode: mode,
    institution,
    faculty,
    docTitle,
    topic,
    course,
    instructor,
    student,
    studentId,
    className,
    location,
    month,
    year
  }), [
    includeCover, documentType, mode, institution, faculty,
    docTitle, topic, course, instructor, student, studentId,
    className, location, month, year
  ]);

  const appendFormattingParams = useCallback((body, docState = INITIAL_DOC_STATE) => {
    const overridesMap = docState?.roleOverrides || {};
    const notesMap = docState?.paragraphNotes || {};
    const mutationsPayload = buildParagraphMutationsPayload(docState);

    const frontMatter = [
      includeCover && 'cover',
      includeComments && 'comments',
      includeThanks && 'thanks'
    ].filter(Boolean).join(',');

    body.append('documentType', documentType);
    body.append('documentMode', mode);
    body.append('instructor', instructor);
    body.append('student', student);
    if (studentId) body.append('studentId', studentId);
    if (className) body.append('className', className);
    if (topic) body.append('topic', topic);
    if (docTitle) body.append('documentTitle', docTitle);
    if (institution) body.append('institution', institution);
    if (faculty) body.append('faculty', faculty);
    if (course) body.append('course', course);
    if (location) body.append('location', location);
    if (month) body.append('month', month);
    if (year) body.append('year', year);

    body.append('includeCover', includeCover);
    body.append('includeComments', includeComments);
    body.append('includeThanks', includeThanks);
    body.append('frontMatter', frontMatter);
    body.append('onlyExistingCaptions', onlyExistingCaptions);
    body.append('skipProposal', skipProposal);

    if (overridesMap && Object.keys(overridesMap).length) {
      body.append('roleOverrides', JSON.stringify(overridesMap));
    }
    const cleanNotes = Object.fromEntries(
      Object.entries(notesMap || {})
        .map(([idx, note]) => [idx, String(note).trim()])
        .filter(([, note]) => note)
    );
    if (Object.keys(cleanNotes).length) {
      body.append('paragraphNotes', JSON.stringify(cleanNotes));
    }
    if (mutationsPayload) {
      body.append('paragraphMutations', JSON.stringify(mutationsPayload));
    }
  }, [
    includeCover, includeComments, includeThanks, documentType, mode,
    instructor, student, studentId, className, topic, docTitle,
    institution, faculty, course, location, month, year,
    onlyExistingCaptions, skipProposal
  ]);

  const loadPreview = useCallback(async (targetFile, docState = INITIAL_DOC_STATE) => {
    if (!targetFile || !auth.token) return;
    const requestId = ++previewRequestRef.current;
    setPreviewLoading(true);
    setPreviewError('');
    try {
      const body = new FormData();
      body.append('document', targetFile);
      body.append('renderDocument', 'true');
      appendFormattingParams(body, docState);
      const next = await previewDocxStructure(auth.token, body);
      if (requestId !== previewRequestRef.current) return;
      setPreview(next);
      setPreviewDirty(false);
      trackAction('wordfmt_preview', {
        label: 'Upload & xem trước cấu trúc Word',
        featureId: 'wordfmt',
        metadata: { documentType }
      });
    } catch (error) {
      if (requestId !== previewRequestRef.current) return;
      setPreviewError(error?.message || 'Không thể phân tích cấu trúc file.');
    } finally {
      if (requestId === previewRequestRef.current) setPreviewLoading(false);
    }
  }, [auth.token, appendFormattingParams, documentType]);

  useEffect(() => {
    previewRequestRef.current += 1;
    insertSeqRef.current = 0;
    setInReview(false);
    setPreview(null);
    setDownloadDoneCount(0);
    setPreviewError('');
    setPreviewDirty(false);
    setEditHistory({
      current: INITIAL_DOC_STATE,
      past: [],
      future: [],
      lastCoalesceKey: null
    });
    setPreviewLoading(false);
  }, [file]);

  const changeRole = useCallback((index, role) => {
    const keyStr = String(index);
    commitEdit((cur) => {
      const nextOverrides = { ...cur.roleOverrides };
      if (role) nextOverrides[index] = role;
      else {
        delete nextOverrides[index];
        delete nextOverrides[keyStr];
      }
      const nextInserts = keyStr.startsWith('ins_')
        ? cur.insertedItems.map((ins) => (String(ins.id) === keyStr ? { ...ins, role: role || 'body' } : ins))
        : cur.insertedItems;
      return {
        ...cur,
        roleOverrides: nextOverrides,
        insertedItems: nextInserts
      };
    });
    setPreviewDirty(true);
  }, [commitEdit]);

  const changeNote = useCallback((index, note) => {
    const keyStr = String(index);
    commitEdit((cur) => {
      const nextNotes = { ...cur.paragraphNotes };
      if (note && note.trim()) nextNotes[index] = note;
      else {
        delete nextNotes[index];
        delete nextNotes[keyStr];
      }
      return { ...cur, paragraphNotes: nextNotes };
    }, `note:${keyStr}`);
  }, [commitEdit]);

  const changeText = useCallback((index, nextText) => {
    const keyStr = String(index);
    const val = String(nextText ?? '');
    commitEdit((cur) => {
      const nextEdits = { ...cur.textEdits, [keyStr]: val };
      const nextInserts = keyStr.startsWith('ins_')
        ? cur.insertedItems.map((ins) => (String(ins.id) === keyStr ? { ...ins, text: val } : ins))
        : cur.insertedItems;
      return {
        ...cur,
        textEdits: nextEdits,
        insertedItems: nextInserts
      };
    }, `text:${keyStr}`);
    setPreviewDirty(true);
  }, [commitEdit]);

  const revertTextEdit = useCallback((index) => {
    const keyStr = String(index);
    commitEdit((cur) => {
      if (!Object.prototype.hasOwnProperty.call(cur.textEdits, keyStr)) return cur;
      const nextEdits = { ...cur.textEdits };
      delete nextEdits[keyStr];
      return { ...cur, textEdits: nextEdits };
    });
    setPreviewDirty(true);
  }, [commitEdit]);

  const insertParagraph = useCallback((anchorKey, position = 'after', initialText = '', role = 'body') => {
    const newId = `ins_${++insertSeqRef.current}`;
    const anchorStr = anchorKey !== undefined && anchorKey !== null ? String(anchorKey) : '';
    const entry = {
      id: newId,
      afterKey: position === 'after' ? anchorStr : '',
      beforeKey: position === 'before' ? anchorStr : '',
      text: String(initialText ?? ''),
      role: role || 'body'
    };
    commitEdit((cur) => ({
      ...cur,
      insertedItems: [...cur.insertedItems, entry]
    }));
    setPreviewDirty(true);
    return newId;
  }, [commitEdit]);

  const splitOrInsertAfter = useCallback((anchorKey, beforeText, afterText) => {
    const newId = `ins_${++insertSeqRef.current}`;
    const anchorStr = String(anchorKey);
    const leftVal = String(beforeText ?? '');
    const rightVal = String(afterText ?? '');
    commitEdit((cur) => {
      const nextEdits = { ...cur.textEdits, [anchorStr]: leftVal };
      const baseInserts = anchorStr.startsWith('ins_')
        ? cur.insertedItems.map((ins) => (String(ins.id) === anchorStr ? { ...ins, text: leftVal } : ins))
        : cur.insertedItems;
      return {
        ...cur,
        textEdits: nextEdits,
        insertedItems: [
          ...baseInserts,
          { id: newId, afterKey: anchorStr, beforeKey: '', text: rightVal, role: 'body' }
        ]
      };
    });
    setPreviewDirty(true);
    return newId;
  }, [commitEdit]);

  const deleteParagraph = useCallback((targetKey) => {
    const keyStr = String(targetKey);
    const wasServerRendered = Boolean(preview?.items?.some((it) => String(it.i) === keyStr));
    commitEdit((cur) => {
      if (keyStr.startsWith('ins_')) {
        const targetIns = cur.insertedItems.find((ins) => String(ins.id) === keyStr);
        const relinkedInserts = cur.insertedItems
          .filter((ins) => String(ins.id) !== keyStr)
          .map((ins) => {
            if (String(ins.afterKey) === keyStr && targetIns) {
              return { ...ins, afterKey: targetIns.afterKey || '', beforeKey: targetIns.beforeKey || '' };
            }
            if (String(ins.beforeKey) === keyStr && targetIns) {
              return { ...ins, afterKey: targetIns.afterKey || '', beforeKey: targetIns.beforeKey || '' };
            }
            return ins;
          });
        const nextEdits = { ...cur.textEdits };
        delete nextEdits[keyStr];
        const nextOverrides = { ...cur.roleOverrides };
        delete nextOverrides[keyStr];
        const nextNotes = { ...cur.paragraphNotes };
        delete nextNotes[keyStr];
        const nextDeletes = wasServerRendered && !cur.deletedItems.includes(keyStr)
          ? [...cur.deletedItems, keyStr]
          : cur.deletedItems;
        return {
          roleOverrides: nextOverrides,
          paragraphNotes: nextNotes,
          textEdits: nextEdits,
          deletedItems: nextDeletes,
          insertedItems: relinkedInserts
        };
      }
      if (cur.deletedItems.includes(keyStr)) return cur;
      return {
        ...cur,
        deletedItems: [...cur.deletedItems, keyStr]
      };
    });
    setPreviewDirty(true);
  }, [commitEdit, preview]);

  const undeleteParagraph = useCallback((targetKey) => {
    const keyStr = String(targetKey);
    commitEdit((cur) => ({
      ...cur,
      deletedItems: cur.deletedItems.filter((k) => String(k) !== keyStr)
    }));
    setPreviewDirty(true);
  }, [commitEdit]);

  const undo = useCallback(() => {
    setEditHistory((prev) => {
      if (!prev.past.length) return prev;
      const previous = prev.past[prev.past.length - 1];
      return {
        current: previous,
        past: prev.past.slice(0, -1),
        future: [prev.current, ...prev.future.slice(0, 49)],
        lastCoalesceKey: null
      };
    });
    setPreviewDirty(true);
  }, []);

  const redo = useCallback(() => {
    setEditHistory((prev) => {
      if (!prev.future.length) return prev;
      const [nextDoc, ...restFuture] = prev.future;
      return {
        current: nextDoc,
        past: [...prev.past.slice(-49), prev.current],
        future: restFuture,
        lastCoalesceKey: null
      };
    });
    setPreviewDirty(true);
  }, []);

  const resetCorrections = useCallback(() => {
    setEditHistory((prev) => ({
      current: INITIAL_DOC_STATE,
      past: [...prev.past.slice(-49), prev.current],
      future: [],
      lastCoalesceKey: null
    }));
    if (file) loadPreview(file, INITIAL_DOC_STATE);
  }, [file, loadPreview]);

  useEffect(() => {
    return subscribeToolRun('wordfmt', (next) => {
      setRun(next || { status: 'idle', result: null });
    });
  }, []);

  useEffect(() => {
    if (run.status === 'success') notify('Chuẩn hóa văn bản thành công!', 'success');
    if (run.status === 'error') notify(SAFE_ERROR_MESSAGE, 'error');
  }, [notify, run.status]);

  const isRunning = run.status === 'running';
  const isSuccess = run.status === 'success' && dismissedCompletedRun !== run;
  const isError = run.status === 'error';
  const downloadUrl = isSuccess ? getSafeDownloadUrl(run.result) : null;

  const selectFile = (candidate) => {
    if (!candidate) return;
    if (!candidate.name.toLowerCase().endsWith('.docx')) {
      notify('Vui lòng chọn file Word định dạng .docx', 'error');
      return;
    }
    setDismissedCompletedRun(run);
    setFile(candidate);
  };

  const fillFromStudentProfile = () => {
    const profileName = String(auth.user?.name || '').trim();
    const profileMssv = String(auth.user?.mssv || '').trim();
    if (profileName) setStudent(profileName);
    if (profileMssv) setStudentId(profileMssv);
    if (profileName || profileMssv) {
      notify('Đã điền tên và MSSV từ hồ sơ sinh viên của bạn.', 'info');
    }
  };

  const changeDocumentType = (nextType) => {
    if (nextType === 'do_an_tot_nghiep') {
      courseworkOptionsRef.current = { docTitle, includeCover, includeComments };
      setDocumentType(nextType);
      setDocTitle('ĐỒ ÁN TỐT NGHIỆP');
      setIncludeCover(true);
      setIncludeComments(true);
      setPreviewDirty(true);
      return;
    }

    const previous = courseworkOptionsRef.current;
    setDocumentType(nextType);
    setDocTitle(previous?.docTitle || 'TIỂU LUẬN MÔN HỌC');
    setIncludeCover(previous?.includeCover ?? true);
    setIncludeComments(previous?.includeComments ?? true);
    setPreviewDirty(true);
  };

  const openGoogleDocsReview = () => {
    if (!file) return;
    setInReview(true);
    if (!preview || previewDirty) {
      loadPreview(file, editHistory.current);
    }
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!file) {
      notify('Vui lòng chọn file .docx trước khi bắt đầu.', 'error');
      return;
    }
    if (!instructor.trim()) {
      notify('Vui lòng nhập tên Giảng Viên Hướng Dẫn.', 'error');
      return;
    }
    if (!student.trim()) {
      notify('Vui lòng nhập tên Sinh Viên / Nhóm.', 'error');
      return;
    }

    const studentWords = student.trim().split(/\s+/).filter(Boolean).length;
    const topicWords = topic.trim().split(/\s+/).filter(Boolean).length;

    let warningMsg = '';
    if (studentWords > 6 && topicWords > 40) {
      warningMsg = `Tên sinh viên vượt quá 6 từ (${studentWords} từ) và tên tiểu luận/đề tài vượt quá 40 từ (${topicWords} từ), khi xuất ra bìa có khả năng sẽ bị lỗi định dạng.`;
    } else if (studentWords > 6) {
      warningMsg = `Tên sinh viên vượt quá 6 từ (${studentWords} từ), khi xuất ra bìa có khả năng sẽ bị lỗi định dạng.`;
    } else if (topicWords > 40) {
      warningMsg = `Tên tiểu luận/đề tài vượt quá 40 từ (${topicWords} từ), khi xuất ra bìa có khả năng sẽ bị lỗi định dạng.`;
    }

    if (warningMsg) {
      const proceed = await askConfirm({
        title: 'Vẫn tiếp tục chuẩn hóa?',
        message: warningMsg,
        confirmText: 'Vẫn tiếp tục'
      });
      if (!proceed) return;
    }

    openGoogleDocsReview();
  };

  const confirmAndFormat = () => {
    if (!file || isRunning) return;
    const body = new FormData();
    body.append('document', file);
    appendFormattingParams(body, editHistory.current);

    setDismissedCompletedRun(null);
    setDownloadDoneCount(0);
    setInReview(false);
    trackAction('wordfmt_format', {
      label: 'Chạy chuẩn hóa file Word',
      featureId: 'wordfmt',
      metadata: { documentType, includeCover, includeComments, includeThanks }
    });
    startToolRun('wordfmt', () => formatDocx(auth.token, body), {
      stageCount: WORD_FMT_STAGES.length,
      summaryChoices: { includeCover, includeComments, includeThanks, onlyExistingCaptions, skipProposal }
    });
  };

  const progress = Math.min(100, Math.max(0, Number.isFinite(run.progress) ? run.progress : 0));
  const stageIndex = Math.min(
    WORD_FMT_STAGES.length - 1,
    Math.max(0, Number.isFinite(run.stageIndex) ? run.stageIndex : 0)
  );
  const activeStage = WORD_FMT_STAGES[stageIndex];

  const handleDownload = async (event) => {
    event?.preventDefault?.();
    if (!downloadUrl || !auth.token || downloading) return;
    setDownloading(true);
    try {
      const blob = await downloadWordFmt(auth.token, downloadUrl);
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = 'BDU_ChuanHoa.docx';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
      setDownloadDoneCount((n) => n + 1);
      trackAction('wordfmt_download', { label: 'Tải file Word đã chuẩn hóa', featureId: 'wordfmt' });
    } catch (error) {
      notify(error.message || 'Không thể tải file Word đã chuẩn hóa.', 'error');
    } finally {
      setDownloading(false);
    }
  };

  const currentStep = isSuccess || isRunning ? 3 : inReview ? 2 : 1;
  const inWorkspaceMode = Boolean(inReview && file && !isRunning && !isSuccess);

  return (
    <section id="tab-wordfmt" className={`tab-pane active wf-studio-page${inWorkspaceMode ? ' is-workspace-open' : ''}`}>
      {/* Studio Hero Header (compact hidden when full-screen Google Docs workspace is active) */}
      {!inWorkspaceMode ? (
        <div className="section-header-box glass-panel wf-studio-hero">
        <img className="brand-watermark" src="/assets/images/logo-bdu-eng.png" alt="" aria-hidden="true" />
        <div className="header-split wf-hero-split">
          <div>
            <div className="wf-hero-kicker-row">
              <span className="badge-mini badge-pill-emerald">BDU WordFmt Studio</span>
              <div className="wf-hero-stepper" aria-label="Tiến trình chuẩn hóa">
                {isSuccess ? (
                  <button
                    type="button"
                    className="wf-stepper-link is-done"
                    onClick={() => {
                      setDismissedCompletedRun(run);
                      setDownloadDoneCount(0);
                    }}
                    title="Quay lại biểu mẫu để chuẩn hóa tài liệu khác"
                  >
                    01 Nhập thông tin
                  </button>
                ) : (
                  <span className={currentStep === 1 ? 'is-active' : 'is-done'}>01 Nhập thông tin</span>
                )}
                <span aria-hidden="true">→</span>
                <span className={currentStep === 2 ? 'is-active' : currentStep > 2 ? 'is-done' : ''}>02 Review Google Docs</span>
                <span aria-hidden="true">→</span>
                <span className={currentStep === 3 ? 'is-active' : ''}>03 Xuất &amp; Tải về</span>
              </div>
            </div>
            <h2 className="section-title">Chuẩn Hóa Văn Bản Word (BDU WordFmt)</h2>
            <p className="section-desc">
              Định dạng tự động khổ A4, Heading 1–4, mục lục, bảng/hình, công thức OMML và xem trước trang giấy thực tế kiểu Google Docs
            </p>
          </div>

          <div className="wf-header-badges">
            <button
              type="button"
              className="wf-skill-trigger"
              onClick={() => setSkillOpen(true)}
            >
              ✨ Skill / Prompt cho AI
            </button>
          </div>
        </div>
      </div>
      ) : null}

      {/* Mode A: Google Docs Review Workspace (Pre-format interactive editing & inspection) */}
      {inWorkspaceMode ? (
        <DocxReviewWorkspace
          stage="review"
          fileName={file.name}
          coverInfo={coverInfo}
          preview={preview}
          loading={previewLoading}
          error={previewError}
          dirty={previewDirty}
          isSubmitting={isRunning}
          overrides={roleOverrides}
          notes={paragraphNotes}
          textEdits={textEdits}
          deletedItems={deletedItems}
          insertedItems={insertedItems}
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={undo}
          onRedo={redo}
          onRoleChange={changeRole}
          onNoteChange={changeNote}
          onTextChange={changeText}
          onSplitOrInsertAfter={splitOrInsertAfter}
          onInsertParagraph={insertParagraph}
          onDeleteParagraph={deleteParagraph}
          onUndeleteParagraph={undeleteParagraph}
          onRevertTextEdit={revertTextEdit}
          onRefresh={() => loadPreview(file, editHistory.current)}
          onReset={resetCorrections}
          onBack={() => setInReview(false)}
          onConfirm={confirmAndFormat}
        />
      ) : (isRunning || isSuccess) ? (
        /* Mode B: Focused BDU Impact VFX Progress Stage & Single Download Action on Completion */
        <div
          id="wordfmt-status-card"
          className={`glass-panel wf-vfx-stage${isSuccess ? ' is-complete' : ' is-running'}`}
          aria-live="polite"
        >
          <div id="wordfmt-progress-box" className="wf-vfx-progress-shell">
            <p className="wf-vfx-eyebrow">
              {isSuccess ? 'WORD_FMT · HOÀN TẤT CHUẨN HÓA' : 'WORD_FMT · ĐANG XỬ LÝ VĂN BẢN'}
            </p>
            <h3 id="wordfmt-progress-title" className="wf-vfx-title">
              {isSuccess ? 'Văn bản đã được chuẩn hóa 100%' : activeStage.inProgress}
            </h3>
            <p id="wordfmt-progress-desc" className="wf-vfx-desc">
              {isSuccess
                ? 'Tài liệu chuẩn A4 BDU của bạn đã sẵn sàng.'
                : activeStage.description}
            </p>

            <div className="wf-vfx-bar-host">
              <ImpactProgress
                progress={progress}
                label={activeStage.inProgress}
                doneLabel="Hoàn tất 100% ✓"
                isComplete={isSuccess}
              />
            </div>

            {isSuccess ? (
              <div className="wf-vfx-download-wrap">
                {downloadUrl ? (
                  <ImpactButton
                    id="btn-download-docx"
                    tone="primary"
                    className="btn btn-primary wf-vfx-download-btn"
                    disabled={downloading}
                    doneTrigger={downloadDoneCount}
                    onClick={handleDownload}
                  >
                    {downloading ? 'Đang tải…' : 'Tải Về File DOCX Đã Chuẩn Hóa'}
                  </ImpactButton>
                ) : (
                  <p className="wf-status-download-unavailable" role="status">
                    Tài liệu đã hoàn tất nhưng liên kết tải xuống chưa khả dụng. Vui lòng thử lại.
                  </p>
                )}
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        /* Mode C: Clean Single-Column Input Form (opens Google Docs Workspace on submit) */
        <div className="wf-studio-single">
          {isError ? (
            <div id="wordfmt-error-box" className="glass-panel wf-status-error wf-error-banner" role="alert">
              <div className="wf-status-error-icon" aria-hidden="true">!</div>
              <div>
                <p className="wf-status-eyebrow">WORD_FMT · CẦN THỬ LẠI</p>
                <h3 className="wf-status-title">Chưa thể hoàn tất chuẩn hóa</h3>
                <p className="wf-status-error-description">{SAFE_ERROR_MESSAGE}</p>
                <p className="wf-status-error-hint">File gốc của bạn không bị thay đổi. Kiểm tra lại file DOCX hoặc kết nối rồi bấm bắt đầu để thử lại.</p>
              </div>
            </div>
          ) : null}

          <div className="wordfmt-card glass-panel wf-studio-form-card">
            <form id="form-wordfmt" onSubmit={submit}>
              {/* Section 01: File & Document Mode */}
              <div className="wf-form-section">
                <div className="wf-form-section-head">
                  <span className="wf-sec-num">01</span>
                  <div>
                    <h3>Tệp nguồn &amp; Loại báo cáo</h3>
                    <p>Tải lên bản thảo <code>.docx</code> và chọn quy chuẩn trình bày của Khoa/Viện.</p>
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Chọn hoặc Kéo Thả File Tiểu Luận / Đồ Án (.docx):</label>
                  <div
                    id="docx-dropzone"
                    className={`dropzone-box${file ? ' has-file' : ''}`}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      selectFile(e.dataTransfer.files?.[0]);
                    }}
                    onClick={() => !file && inputRef.current?.click()}
                    style={{ cursor: file ? 'default' : 'pointer' }}
                  >
                    <input
                      ref={inputRef}
                      type="file"
                      id="docx-file-input"
                      accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                      className="hidden-file-input"
                      onChange={(e) => selectFile(e.target.files?.[0])}
                      style={{ display: 'none' }}
                    />
                    {!file ? (
                      <div className="dropzone-content">
                        <h4 className="dropzone-title">Kéo &amp; Thả file .docx vào đây</h4>
                        <p className="dropzone-subtitle">
                          hoặc <span className="text-blue cursor-pointer">Bấm để chọn file từ máy tính</span>
                        </p>
                        <span className="dropzone-hint">Dung lượng tối đa 25MB (.docx)</span>
                      </div>
                    ) : (
                      <div id="dropzone-file-info" className="file-info-badge">
                        <span id="selected-file-name" className="file-name">{file.name}</span>
                        <span className="wf-file-size">
                          ({(file.size / 1024).toFixed(1)} KB)
                        </span>
                        <button
                          type="button"
                          id="btn-remove-file"
                          className="btn-remove-file"
                          title="Xóa file"
                          onClick={(e) => {
                            e.stopPropagation();
                            setFile(null);
                          }}
                        >
                          ✕
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                <div className="form-row-2">
                  <div className="form-group">
                    <label htmlFor="wf-document-type" className="form-label">Loại tài liệu:</label>
                    <select
                      id="wf-document-type"
                      className="form-input"
                      value={documentType}
                      onChange={(e) => changeDocumentType(e.target.value)}
                    >
                      <option value="tieu_luan">Tiểu luận môn học</option>
                      <option value="do_an_tot_nghiep">Đồ án tốt nghiệp</option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label htmlFor="wf-document-mode" className="form-label">Chế độ tài liệu:</label>
                    <select
                      id="wf-document-mode"
                      className="form-input"
                      value={mode}
                      onChange={(e) => {
                        setMode(e.target.value);
                        setPreviewDirty(true);
                      }}
                    >
                      <option value="digital_document">Tài liệu số (Nộp Moodle/Online)</option>
                      <option value="binding_package">
                        {documentType === 'do_an_tot_nghiep'
                          ? 'Bản phục vụ đóng quyển (giữ hai trang bìa)'
                          : 'Bản phục vụ đóng quyển (2 trang bìa: bìa chính & bìa phụ)'}
                      </option>
                    </select>
                  </div>
                </div>

                <p id="wf-document-type-hint" className="dropzone-hint" aria-live="polite">
                  {documentType === 'do_an_tot_nghiep'
                    ? 'Chuẩn hóa đầu đề cương, giữ nguyên khung nội dung và ký duyệt; bổ sung hai trang nhận xét theo mẫu đồ án.'
                    : 'Định dạng tiểu luận theo cấu hình hiện tại.'}
                  {' · '}
                  <span id="wf-binding-hint">
                    {mode === 'binding_package'
                      ? (documentType === 'do_an_tot_nghiep'
                        ? 'Đồ án có hai trang bìa ở cả hai chế độ xuất.'
                        : 'In một mặt A4, bìa cứng xanh dương.')
                      : 'Bản số tiêu chuẩn.'}
                  </span>
                </p>
              </div>

              {/* Section 02: Cover Identity Metadata */}
              <div className="wf-form-section">
                <div className="wf-form-section-head wf-form-section-head--split">
                  <div className="wf-form-section-head-left">
                    <span className="wf-sec-num">02</span>
                    <div>
                      <h3>Thông tin định danh trên bìa</h3>
                      <p>Điền thông tin GVHD, sinh viên và tên đề tài để dựng bìa &amp; footer tự động.</p>
                    </div>
                  </div>
                  {(auth.user?.name || auth.user?.mssv) ? (
                    <button
                      type="button"
                      className="wf-autofill-pill"
                      onClick={fillFromStudentProfile}
                    >
                      + Điền tên &amp; MSSV của tôi
                    </button>
                  ) : null}
                </div>

                <div className="form-row-2">
                  <div className="form-group">
                    <label htmlFor="wf-instructor" className="form-label">
                      Giảng Viên Hướng Dẫn (GVHD): <span className="required">*</span>
                    </label>
                    <input
                      type="text"
                      id="wf-instructor"
                      className="form-input"
                      placeholder="Ví dụ: ThS. Nguyễn Văn A"
                      value={instructor}
                      onChange={(e) => { setInstructor(e.target.value); setPreviewDirty(true); }}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="wf-student" className="form-label">
                      Tên Sinh Viên / Nhóm: <span className="required">*</span>
                    </label>
                    <input
                      type="text"
                      id="wf-student"
                      className="form-input"
                      placeholder="Nhập họ tên sinh viên hoặc tên nhóm"
                      value={student}
                      onChange={(e) => { setStudent(e.target.value); setPreviewDirty(true); }}
                      required
                    />
                    {student.trim().split(/\s+/).filter(Boolean).length > 6 ? (
                      <p className="dropzone-hint wf-inline-warn">
                        ⚠️ Tên sinh viên dài hơn 6 từ ({student.trim().split(/\s+/).filter(Boolean).length} từ). Có thể gây lệch bố cục trang bìa.
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="form-row-2">
                  <div className="form-group">
                    <label htmlFor="wf-student-id" className="form-label">Mã Số Sinh Viên (MSSV):</label>
                    <input
                      type="text"
                      id="wf-student-id"
                      className="form-input"
                      placeholder="Ví dụ: 2405xxxx"
                      value={studentId}
                      onChange={(e) => { setStudentId(e.target.value); setPreviewDirty(true); }}
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="wf-class-name" className="form-label">Lớp Sinh Hoạt:</label>
                    <input
                      type="text"
                      id="wf-class-name"
                      className="form-input"
                      placeholder="Ví dụ: 2405SE01"
                      value={className}
                      onChange={(e) => { setClassName(e.target.value); setPreviewDirty(true); }}
                    />
                  </div>
                </div>

                <div className="form-row-2">
                  <div className="form-group">
                    <label htmlFor="wf-topic" className="form-label">Tên Đề Tài / Báo Cáo:</label>
                    <input
                      type="text"
                      id="wf-topic"
                      className="form-input"
                      placeholder="Ví dụ: Xây dựng hệ thống quản lý học tập"
                      value={topic}
                      onChange={(e) => { setTopic(e.target.value); setPreviewDirty(true); }}
                    />
                    {topic.trim().split(/\s+/).filter(Boolean).length > 40 ? (
                      <p className="dropzone-hint wf-inline-warn">
                        ⚠️ Tên đề tài dài hơn 40 từ ({topic.trim().split(/\s+/).filter(Boolean).length} từ). Có thể gây lệch bố cục trang bìa.
                      </p>
                    ) : null}
                  </div>
                  <div className="form-group">
                    <label htmlFor="wf-doc-title" className="form-label">Tiêu Đề Bìa:</label>
                    <input
                      type="text"
                      id="wf-doc-title"
                      className="form-input"
                      placeholder="TIỂU LUẬN MÔN HỌC"
                      value={docTitle}
                      onChange={(e) => { setDocTitle(e.target.value); setPreviewDirty(true); }}
                      readOnly={documentType === 'do_an_tot_nghiep'}
                    />
                  </div>
                </div>

                <details className="wordfmt-cover-options">
                  <summary className="wf-details-summary">Tùy chỉnh Đơn vị đào tạo, Môn học &amp; Thời gian trên bìa</summary>
                  <div className="wf-details-body">
                    <div className="form-row-2">
                      <div className="form-group">
                        <label htmlFor="wf-institution" className="form-label">Trường:</label>
                        <input
                          type="text"
                          id="wf-institution"
                          className="form-input"
                          value={institution}
                          onChange={(e) => { setInstitution(e.target.value); setPreviewDirty(true); }}
                        />
                      </div>
                      <div className="form-group">
                        <label htmlFor="wf-faculty" className="form-label">Khoa / Viện:</label>
                        <input
                          type="text"
                          id="wf-faculty"
                          className="form-input"
                          value={faculty}
                          onChange={(e) => { setFaculty(e.target.value); setPreviewDirty(true); }}
                        />
                      </div>
                    </div>

                    <div className="form-row-2">
                      <div className="form-group">
                        <label htmlFor="wf-course" className="form-label">Tên môn học (nếu cần trên bìa):</label>
                        <input
                          type="text"
                          id="wf-course"
                          className="form-input"
                          placeholder="Để trống nếu bìa không yêu cầu"
                          value={course}
                          onChange={(e) => { setCourse(e.target.value); setPreviewDirty(true); }}
                        />
                      </div>
                      <div className="form-group">
                        <label htmlFor="wf-location" className="form-label">Địa điểm:</label>
                        <input
                          type="text"
                          id="wf-location"
                          className="form-input"
                          value={location}
                          onChange={(e) => { setLocation(e.target.value); setPreviewDirty(true); }}
                        />
                      </div>
                    </div>

                    <div className="form-row-2">
                      <div className="form-group">
                        <label htmlFor="wf-month" className="form-label">Tháng trên bìa:</label>
                        <input
                          type="text"
                          id="wf-month"
                          className="form-input"
                          inputMode="numeric"
                          placeholder={`Mặc định: tháng ${new Date().getMonth() + 1}`}
                          value={month}
                          onChange={(e) => { setMonth(e.target.value); setPreviewDirty(true); }}
                        />
                      </div>
                      <div className="form-group">
                        <label htmlFor="wf-year" className="form-label">Năm trên bìa:</label>
                        <input
                          type="text"
                          id="wf-year"
                          className="form-input"
                          inputMode="numeric"
                          placeholder={`Mặc định: năm ${new Date().getFullYear()}`}
                          value={year}
                          onChange={(e) => { setYear(e.target.value); setPreviewDirty(true); }}
                        />
                      </div>
                    </div>
                  </div>
                </details>
              </div>

              {/* Section 03: Front-Matter & Advanced Options */}
              <div className="wf-form-section">
                <div className="wf-form-section-head">
                  <span className="wf-sec-num">03</span>
                  <div>
                    <h3>Trang đầu (Front-Matter) &amp; Quy tắc nâng cao</h3>
                    <p>Chọn thành phần tự động sinh và cách bảo toàn bảng biểu/đề cương.</p>
                  </div>
                </div>

                <div className="features-checklist wf-checklist-grid wf-checklist-grid--2col">
                  <label className="feature-item">
                    <input
                      type="checkbox"
                      id="wf-include-cover"
                      checked={includeCover}
                      onChange={(e) => { setIncludeCover(e.target.checked); setPreviewDirty(true); }}
                      disabled={documentType === 'do_an_tot_nghiep'}
                    />
                    <span id="wf-cover-label">
                      <strong>{documentType === 'do_an_tot_nghiep' ? 'Hai trang bìa:' : 'Trang bìa:'}</strong>{' '}
                      {documentType === 'do_an_tot_nghiep'
                        ? 'Bìa chính và bìa phụ; chỉ thêm bìa còn thiếu.'
                        : 'Khung viền chuẩn BDU, Logo, đề tài, GVHD, SVTH, Lớp, MSSV'}
                    </span>
                  </label>

                  <label className="feature-item">
                    <input
                      type="checkbox"
                      id="wf-include-comments"
                      checked={includeComments}
                      onChange={(e) => { setIncludeComments(e.target.checked); setPreviewDirty(true); }}
                      disabled={documentType === 'do_an_tot_nghiep'}
                    />
                    <span id="wf-comments-label">
                      <strong>{documentType === 'do_an_tot_nghiep' ? 'Hai trang nhận xét:' : 'Nhận xét giảng viên:'}</strong>{' '}
                      {documentType === 'do_an_tot_nghiep'
                        ? 'Giảng viên hướng dẫn và giảng viên phản biện, có chỗ ký tên.'
                        : 'Trang 20 dòng chấm tab-leader để giảng viên ghi nhận xét'}
                    </span>
                  </label>

                  <label className="feature-item">
                    <input
                      type="checkbox"
                      id="wf-include-thanks"
                      checked={includeThanks}
                      onChange={(e) => { setIncludeThanks(e.target.checked); setPreviewDirty(true); }}
                    />
                    <span><strong>Lời cảm ơn:</strong> Đặt trước Mục lục, bảo toàn khối chữ ký bên phải</span>
                  </label>

                  <label className="feature-item">
                    <input type="checkbox" checked disabled />
                    <span><strong>Mục lục &amp; Danh mục Bảng/Hình:</strong> Tự động tạo và đánh số trang chuẩn BDU</span>
                  </label>

                  <label className="feature-item">
                    <input
                      type="checkbox"
                      id="wf-only-existing-captions"
                      checked={onlyExistingCaptions}
                      onChange={(e) => { setOnlyExistingCaptions(e.target.checked); setPreviewDirty(true); }}
                    />
                    <span id="wf-only-existing-captions-label">
                      <strong>Chỉ định dạng Bảng và Hình đã có sẵn:</strong> Không tự chèn caption giữ chỗ vào bảng layout
                    </span>
                  </label>

                  <label className="feature-item">
                    <input
                      type="checkbox"
                      id="wf-skip-proposal"
                      checked={skipProposal}
                      onChange={(e) => { setSkipProposal(e.target.checked); setPreviewDirty(true); }}
                    />
                    <span id="wf-skip-proposal-label">
                      <strong>Bỏ qua định dạng đề cương:</strong> Giữ nguyên hoàn toàn vùng đề cương đầu tài liệu
                    </span>
                  </label>
                </div>
              </div>

              <div className="wf-form-submit-wrap">
                <ImpactButton
                  type="submit"
                  id="btn-start-wordfmt"
                  tone="primary"
                  className="btn btn-primary wf-studio-submit-vfx"
                  disabled={isRunning}
                >
                  {isRunning ? 'Đang chuẩn hóa…' : 'Tiếp tục · Bắt đầu chuẩn hóa văn bản →'}
                </ImpactButton>
              </div>
            </form>

            <AiSkillPanel
              info={coverInfo}
              open={skillOpen}
              onToggle={() => setSkillOpen((prev) => !prev)}
              onClose={() => setSkillOpen(false)}
              onNotify={notify}
            />
          </div>
        </div>
      )}

      {confirmUI}
    </section>
  );
}
