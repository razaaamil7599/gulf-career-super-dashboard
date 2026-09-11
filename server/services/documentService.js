/**
 * Document Service
 * Image perspective correction, PDF compilation, and GCS upload.
 */

const sharp = require('sharp');
const { PDFDocument } = require('pdf-lib');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs').promises;
const OpenAI = require('openai');
const { rtdbUpdate, rtdbGetFiltered } = require('./firebaseService');

const vision = require('@google-cloud/vision');

/**
 * Extract document info and face using Google Cloud Vision Pipeline.
 * Extracts accurate face polygon array, avoiding backgrounds.
 */
async function processDocumentWithGoogleVision(inputBuffer) {
  try {
    console.log('[LOG] Sending to Google Cloud Vision...');
    
    // Check credentials explicitly without crashing the thread
    const fs = require('fs');
    if (!process.env.GOOGLE_APPLICATION_CREDENTIALS || !fs.existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)) {
       console.error("[DOC] Vision API Error: Google Credentials file missing or invalid.");
       return { buffer: inputBuffer, rejected: true, reason: 'Vision API config missing or offline.', status: 'NEED_MANUAL_REPOST' };
    }

    const client = new vision.ImageAnnotatorClient();

    // The Industry-Standard Clean-Scan API
    const [result] = await client.annotateImage({
      image: { content: inputBuffer },
      features: [
        { type: 'DOCUMENT_TEXT_DETECTION' },
        { type: 'FACE_DETECTION' }
      ]
    });

    const fullTextAnnotation = result.fullTextAnnotation;
    if (!fullTextAnnotation || !fullTextAnnotation.text) {
      return { buffer: inputBuffer, rejected: true, reason: 'No readable text found in document.', status: 'NEED_MANUAL_REPOST' };
    }

    // 1. Calculate Overall OCR Confidence
    let totalConf = 0;
    let blockCount = 0;
    let averageConfidence = 1.0;

    if (fullTextAnnotation.pages && fullTextAnnotation.pages.length > 0) {
      for (const block of fullTextAnnotation.pages[0].blocks) {
        totalConf += block.confidence || 0;
        blockCount++;
      }
      if (blockCount > 0) averageConfidence = totalConf / blockCount;
    }

    console.log(`[LOG] GCV OCR Average Confidence: ${(averageConfidence * 100).toFixed(1)}%`);

    // Status Sync Rejection (< 70%)
    if (averageConfidence < 0.70) {
      console.warn('[DOC] OCR confidence below 70%. Rejecting cleanly.');
      return { 
        buffer: inputBuffer, 
        rejected: true, 
        reason: `Finger obstructing text or image is too blurry. (Confidence: ${(averageConfidence * 100).toFixed(0)}%)`, 
        status: 'NEED_MANUAL_REPOST' // Used by frontend DocumentUploader.tsx
      };
    }

    // 2. Text Parsing with OpenAI Language Model (Cheaper, 100% accurate text rules)
    const rawText = fullTextAnnotation.text;
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const prompt = `
      Extract the following passport/ID details from this raw OCR text block strictly into JSON. Make logical inferences if typos exist.
      RETURN JSON ONLY WITHOUT MARKDOWN:
      {
        "full_name": "...", 
        "passport_number": "...",
        "dob": "...",
        "gender": "...",
        "place_of_issue": "...",
        "expiry": "...",
        "nationality": "..."
      }
      RAW OCR:
      ${rawText}
    `;

    const txtResponse = await openai.chat.completions.create({
      model: "gpt-4o-mini", // Fast Language Parser
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      max_tokens: 500,
    });
    
    const ocrData = JSON.parse(txtResponse.choices[0].message.content);
    console.log("[LOG] Extracted Data from GCV Text:", JSON.stringify(ocrData, null, 2));

    // 3. Face Extraction with precise GCV Vertices
    let photoBuffer = null;
    if (result.faceAnnotations && result.faceAnnotations.length > 0) {
      try {
        // GCV returns poly vertices for the exact face boundingPoly or fdBoundingPoly
        const face = result.faceAnnotations[0].fdBoundingPoly || result.faceAnnotations[0].boundingPoly;
        const vertices = face.vertices;
        
        // Find min/max for rectangular crop
        const left = Math.min(...vertices.map(v => v.x || 0));
        const top = Math.min(...vertices.map(v => v.y || 0));
        const right = Math.max(...vertices.map(v => v.x || 0));
        const bottom = Math.max(...vertices.map(v => v.y || 0));
        
        let width = right - left;
        let height = bottom - top;

        // Crop precisely with sharp
        if (width > 0 && height > 0) {
            const meta = await sharp(inputBuffer).metadata();
            const safeLeft = Math.max(0, left);
            const safeTop = Math.max(0, top);
            const safeW = Math.min(width, meta.width - safeLeft);
            const safeH = Math.min(height, meta.height - safeTop);
            
            if (safeW > 0 && safeH > 0) {
               photoBuffer = await sharp(inputBuffer)
                 .extract({ left: safeLeft, top: safeTop, width: safeW, height: safeH })
                 .resize(400, 500, { fit: 'cover' })
                 .toBuffer();
             }
        }
      } catch (e) {
        console.warn(`[DOC] Face extraction failed: ${e.message}`);
      }
    }

    return { 
      buffer: null, 
      photoBuffer, 
      ocrData: ocrData || {}, 
      dataLossHigh: false,
      isAiFailed: false,
      processed: true 
    };

  } catch (err) {
    console.error(`[DOC] Deep Pipeline Failure: ${err.message}`);
    return { buffer: inputBuffer, rejected: true, reason: 'System Failure: Could not finalize document AI processing.', status: 'NEED_MANUAL_REPOST' };
  }
}

