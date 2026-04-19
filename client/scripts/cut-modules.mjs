/**
 * Splits _monolithInner.jsx into constants, i18n, api, hooks/useSessionState, and AppBody.jsx
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const src = path.join(root, 'src');
const innerPath = path.join(src, '_monolithInner.jsx');
const lines = fs.readFileSync(innerPath, 'utf8').split(/\r?\n/);

function sliceLineRange(a, b) {
  // 1-based inclusive a, inclusive b
  return lines.slice(a - 1, b).join('\n');
}

// --- useSessionState.js (lines 4–23 in monolith)
const useSessionStateSrc = `import { useState, useCallback } from 'react';

${sliceLineRange(4, 23)}
export { useSessionState };
`;

fs.mkdirSync(path.join(src, 'hooks'), { recursive: true });
fs.writeFileSync(path.join(src, 'hooks', 'useSessionState.js'), useSessionStateSrc, 'utf8');

// --- constants.js: brand (30–37) + DEF_USERS/DEF_CATS/DATA_VERSION (542–563), AUTH via Vite
const constantsSrc = `${sliceLineRange(30, 37)}

/* === SEED DATA (local dev / demo only) ======================================= */
${sliceLineRange(542, 558)}

/* ── VERSION & SCHEMA ──────────────────────────────────────────────────────── */
export const DATA_VERSION = 6; // increment when schema changes; triggers normalize()
/** Backend auth server URL. Set to empty string to use local-only mode (no signup/server login). */
export const AUTH_URL = import.meta.env.VITE_AUTH_URL || '';
`;

// Fix const -> export const for G..UNKNOWN
const constantsFixed = constantsSrc
  .replace(/^const G /m, 'export const G ')
  .replace(/^const GH /m, 'export const GH ')
  .replace(/^const GL /m, 'export const GL ')
  .replace(/^const T /m, 'export const T ')
  .replace(/^const BILL_COLOR /m, 'export const BILL_COLOR ')
  .replace(/^const BL /m, 'export const BL ')
  .replace(/^const UNKNOWN_USER_NAME/m, 'export const UNKNOWN_USER_NAME')
  .replace(/^const DEF_USERS/m, 'export const DEF_USERS')
  .replace(/^const DEF_CATS/m, 'export const DEF_CATS');

fs.writeFileSync(path.join(src, 'constants.js'), constantsFixed, 'utf8');

// --- i18n.js: TR + mkT (39–534)
const i18nRaw = sliceLineRange(39, 534);
const i18nFixed = i18nRaw
  .replace(/^const TR = /m, 'export const TR = ')
  .replace(/^const mkT=/m, 'export const mkT=');

fs.writeFileSync(path.join(src, 'i18n.js'), i18nFixed, 'utf8');

// --- api.js: keepServerWarm through debugApiRequest (565–862)
const apiBlock = sliceLineRange(565, 862);
const apiSrc = `import { AUTH_URL } from './constants.js';

${apiBlock.replace(
  /^const AUTH_URL = .*$/m,
  '// AUTH_URL imported from constants',
)}

export {
  readOfflineQueue,
  writeOfflineQueue,
  dispatchSolanaToast,
  isNetworkError,
  shouldQueueWrite,
  makeOfflineQueuedError,
  isOfflineQueuedError,
  isCommentPostUnavailable,
  enqueueOfflineOp,
  API,
  debugApiRequest,
};

// side effect: ping server
keepServerWarm();
`;

// Remove duplicate AUTH line in api - we already import AUTH_URL
const apiClean = apiSrc
  .replace(/\/\/ AUTH_URL imported from constants\n/, '')
  .replace(/\nconst AUTH_URL = \(typeof window[^;]+;\n/, '\n');

fs.writeFileSync(path.join(src, 'api.js'), apiClean, 'utf8');

// --- AppBody: from line 864 to end, prepend imports
const tail = lines.slice(863).join('\n'); // 864-end (1-based 864 = index 863)

const appBody = `import React, { useState, useEffect, useRef, useCallback, useMemo, createContext, useContext } from 'react';
import { useSessionState } from './hooks/useSessionState.js';
import {
  G,
  GH,
  GL,
  T,
  BILL_COLOR,
  BL,
  UNKNOWN_USER_NAME,
  DATA_VERSION,
  DEF_USERS,
  DEF_CATS,
  AUTH_URL,
} from './constants.js';
import { TR, mkT } from './i18n.js';
import {
  API,
  debugApiRequest,
  readOfflineQueue,
  writeOfflineQueue,
  dispatchSolanaToast,
  isNetworkError,
  shouldQueueWrite,
  makeOfflineQueuedError,
  isOfflineQueuedError,
  isCommentPostUnavailable,
  enqueueOfflineOp,
} from './api.js';

${tail.replace(/^function SolanaExpenses\(/m, 'export default function App(').replace(/^class AppErrorBoundary/m, 'export class AppErrorBoundary')}`;

fs.writeFileSync(path.join(src, 'AppBody.jsx'), appBody, 'utf8');

console.log('Wrote hooks/useSessionState.js, constants.js, i18n.js, api.js, AppBody.jsx');
