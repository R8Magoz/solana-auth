'use strict';

const fs = require('fs');
const path = require('path');
const cloudinary = require('cloudinary').v2;

/**
 * MIME types we send to Cloudinary for receipts. PDFs are included (never reject with
 * `if (m.includes('pdf')) return false` — Cloudinary uses resource_type: 'auto' on upload).
 */
function receiptMimeOkForServerUpload(mediaType) {
  const m = String(mediaType || '').toLowerCase();
  if (!m || m === 'application/octet-stream') return true;
  if (m.startsWith('image/')) return true;
  if (m === 'application/pdf' || m.includes('pdf')) return true;
  return mimeToExt(mediaType) !== 'bin';
}

function mimeToExt(mime) {
  const m = (mime || '').toLowerCase();
  if (m === 'image/jpeg' || m === 'image/jpg') return 'jpg';
  if (m === 'image/png') return 'png';
  if (m === 'image/webp') return 'webp';
  if (m === 'image/gif') return 'gif';
  if (m === 'image/tiff' || m === 'image/tif' || m === 'image/x-tiff') return 'tif';
  if (m === 'image/heic' || m === 'image/heif') return 'heic';
  if (m === 'application/pdf') return 'pdf';
  if (m === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') return 'xlsx';
  if (m === 'application/vnd.ms-excel') return 'xls';
  if (m === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx';
  if (m === 'application/msword') return 'doc';
  if (m === 'text/csv') return 'csv';
  if (m === 'application/zip') return 'zip';
  return 'bin';
}

function cloudinaryEnvOk() {
  return !!(
    process.env.CLOUDINARY_CLOUD_NAME
    && process.env.CLOUDINARY_API_KEY
    && process.env.CLOUDINARY_API_SECRET
  );
}

let cloudinaryConfigured = false;
function ensureCloudinary() {
  if (cloudinaryConfigured) return true;
  if (!cloudinaryEnvOk()) return false;
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  });
  cloudinaryConfigured = true;
  return true;
}

function cloudinaryPublicIdFromUrl(url) {
  try {
    const u = new URL(url);
    const marker = '/upload/';
    const idx = u.pathname.indexOf(marker);
    if (idx === -1) return null;
    let tail = u.pathname.slice(idx + marker.length);
    tail = tail.replace(/^v\d+\//, '');
    return tail.replace(/\.[^/.]+$/, '') || null;
  } catch {
    return null;
  }
}

function isRemoteReceiptPath(p) {
  return typeof p === 'string' && /^https?:\/\//i.test(p);
}

function uploadReceiptToCloudinary(buf, mime, entityId) {
  const folder = (process.env.CLOUDINARY_RECEIPTS_FOLDER || 'solana-receipts').replace(/^\/+|\/+$/g, '');
  const publicId = String(entityId).replace(/[^a-zA-Z0-9_-]/g, '_');
  const opts = {
    folder,
    public_id: publicId,
    resource_type: 'auto', // images + PDF (and other auto-detected types)
    overwrite: true,
    unique_filename: false,
    use_filename: false,
  };
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(opts, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
    stream.on('error', reject);
    stream.end(buf);
  });
}

function destroyCloudinaryPublicId(publicId, resourceType) {
  // Derive resource type: PDFs are stored as 'raw', everything else is 'image'
  const rtype = resourceType || (String(publicId).endsWith('.pdf') ? 'raw' : 'image');
  return new Promise((resolve) => {
    cloudinary.uploader.destroy(
      publicId,
      { resource_type: rtype },
      (err, result) => {
        if (err) console.warn('[receipt] cloudinary destroy:', err.message || err);
        resolve(result);
      }
    );
  });
}

async function removeReceiptAsset(receiptPath, DATA_DIR) {
  if (!receiptPath) return;
  if (isRemoteReceiptPath(receiptPath)) {
    if (!ensureCloudinary()) return;
    const pid = cloudinaryPublicIdFromUrl(receiptPath);
    const pathLower = String(receiptPath).toLowerCase().split('?')[0];
    const knownType = pathLower.endsWith('.pdf') ? 'raw' : 'image';
    if (pid) await destroyCloudinaryPublicId(pid, knownType);
    return;
  }
  const abs = path.join(DATA_DIR, receiptPath);
  try {
    if (fs.existsSync(abs)) fs.unlinkSync(abs);
  } catch (_) { /* ignore */ }
}

/**
 * @param {{ b64: string, mediaType?: string, entityId: string, DATA_DIR: string }} opts
 * @returns {Promise<{ receiptPath: string }>}
 */
async function saveReceiptB64ToStorage({ b64, mediaType, entityId, DATA_DIR }) {
  if (!b64 || typeof b64 !== 'string') {
    const err = new Error('Falta b64.');
    err.statusCode = 400;
    throw err;
  }
  // Strip data URI prefix if present (e.g. "data:image/jpeg;base64,")
  const cleanB64 = b64.replace(/^data:[^;]+;base64,/, '');
  if (cleanB64.length > 140_000_000) {
    const err = new Error('Archivo demasiado grande (máx. 100 MB).');
    err.statusCode = 413;
    throw err;
  }
  const mime = String(mediaType || 'application/octet-stream').trim().toLowerCase().slice(0, 128);
  let ext = mimeToExt(mime) || 'bin';
  let buf;
  try {
    buf = Buffer.from(cleanB64, 'base64');
  } catch {
    const err = new Error('Base64 inválido.');
    err.statusCode = 400;
    throw err;
  }
  if (buf.length > 100 * 1024 * 1024) {
    const err = new Error('Archivo demasiado grande (máx. 100 MB).');
    err.statusCode = 413;
    throw err;
  }

  if (ensureCloudinary()) {
    try {
      const result = await uploadReceiptToCloudinary(buf, mime, entityId);
      return { receiptPath: result.secure_url };
    } catch (e) {
      console.warn('[receipt] Cloudinary upload failed, falling back to disk:', e && e.message ? e.message : e);
    }
  }

  const RECEIPTS_DIR = path.join(DATA_DIR, 'receipts');
  if (!fs.existsSync(RECEIPTS_DIR)) fs.mkdirSync(RECEIPTS_DIR, { recursive: true });
  const safeId = String(entityId).replace(/[^a-zA-Z0-9_-]/g, '_');
  const rel = path.join('receipts', `${safeId}.${ext}`).replace(/\\/g, '/');
  const abs = path.join(DATA_DIR, 'receipts', `${safeId}.${ext}`);
  fs.writeFileSync(abs, buf);
  return { receiptPath: rel };
}

module.exports = {
  mimeToExt,
  receiptMimeOkForServerUpload,
  isRemoteReceiptPath,
  removeReceiptAsset,
  saveReceiptB64ToStorage,
  cloudinaryPublicIdFromUrl,
  ensureCloudinary,
};