/**
 * Get image metadata for validation.
 */
async function getImageMeta(buffer) {
  return sharp(buffer).metadata();
}

// ── PDF Compilation ───────────────────────────────────────────────────────────

/**
 * Compiles an array of image buffers into a single PDF.
 * Each image becomes one A4 page.
 * @param {Buffer[]} imageBuffers - Array of JPEG/PNG image buffers
 * @returns {Promise<Buffer>} PDF buffer
 */
async function compileImagesToPDF(imageBuffers) {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle('Gulf Career Gateway - Candidate Documents');
  pdfDoc.setAuthor('Gulf Career Gateway | A.R. Khan IT Solution');
  pdfDoc.setCreator('Gulf Career Super Dashboard v1.0');

  const A4_WIDTH = 595.28;
  const A4_HEIGHT = 841.89;

  for (const imgBuffer of imageBuffers) {
    const page = pdfDoc.addPage([A4_WIDTH, A4_HEIGHT]);

    let image;
    try {
      image = await pdfDoc.embedJpg(imgBuffer);
    } catch {
      image = await pdfDoc.embedPng(imgBuffer);
    }

    const { width, height } = image.scale(1);
    const scale = Math.min(A4_WIDTH / width, A4_HEIGHT / height);

    const scaledW = width * scale;
    const scaledH = height * scale;
    const x = (A4_WIDTH - scaledW) / 2;
    const y = (A4_HEIGHT - scaledH) / 2;

    // Ensure the entire page background is pure white
    page.drawRectangle({
      x: 0,
      y: 0,
      width: A4_WIDTH,
      height: A4_HEIGHT,
      color: require('pdf-lib').rgb(1, 1, 1),
    });

    page.drawImage(image, { x, y, width: scaledW, height: scaledH });
  }

  return Buffer.from(await pdfDoc.save());
}

// ── GCS Upload ────────────────────────────────────────────────────────────────

/**
 * Upload a PDF buffer to Google Cloud Storage.
 * Falls back to local /tmp save when using emulator.
 */
async function uploadPDF(pdfBuffer, candidateName, candidateId = 'Default_Upload') {
  const isDefault = candidateId === 'Default_Upload';
  const folder = isDefault ? 'unassigned' : candidateId;
  const filename = `documents/${folder}/${uuidv4()}-${candidateName.replace(/\s+/g, '_')}.pdf`;
  const useEmulator = process.env.FIREBASE_USE_EMULATOR === 'true';
  const forceLocal = process.env.FORCE_LOCAL_STORAGE === 'true';

  if (useEmulator || forceLocal) {
    // Local dev: save to tmp folder
    const tmpPath = path.join(process.cwd(), 'public', 'tmp', filename.replace('documents/', ''));
    await fs.mkdir(path.dirname(tmpPath), { recursive: true });
    await fs.writeFile(tmpPath, pdfBuffer);
    console.log(`[DOC] Emulator: PDF saved to ${tmpPath}`);
    return { url: `/tmp/${folder}/${path.basename(tmpPath)}`, path: tmpPath, isLocal: true };
  }

  const { getStorage } = require('./firebaseService');
  const bucket = getStorage().bucket();
  const file = bucket.file(filename);

  await file.save(pdfBuffer, {
    metadata: { contentType: 'application/pdf' },
  });

  await file.makePublic();
  const publicUrl = `https://storage.googleapis.com/${bucket.name}/${filename}`;
  console.log(`[DOC] PDF uploaded: ${publicUrl}`);
  return { url: publicUrl, path: filename, isLocal: false };
}

// ── Full Pipeline ─────────────────────────────────────────────────────────────

