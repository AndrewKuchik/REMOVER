import './style.css';

// Фаза 0 — каркас. Здесь пока только проверка, что сборка и запуск работают.
// Логика вырезания фона появится в Фазе 1.

const main = document.getElementById('main');
main.innerHTML = `
  <p style="text-align:center; color: var(--muted)">
    Каркас работает ✅<br />
    Здесь появится загрузка картинки и удаление фона (Фаза 1).
  </p>
`;
