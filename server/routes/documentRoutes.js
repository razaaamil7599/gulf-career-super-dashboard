/**
 * Document Routes
 * POST /api/document/process — upload images, process, compile PDF
 */

const express = require('express');
const multer = require('multer');
const router = express.Router();
const { processDocumentPipeline } = require('../services/documentService');
const { rtdbUpdate, rtdbGetFiltered } = require('../services/firebaseService');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB per file
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'), false);
  },
});

// POST /api/document/process
// Form-data fields: files[] (images), candidateName (string)
router.post('/process', upload.array('files', 20), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'At least one image file is required.' });
    }

    const candidateName = req.body.candidateName || 'Candidate';
    const candidateId = req.body.candidateId || 'Default_Upload';
    console.log(`[Doc] Processing ${req.files.length} image(s) for: ${candidateName} (ID: ${candidateId})`);

    const result = await processDocumentPipeline(req.files, candidateName, candidateId);

    // 4. Handle Automated Rejection (OCR Fail-Safe)
    if (result.isRejected) {
      try {
        const candidates = await rtdbGetFiltered('candidates', 'name', candidateName);
        if (candidates) {
          const id = Object.keys(candidates)[0];
          await rtdbUpdate(`candidates/${id}`, { 
            status: 'REJECTED: Low Quality',
            ocr_verification: 'FAILED',
            rejectionReason: result.rejectionReason,
            updatedAt: Date.now()
          });
          console.log(`[Doc] Automatically REJECTED candidate ${id} due to low image quality.`);
        }
      } catch (e) {
        console.warn(`[Doc] Could not update rejection status: ${e.message}`);
      }
      return res.status(422).json({ 
        error: 'Document Rejected: Low Quality or Unreadable',
        rejectionReason: result.rejectionReason,
        status: result.status
      });
    }

    // 5. Update Firebase on Success
    if (candidateId) {
      try {
        const candidates = await rtdbGetFiltered('candidates', 'name', candidateName);
        if (candidates) {
          const id = Object.keys(candidates)[0];
          await rtdbUpdate(`candidates/${id}`, {
            documentUrl: result.url,
            documentPath: result.path,
            status: 'document_processed_v4',
            ocr_data: result.ocrData || {},
            ocr_verification: 'PASSED',
            updatedAt: Date.now(),
          });
        }
      } catch (e) {
        console.warn(`[Doc] Could not update success status: ${e.message}`);
      }
    }

    res.json({
      success: true,
      candidateName,
      pageCount: result.pageCount,
      pdfSizeBytes: result.pdfSizeBytes,
      pdfUrl: result.url,
      isLocal: result.isLocal,
      aiError: result.pipelineError,
      isAiFailed: result.isAiFailed, // Pass Safe Mode status to UI
    });
  } catch (err) {
    console.error('[Doc] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
