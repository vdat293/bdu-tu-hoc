/**
 * WordFmt Integration Service
 * Formats DOCX files based on BDU / tieu_luan_httt_v1 profile using WordFmt C# binary
 */

import { execFile } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { AsyncQueue } from '../utils/async-queue.js';
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
   * @param {string} [params.frontMatter] - Comma separated front matter: cover,comments,thanks
   * @param {string} [params.profile] - Profile name (defaults to tieu_luan_httt_v1.json)
   */
  async formatDocx({
    inputPath,
    instructor,
    student,
    studentId = '',
    topic = '',
    className = '',
    documentTitle = 'TIỂU LUẬN MÔN HỌC',
    frontMatter = 'cover,comments,thanks',
    profile = 'tieu_luan_httt_v1.json'
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
    const profilePath = path.join(PROFILES_DIR, profile);

    let sourceListNormalization;
    try {
      sourceListNormalization = normalizeSourceLists(inputPath, preparedInputPath);
    } catch (listError) {
      console.error('Source list normalization error:', listError);
      throw new Error('Không thể chuẩn hóa danh sách trong DOCX đầu vào.');
    }

    const cleanupPreparedInput = () => {
      try {
        if (fs.existsSync(preparedInputPath)) fs.unlinkSync(preparedInputPath);
      } catch (cleanupError) {
        console.warn('Failed to clean prepared DOCX:', cleanupError);
      }
    };

    const args = [
      DLL_PATH,
      'format',
      preparedInputPath,
      '--output', outputPath,
      '--instructor', instructor.trim(),
      '--student', student.trim(),
      '--profile', profilePath,
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
            cleanupPreparedInput();
            return reject(new Error(stderr || stdout || 'Lỗi khi định dạng văn bản DOCX.'));
          }

          try {
            const normalization = normalizeFormattedDocx(outputPath);
            reportData = {
              ...(reportData || {}),
              input: inputPath,
              sourceListNormalization,
              outputNormalization: normalization
            };
          } catch (normalizationError) {
            console.error('DOCX post-processing error:', normalizationError);
            cleanupPreparedInput();
            return reject(new Error('Không thể hoàn tất chuẩn hóa màu chữ, độ đậm và dấu gạch trong DOCX.'));
          }

          cleanupPreparedInput();

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
  async checkDocx(inputPath, profile = 'tieu_luan_httt_v1.json') {
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
          fs.unlinkSync(filePath);
        }
      }
    } catch (err) {
      console.error('Error cleaning temp files:', err);
    }
  }
};
