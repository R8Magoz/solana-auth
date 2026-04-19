// CSS variable strings for inline styles that must stay in JS
export const BRAND = 'var(--color-brand)';
export const BRAND_HOVER = 'var(--color-brand-hover)';
export const BRAND_TINT = 'var(--color-brand-tint)';

// Keep HEX for SVG/canvas and other places that require raw colors
export const BRAND_HEX = '#3C0A37';
export const ACCENT_HEX = '#C4622D';
export const BADGE_HEX = '#7A4F9A';

// Backwards-compatible aliases used throughout the monolith
export const G = BRAND; // brand primary
export const GH = BRAND_HOVER; // primary hover
export const GL = BRAND_TINT; // primary tint
export const T = 'var(--color-accent)'; // accent
export const BILL_COLOR = '#C2622A'; // orange for facturas (kept as hex)
export const BL = 'var(--color-badge)'; // notification badge
/** Shown when a user id is not in the local users list (e.g. server sync lag). */
export const UNKNOWN_USER_NAME="Usuario";

/* === SEED DATA (local dev / demo only) ======================================= */
export const DEF_USERS = [
  { id: 'u_demo1', name: 'Admin User', title: 'Administrador', email: 'admin@example.com', phone: '', role: 'superadmin', color: '#3C0A37' },
  { id: 'u_demo2', name: 'Manager User', title: 'Responsable', email: 'manager@example.com', phone: '', role: 'admin', color: '#52114B' },
  { id: 'u_demo3', name: 'Team Member', title: 'Equipo', email: 'team1@example.com', phone: '', role: 'user', color: '#8B5E3C' },
  { id: 'u_demo4', name: 'Team Member 2', title: 'Equipo', email: 'team2@example.com', phone: '', role: 'user', color: '#6B7280' },
];
export const DEF_CATS=[
  {id:"c1",name:"Equipment",       archived:false,approverIds:[]},
  {id:"c2",name:"Supplies",        archived:false,approverIds:[]},
  {id:"c3",name:"Marketing",       archived:false,approverIds:[]},
  {id:"c4",name:"Legal",           archived:false,approverIds:[]},
  {id:"c5",name:"Rent",            archived:false,approverIds:[]},
  {id:"c6",name:"Software",        archived:false,approverIds:[]},
  {id:"c7",name:"Food & Beverage", archived:false,approverIds:[]},
  {id:"c8",name:"Travel",          archived:false,approverIds:[]},
  {id:"c9",name:"Otro",           archived:false,approverIds:[]},
];

/* ── VERSION & SCHEMA ──────────────────────────────────────────────────────── */
export const DATA_VERSION = 6; // increment when schema changes; triggers normalize()
/** Backend auth server URL. Set to empty string to use local-only mode (no signup/server login). */
export const AUTH_URL = import.meta.env.VITE_AUTH_URL || '';
