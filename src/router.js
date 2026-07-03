// router.js — выбирает движок. По умолчанию МГНОВЕННЫЙ кейер (0 МБ, без загрузки).
// Нейросеть (RMBG) грузится ЛЕНИВО — только когда пользователь явно её попросит,
// поэтому transformers.js НЕ попадает в стартовую загрузку сайта (мгновенный старт).

import { autoKey, borderUniformity } from './keyer.js';

// Растянуть маску mw×mh → w×h (билинейно, без сторонних зависимостей).
function upscaleMask(m, mw, mh, w, h) {
  if (mw === w && mh === h) return m;
  const rgba = new Uint8ClampedArray(mw * mh * 4);
  for (let i = 0; i < mw * mh; i++) {
    rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = m[i];
    rgba[i * 4 + 3] = 255;
  }
  const cS = new OffscreenCanvas(mw, mh);
  cS.getContext('2d').putImageData(new ImageData(rgba, mw, mh), 0, 0);
  const cB = new OffscreenCanvas(w, h);
  const xb = cB.getContext('2d');
  xb.imageSmoothingEnabled = true;
  xb.drawImage(cS, 0, 0, w, h);
  const d = xb.getImageData(0, 0, w, h).data;
  const out = new Uint8ClampedArray(w * h);
  for (let i = 0; i < w * h; i++) out[i] = d[i * 4];
  return out;
}

// Мгновенный путь: кейер на уменьшенном прокси (≤1024), маска — на оригинал.
export async function prepareInstant(file, opts = {}) {
  const bmp = await createImageBitmap(file);
  const w = bmp.width, h = bmp.height;

  const cF = new OffscreenCanvas(w, h);
  cF.getContext('2d').drawImage(bmp, 0, 0);
  const src = cF.getContext('2d').getImageData(0, 0, w, h).data;

  const scale = Math.min(1, 1024 / Math.max(w, h));
  const pw = Math.max(1, Math.round(w * scale));
  const ph = Math.max(1, Math.round(h * scale));
  const cP = new OffscreenCanvas(pw, ph);
  cP.getContext('2d').drawImage(bmp, 0, 0, pw, ph);
  const psrc = cP.getContext('2d').getImageData(0, 0, pw, ph).data;

  const tol = opts.tol ?? 26;
  const soft = opts.soft ?? 12;
  const pmask = autoKey(psrc, pw, ph, tol, soft);
  const mask = upscaleMask(pmask, pw, ph, w, h);
  const uniformity = borderUniformity(psrc, pw, ph);

  // прокси храним — чтобы мгновенно пере-считать маску при смене чувствительности
  return { src, mask, w, h, meta: { engine: 'instant', uniformity, proxy: { psrc, pw, ph } } };
}

// Быстрый пере-расчёт маски по сохранённому прокси (для ползунка чувствительности).
export function keyFromProxy(proxy, w, h, tol, soft = 12) {
  const pmask = autoKey(proxy.psrc, proxy.pw, proxy.ph, tol, soft);
  return upscaleMask(pmask, proxy.pw, proxy.ph, w, h);
}

// Нейросеть — ленивая загрузка модуля с transformers.
export async function prepareNeural(file, onProgress) {
  const { prepare } = await import('./engine.js');
  const r = await prepare(file, onProgress);
  return { ...r, meta: { engine: 'neural' } };
}

// Диспетчер по режиму.
export async function prepareAuto(file, mode, onProgress, opts) {
  return mode === 'neural'
    ? prepareNeural(file, onProgress)
    : prepareInstant(file, opts);
}
