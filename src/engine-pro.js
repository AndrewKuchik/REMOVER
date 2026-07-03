// engine-pro.js — режим «Качество».
// Надёжная стратегия без падений по памяти:
//   • есть WebGPU → BiRefNet_lite fp16 (лучший край, память на видеокарте) — топ-качество;
//   • нет WebGPU  → откат на лёгкий движок @imgly (ISNet). Он не переполняет память CPU.
// Вход для BiRefNet уменьшаем до 2048px (модель считает в 1024² — качество то же,
// память меньше). Маску всегда накладываем на оригинал в полном разрешении.

import { pipeline, RawImage } from '@huggingface/transformers';
import { prepare as prepareFast } from './engine.js';

const GPU_MODEL = 'onnx-community/BiRefNet_lite-ONNX';

let birefnet = null;
let loadingBiRefNet = null;
export const info = { device: '', model: '' }; // что реально используется (для интерфейса)

async function hasWebGPU() {
  if (typeof navigator === 'undefined' || !('gpu' in navigator)) return false;
  try {
    return !!(await navigator.gpu.requestAdapter());
  } catch {
    return false;
  }
}

function loadBiRefNet(onProgress) {
  if (birefnet) return Promise.resolve(birefnet);
  if (!loadingBiRefNet) {
    loadingBiRefNet = pipeline('background-removal', GPU_MODEL, {
      device: 'webgpu',
      dtype: 'fp16',
      progress_callback: (p) => {
        if (onProgress && p && typeof p.progress === 'number') {
          onProgress({ stage: 'download', progress: p.progress / 100 });
        }
      },
    }).then((s) => { birefnet = s; return s; });
  }
  return loadingBiRefNet;
}

// Уменьшить картинку до maxSide и вернуть RawImage для модели.
async function downscaleToRawImage(file, maxSide = 2048) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const c = new OffscreenCanvas(w, h);
  c.getContext('2d').drawImage(bmp, 0, 0, w, h);
  const d = c.getContext('2d').getImageData(0, 0, w, h);
  return new RawImage(d.data, w, h, 4);
}

function rawToCanvas(raw) {
  const { data, width, height, channels } = raw;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    if (channels === 4) {
      rgba[i * 4] = data[i * 4]; rgba[i * 4 + 1] = data[i * 4 + 1];
      rgba[i * 4 + 2] = data[i * 4 + 2]; rgba[i * 4 + 3] = data[i * 4 + 3];
    } else if (channels === 3) {
      rgba[i * 4] = data[i * 3]; rgba[i * 4 + 1] = data[i * 3 + 1];
      rgba[i * 4 + 2] = data[i * 3 + 2]; rgba[i * 4 + 3] = 255;
    } else {
      rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = data[i]; rgba[i * 4 + 3] = 255;
    }
  }
  const c = new OffscreenCanvas(width, height);
  c.getContext('2d').putImageData(new ImageData(rgba, width, height), 0, 0);
  return c;
}

async function prepareBiRefNet(file, onProgress) {
  const seg = await loadBiRefNet(onProgress);
  if (onProgress) onProgress({ stage: 'compute' });

  const input = await downscaleToRawImage(file, 2048);
  const result = await seg(input);
  const raw = Array.isArray(result) ? result[0] : result;

  const origBmp = await createImageBitmap(file);
  const w = origBmp.width, h = origBmp.height;
  const c1 = new OffscreenCanvas(w, h);
  c1.getContext('2d').drawImage(origBmp, 0, 0);
  const src = c1.getContext('2d').getImageData(0, 0, w, h).data;

  const rawCanvas = rawToCanvas(raw);
  const c2 = new OffscreenCanvas(w, h);
  c2.getContext('2d').drawImage(rawCanvas, 0, 0, w, h);
  const md = c2.getContext('2d').getImageData(0, 0, w, h).data;

  const useAlpha = raw.channels === 4;
  const mask = new Uint8ClampedArray(w * h);
  for (let i = 0; i < w * h; i++) mask[i] = useAlpha ? md[i * 4 + 3] : md[i * 4];

  return { src, mask, w, h };
}

/** Про-подготовка: {src, mask, w, h}. Сама выбирает лучший доступный путь. */
export async function preparePro(file, onProgress) {
  if (await hasWebGPU()) {
    try {
      const r = await prepareBiRefNet(file, onProgress);
      info.device = 'WebGPU'; info.model = 'BiRefNet';
      return r;
    } catch (e) {
      console.warn('BiRefNet не сработал, откат на @imgly:', e);
    }
  }
  // Надёжный откат: лёгкий движок быстрого режима (не падает по памяти).
  info.device = 'CPU'; info.model = 'ISNet';
  return await prepareFast(file, onProgress);
}
