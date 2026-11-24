/**
 * Module: WordFmt (định dạng DOCX)
 */

import path from 'node:path';
import fs from 'node:fs';
import { WordFmtService } from '../../services/wordfmt.service.js';
import { BduIdentityService } from '../../services/bdu-identity.service.js';

function resolveWordFmtDownloadPath(filename) {
  const safeName = String(filename || '');
  if (!safeName || path.basename(safeName) !== safeName || !/^formatted_[0-9]+_[a-z0-9]{1,12}\.docx$/i.test(safeName)) {
    return null;
  }
  const root = path.resolve('temp');
  const filePath = path.resolve(root, safeName);
  const relative = path.relative(root, filePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  try {
    const realRoot = fs.realpathSync(root);
    const realFile = fs.realpathSync(filePath);
    const realRelative = path.relative(realRoot, realFile);
    if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) return null;
    return { filePath: realFile, root: realRoot };
  } catch {
    return null;
  }
}

export const WordFmtController = {
  // Tools: Preview DOCX structure & rendered A4 pages (for Google Docs-style review before formatting)
  async previewDocxStructure(req, res) {
    if (!req.file) {
      return res.status(400).json({ result: false, message: 'Vui lòng chọn file Word (.docx) để tải lên.' });
    }
    try {
      const body = req.body || {};
      const wantsRender = body.renderDocument === 'true' || body.renderDocument === true;
      const preview = wantsRender
        ? await WordFmtService.previewStructure(req.file.path, {
          renderDocument: true,
          roleOverrides: body.roleOverrides,
          paragraphNotes: body.paragraphNotes,
          paragraphMutations: body.paragraphMutations,
          documentType: body.documentType,
          documentMode: body.documentMode,
          instructor: body.instructor,
          student: body.student,
          studentId: body.studentId,
          className: body.className,
          topic: body.topic,
          documentTitle: body.documentTitle || body.docTitle,
          institution: body.institution,
          institute: body.institute,
          faculty: body.faculty,
          course: body.course,
          location: body.location,
          month: body.month,
          year: body.year,
          frontMatter: body.frontMatter,
          onlyExistingCaptions: body.onlyExistingCaptions,
          skipProposal: body.skipProposal
        })
        : await WordFmtService.previewStructure(req.file.path, body.roleOverrides);
      return res.json({ result: true, preview });
    } catch (err) {
      console.error('WordFmt preview error:', err.message);
      return res.status(400).json({ result: false, message: err.message || 'Không thể phân tích cấu trúc file DOCX.' });
    } finally {
      try { if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path); } catch { /* best effort */ }
    }
  },

  // Tools: Preview already-formatted output DOCX on the Google Docs A4 canvas
  async previewFormattedDocx(req, res) {
    try {
      const ownerMssv = req.verifiedMssv || await BduIdentityService.resolveVerifiedMssv(req.headers.authorization || '');
      const safePath = resolveWordFmtDownloadPath(req.params.filename);
      if (!safePath || !WordFmtService.canDownload(req.params.filename, ownerMssv)) {
        return res.status(404).json({ result: false, message: 'File không tồn tại hoặc đã hết hạn.' });
      }
      const preview = await WordFmtService.previewFormattedOutput(path.basename(safePath.filePath), ownerMssv);
      if (!preview) {
        return res.status(404).json({ result: false, message: 'File không tồn tại hoặc đã hết hạn.' });
      }
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Vary', 'Authorization');
      return res.json({ result: true, preview });
    } catch (err) {
      console.error('WordFmt output preview error:', err.message);
      return res.status(400).json({ result: false, message: 'Không thể tải bản xem thực tế của tài liệu.' });
    }
  },

  // 5. Tools: Format DOCX
  async formatDocx(req, res) {
    try {
      if (!req.file) {
        return res.status(400).json({ result: false, message: 'Vui lòng chọn file Word (.docx) để tải lên.' });
      }

      const {
        instructor,
        student,
        studentId,
        topic,
        className,
        documentTitle,
        docTitle,
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
        profile,
        onlyExistingCaptions,
        skipProposal
      } = req.body;
      const inputPath = req.file.path;
      const ownerMssv = req.verifiedMssv || await BduIdentityService.resolveVerifiedMssv(req.headers.authorization || '');

      const result = await WordFmtService.formatDocx({
        inputPath,
        instructor,
        ownerMssv,
        student,
        studentId,
        topic,
        className,
        documentTitle: documentTitle || docTitle,
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
        profile,
        onlyExistingCaptions: onlyExistingCaptions === 'true' || onlyExistingCaptions === true,
        skipProposal: skipProposal === 'true' || skipProposal === true,
        roleOverrides: req.body.roleOverrides,
        paragraphNotes: req.body.paragraphNotes,
        paragraphMutations: req.body.paragraphMutations
      });

      const downloadUrl = `/api/wordfmt/download/${encodeURIComponent(result.outputFile)}`;

      // Cleanup uploaded temp file
      if (fs.existsSync(inputPath)) {
        fs.unlinkSync(inputPath);
      }

      return res.json({
        result: true,
        message: 'Định dạng văn bản thành công!',
        downloadUrl,
        fileSize: result.fileSize,
        report: result.report
      });
    } catch (err) {
      console.error('WordFmt format error:', err.message);
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(400).json({
        result: false,
        message: err.message || 'Không thể định dạng file DOCX.'
      });
    }
  },

  // 6. Tools: Download Formatted DOCX
  async downloadFormattedDocx(req, res) {
    const ownerMssv = req.verifiedMssv || await BduIdentityService.resolveVerifiedMssv(req.headers.authorization || '');
    const safePath = resolveWordFmtDownloadPath(req.params.filename);
    if (!safePath || !WordFmtService.canDownload(req.params.filename, ownerMssv)) {
      return res.status(404).json({ result: false, message: 'File không tồn tại hoặc đã hết hạn.' });
    }

    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Vary', 'Authorization');
    return res.download(safePath.filePath, `BDU_ChuanHoa_${path.basename(req.params.filename)}`, (err) => {
      if (err) {
        console.error('Download error:', err);
      }
    });
  },
};

