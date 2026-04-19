'use strict';

const express = require('express');
const settingsCache = require('../lib/settingsCache');

/**
 * @param {object} deps
 * @returns {import('express').Router}
 */
function createAiRouter(deps) {
  const {
    scanLimiter,
    verifySessionToken,
    audit,
    ANTHROPIC_API_KEY,
  } = deps;

  const router = express.Router();

  /**
   * POST /ai/scan-receipt
   * Body: { b64, mediaType }
   * Auth: Bearer session token (any authenticated user)
   * Proxies to Anthropic Claude. ANTHROPIC_API_KEY never leaves the server.
   */
  router.post('/scan-receipt', scanLimiter, async (req, res) => {
    const auth = req.headers['authorization'] || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return res.status(403).json({ error: 'No autorizado.' });
    const session = verifySessionToken(token);
    if (!session) return res.status(401).json({ error: 'No autorizado.' });

    if (!ANTHROPIC_API_KEY) {
      return res.status(503).json({ error: 'Escaneo no disponible — configura ANTHROPIC_API_KEY en Render.' });
    }

    const { b64, mediaType } = req.body || {};
    if (!b64 || typeof b64 !== 'string') return res.status(400).json({ error: 'Falta b64.' });

    const ALLOWED = ['image/jpeg','image/png','image/webp','application/pdf'];
    const mime = (mediaType || 'image/jpeg').toLowerCase();
    if (!ALLOWED.includes(mime)) return res.status(400).json({ error: `Tipo no soportado: ${mime}` });
    if (b64.length > 5_600_000) return res.status(413).json({ error: 'Archivo demasiado grande (max ~4 MB).' });

    const isPdf = mime === 'application/pdf';
    const block = isPdf
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }
      : { type: 'image',    source: { type: 'base64', media_type: mime,               data: b64 } };
    let categoryList = 'Equipment|Supplies|Marketing|Legal|Rent|Software|Food & Beverage|Travel|Otro';
    try {
      const cats = settingsCache.get('categories', null);
      if (Array.isArray(cats)) {
        const activeNames = cats
          .filter((c) => !c.archived)
          .map((c) => c.name)
          .filter(Boolean);
        if (activeNames.length > 0) categoryList = activeNames.join('|');
      }
    } catch (e) {
      console.warn('[scan] Could not load categories from settings cache:', e.message);
    }

    let timeoutId;
    try {
      const controller = new AbortController();
      timeoutId = setTimeout(() => controller.abort(), 30000);
      const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type':      'application/json',
          'x-api-key':         ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 400,
          messages: [{ role: 'user', content: [
            block,
            { type: 'text', text: `Extract receipt data. Return ONLY valid JSON no markdown: {"amount":number,"description":"string","date":"YYYY-MM-DD","category":"${categoryList}"}` }
          ]}]
        })
      });

      if (!apiRes.ok) {
        const errMsg = apiRes.status === 401 ? 'Clave API inválida en servidor.' :
                       apiRes.status === 429 ? 'Límite de API alcanzado.' :
                       `Error API (${apiRes.status})`;
        audit('scan_api_error', { status: apiRes.status, userId: session.userId });
        return res.status(502).json({ error: errMsg });
      }

      const data = await apiRes.json();
      const txt = (data.content?.find(b => b.type === 'text')?.text || '').replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(txt);
      audit('scan_success', { userId: session.userId });
      res.json({ ok: true, result: parsed });
    } catch (err) {
      if (err && err.name === 'AbortError') {
        audit('scan_timeout', { userId: session.userId });
        return res.status(504).json({ error: 'Tiempo de espera agotado al procesar el escaneo.' });
      }
      audit('scan_error', { userId: session.userId, error: err.message });
      res.status(500).json({ error: 'Error al procesar el escaneo.' });
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  });

  return router;
}

module.exports = { createAiRouter };
