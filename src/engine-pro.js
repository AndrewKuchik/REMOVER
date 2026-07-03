// engine-pro.js — про-режим: BiRefNet через transformers.js.
// Тяжелее и качественнее (волосы, кружево). Считает на WebGPU, если он есть,
// иначе откатывается на WASM. Модель качается один раз и кэшируется браузером.

import { pipeline } from '@huggingface/transformers';

const MODEL_ID = 'onnx-community/BiRefNet_lite-ONNX';

let segmenter = null;
let loading = null;

function hasWebGPU() {
  return typeof navigator !== 'undefined' && !!navigator.gpu;
}

// У модели есть только fp32 (model.onnx) и fp16 (model_fp16.onnx) — q8 нет.
function load(device, dtype, onProgress) {
  return pipeline('background-removal', MODEL_ID, {
    device,
    dtype,
    progress_callback: (info) => {
      if (onProgress && info && typeof info.progress === 'number') {
        onProgress(info.progress / 100);
      }
    },
  });
}

async function getSegmenter(onProgress) {
  if (segmenter) return segmenter;
  if (!loading) {
    loading = (async () => {
      if (hasWebGPU()) {
        try {
          return await load('webgpu', 'fp16', onProgress);
        } catch (e) {
          console.warn('WebGPU не сработал, откат на WASM:', e);
        }
      }
      return await load('wasm', 'fp32', onProgress);
    })().then((s) => { segmenter = s; return s; });
  }
  return loading;
}

// RawImage → canvas в его родном размере (учитываем число каналов).
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
    } else { // 1 канал — это уже маска
      rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = data[i]; rgba[i * 4 + 3] = 255;
    }
  }
  const c = new OffscreenCanvas(width, height);
  c.getContext('2d').putImageData(new ImageData(rgba, width, height), 0, 0);
  return c;
}

/**
 * Про-подготовка: даёт {src, mask, w, h} того же формата, что и быстрый режим,
 * чтобы дальше работал наш общий слой обработки края (refine.js).
 */
export async function preparePro(file, onProgress) {
  const seg = await getSegmenter(onProgress);

  const url = URL.createObjectURL(file);
  let result;
  try {
    result = await seg(url);
  } finally {
    URL.revokeObjectURL(url);
  }
  const raw = Array.isArray(result) ? result[0] : result;

  // Оригинал в полном разрешении → RGBA
  const origBmp = await createImageBitmap(file);
  const w = origBmp.width, h = origBmp.height;
  const c1 = new OffscreenCanvas(w, h);
  const x1 = c1.getContext('2d');
  x1.drawImage(origBmp, 0, 0);
  const src = x1.getImageData(0, 0, w, h).data;

  // Маска из результата модели, приведённая к размеру оригинала
  const rawCanvas = rawToCanvas(raw);
  const c2 = new OffscreenCanvas(w, h);
  const x2 = c2.getContext('2d');
  x2.drawImage(rawCanvas, 0, 0, w, h);
  const md = x2.getImageData(0, 0, w, h).data;

  const useAlpha = raw.channels === 4; // pipeline вернул вырезку RGBA → маска в альфе
  const mask = new Uint8ClampedArray(w * h);
  for (let i = 0; i < w * h; i++) mask[i] = useAlpha ? md[i * 4 + 3] : md[i * 4];

  return { src, mask, w, h };
}
