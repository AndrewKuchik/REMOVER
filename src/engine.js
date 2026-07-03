// engine.js — обёртка над движком удаления фона.
// Фаза 1: быстрый режим на @imgly/background-removal (работает целиком в браузере).
// В следующих фазах сюда добавится про-режим (BiRefNet) и наш слой обработки края.

import { removeBackground } from '@imgly/background-removal';

/**
 * Убирает фон у картинки.
 * @param {File|Blob|string} input — файл картинки (или URL).
 * @param {(p:number)=>void} onProgress — прогресс 0..1 (для индикатора).
 * @returns {Promise<Blob>} PNG с прозрачным фоном в полном разрешении.
 */
export async function cutout(input, onProgress) {
  const blob = await removeBackground(input, {
    output: { format: 'image/png' },
    progress: (key, current, total) => {
      // key вида "fetch:..." (загрузка модели) или "compute:..." (обработка).
      if (onProgress && total) onProgress(current / total);
    },
  });
  return blob;
}
