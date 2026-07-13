'use strict';

/** Exact English default names → Spanish (idempotent migration; custom names untouched). */
const DEFAULT_CATEGORY_EN_TO_ES = {
  Equipment: 'Equipamiento',
  Supplies: 'Suministros',
  Marketing: 'Marketing',
  Legal: 'Legal',
  Rent: 'Alquiler',
  Software: 'Software',
  'Food & Beverage': 'Comida y bebida',
  Travel: 'Viajes',
  Otro: 'Otro',
};

/** Default category roster. Array order is the canonical display order (persisted in app_settings.categories). */
const DEFAULT_CATEGORIES = [
  { id: 'c1', name: 'Equipamiento', archived: false },
  { id: 'c2', name: 'Suministros', archived: false },
  { id: 'c3', name: 'Marketing', archived: false },
  { id: 'c4', name: 'Legal', archived: false },
  { id: 'c5', name: 'Alquiler', archived: false },
  { id: 'c6', name: 'Software', archived: false },
  { id: 'c7', name: 'Comida y bebida', archived: false },
  { id: 'c8', name: 'Viajes', archived: false },
  { id: 'c9', name: 'Otro', archived: false },
];

const DEFAULT_CATEGORY_LIST_PIPE = DEFAULT_CATEGORIES.map((c) => c.name).join('|');

module.exports = {
  DEFAULT_CATEGORY_EN_TO_ES,
  DEFAULT_CATEGORIES,
  DEFAULT_CATEGORY_LIST_PIPE,
};
