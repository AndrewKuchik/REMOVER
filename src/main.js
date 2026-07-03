import './style.css';
import { prepare } from './engine.js';
import { composeCutout } from './refine.js';

// --- Элементы ---
const drop = document.getElementById('drop');
const fileInput = document.getElementById('file');
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
// оверлей обработки
const proc = document.getElementById('proc');
const procLabel = document.getElementById('proc-label');
const procSub = document.getElementById('proc-sub');
const barWrap = document.getElementById('bar-wrap');
const barFill = document.getElementById('bar-fill');

let prepared = null;
let currentName = 'cutout';
let origUrl = null;
let currentFile = null;

function show(view) {
  drop.hidden = view !== 'drop';
  noticeEl.hidden = view !== 'notice';
  resultEl.hidden = view !== 'result';
}

// --- Обработка прямо на месте результата ---
let procTimer = null;
function stopProcTimer() { if (procTimer) { clearInterval(procTimer); procTimer = null; } }

function enterProcessing() {
  resultEl.classList.add('processing');
  proc.hidden = true;      // оверлей появится либо на скачивании, либо через 800 мс
  barWrap.hidden = true;
  stopProcTimer();
}
function exitProcessing() {
  resultEl.classList.remove('processing');
  proc.hidden = true;
  stopProcTimer();
}
function showDownload(info) {
  proc.hidden = false;
  barWrap.hidden = false;
  const pct = Math.round((info.progress || 0) * 100);
  barFill.style.width = pct + '%';
  procLabel.textContent = 'Настройка (один раз)…';
  const mb = info.totalMB ? ` · ${Math.round(info.loadedMB)}/${Math.round(info.totalMB)} МБ` : '';
  procSub.textContent = `Загружаю модель ${pct}%${mb} — дальше мгновенно, без интернета`;
}
function showCompute() {
  proc.hidden = false;
  barWrap.hidden = true;
  procLabel.textContent = 'Убираю фон…';
  const t0 = performance.now();
  stopProcTimer();
  const tick = () => { procSub.textContent = `${Math.round((performance.now() - t0) / 1000)} с`; };
  tick();
  procTimer = setInterval(tick, 1000);
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

  // Показать оригинал сразу на месте результата
  if (origUrl) URL.revokeObjectURL(origUrl);
  origUrl = URL.createObjectURL(file);
  origImg.src = origUrl;
  compareRange.value = 100;
  applyCompare();
  enterProcessing();
  show('result');

  let delay = null;
  try {
    prepared = await prepare(file, (info) => {
      if (info.stage === 'download') {
        if (delay) { clearTimeout(delay); delay = null; }
        showDownload(info);
      } else if (info.stage === 'compute') {
        if (!proc.hidden) showCompute();               // уже показывали скачивание — переключаем
        else if (!delay) delay = setTimeout(showCompute, 800); // иначе через 800 мс (без мельканий)
      }
    });
    if (delay) clearTimeout(delay);
    exitProcessing();
    render();
    show('result');
  } catch (err) {
    console.error(err);
    if (delay) clearTimeout(delay);
    exitProcessing();
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
