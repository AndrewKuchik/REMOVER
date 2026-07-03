// cleanup.js — очистка маски от «грязи» (тумана и мелких точек-островков).
// Работает на РОДНОМ разрешении маски (1024²) ДО растягивания на оригинал,
// иначе шум размазывается в широкий ореол. Чистые типизированные операции —
// тестируются в Node.

// 1) Медианный фильтр 3×3 — убирает «соль-перец», сохраняя края.
export function median3(a, w, h) {
  const out = new Uint8ClampedArray(a.length);
  const win = new Uint8Array(9);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = Math.min(h - 1, Math.max(0, y + dy));
        for (let dx = -1; dx <= 1; dx++) {
          const xx = Math.min(w - 1, Math.max(0, x + dx));
          win[n++] = a[yy * w + xx];
        }
      }
      win.sort(); // типизированный массив сортируется численно
      out[y * w + x] = win[4];
    }
  }
  a.set(out);
}

// 2) Кривая альфы (smoothstep): всё ниже t1 → 0 (убивает туман фона),
//    всё выше t2 → 255 (уплотняет объект), между — плавно.
export function alphaCurve(a, t1 = 0.12, t2 = 0.88) {
  const lut = new Uint8Array(256);
  const lo = t1 * 255, hi = t2 * 255;
  for (let v = 0; v < 256; v++) {
    let t = hi > lo ? (v - lo) / (hi - lo) : (v >= hi ? 1 : 0);
    t = Math.min(1, Math.max(0, t));
    lut[v] = Math.round(t * t * (3 - 2 * t) * 255);
  }
  for (let i = 0; i < a.length; i++) a[i] = lut[a[i]];
}

// 3) Удаление мелких «островков»: связные компоненты (8-связность) по alpha>bin;
//    компоненты площадью < minArea обнуляем. У выживших альфа не трогается.
export function removeSpecks(a, w, h, bin = 16, minArea = 64) {
  const n = w * h;
  const seen = new Uint8Array(n);
  const stack = new Int32Array(n);
  const comp = new Int32Array(n);
  for (let s = 0; s < n; s++) {
    if (a[s] <= bin || seen[s]) continue;
    let sp = 0, cn = 0;
    stack[sp++] = s; seen[s] = 1;
    while (sp > 0) {
      const idx = stack[--sp];
      comp[cn++] = idx;
      const x = idx % w, y = (idx / w) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy; if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx; if (xx < 0 || xx >= w) continue;
          const ni = yy * w + xx;
          if (!seen[ni] && a[ni] > bin) { seen[ni] = 1; stack[sp++] = ni; }
        }
      }
    }
    if (cn < minArea) for (let i = 0; i < cn; i++) a[comp[i]] = 0;
  }
}

// --- Морфология (min/max), раздельно по осям ---
function morph(a, w, h, r, max) {
  if (r <= 0) return;
  const tmp = new Uint8ClampedArray(w * h);
  const pick = (best, v) => (max ? (v > best ? v : best) : (v < best ? v : best));
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let b = a[row + x];
      for (let d = -r; d <= r; d++) {
        const xx = Math.min(w - 1, Math.max(0, x + d));
        b = pick(b, a[row + xx]);
      }
      tmp[row + x] = b;
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let b = tmp[y * w + x];
      for (let d = -r; d <= r; d++) {
        const yy = Math.min(h - 1, Math.max(0, y + d));
        b = pick(b, tmp[yy * w + x]);
      }
      a[y * w + x] = b;
    }
  }
}
// Открытие (эрозия→дилатация): убирает нити/шум. Закрытие: заполняет дырки.
export function open(a, w, h, r) { morph(a, w, h, r, false); morph(a, w, h, r, true); }
export function close(a, w, h, r) { morph(a, w, h, r, true); morph(a, w, h, r, false); }

/**
 * Полная очистка маски на родном разрешении.
 * @param {Uint8ClampedArray} a — маска 0..255 (мутируется)
 */
export function cleanMask(a, w, h, opts = {}) {
  const t1 = opts.t1 ?? 0.12;
  const t2 = opts.t2 ?? 0.88;
  const minArea = opts.minArea ?? Math.max(64, (w * h * 0.0002) | 0);
  median3(a, w, h);
  alphaCurve(a, t1, t2);
  removeSpecks(a, w, h, 16, minArea);
  open(a, w, h, 1);
  close(a, w, h, 2);
}
