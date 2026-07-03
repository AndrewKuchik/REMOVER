// engine.js — обёртка над движком удаления фона.
// Быстрый режим на @imgly/background-removal (работает целиком в браузере).
// В про-режиме (Фаза 4) сюда добавится BiRefNet.

import { segmentForeground } from '@imgly/background-removal';

/**
 * Получить маску объекта (без наложения). Мы наложим её сами на оригинал
 * в полном разрешении — так контролируем край (см. refine.js).
 * @param {File|Blob|string} input
 * @param {(p:number)=>void} onProgress — прогресс 0..1
 * @returns {Promise<Blob>} серая маска (белое = объект).
 */
export async function getMask(input, onProgress) {
  return await segmentForeground(input, {
    progress: (key, current, total) => {
      if (onProgress && total) onProgress(current / total);
    },
  });
}

/** Декодировать файл/blob в ImageBitmap. */
export async function toBitmap(input) {
  const blob = input instanceof Blob ? input : await (await fetch(input)).blob();
  return await createImageBitmap(blob);
}

/**
 * Достаёт RGBA оригинала и маску, приведённую к тому же размеру.
 * @returns {{src:Uint8ClampedArray, mask:Uint8ClampedArray, w:number, h:number}}
 */
export async function prepare(input, onProgress) {
  const [origBmp, maskBlob] = await Promise.all([
    toBitmap(input),
    getMask(input, onProgress),
  ]);
  const w = origBmp.width, h = origBmp.height;

  // оригинал → RGBA
  const c1 = new OffscreenCanvas(w, h);
  const x1 = c1.getContext('2d');
  x1.drawImage(origBmp, 0, 0);
  const src = x1.getImageData(0, 0, w, h).data;

  // маска → тот же размер, берём канал R как значение маски
  const maskBmp = await createImageBitmap(maskBlob);
  const c2 = new OffscreenCanvas(w, h);
  const x2 = c2.getContext('2d');
  x2.drawImage(maskBmp, 0, 0, w, h);
  const md = x2.getImageData(0, 0, w, h).data;
  const mask = new Uint8ClampedArray(w * h);
  for (let i = 0; i < w * h; i++) mask[i] = md[i * 4];

  return { src, mask, w, h };
}
