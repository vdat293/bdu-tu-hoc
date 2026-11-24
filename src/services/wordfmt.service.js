/**
 * WordFmt Integration Service
 * Formats DOCX files based on BDU / tieu_luan profile using WordFmt C# binary
 */

import { execFile } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { AsyncQueue } from '../utils/async-queue.js';
import AdmZip from 'adm-zip';
import {
  analyzeDocxStructure, formatStructuredDocx, applyRoleOverrides, applyParagraphNotes, applyParagraphMutations, buildStructurePreview, ROLE_OVERRIDE_KEYS
} from '../utils/docx-structure.js';
import {
  stampSourceParagraphBookmarks,
  buildRenderedDocxPreview
} from '../utils/docx-preview-renderer.js';
import {
  normalizeFormattedDocx,
  normalizeSourceLists
} from '../utils/docx-postprocessor.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../../');
const TEMP_DIR = path.join(ROOT_DIR, 'temp');
const PROFILES_DIR = path.join(ROOT_DIR, 'profiles');
const DLL_PATH = path.join(ROOT_DIR, 'bin', 'wordfmt', 'wordfmt.dll');
const outputOwners = new Map();

function rememberOutputOwner(outputFile, ownerMssv) {
  const owner = String(ownerMssv || '').trim().toUpperCase();
  if (owner) outputOwners.set(path.basename(outputFile), owner);
}

const MAX_ROLE_OVERRIDES = 5000;

/**
 * Accepts a JSON string or object { "<paragraphIndex>": "<roleKey>|auto" } and
 * returns a sanitized plain object. Unknown keys/roles are dropped.
 */
const VALID_PARAGRAPH_KEY_RE = /^(?:\d{1,6}|ins_[a-zA-Z0-9_-]{1,32})$/;

