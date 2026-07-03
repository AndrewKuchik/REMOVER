import './style.css';
import { prepare } from './engine.js';
import { composeCutout } from './refine.js';

// --- Элементы ---
const drop = document.getElementById('drop');
const fileInput = document.getElementById('file');
const statusEl = document.getElementById('status');
const statusText = document.getElementById('status-text');
const resultEl = document.getElementById('result');
const canvas = document.getElementById('result-canvas');
const ctx = canvas.getContext('2d');
const origImg = document.getElementById('orig-img');
const cutoutLayer = document.getElementById('cutout-layer');
const divider = document.getElementById('divider');
const compareRange = document.getElementById('compare-range');
const downloadBtn = document.getElementById('download');
const againBtn = document.getElementById('again');

const shrinkEl = document.getElementById('shrink');
const featherEl = document.getElementById('feather');
const decontEl = document.getElementById('decont');
const vShrink = document.getElementById('v-shrink');
const vFeather = document.getElementById('v-feather');
const bgColor = document.getElementById('bg-color');

let prepared = null;
let currentName = 'cutout';
let origUrl = null;

function show(view) {
  drop.hidden = view !== 'drop';
  statusEl.hidden = view !== 'status';
  resultEl.hidden = view !== 'result';
}

// Пересчёт края с текущими настройками (быстро, без нейросети).
function render() {
  if (!prepared) return;
  const { src, mask, w, h } = prepared;
  const img = composeCutout(src, mask, w, h, {
    shrink: +shrinkEl.value,
    feather: +featherEl.value,
    decontaminate: decontEl.checked,
  });
  canvas.width = w;
  canvas.height = h;
  ctx.putImageData(img, 0, 0);
}

// Ползунок «до/после»: слева оригинал, справа результат.
function applyCompare() {
  const v = +compareRange.value; // 100 = весь результат
  cutoutLayer.style.clipPath = `inset(0 ${100 - v}% 0 0)`;
  divider.style.left = `${v}%`;
}

// Фон под прозрачной картинкой.
function setBg(bg, btn) {
  document.querySelectorAll('.sw').forEach((s) => s.classList.remove('active'));
  if (btn) btn.classList.add('active');
  if (bg === 'checker') {
    cutoutLayer.classList.add('checker');
    cutoutLayer.style.background = '';
  } else {
    cutoutLayer.classList.remove('checker');
    cutoutLayer.style.background = bg;
  }
}

async function handleFile(file) {
  if (!file || !file.type.startsWith('image/')) {
    alert('Пожалуйста, выбери картинку (PNG, JPG и т.п.).');
    return;
  }
  currentName = file.name.replace(/\.[^.]+$/, '') || 'cutout';

  show('status');
  statusText.textContent = 'Загрузка движка и обработка… (первый раз дольше — качается модель)';

  try {
    prepared = await prepare(file, (p) => {
      statusText.textContent = `Обработка… ${Math.round(p * 100)}%`;
    });
    if (origUrl) URL.revokeObjectURL(origUrl);
    origUrl = URL.createObjectURL(file);
    origImg.src = origUrl;
    render();
    compareRange.value = 100;
    applyCompare();
    show('result');
  } catch (err) {
    console.error(err);
    show('drop');
    alert('Не получилось обработать картинку: ' + (err?.message || err));
  }
}

// Ползунки края
shrinkEl.addEventListener('input', () => { vShrink.textContent = shrinkEl.value; render(); });
featherEl.addEventListener('input', () => { vFeather.textContent = featherEl.value; render(); });
decontEl.addEventListener('change', render);

// До/после
compareRange.addEventListener('input', applyCompare);

// Фоны
document.querySelectorAll('.sw[data-bg]').forEach((btn) =>
  btn.addEventListener('click', () => setBg(btn.dataset.bg, btn))
);
bgColor.addEventListener('input', () => setBg(bgColor.value, bgColor.closest('.sw')));

// Выбор файла
fileInput.addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  if (file) handleFile(file);
  fileInput.value = '';
});

// Drag & drop
['dragenter', 'dragover'].forEach((ev) =>
  drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('dragover'); })
);
['dragleave', 'drop'].forEach((ev) =>
  drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('dragover'); })
);
drop.addEventListener('drop', (e) => {
  const file = e.dataTransfer?.files?.[0];
  if (file) handleFile(file);
});

// Скачать PNG (полное разрешение)
downloadBtn.addEventListener('click', () => {
  canvas.toBlob((blob) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${currentName}-без-фона.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }, 'image/png');
});

againBtn.addEventListener('click', () => show('drop'));

show('drop');
