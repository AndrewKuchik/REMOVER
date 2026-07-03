import './style.css';
import { prepare } from './engine.js';
import { composeCutout } from './refine.js';
// про-движок (transformers.js) грузим лениво — только когда выбран режим «Качество»

// --- Элементы ---
const drop = document.getElementById('drop');
const fileInput = document.getElementById('file');
const statusEl = document.getElementById('status');
const statusText = document.getElementById('status-text');
const statusSub = document.getElementById('status-sub');
const errorEl = document.getElementById('error');
const errorText = document.getElementById('error-text');
const errRetry = document.getElementById('err-retry');
const errFast = document.getElementById('err-fast');
const errBack = document.getElementById('err-back');
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
let currentFile = null;

const getMode = () => document.querySelector('input[name="mode"]:checked')?.value || 'fast';

function show(view) {
  drop.hidden = view !== 'drop';
  statusEl.hidden = view !== 'status';
  errorEl.hidden = view !== 'error';
  resultEl.hidden = view !== 'result';
}

// --- Контроллер статуса: скачивание (проценты) → обработка (счётчик секунд) ---
let procTimer = null;
function stopProcTimer() { if (procTimer) { clearInterval(procTimer); procTimer = null; } }

function statusDownloading(p) {
  stopProcTimer();
  statusText.textContent = `Скачиваю модель… ${Math.round((p || 0) * 100)}%`;
  statusSub.textContent = 'Это разовая загрузка — потом модель берётся из кэша мгновенно.';
}
function statusProcessing() {
  if (procTimer) return; // уже идёт
  const t0 = performance.now();
  const tick = () => {
    const s = Math.round((performance.now() - t0) / 1000);
    statusText.textContent = `Обрабатываю картинку… ${s} с`;
    statusSub.textContent = 'Идёт вычисление, не закрывай вкладку.';
  };
  tick();
  procTimer = setInterval(tick, 1000);
}
function onProgress(info) {
  if (!info) return;
  if (info.stage === 'compute') statusProcessing();
  else statusDownloading(info.progress);
}

// Показать, какой движок/устройство реально сработали.
function setEngineNote(info) {
  const hint = document.querySelector('.mode-hint');
  if (!hint) return;
  if (info && info.model) {
    const dev = info.device === 'WebGPU' ? 'на видеокарте (WebGPU)' : 'на процессоре';
    const extra = info.model === 'ISNet' ? ' — WebGPU недоступен, взят лёгкий движок' : '';
    hint.textContent = `Использовано: ${info.model} ${dev}${extra}.`;
  } else {
    hint.textContent = 'Быстрый режим (ISNet). «💎 Качество» точнее на волосах/кружеве.';
  }
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
  currentFile = file;
  currentName = file.name.replace(/\.[^.]+$/, '') || 'cutout';
  const mode = getMode();

  show('status');
  statusText.textContent = 'Готовлю…';
  statusSub.textContent = '';

  try {
    const proMod = mode === 'pro' ? await import('./engine-pro.js') : null;
    const run = proMod ? proMod.preparePro : prepare;
    prepared = await run(file, onProgress);
    stopProcTimer();
    setEngineNote(proMod ? proMod.info : null);
    if (origUrl) URL.revokeObjectURL(origUrl);
    origUrl = URL.createObjectURL(file);
    origImg.src = origUrl;
    render();
    compareRange.value = 100;
    applyCompare();
    show('result'); // окно загрузки закрывается — работа готова
  } catch (err) {
    console.error(err);
    stopProcTimer();
    showError(err, mode);
  }
}

// Понятная ошибка вместо alert.
function showError(err, mode) {
  const msg = String(err?.message || err || '');
  const isMemory = /bad_alloc|out of memory|OrtRun|allocation/i.test(msg);
  if (mode === 'pro' && isMemory) {
    errorText.innerHTML = 'Режим «💎 Качество» не хватило памяти на этой картинке/устройстве. ' +
      'Попробуй режим «⚡ Быстро» — он лёгкий и почти всегда справляется.';
    errFast.hidden = false;
  } else {
    errorText.textContent = 'Не получилось обработать картинку. ' + (msg ? '(' + msg + ')' : '');
    errFast.hidden = mode !== 'pro';
  }
  show('error');
}

// Ползунки края
shrinkEl.addEventListener('input', () => { vShrink.textContent = shrinkEl.value; render(); });
featherEl.addEventListener('input', () => { vFeather.textContent = featherEl.value; render(); });
decontEl.addEventListener('change', render);

// До/после
compareRange.addEventListener('input', applyCompare);

// Смена режима качества — переобработать текущую картинку
document.querySelectorAll('input[name="mode"]').forEach((r) =>
  r.addEventListener('change', () => { if (currentFile) handleFile(currentFile); })
);

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

// Кнопки панели ошибки
errRetry.addEventListener('click', () => { if (currentFile) handleFile(currentFile); });
errFast.addEventListener('click', () => {
  const fast = document.querySelector('input[name="mode"][value="fast"]');
  if (fast) fast.checked = true;
  if (currentFile) handleFile(currentFile);
});
errBack.addEventListener('click', () => show('drop'));

// Честное предупреждение, если у браузера нет WebGPU (про-режим будет медленным).
if (typeof navigator !== 'undefined' && !navigator.gpu) {
  const hint = document.querySelector('.mode-hint');
  if (hint) hint.textContent = '«Качество» точнее, но в этом браузере нет WebGPU — считает медленно.';
}

show('drop');
