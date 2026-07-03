// keyer.js — МГНОВЕННЫЙ удалитель фона без модели и без загрузки (0 МБ).
// Автоматизирует ручной метод Photopea: определяет почти-однотонный фон, заливкой
// от краёв убирает связный фон, даёт мягкую альфу. Идеален для рисунков/логотипов/
// товаров/сканов на светлом фоне. Мгновенно.
//
// Учтены правки адверсариал-критика:
//  • эталон фона по ПОЛОСЕ краёв (не 1px) с отбраковкой «контаминации» — если объект
//    касается края, эти пиксели не портят эталон и не становятся стартом заливки;
//  • запечатывание разрывов штрихов (дилатация объекта) — заливка не «протекает»
//    сквозь тонкие просветы гравюры и не стирает внутренний фон.

import { dilate } from './cleanup.js';

// --- sRGB → CIELAB ---
function srgbToLab(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  r = r > 0.04045 ? ((r + 0.055) / 1.055) ** 2.4 : r / 12.92;
  g = g > 0.04045 ? ((g + 0.055) / 1.055) ** 2.4 : g / 12.92;
  b = b > 0.04045 ? ((b + 0.055) / 1.055) ** 2.4 : b / 12.92;
  let x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  let y = (r * 0.2126 + g * 0.7152 + b * 0.0722);
  let z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  x = f(x); y = f(y); z = f(z);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
const dE = (a0, a1, a2, b0, b1, b2) => Math.hypot(a0 - b0, a1 - b1, a2 - b2);
const smooth = (t) => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };

// Эталон фона: собираем пиксели полосы шириной band по всем краям, берём медиану,
// отбрасываем «загрязнённые» (объект у края) и усредняем чистые. Возвращаем Lab-эталон
// и множество «чистых» краевых стартов для заливки.
function backgroundReference(lab, w, h, band = 8) {
  const idxs = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (x < band || y < band || x >= w - band || y >= h - band) idxs.push(y * w + x);
  }
  // предварительная медиана по каждому каналу (грубо)
  const L = [], A = [], B = [];
  for (const i of idxs) { L.push(lab[i * 3]); A.push(lab[i * 3 + 1]); B.push(lab[i * 3 + 2]); }
  const med = (arr) => { const c = arr.slice().sort((p, q) => p - q); return c[c.length >> 1]; };
  let ref = [med(L), med(A), med(B)];
  // отбрасываем краевые пиксели далеко от медианы (это объект, а не фон)
  const clean = [];
  for (const i of idxs) {
    if (dE(lab[i * 3], lab[i * 3 + 1], lab[i * 3 + 2], ref[0], ref[1], ref[2]) < 12) clean.push(i);
  }
  const use = clean.length > idxs.length * 0.2 ? clean : idxs; // если фон почти весь «грязный» — берём всё
  let sL = 0, sA = 0, sB = 0;
  for (const i of use) { sL += lab[i * 3]; sA += lab[i * 3 + 1]; sB += lab[i * 3 + 2]; }
  ref = [sL / use.length, sA / use.length, sB / use.length];
  // «чистые» края (близкие к эталону) — только они годятся как старт заливки
  const seeds = [];
  const bandSeed = (i) => {
    if (dE(lab[i * 3], lab[i * 3 + 1], lab[i * 3 + 2], ref[0], ref[1], ref[2]) < 20) seeds.push(i);
  };
  for (let x = 0; x < w; x++) { bandSeed(x); bandSeed((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { bandSeed(y * w); bandSeed(y * w + w - 1); }
  return { ref, seeds };
}

/**
 * Автоматический ключ фона.
 * @returns {Uint8ClampedArray} mask 0..255 (255 = объект)
 */
export function autoKey(src, w, h, tol = 26, soft = 12) {
  const n = w * h;
  const lab = new Int16Array(n * 3); // Int16 — экономим память на больших картинках
  for (let i = 0; i < n; i++) {
    const L = srgbToLab(src[i * 4], src[i * 4 + 1], src[i * 4 + 2]);
    lab[i * 3] = L[0]; lab[i * 3 + 1] = L[1]; lab[i * 3 + 2] = L[2];
  }
  const { ref, seeds } = backgroundReference(lab, w, h);
  const tolIn = Math.max(1, tol - soft);
  const tolOut = tol;

  // Поле расстояний до фона
  const dist = new Float32Array(n);
  for (let i = 0; i < n; i++) dist[i] = dE(lab[i * 3], lab[i * 3 + 1], lab[i * 3 + 2], ref[0], ref[1], ref[2]);

  // Запечатывание: утолщаем объект (dist>=tolOut) на 2px, чтобы заливка не протекала
  // сквозь разрывы штрихов и не стирала внутренние «карманы» фона.
  const objSealed = new Uint8ClampedArray(n);
  for (let i = 0; i < n; i++) objSealed[i] = dist[i] >= tolOut ? 255 : 0;
  dilate(objSealed, w, h, 2);

  // Flood fill только от ЧИСТЫХ краёв, только по фону (dist<tolOut и не запечатанный объект)
  const reached = new Uint8Array(n);
  const stack = new Int32Array(n);
  let sp = 0;
  const floodable = (i) => dist[i] < tolOut && objSealed[i] < 128;
  const seed = (i) => { if (!reached[i] && floodable(i)) { reached[i] = 1; stack[sp++] = i; } };
  for (const i of seeds) seed(i);
  while (sp > 0) {
    const idx = stack[--sp];
    const x = idx % w, y = (idx / w) | 0;
    if (x > 0) seed(idx - 1);
    if (x < w - 1) seed(idx + 1);
    if (y > 0) seed(idx - w);
    if (y < h - 1) seed(idx + w);
  }

  // Мягкая альфа: в связном фоне — плавный переход по расстоянию
  const mask = new Uint8ClampedArray(n);
  for (let i = 0; i < n; i++) {
    if (!reached[i]) { mask[i] = 255; continue; }
    mask[i] = Math.round(smooth((dist[i] - tolIn) / (tolOut - tolIn)) * 255);
  }
  return mask;
}

// Оценка «однотонности» фона по полосе краёв: подходит ли мгновенный метод.
export function borderUniformity(src, w, h, band = 8) {
  const n = w * h;
  const lab = new Int16Array(n * 3);
  for (let i = 0; i < n; i++) {
    const L = srgbToLab(src[i * 4], src[i * 4 + 1], src[i * 4 + 2]);
    lab[i * 3] = L[0]; lab[i * 3 + 1] = L[1]; lab[i * 3 + 2] = L[2];
  }
  const { ref, seeds } = backgroundReference(lab, w, h, band);
  // разброс краевых пикселей относительно эталона
  let sum = 0, cnt = 0, max = 0;
  const acc = (i) => { const d = dE(lab[i * 3], lab[i * 3 + 1], lab[i * 3 + 2], ref[0], ref[1], ref[2]); sum += d; if (d > max) max = d; cnt++; };
  for (let x = 0; x < w; x++) { acc(x); acc((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { acc(y * w); acc(y * w + w - 1); }
  return { mean: sum / cnt, max, seedFrac: seeds.length / (2 * (w + h)) };
}
