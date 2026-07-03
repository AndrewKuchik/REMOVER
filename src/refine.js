// refine.js — наш слой обработки края. Именно он даёт профессиональный результат
// без каёмки. Работает на полном разрешении оригинала.
//
// Идея: движок даёт маску (кто объект, кто фон). Мы:
//   1) при желании «обрезаем» край внутрь (erosion) — убираем грязный контур;
//   2) «затекаем» цвет объекта наружу (decontamination) — чтобы под краем не было
//      цвета старого фона (это убирает цветную каёмку);
//   3) смягчаем край (feather) — плавный переход, не «наклейка».

// --- Эрозия (min-фильтр), раздельно по осям. Съедает край внутрь на r пикселей. ---
function erode(a, w, h, r) {
  if (r <= 0) return a;
  const tmp = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let m = 255;
      for (let dx = -r; dx <= r; dx++) {
        const xx = Math.min(w - 1, Math.max(0, x + dx));
        const v = a[row + xx];
        if (v < m) m = v;
      }
      tmp[row + x] = m;
    }
  }
  const out = new Uint8ClampedArray(w * h);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let m = 255;
      for (let dy = -r; dy <= r; dy++) {
        const yy = Math.min(h - 1, Math.max(0, y + dy));
        const v = tmp[yy * w + x];
        if (v < m) m = v;
      }
      out[y * w + x] = m;
    }
  }
  return out;
}

// --- Размытие края (box blur), раздельно по осям. Смягчает переход на r пикселей. ---
function blur(a, w, h, r) {
  if (r <= 0) return a;
  const tmp = new Float32Array(w * h);
  const win = r * 2 + 1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let dx = -r; dx <= r; dx++) {
        const xx = Math.min(w - 1, Math.max(0, x + dx));
        s += a[row + xx];
      }
      tmp[row + x] = s / win;
    }
  }
  const out = new Uint8ClampedArray(w * h);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let s = 0;
      for (let dy = -r; dy <= r; dy++) {
        const yy = Math.min(h - 1, Math.max(0, y + dy));
        s += tmp[yy * w + x];
      }
      out[y * w + x] = s / win;
    }
  }
  return out;
}

// --- Деконтаминация: «затекание» цвета объекта наружу на iters пикселей. ---
// Пиксели, где объект точно есть (alpha высокая), считаем «известным» цветом
// и постепенно копируем его в соседние пиксели края. Так под полупрозрачным
// краем оказывается цвет объекта, а не старого фона → каёмка исчезает.
function bleedColor(src, a, w, h, iters) {
  const n = w * h;
  let r = new Uint8ClampedArray(n);
  let g = new Uint8ClampedArray(n);
  let b = new Uint8ClampedArray(n);
  let known = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    r[i] = src[i * 4];
    g[i] = src[i * 4 + 1];
    b[i] = src[i * 4 + 2];
    known[i] = a[i] > 200 ? 1 : 0; // «твёрдый» объект — источник цвета
  }
  // ping-pong буферы
  let r2 = new Uint8ClampedArray(n), g2 = new Uint8ClampedArray(n),
      b2 = new Uint8ClampedArray(n), k2 = new Uint8Array(n);
  for (let it = 0; it < iters; it++) {
    let changed = false;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (known[i]) { r2[i] = r[i]; g2[i] = g[i]; b2[i] = b[i]; k2[i] = 1; continue; }
        let sr = 0, sg = 0, sb = 0, c = 0;
        if (x > 0 && known[i - 1]) { sr += r[i - 1]; sg += g[i - 1]; sb += b[i - 1]; c++; }
        if (x < w - 1 && known[i + 1]) { sr += r[i + 1]; sg += g[i + 1]; sb += b[i + 1]; c++; }
        if (y > 0 && known[i - w]) { sr += r[i - w]; sg += g[i - w]; sb += b[i - w]; c++; }
        if (y < h - 1 && known[i + w]) { sr += r[i + w]; sg += g[i + w]; sb += b[i + w]; c++; }
        if (c > 0) {
          r2[i] = sr / c; g2[i] = sg / c; b2[i] = sb / c; k2[i] = 1; changed = true;
        } else {
          r2[i] = r[i]; g2[i] = g[i]; b2[i] = b[i]; k2[i] = 0;
        }
      }
    }
    [r, r2] = [r2, r]; [g, g2] = [g2, g]; [b, b2] = [b2, b]; [known, k2] = [k2, known];
    if (!changed) break;
  }
  return { r, g, b };
}

/**
 * Собирает итоговую вырезанную картинку.
 * @param {Uint8ClampedArray} src — RGBA оригинала (полное разрешение), длина w*h*4.
 * @param {Uint8ClampedArray} mask — маска (0..255) того же размера w*h.
 * @param {number} w @param {number} h
 * @param {{shrink:number, feather:number, decontaminate:boolean}} opts
 * @returns {ImageData} готовое RGBA с прозрачным фоном.
 */
export function composeCutout(src, mask, w, h, opts) {
  const shrink = opts.shrink | 0;
  const feather = opts.feather | 0;

  let a = shrink > 0 ? erode(mask, w, h, shrink) : mask;

  // Цвет: либо «затёкший» (без каёмки), либо оригинальный.
  // Источник чистого цвета берём ГЛУБЖЕ края (иначе сам источник загрязнён
  // жёлтым от антиалиасинга) и затекаем им наружу, перекрывая всю кромку.
  let color = null;
  if (opts.decontaminate) {
    const seedDepth = shrink + feather + 2;
    const seed = erode(mask, w, h, seedDepth);
    color = bleedColor(src, seed, w, h, seedDepth + feather + 6);
  }

  a = feather > 0 ? blur(a, w, h, feather) : a;

  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    if (color) {
      out[i * 4] = color.r[i];
      out[i * 4 + 1] = color.g[i];
      out[i * 4 + 2] = color.b[i];
    } else {
      out[i * 4] = src[i * 4];
      out[i * 4 + 1] = src[i * 4 + 1];
      out[i * 4 + 2] = src[i * 4 + 2];
    }
    out[i * 4 + 3] = a[i];
  }
  return new ImageData(out, w, h);
}