async function reconstructDigitalPassport(pdfDoc, result) {
  const { ocrData, photoBuffer, dataLossHigh, isAiFailed } = result;
  const page = pdfDoc.addPage([595.28, 841.89]);
  const { width: A4_W, height: A4_H } = page.getSize();
  const { StandardFonts } = require('pdf-lib');
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);

  // Pure White Background
  page.drawRectangle({ x: 0, y: 0, width: A4_W, height: A4_H, color: require('pdf-lib').rgb(1, 1, 1) });

  // Professional Branding Header
  page.drawText('GULF CAREER GATEWAY', {
    x: 50, y: A4_H - 60, size: 24, font: helveticaBold, color: require('pdf-lib').rgb(0.05, 0.15, 0.35)
  });
  page.drawText('DIGITAL VERIFIED CANDIDATE PASS', {
    x: 50, y: A4_H - 78, size: 10, font: helveticaBold, color: require('pdf-lib').rgb(0.4, 0.5, 0.6)
  });
  
  page.drawLine({
    start: { x: 50, y: A4_H - 95 },
    end: { x: 545, y: A4_H - 95 },
    thickness: 1.5,
    color: require('pdf-lib').rgb(0.8, 0.8, 0.8)
  });

  if (isAiFailed || dataLossHigh) {
    const bannerText = isAiFailed ? 'AI ANALYSIS UNAVAILABLE — MANUAL VERIFICATION REQUIRED' : 'OBSTRUCTION DETECTED — MANUAL VERIFICATION REQUIRED';
    page.drawRectangle({ x: 50, y: A4_H - 125, width: 495, height: 25, color: require('pdf-lib').rgb(0.9, 0.1, 0.1) });
    page.drawText(bannerText, { x: 70, y: A4_H - 118, size: 9, font: helveticaBold, color: require('pdf-lib').rgb(1, 1, 1) });
  }

  // Candidate Photo with Clean Border Box
  if (photoBuffer) {
    try {
      const photo = await pdfDoc.embedJpg(photoBuffer);
      const photoW = 140;
      const photoH = 140 * (photo.height / photo.width);
      // Clean Border Box shadow illusion
      page.drawRectangle({ x: 48, y: A4_H - 282, width: photoW + 4, height: photoH + 4, color: require('pdf-lib').rgb(0.9, 0.9, 0.9) });
      page.drawImage(photo, { x: 50, y: A4_H - 280, width: photoW, height: photoH });
      page.drawRectangle({ x: 50, y: A4_H - 280, width: photoW, height: photoH, borderColor: require('pdf-lib').rgb(0.1, 0.2, 0.4), borderWidth: 1.5 });
    } catch (e) { console.error("PDF Photo Embed Error:", e); }
  } else if (isAiFailed) {
    page.drawRectangle({ x: 50, y: A4_H - 280, width: 140, height: 180, color: require('pdf-lib').rgb(0.95, 0.95, 0.95) });
    page.drawText('Photo extraction skipped', { x: 65, y: A4_H - 195, size: 8, font: helvetica, color: require('pdf-lib').rgb(0.6, 0.6, 0.6) });
  }

  // Field Data Grid
  let yPos = A4_H - 320;
  const fields = [
    ['Full Name', ocrData?.full_name],
    ['Passport No', ocrData?.passport_number],
    ['Date of Birth', ocrData?.dob],
    ['Gender', ocrData?.gender],
    ['Place of Issue', ocrData?.place_of_issue],
    ['Expiry Date', ocrData?.expiry],
    ['Nationality', ocrData?.nationality]
  ];

  for (const [label, value] of fields) {
    page.drawText(label.toUpperCase() + ':', { x: 50, y: yPos, size: 9, font: helveticaBold, color: require('pdf-lib').rgb(0.5, 0.5, 0.5) });
    page.drawText(String(value || 'N/A (AI Failed)').toUpperCase(), { x: 200, y: yPos, size: 11, font: helveticaBold, color: require('pdf-lib').rgb(0.1, 0.1, 0.1) });
    yPos -= 35;
  }
}

async function processDocumentPipeline(files, candidateName = 'Candidate', candidateId = 'Default_Upload') {
  let pipelineError = false;
  let isRejected = false;
  let rejectionReason = '';
  let finalOcrData = {};
  let aiFailed = false;
  
  const processedResults = await Promise.all(
    files.map((f) => processDocumentWithGoogleVision(f.buffer))
  );

  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(`Candidate: ${candidateName}`);

  for (const res of processedResults) {
    if (res.isAiFailed) aiFailed = true;

    if (res.rejected) {
      isRejected = true;
      rejectionReason = res.reason;
      continue;
    }
    if (res.error) {
      pipelineError = res.message || true;
      continue;
    }
    
    // Pure Digital SVG Reconstruction
    await reconstructDigitalPassport(pdfDoc, res);

    if (res.ocrData) {
      finalOcrData = { ...finalOcrData, ...res.ocrData };
    }
  }

  if (isRejected) {
    return { isRejected, rejectionReason, processed: false };
  }

  const pdfBuffer = Buffer.from(await pdfDoc.save());
  const uploadResult = await uploadPDF(pdfBuffer, candidateName, candidateId);

  return {
    pageCount: files.length, // Pure Digital Mode: 1 page per file
    pdfSizeBytes: pdfBuffer.length,
    pipelineError,
    isAiFailed: aiFailed,
    ocrData: finalOcrData,
    ...uploadResult,
  };
}

module.exports = {
  processDocumentWithGoogleVision,
  compileImagesToPDF,
  uploadPDF,
  processDocumentPipeline,
};
