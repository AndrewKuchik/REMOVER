import './style.css';
import { cutout } from './engine.js';

// --- Элементы страницы ---
const drop = document.getElementById('drop');
const fileInput = document.getElementById('file');
const statusEl = document.getElementById('status');
const statusText = document.getElementById('status-text');
const resultEl = document.getElementById('result');
const resultImg = document.getElementById('result-img');
const downloadBtn = document.getElementById('download');
const againBtn = document.getElementById('again');

let currentUrl = null;      // objectURL результата (для очистки памяти)
let currentName = 'cutout'; // имя исходного файла (для скачивания)

// --- Переключение экранов: загрузка / обработка / результат ---
function show(view) {
  drop.hidden = view !== 'drop';
  statusEl.hidden = view !== 'status';
  resultEl.hidden = view !== 'result';
}

// --- Обработка выбранного файла ---
async function handleFile(file) {
  if (!file || !file.type.startsWith('image/')) {
    alert('Пожалуйста, выбери картинку (PNG, JPG и т.п.).');
    return;
  }
  currentName = file.name.replace(/\.[^.]+$/, '') || 'cutout';

  show('status');
  statusText.textContent = 'Загрузка движка и обработка… (первый раз дольше — качается модель)';

  try {
    const blob = await cutout(file, (p) => {
      const pct = Math.round(p * 100);
      statusText.textContent = `Обработка… ${pct}%`;
    });

    if (currentUrl) URL.revokeObjectURL(currentUrl);
    currentUrl = URL.createObjectURL(blob);
    resultImg.src = currentUrl;
    show('result');
  } catch (err) {
    console.error(err);
    show('drop');
    alert('Не получилось обработать картинку: ' + (err?.message || err));
  }
}

// --- Клик / выбор файла ---
fileInput.addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  if (file) handleFile(file);
  fileInput.value = ''; // чтобы можно было выбрать тот же файл повторно
});

// --- Drag & drop ---
['dragenter', 'dragover'].forEach((ev) =>
  drop.addEventListener(ev, (e) => {
    e.preventDefault();
    drop.classList.add('dragover');
  })
);
['dragleave', 'drop'].forEach((ev) =>
  drop.addEventListener(ev, (e) => {
    e.preventDefault();
    drop.classList.remove('dragover');
  })
);
drop.addEventListener('drop', (e) => {
  const file = e.dataTransfer?.files?.[0];
  if (file) handleFile(file);
});

// --- Скачать PNG ---
downloadBtn.addEventListener('click', () => {
  if (!currentUrl) return;
  const a = document.createElement('a');
  a.href = currentUrl;
  a.download = `${currentName}-без-фона.png`;
  a.click();
});

// --- Другая картинка ---
againBtn.addEventListener('click', () => show('drop'));

// Старт
show('drop');
