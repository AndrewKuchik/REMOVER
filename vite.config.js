import { defineConfig } from 'vite';

// base: './' — чтобы сайт работал и локально, и на бесплатном хостинге (GitHub Pages)
// из подпапки, без переписывания путей.
//
// Заголовки COOP/COEP (для многопоточного WASM) НАМЕРЕННО не ставим: при загрузке
// модели @imgly с CDN режим require-corp может заблокировать чужие ресурсы. WebGPU
// (про-режим) в этих заголовках не нуждается.
export default defineConfig({
  base: './',
  optimizeDeps: {
    // не пре-бандлить transformers.js — иначе ломается его собственный ONNX-runtime WASM
    exclude: ['@huggingface/transformers'],
  },
});
