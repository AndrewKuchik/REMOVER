import { defineConfig } from 'vite';

// base: './' — чтобы сайт работал и локально, и на бесплатном хостинге (GitHub Pages)
// из подпапки, без переписывания путей.
export default defineConfig({
  base: './',
  server: {
    // Заголовки нужны для WebGPU/потоков в про-режиме (Фаза 4). Ставим заранее.
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});
