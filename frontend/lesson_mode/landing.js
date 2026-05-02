const statusEl = document.getElementById("global-status");

async function checkHealth() {
  try {
    const response = await fetch("/health");
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
    statusEl.textContent = "API: сервер на связи";
    statusEl.className = "status-pill ok";
  } catch (error) {
    statusEl.textContent = `Ошибка API: ${error.message}`;
    statusEl.className = "status-pill bad";
  }
}

checkHealth();
