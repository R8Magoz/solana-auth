'use strict';

const fs = require('fs');
const path = require('path');
const cloudinary = require('cloudinary').v2;

function mimeToExt(mime) {
  const m = (mime || '').toLowerCase();
  if (m === 'image/jpeg' || m === 'image/jpg') return 'jpg';
  if (m === 'image/png') return 'png';
  if (m === 'image/webp') return 'webp';
  if (m === 'image/gif') return 'gif';
  if (m === 'image/tiff' || m === 'image/tif' || m === 'image/x-tiff') return 'tiff';
  if (m === 'image/heic' || m === 'image/heif') return 'heic';
  if (m === 'application/pdf') return 'pdf';
  return null;
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
  const dataUri = `data:${mime};base64,${buf.toString('base64')}`;
  const folder = (process.env.CLOUDINARY_RECEIPTS_FOLDER || 'solana-receipts').replace(/^\/+|\/+$/g, '');
  const publicId = String(entityId).replace(/[^a-zA-Z0-9_-]/g, '_');
  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload(
      dataUri,
      {
        folder,
        public_id: publicId,
        overwrite: true,
        resource_type: 'image',
        unique_filename: false,
        use_filename: false,
      },
      (err, result) => {
        if (err) reject(err);
        else resolve(result);
      },
    );
  });
}

function destroyCloudinaryPublicId(publicId) {
  return new Promise((resolve) => {
    cloudinary.uploader.destroy(publicId, (err, result) => {
      if (err) console.warn('[receipt] cloudinary destroy:', err.message || err);
      resolve(result);
    });
  });
}

async function removeReceiptAsset(receiptPath, DATA_DIR) {
  if (!receiptPath) return;
  if (isRemoteReceiptPath(receiptPath)) {
    if (!ensureCloudinary()) return;
    const pid = cloudinaryPublicIdFromUrl(receiptPath);
    if (pid) await destroyCloudinaryPublicId(pid);
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
  if (b64.length > 8_400_000) {
    const err = new Error('Archivo demasiado grande (máx. 6 MB).');
    err.statusCode = 413;
    throw err;
  }
  const mime = String(mediaType || 'image/jpeg').trim().toLowerCase().slice(0, 128);
  const ext = mimeToExt(mime);
  if (!ext) {
    const err = new Error(`Tipo no soportado: ${mime}`);
    err.statusCode = 400;
    throw err;
  }
  let buf;
  try {
    buf = Buffer.from(b64, 'base64');
  } catch {
    const err = new Error('Base64 inválido.');
    err.statusCode = 400;
    throw err;
  }
  if (buf.length > 6 * 1024 * 1024) {
    const err = new Error('Archivo demasiado grande (máx. 6 MB).');
    err.statusCode = 413;
    throw err;
  }

  if (ensureCloudinary()) {
    const result = await uploadReceiptToCloudinary(buf, mime, entityId);
    return { receiptPath: result.secure_url };
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
  isRemoteReceiptPath,
  removeReceiptAsset,
  saveReceiptB64ToStorage,
  cloudinaryPublicIdFromUrl,
  ensureCloudinary,
};
