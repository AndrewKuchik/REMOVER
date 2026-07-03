// engine.js — единый движок вырезания фона.
// Модель: RMBG-1.4 (q8, ~44 МБ) через transformers.js. Считает на процессоре (WASM),
// работает во всех браузерах без видеокарты и не переполняет память. Маску отдаём
// в общий слой обработки края (refine.js) и накладываем на оригинал в полном разрешении.

import { AutoModel, AutoProcessor, RawImage } from '@huggingface/transformers';
import { cleanMask } from './cleanup.js';

const MODEL_ID = 'briaai/RMBG-1.4';

let modelP = null;
let procP = null;

// Загрузка модели один раз. Прогресс агрегируем по всем файлам → общий процент и МБ.
function getModel(onProgress) {
  if (!modelP) {
    const files = {};
    const cb = (e) => {
      if (e && e.file && typeof e.loaded === 'number') {
        files[e.file] = { loaded: e.loaded, total: e.total || 0 };
      }
      let loaded = 0, total = 0;
      for (const k in files) { loaded += files[k].loaded; total += files[k].total; }
      if (onProgress && total > 0) {
        onProgress({ stage: 'download', progress: loaded / total, loadedMB: loaded / 1e6, totalMB: total / 1e6 });
      }
    };
    modelP = AutoModel.from_pretrained(MODEL_ID, {
      config: { model_type: 'custom' }, // обходим неверное определение как Segformer
      dtype: 'q8',
      device: 'wasm',
      progress_callback: cb,
    });
    procP = AutoProcessor.from_pretrained(MODEL_ID);
  }
  return Promise.all([modelP, procP]);
}

// Растянуть маску mw×mh → w×h через canvas (билинейно).
function upscaleMask(m, mw, mh, w, h) {
  const rgba = new Uint8ClampedArray(mw * mh * 4);
  for (let i = 0; i < mw * mh; i++) {
    rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = m[i];
    rgba[i * 4 + 3] = 255;
  }
  const cSmall = new OffscreenCanvas(mw, mh);
  cSmall.getContext('2d').putImageData(new ImageData(rgba, mw, mh), 0, 0);
  const cBig = new OffscreenCanvas(w, h);
  const xb = cBig.getContext('2d');
  xb.imageSmoothingEnabled = true;
  xb.drawImage(cSmall, 0, 0, w, h);
  const d = xb.getImageData(0, 0, w, h).data;
  const mask = new Uint8ClampedArray(w * h);
  for (let i = 0; i < w * h; i++) mask[i] = d[i * 4];
  return mask;
}

// Уменьшить до maxSide и вернуть RawImage (RGB) для модели.
function toModelInput(bmp, maxSide = 1024) {
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const c = new OffscreenCanvas(w, h);
  const x = c.getContext('2d');
  x.drawImage(bmp, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h);
  return new RawImage(d.data, w, h, 4).rgb();
}

/**
 * Подготовка: {src, mask, w, h}.
 * src — RGBA оригинала (полное разрешение); mask — 0..255 того же размера.
 */
export async function prepare(file, onProgress) {
  const [model, processor] = await getModel(onProgress);
  if (onProgress) onProgress({ stage: 'compute' });

  const origBmp = await createImageBitmap(file);
  const w = origBmp.width, h = origBmp.height;

  // Оригинал → RGBA (для наложения и деконтаминации)
  const c1 = new OffscreenCanvas(w, h);
  const x1 = c1.getContext('2d');
  x1.drawImage(origBmp, 0, 0);
  const src = x1.getImageData(0, 0, w, h).data;

  // Инференс (вход уменьшен — модель всё равно считает в 1024², память меньше)
  const input = toModelInput(origBmp, 1024);
  const { pixel_values } = await processor(input);
  const out = await model({ input: pixel_values });
  const tensor = out.output ?? out[Object.keys(out)[0]];

  // Маска на РОДНОМ разрешении (без растягивания)
  const maskRaw = await RawImage.fromTensor(tensor[0].mul(255).to('uint8'));
  const mw = maskRaw.width, mh = maskRaw.height, ch = maskRaw.channels;
  const mNative = new Uint8ClampedArray(mw * mh);
  for (let i = 0; i < mw * mh; i++) mNative[i] = maskRaw.data[i * ch];

  // Чистим грязь/точки/туман ДО растягивания
  cleanMask(mNative, mw, mh);

  // Растягиваем очищенную маску до размера оригинала (билинейно, через canvas)
  const mask = upscaleMask(mNative, mw, mh, w, h);

  return { src, mask, w, h };
}