export function normalizeRoleOverrides(raw) {
  if (!raw) return {};
  let value = raw;
  if (typeof raw === 'string') {
    try { value = JSON.parse(raw); } catch { throw new Error('Dữ liệu chỉnh sửa cấu trúc không hợp lệ.'); }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result = {};
  for (const [index, role] of Object.entries(value).slice(0, MAX_ROLE_OVERRIDES)) {
    if (!VALID_PARAGRAPH_KEY_RE.test(index)) continue;
    if (role !== 'auto' && !ROLE_OVERRIDE_KEYS.includes(role)) continue;
    result[index] = role;
  }
  return result;
}

export function normalizeParagraphNotes(raw) {
  if (!raw) return {};
  let value = raw;
  if (typeof raw === 'string') {
    try { value = JSON.parse(raw); } catch { throw new Error('Dữ liệu ghi chú không hợp lệ.'); }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result = {};
  for (const [index, note] of Object.entries(value).slice(0, 500)) {
    const text = typeof note === 'string' ? note.trim().slice(0, 1000) : '';
    if (VALID_PARAGRAPH_KEY_RE.test(index) && text) result[index] = text;
  }
  return result;
}

export function normalizeParagraphMutations(raw) {
  const empty = { edits: {}, deletes: [], inserts: [], count: 0 };
  if (!raw) return empty;
  let value = raw;
  if (typeof raw === 'string') {
    try { value = JSON.parse(raw); } catch { throw new Error('Dữ liệu chỉnh sửa nội dung không hợp lệ.'); }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return empty;

  const edits = {};
  if (value.edits && typeof value.edits === 'object' && !Array.isArray(value.edits)) {
    for (const [key, text] of Object.entries(value.edits).slice(0, 3000)) {
      if (!VALID_PARAGRAPH_KEY_RE.test(key) || typeof text !== 'string') continue;
      edits[key] = text.slice(0, 20000);
    }
  }

  const deletes = [];
  if (Array.isArray(value.deletes)) {
    const seen = new Set();
    for (const rawKey of value.deletes.slice(0, 3000)) {
      const k = String(rawKey || '').trim();
      if (VALID_PARAGRAPH_KEY_RE.test(k) && !seen.has(k)) {
        seen.add(k);
        deletes.push(k);
      }
    }
  }

  const inserts = [];
  if (Array.isArray(value.inserts)) {
    const seenIds = new Set();
    for (const item of value.inserts.slice(0, 2000)) {
      if (!item || typeof item !== 'object') continue;
      const id = String(item.id || '').trim();
      if (!/^ins_[a-zA-Z0-9_-]{1,32}$/.test(id) || seenIds.has(id)) continue;
      seenIds.add(id);
      const afterKey = item.afterKey !== undefined && item.afterKey !== null ? String(item.afterKey).trim() : '';
      const beforeKey = item.beforeKey !== undefined && item.beforeKey !== null ? String(item.beforeKey).trim() : '';
      const role = ROLE_OVERRIDE_KEYS.includes(item.role) ? item.role : 'body';
      const text = typeof item.text === 'string' ? item.text.slice(0, 20000) : '';
      inserts.push({
        id,
        afterKey: VALID_PARAGRAPH_KEY_RE.test(afterKey) ? afterKey : '',
        beforeKey: VALID_PARAGRAPH_KEY_RE.test(beforeKey) ? beforeKey : '',
        role,
        text
      });
    }
  }

  const count = Object.keys(edits).length + deletes.length + inserts.length;
  return { edits, deletes, inserts, count };
}

function withRoleOverrides(inputPath, overrides, targetPath, notes = {}, mutations = null) {
  const hasMutations = Boolean(mutations && mutations.count > 0);
  if (!Object.keys(overrides).length && !Object.keys(notes).length && !hasMutations) return inputPath;
  const archive = new AdmZip(inputPath);
  applyRoleOverrides(archive, overrides);
  applyParagraphNotes(archive, notes);
  if (hasMutations) {
    applyParagraphMutations(archive, { ...mutations, roleOverrides: overrides });
  }
  archive.writeZip(targetPath);
  return targetPath;
}

// Concurrency Queue: max 3 concurrent dotnet processes by default (configurable via env)
const MAX_CONCURRENCY = parseInt(process.env.WORDFMT_CONCURRENCY || '3', 10);
const wordFmtQueue = new AsyncQueue({
  concurrency: MAX_CONCURRENCY,
  name: 'WordFmtQueue'
});

// Ensure temp directory exists
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

export const WordFmtService = {
  /**
   * Format an uploaded DOCX file matching 100% the WPF GUI parameters
   * @param {Object} params
   * @param {string} params.inputPath - Path to uploaded .docx file
   * @param {string} params.instructor - Name of instructor (GVHD)
   * @param {string} params.student - Student name or group name
   * @param {string} [params.studentId] - Student MSSV
   * @param {string} [params.topic] - Topic Title (Tên đề tài)
   * @param {string} [params.className] - Class Name (Tên lớp)
   * @param {string} [params.documentTitle] - Document title (Tiểu luận môn học)
   * @param {string} [params.institution] - Institution displayed on the cover
   * @param {string} [params.faculty] - Faculty displayed on the cover
   * @param {string} [params.course] - Optional course name displayed on the cover
   * @param {string} [params.location] - Location displayed on the cover
   * @param {string} [params.month] - Month displayed on the cover
   * @param {string} [params.year] - Year displayed on the cover
   * @param {string} [params.ownerMssv] - BDU MSSV đã xác minh, dùng cho ownership của output
   * @param {'digital_document'|'binding_package'} [params.documentMode]
   * @param {string} [params.frontMatter] - Comma separated front matter: cover,comments,thanks
   * @param {string} [params.profile] - Profile name (defaults to tieu_luan.json)
   * @param {'tieu_luan'|'do_an_tot_nghiep'} [params.documentType] - Document family, independent of print mode
   */
  async formatDocx({
    inputPath,
    instructor,
    student,
    studentId = '',
    topic = '',
    className = '',
    documentTitle = 'TIỂU LUẬN MÔN HỌC',
    institution = '',
    institute = '',
    faculty = '',
    course = '',
    location = '',
    month = '',
    year = '',
    ownerMssv = '',
    documentMode = 'digital_document',
    documentType = 'tieu_luan',
    frontMatter = 'cover,comments,thanks',
    profile = 'tieu_luan.json',
    // Safe default for uploaded academic documents. Callers can opt in to
    // placeholder insertion explicitly when they are preparing a new draft.
    onlyExistingCaptions = true,
    skipProposal = false,
    roleOverrides = {},
    paragraphNotes = {},
    paragraphMutations = null
  }) {
    if (!['tieu_luan', 'do_an_tot_nghiep'].includes(documentType)) {
      throw new Error('Loại tài liệu không hợp lệ.');
    }
    if (documentType === 'do_an_tot_nghiep') {
      profile = 'do_an_tot_nghiep.json';
      documentTitle = 'ĐỒ ÁN TỐT NGHIỆP';
    }
    if (!fs.existsSync(inputPath)) {
      throw new Error('Không tìm thấy file tải lên.');
    }

    if (!instructor || !instructor.trim()) {
      throw new Error('Vui lòng nhập tên Giảng viên hướng dẫn.');
    }

    if (!student || !student.trim()) {
      throw new Error('Vui lòng nhập Tên sinh viên hoặc Tên nhóm.');
    }

    const id = Date.now() + '_' + Math.random().toString(36).substring(2, 8);
    const outputPath = path.join(TEMP_DIR, `formatted_${id}.docx`);
    const preparedInputPath = path.join(TEMP_DIR, `prepared_${id}.docx`);
    const reportPath = path.join(TEMP_DIR, `report_${id}.json`);
    const baseProfilePath = path.join(PROFILES_DIR, path.basename(profile));
    const runtimeProfilePath = path.join(TEMP_DIR, `profile_${id}.json`);

    if (!fs.existsSync(baseProfilePath)) {
      throw new Error('Không tìm thấy profile định dạng được yêu cầu.');
    }

    const runtimeProfile = JSON.parse(fs.readFileSync(baseProfilePath, 'utf8'));
    if (runtimeProfile.heading_rules_file) {
      runtimeProfile.heading_rules_file = path.join(
        PROFILES_DIR,
        path.basename(runtimeProfile.heading_rules_file)
      );
    }
    runtimeProfile.cover = { ...(runtimeProfile.cover || {}) };
    if (institution.trim()) runtimeProfile.cover.institution = institution.trim();
    if (institute.trim()) runtimeProfile.cover.institute = institute.trim();
    if (faculty.trim()) runtimeProfile.cover.faculty = faculty.trim();
    if (course.trim()) runtimeProfile.cover.course = course.trim();
    if (location.trim()) runtimeProfile.cover.location = location.trim();
    runtimeProfile.document_modes = {
      ...(runtimeProfile.document_modes || {}),
      default: documentMode === 'binding_package' ? 'binding_package' : 'digital_document'
    };
    const structure = analyzeDocxStructure(inputPath);
    if (documentType === 'do_an_tot_nghiep' || documentType === 'tieu_luan' || structure.requiresStructuredFormatting || onlyExistingCaptions || skipProposal) {
      return wordFmtQueue.enqueue(async () => {
        const overridePath = path.join(TEMP_DIR, `overrides_${id}.docx`);
        try {
          const overrides = normalizeRoleOverrides(roleOverrides);
          const notes = normalizeParagraphNotes(paragraphNotes);
          const mutations = normalizeParagraphMutations(paragraphMutations);
          const sourcePath = withRoleOverrides(inputPath, overrides, overridePath, notes, mutations);
          const sourceStructure = sourcePath === inputPath ? structure : analyzeDocxStructure(sourcePath);
          const result = formatStructuredDocx(sourcePath, outputPath, {
            profile: runtimeProfile, instructor, student, studentId, topic, className,
            documentTitle, institution, institute, faculty, course, location, month, year,
            documentMode, documentType, frontMatter,
            onlyExistingCaptions, skipProposal
          }, sourceStructure);
          if (result.report?.structure) {
            result.report.structure.manualRoleOverrides = Object.keys(overrides).length;
            result.report.structure.manualNotes = Object.keys(notes).length;
            result.report.structure.manualContentEdits = mutations.count;
          }
          rememberOutputOwner(path.basename(outputPath), ownerMssv);
          return { ...result, outputFile: path.basename(outputPath), stdout: '' };
        } finally {
          try { if (fs.existsSync(overridePath)) fs.unlinkSync(overridePath); } catch { /* best effort */ }
        }
      });
    }
    fs.writeFileSync(runtimeProfilePath, JSON.stringify(runtimeProfile, null, 2));

    let sourceListNormalization;
    try {
      sourceListNormalization = normalizeSourceLists(inputPath, preparedInputPath);
    } catch (listError) {
      console.error('Source list normalization error:', listError);
      try {
        if (fs.existsSync(runtimeProfilePath)) fs.unlinkSync(runtimeProfilePath);
      } catch (cleanupError) {
        console.warn('Failed to clean runtime profile:', cleanupError);
      }
      throw new Error('Không thể chuẩn hóa danh sách trong DOCX đầu vào.');
    }

    const cleanupWorkingFiles = () => {
      try {
        if (fs.existsSync(preparedInputPath)) fs.unlinkSync(preparedInputPath);
        if (fs.existsSync(runtimeProfilePath)) fs.unlinkSync(runtimeProfilePath);
        if (fs.existsSync(reportPath)) fs.unlinkSync(reportPath);
      } catch (cleanupError) {
        console.warn('Failed to clean WordFmt working files:', cleanupError);
      }
    };

    const args = [
      DLL_PATH,
      'format',
      preparedInputPath,
      '--output', outputPath,
      '--instructor', instructor.trim(),
      '--student', student.trim(),
      '--profile', runtimeProfilePath,
      '--report', reportPath
    ];

    if (studentId && studentId.trim()) {
      args.push('--student-id', studentId.trim());
    }

    if (topic && topic.trim()) {
      args.push('--topic', topic.trim());
    }

    if (className && className.trim()) {
      args.push('--class-name', className.trim());
    }

    if (documentTitle && documentTitle.trim()) {
      args.push('--document-title', documentTitle.trim());
    }

    if (frontMatter && frontMatter.trim()) {
      args.push('--front-matter', frontMatter.trim());
    }

    return wordFmtQueue.enqueue(() => {
      return new Promise((resolve, reject) => {
        execFile('dotnet', args, { cwd: ROOT_DIR }, (error, stdout, stderr) => {
          let reportData = null;
          if (fs.existsSync(reportPath)) {
            try {
              reportData = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
            } catch (e) {
              console.error('Failed to parse report JSON:', e);
            }
          }

          if (error && (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0)) {
            console.error('WordFmt error:', stderr || stdout || error.message);
            cleanupWorkingFiles();
            return reject(new Error(stderr || stdout || 'Lỗi khi định dạng văn bản DOCX.'));
          }

          try {
            const normalization = normalizeFormattedDocx(outputPath, {
              documentTitle: documentTitle.trim() || runtimeProfile.cover.document_type,
              documentMode: runtimeProfile.document_modes.default,
              removeCoverCourse: !course.trim(),
              sourcePath: preparedInputPath,
              location: runtimeProfile.cover.location,
              month,
              year,
              profile: runtimeProfile
            });
            reportData = {
              ...(reportData || {}),
              input: inputPath,
              appliedProfile: {
                profileId: runtimeProfile.profile_id,
                sourceRevision: runtimeProfile.source_revision,
                documentMode: runtimeProfile.document_modes.default
              },
              sourceListNormalization,
              outputNormalization: normalization
            };
          } catch (normalizationError) {
            console.error('DOCX post-processing error:', normalizationError);
            cleanupWorkingFiles();
            return reject(new Error('Không thể hoàn tất chuẩn hóa màu chữ, độ đậm và dấu gạch trong DOCX.'));
          }

          cleanupWorkingFiles();
          rememberOutputOwner(path.basename(outputPath), ownerMssv);

          resolve({
            success: true,
            outputFile: `formatted_${id}.docx`,
            outputPath: outputPath,
            report: reportData,
            stdout: stdout,
            fileSize: fs.existsSync(outputPath) ? fs.statSync(outputPath).size : 0
          });
        });
      });
    });
  },

  /**
   * Structure & rendered A4 page preview for the editor.
   * Backward-compatible: second argument may be plain `roleOverrides` OR an
   * options object `{ renderDocument: true, roleOverrides, paragraphNotes, ... }`.
   */
  async previewStructure(inputPath, roleOverridesOrOptions = {}) {
    if (!fs.existsSync(inputPath)) throw new Error('Không tìm thấy file tải lên.');
    const isRichOptions = Boolean(
      roleOverridesOrOptions
      && typeof roleOverridesOrOptions === 'object'
      && !Array.isArray(roleOverridesOrOptions)
      && (
        'renderDocument' in roleOverridesOrOptions
        || 'documentType' in roleOverridesOrOptions
        || 'roleOverrides' in roleOverridesOrOptions
        || 'paragraphNotes' in roleOverridesOrOptions
        || 'paragraphMutations' in roleOverridesOrOptions
      )
    );
    const rawOverrides = isRichOptions ? roleOverridesOrOptions.roleOverrides : roleOverridesOrOptions;
    const renderDocument = Boolean(isRichOptions && roleOverridesOrOptions.renderDocument);

    return wordFmtQueue.enqueue(async () => {
      const overrides = normalizeRoleOverrides(rawOverrides);
      const notes = isRichOptions ? normalizeParagraphNotes(roleOverridesOrOptions.paragraphNotes) : {};
      const mutations = isRichOptions ? normalizeParagraphMutations(roleOverridesOrOptions.paragraphMutations) : { edits: {}, deletes: [], inserts: [], count: 0 };
      let archive;
      try {
        archive = new AdmZip(inputPath);
        if (renderDocument || mutations.count > 0) stampSourceParagraphBookmarks(archive);
        if (Object.keys(overrides).length) applyRoleOverrides(archive, overrides);
        if (Object.keys(notes).length) applyParagraphNotes(archive, notes);
        if (mutations.count > 0) {
          applyParagraphMutations(archive, { ...mutations, roleOverrides: overrides }, { stampPreviewBookmarks: renderDocument || mutations.count > 0 });
        }
      } catch {
        throw new Error('File Word không hợp lệ hoặc bị hỏng.');
      }

      const sourceAnalysis = analyzeDocxStructure(archive);
      const structurePreview = buildStructurePreview(sourceAnalysis, { maxText: renderDocument ? 600 : 280 });
      if (!renderDocument) return structurePreview;

      const id = `pv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const tempSrcPath = path.join(TEMP_DIR, `${id}_src.docx`);
      const tempOutPath = path.join(TEMP_DIR, `${id}_out.docx`);
      try {
        const documentType = roleOverridesOrOptions.documentType === 'do_an_tot_nghiep' ? 'do_an_tot_nghiep' : 'tieu_luan';
        const profileName = documentType === 'do_an_tot_nghiep' ? 'do_an_tot_nghiep.json' : 'tieu_luan.json';
        const baseProfilePath = path.join(PROFILES_DIR, profileName);
        const runtimeProfile = JSON.parse(fs.readFileSync(baseProfilePath, 'utf8'));
        const documentMode = roleOverridesOrOptions.documentMode === 'binding_package' ? 'binding_package' : 'digital_document';

        const institution = String(roleOverridesOrOptions.institution || '').trim();
        const institute = String(roleOverridesOrOptions.institute || '').trim();
        const faculty = String(roleOverridesOrOptions.faculty || '').trim();
        const course = String(roleOverridesOrOptions.course || '').trim();
        const location = String(roleOverridesOrOptions.location || '').trim();

        runtimeProfile.cover = { ...(runtimeProfile.cover || {}) };
        if (institution) runtimeProfile.cover.institution = institution;
        if (institute) runtimeProfile.cover.institute = institute;
        if (faculty) runtimeProfile.cover.faculty = faculty;
        if (course) runtimeProfile.cover.course = course;
        if (location) runtimeProfile.cover.location = location;
        runtimeProfile.document_modes = {
          ...(runtimeProfile.document_modes || {}),
          default: documentMode
        };

        const instructor = String(roleOverridesOrOptions.instructor || '').trim() || '……………………';
        const student = String(roleOverridesOrOptions.student || '').trim() || '……………………';
        const studentId = String(roleOverridesOrOptions.studentId || '').trim();
        const className = String(roleOverridesOrOptions.className || '').trim();
        const topic = String(roleOverridesOrOptions.topic || '').trim();
        const documentTitle = documentType === 'do_an_tot_nghiep'
          ? 'ĐỒ ÁN TỐT NGHIỆP'
          : (String(roleOverridesOrOptions.documentTitle || '').trim() || 'TIỂU LUẬN MÔN HỌC');
        const month = String(roleOverridesOrOptions.month || '').trim();
        const year = String(roleOverridesOrOptions.year || '').trim();
        const frontMatter = roleOverridesOrOptions.frontMatter !== undefined
          ? String(roleOverridesOrOptions.frontMatter)
          : 'cover,comments,thanks';
        const onlyExistingCaptions = roleOverridesOrOptions.onlyExistingCaptions === undefined
          ? true
          : (roleOverridesOrOptions.onlyExistingCaptions === 'true' || roleOverridesOrOptions.onlyExistingCaptions === true);
        const skipProposal = roleOverridesOrOptions.skipProposal === 'true' || roleOverridesOrOptions.skipProposal === true;

        archive.writeZip(tempSrcPath);
        const stampedAnalysis = analyzeDocxStructure(tempSrcPath);
        formatStructuredDocx(tempSrcPath, tempOutPath, {
          profile: runtimeProfile,
          instructor,
          student,
          studentId,
          topic,
          className,
          documentTitle,
          institution,
          institute,
          faculty,
          course,
          location,
          month,
          year,
          documentMode,
          documentType,
          frontMatter,
          onlyExistingCaptions,
          skipProposal
        }, stampedAnalysis);

        const formattedArchive = new AdmZip(tempOutPath);
        const document = buildRenderedDocxPreview(formattedArchive, {
          sourcePreview: structurePreview,
          overrides,
          notes
        });
        return {
          ...structurePreview,
          document
        };
      } catch (renderErr) {
        console.warn('WordFmt live document render fallback:', renderErr?.message);
        return {
          ...structurePreview,
          document: null,
          renderWarning: 'Chưa thể dựng bản in đầy đủ cho tệp này; đang hiển thị cấu trúc chuẩn.'
        };
      } finally {
        try { if (fs.existsSync(tempSrcPath)) fs.unlinkSync(tempSrcPath); } catch { /* best effort */ }
        try { if (fs.existsSync(tempOutPath)) fs.unlinkSync(tempOutPath); } catch { /* best effort */ }
      }
    });
  },

  /**
   * Renders the paginated A4 preview of an already-formatted output file owned by `ownerMssv`.
   */
  async previewFormattedOutput(outputFile, ownerMssv) {
    const safeName = path.basename(String(outputFile || ''));
    if (!this.canDownload(safeName, ownerMssv)) {
      return null;
    }
    const targetPath = path.join(TEMP_DIR, safeName);
    if (!fs.existsSync(targetPath)) return null;
    return wordFmtQueue.enqueue(async () => {
      const archive = new AdmZip(targetPath);
      const analysis = analyzeDocxStructure(archive);
      const structurePreview = buildStructurePreview(analysis, { maxText: 600 });
      const document = buildRenderedDocxPreview(archive, {
        sourcePreview: structurePreview
      });
      return {
        ...structurePreview,
        document
      };
    });
  },

  /**
   * Quick check DOCX for style compliance
   */
  async checkDocx(inputPath, profile = 'tieu_luan.json') {
    const structure = analyzeDocxStructure(inputPath);
    if (structure.requiresStructuredFormatting) {
      const mismatches = structure.records.filter(r => ['chapter', 'heading'].includes(r.role)
        && r.styleId !== `WFHeading${r.level}`);
      return {
        output: [`Nhận diện ${structure.chapters.length} chương thực; bảo vệ ${structure.summary.protectedIndexParagraphs} đoạn mục lục.`,
          `${structure.summary.chapterSummariesPreserved} đoạn giới thiệu chương được giữ là nội dung.`,
          ...mismatches.map(r=>`STYLE_MISMATCH: ${r.displayText} → WFHeading${r.level}`), ...structure.warnings].join('\n'),
        exitCode: mismatches.length || structure.warnings.length ? 1 : 0,
        structure: structure.summary
      };
    }
    const profilePath = path.join(PROFILES_DIR, profile);
    const args = [DLL_PATH, 'check', inputPath, '--profile', profilePath];

    return wordFmtQueue.enqueue(() => {
      return new Promise((resolve, reject) => {
        execFile('dotnet', args, { cwd: ROOT_DIR }, (error, stdout, stderr) => {
          resolve({
            output: stdout || stderr,
            exitCode: error ? error.code : 0
          });
        });
      });
    });
  },

  canDownload(outputFile, ownerMssv) {
    const file = path.basename(String(outputFile || ''));
    const owner = String(ownerMssv || '').trim().toUpperCase();
    return Boolean(owner && outputOwners.get(file) === owner);
  },

  /**
   * Get current WordFmt queue statistics
   */
  getQueueStats() {
    return wordFmtQueue.getStats();
  },

  /**
   * Clean up old temporary files (> 30 minutes)
   */
  cleanOldTempFiles() {
    try {
      const files = fs.readdirSync(TEMP_DIR);
      const now = Date.now();
      const maxAge = 30 * 60 * 1000;

      for (const file of files) {
        const filePath = path.join(TEMP_DIR, file);
        const stats = fs.statSync(filePath);
        if (now - stats.mtimeMs > maxAge) {
          if (stats.isDirectory()) {
            fs.rmSync(filePath, { recursive: true, force: true });
          } else {
            fs.unlinkSync(filePath);
          }
        }
      }
    } catch (err) {
      console.error('Error cleaning temp files:', err);
    }
  }
};
