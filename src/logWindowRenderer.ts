// Скрипт окна логов.
// Получает начальный контент лога и новые записи от main через preload API.
// Позволяет экспортировать лог и очистить только вид (не меняет logStore в main).

(() => {

const logArea = document.getElementById('log-area') as HTMLDivElement;
const btnExport = document.getElementById('btn-export') as HTMLButtonElement;
const btnClear = document.getElementById('btn-clear') as HTMLButtonElement;

function appendLine(line: string) {
  const prev = logArea.innerText;
  logArea.innerText = prev ? prev + '\n' + line : line;
  logArea.scrollTop = logArea.scrollHeight;
}

window.electronAPI.onLogContent((_e, content: string) => {
  logArea.innerText = content || '';
  logArea.scrollTop = logArea.scrollHeight;
});

window.electronAPI.onLogAppend((_e, line: string) => { appendLine(line); });

window.electronAPI.onMergeComplete((_e, summary) => {
  appendLine('\n=== Merge complete ===');
  appendLine(JSON.stringify(summary, null, 2));
  appendLine('======================\n');
});

btnExport.addEventListener('click', async () => {
  btnExport.disabled = true;
  try {
    const res = await window.electronAPI.exportLog();
    if (res && res.ok) alert('Лог сохранён: ' + res.path);
    else alert('Ошибка при сохранении лога' + (res?.error ? (': ' + res.error) : ''));
  } finally { btnExport.disabled = false; }
});

btnClear.addEventListener('click', () => { logArea.innerText = ''; });

})();