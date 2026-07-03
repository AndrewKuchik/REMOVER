import './style.css';
import { prepare } from './engine.js';
import { composeCutout } from './refine.js';

// --- Элементы ---
const drop = document.getElementById('drop');
const fileInput = document.getElementById('file');
const statusEl = document.getElementById('status');
const statusText = document.getElementById('status-text');
const statusSub = document.getElementById('status-sub');
const barWrap = document.getElementById('bar-wrap');
const barFill = document.getElementById('bar-fill');
const noticeEl = document.getElementById('notice');
const noticeText = document.getElementById('notice-text');
const noticeRetry = document.getElementById('notice-retry');
const noticeBack = document.getElementById('notice-back');
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

function show(view) {
  drop.hidden = view !== 'drop';
  statusEl.hidden = view !== 'status';
  noticeEl.hidden = view !== 'notice';
  resultEl.hidden = view !== 'result';
}

// --- Статус: спокойное скачивание (полоса + МБ) → обработка (счётчик) ---
let procTimer = null;
function stopProcTimer() { if (procTimer) { clearInterval(procTimer); procTimer = null; } }

function statusDownloading(info) {
  stopProcTimer();
  barWrap.hidden = false;
  const pct = Math.round((info.progress || 0) * 100);
  barFill.style.width = pct + '%';
  statusText.textContent = 'Настраиваю на твоём устройстве…';
  const mb = info.totalMB ? ` · ${Math.round(info.loadedMB)}/${Math.round(info.totalMB)} МБ` : '';
  statusSub.textContent = `Загружаю модель один раз (${pct}%${mb}) — дальше мгновенно и без интернета.`;
}
function statusProcessing() {
  if (procTimer) return;
  barWrap.hidden = true;
  const t0 = performance.now();
  const tick = () => {
    const s = Math.round((performance.now() - t0) / 1000);
    statusText.textContent = 'Обрабатываю картинку…';
    statusSub.textContent = `${s} с · идёт вычисление, не закрывай вкладку.`;
  };
  tick();
  procTimer = setInterval(tick, 1000);
}
function onProgress(info) {
  if (!info) return;
  if (info.stage === 'compute') statusProcessing();
  else statusDownloading(info);
}

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

function applyCompare() {
  const v = +compareRange.value;
  cutoutLayer.style.clipPath = `inset(0 ${100 - v}% 0 0)`;
  divider.style.left = `${v}%`;
}

function setBg(bg, btn) {
  document.querySelectorAll('.sw').forEach((s) => s.classList.remove('active'));
  if (btn) btn.classList.add('active');
  if (bg === 'checker') { cutoutLayer.classList.add('checker'); cutoutLayer.style.background = ''; }
  else { cutoutLayer.classList.remove('checker'); cutoutLayer.style.background = bg; }
}

async function handleFile(file) {
  if (!file || !file.type.startsWith('image/')) {
    showNotice('Это не похоже на картинку. Выбери файл PNG, JPG и т.п.');
    return;
  }
  currentFile = file;
  currentName = file.name.replace(/\.[^.]+$/, '') || 'cutout';

  show('status');
  statusText.textContent = 'Готовлю…';
  statusSub.textContent = '';
  barWrap.hidden = true;

  try {
    prepared = await prepare(file, onProgress);
    stopProcTimer();
    if (origUrl) URL.revokeObjectURL(origUrl);
    origUrl = URL.createObjectURL(file);
    origImg.src = origUrl;
    render();
    compareRange.value = 100;
    applyCompare();
    show('result');
  } catch (err) {
    console.error(err);
    stopProcTimer();
    showNotice(err);
  }
}

function showNotice(err) {
  const msg = typeof err === 'string' ? err : String(err?.message || err || '');
  noticeText.textContent = typeof err === 'string'
    ? msg
    : 'Не получилось обработать эту картинку. Попробуй ещё раз или выбери другую.';
  show('notice');
}

// --- Настройки края ---
shrinkEl.addEventListener('input', () => { vShrink.textContent = shrinkEl.value; render(); });
featherEl.addEventListener('input', () => { vFeather.textContent = featherEl.value; render(); });
decontEl.addEventListener('change', render);

// --- До/после ---
compareRange.addEventListener('input', applyCompare);

// --- Фоны ---
document.querySelectorAll('.sw[data-bg]').forEach((btn) =>
  btn.addEventListener('click', () => setBg(btn.dataset.bg, btn))
);
bgColor.addEventListener('input', () => setBg(bgColor.value, bgColor.closest('.sw')));

// --- Выбор файла ---
fileInput.addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  if (file) handleFile(file);
  fileInput.value = '';
});

// --- Drag & drop ---
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

// --- Скачать PNG ---
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
noticeRetry.addEventListener('click', () => { if (currentFile) handleFile(currentFile); else show('drop'); });
noticeBack.addEventListener('click', () => show('drop'));

show('drop');
