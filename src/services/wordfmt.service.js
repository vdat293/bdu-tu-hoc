/**
 * WordFmt Integration Service
 * Formats DOCX files based on BDU / tieu_luan profile using WordFmt C# binary
 */

import { execFile } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { AsyncQueue } from '../utils/async-queue.js';
import { analyzeDocxStructure, formatStructuredDocx } from '../utils/docx-structure.js';
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
   * @param {'digital_document'|'binding_package'} [params.documentMode]
   * @param {string} [params.frontMatter] - Comma separated front matter: cover,comments,thanks
   * @param {string} [params.profile] - Profile name (defaults to tieu_luan.json)
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
    faculty = '',
    course = '',
    location = '',
    month = '',
    year = '',
    documentMode = 'digital_document',
    frontMatter = 'cover,comments,thanks',
    profile = 'tieu_luan.json'
  }) {
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
    if (faculty.trim()) runtimeProfile.cover.faculty = faculty.trim();
    if (course.trim()) runtimeProfile.cover.course = course.trim();
    if (location.trim()) runtimeProfile.cover.location = location.trim();
    runtimeProfile.document_modes = {
      ...(runtimeProfile.document_modes || {}),
      default: documentMode === 'binding_package' ? 'binding_package' : 'digital_document'
    };
    const structure = analyzeDocxStructure(inputPath);
    if (structure.requiresStructuredFormatting) {
      return wordFmtQueue.enqueue(async () => {
        const result = formatStructuredDocx(inputPath, outputPath, {
          profile: runtimeProfile, instructor, student, studentId, topic, className,
          documentTitle, institution, faculty, course, location, month, year,
          documentMode, frontMatter
        }, structure);
        return { ...result, outputFile: path.basename(outputPath), stdout: '' };
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
