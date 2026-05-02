import {
  buildMatchPairUpdate,
  buildBinaryToggleUpdate,
  buildMultipleChoiceUpdate,
  buildOrderingMoveUpdate,
  buildPowerToggleUpdate,
  escapeHtml,
  renderStudentWidget,
  widgetProgressFromParticipant,
} from "./widget_runtime.js";

const CURRENT_RUN_STORAGE_KEY = "teachereye.lessonMode.currentRunId";
const CURRENT_SESSION_STORAGE_KEY = "teachereye.lessonMode.studentSessionId";

const state = {
  runId: null,
  sessionId: null,
  run: null,
  lesson: null,
  participant: null,
  pollTimer: null,
  lastSceneId: null,
};

const els = {
  status: document.getElementById("global-status"),
  studentClassInput: document.getElementById("student-class-input"),
  studentNameInput: document.getElementById("student-name-input"),
  studentSessionMeta: document.getElementById("student-session-meta"),
  studentRunIdInput: document.getElementById("student-run-id-input"),
  studentRunMeta: document.getElementById("student-run-meta"),
  studentSceneMeta: document.getElementById("student-scene-meta"),
  studentSceneTitle: document.getElementById("student-scene-title"),
  studentWidgets: document.getElementById("student-widgets"),
  codeEditor: document.getElementById("code-editor"),
  codeOutput: document.getElementById("code-output"),
  codeRunMeta: document.getElementById("code-run-meta"),
  prevBtn: document.getElementById("student-prev-btn"),
  nextBtn: document.getElementById("student-next-btn"),
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const body = await response.json();
      detail = body.detail || JSON.stringify(body);
    } catch {
      // Ignore parse issues.
    }
    throw new Error(detail);
  }
  return response.json();
}

function setStatus(text, kind = "ok") {
  els.status.textContent = text;
  els.status.className = `status-pill ${kind}`;
}

async function checkHealth() {
  try {
    await api("/health");
    setStatus("API: сервер на связи", "ok");
  } catch (error) {
    setStatus(`Ошибка API: ${error.message}`, "bad");
  }
}

function currentScene() {
  if (!state.lesson || !state.participant) return null;
  return state.lesson.scenes?.[state.participant.current_scene_index] || null;
}

function widgetProgress(sceneId, widgetId) {
  return widgetProgressFromParticipant(state.participant, sceneId, widgetId);
}

function renderScene() {
  if (!state.run || !state.lesson || !state.participant) {
    els.studentRunMeta.textContent = "Пока не подключен к уроку";
    els.studentSceneMeta.textContent = "Подключись к уроку, чтобы начать работу.";
    els.studentSceneTitle.textContent = "";
    els.studentWidgets.innerHTML = "";
    els.prevBtn.disabled = true;
    els.nextBtn.disabled = true;
    return;
  }

  const scene = currentScene();
  const sceneChanged = state.lastSceneId !== scene?.id;
  els.studentRunMeta.textContent = `Урок #${state.run.id} • открыто до сцены ${
    state.run.highest_unlocked_scene_index + 1
  }`;
  els.studentSceneMeta.textContent = `Ты на сцене ${state.participant.current_scene_index + 1}. Учитель сейчас на ${
    state.run.current_scene_index + 1
  }. Звезды: ${(state.participant.stars_tenths / 10).toFixed(1)}.`;
  els.studentSceneTitle.textContent = scene?.title || "Сцена недоступна";
  els.prevBtn.disabled = state.participant.current_scene_index <= 0;
  els.nextBtn.disabled = state.participant.current_scene_index >= state.run.highest_unlocked_scene_index;

  if (!scene) {
    els.studentWidgets.innerHTML = `<div class="empty-state">Сцена недоступна.</div>`;
    return;
  }

  els.studentWidgets.innerHTML = scene.widgets
    .map((widget, index) => renderStudentWidget(scene, widget, widgetProgress(scene.id, widget.id), sceneChanged, index))
    .join("");
  state.lastSceneId = scene.id;
}

async function login() {
  const session = await api("/login", {
    method: "POST",
    body: JSON.stringify({
      student_name: els.studentNameInput.value.trim(),
      class_name: els.studentClassInput.value.trim().toUpperCase(),
    }),
  });
  state.sessionId = session.session_id;
  localStorage.setItem(CURRENT_SESSION_STORAGE_KEY, String(session.session_id));
  els.studentSessionMeta.textContent = `Сессия #${session.session_id} • код ${session.session_display_code}`;
}

async function joinRun() {
  if (!state.sessionId) throw new Error("Сначала войди в сессию");
  const runId = Number(els.studentRunIdInput.value);
  if (!runId) throw new Error("Введи ID урока");

  const response = await api(`/lesson-runs/${runId}/join`, {
    method: "POST",
    body: JSON.stringify({ session_id: state.sessionId }),
  });

  state.runId = runId;
  state.run = response.run;
  state.participant = response.participant;
  localStorage.setItem(CURRENT_RUN_STORAGE_KEY, String(runId));
  await syncState();
}

async function syncState() {
  if (!state.runId || !state.sessionId) return;
  const [runResponse, participant] = await Promise.all([
    api(`/lesson-runs/${state.runId}`),
    api(`/lesson-runs/${state.runId}/participants/${state.sessionId}`),
  ]);
  state.run = runResponse.run;
  state.lesson = runResponse.lesson;
  state.participant = participant;
  renderScene();
}

async function navigate(sceneIndex) {
  await api(`/lesson-runs/${state.runId}/participants/${state.sessionId}/navigate`, {
    method: "POST",
    body: JSON.stringify({ scene_index: sceneIndex }),
  });
  await syncState();
}

async function updateWidgetState(sceneId, widgetId, widgetState, preview, activityDelta = 1) {
  await api(`/lesson-runs/${state.runId}/participants/${state.sessionId}/widget-state`, {
    method: "POST",
    body: JSON.stringify({
      scene_id: sceneId,
      widget_id: widgetId,
      state: widgetState,
      preview,
      activity_delta: activityDelta,
      expected_progress_version: state.participant?.progress_version ?? null,
    }),
  });
  await syncState();
}

async function handleWidgetAction(event) {
  const button = event.target.closest("[data-action]");
  if (!button || !state.runId || !state.sessionId) return;

  const sceneId = Number(button.dataset.sceneId);
  const widgetId = Number(button.dataset.widgetId);
  const scene = currentScene();
  const widget = scene?.widgets?.find((item) => item.id === widgetId);
  if (!scene || !widget) return;

  const current = widgetProgress(sceneId, widgetId);

  if (button.dataset.action === "choice-option") {
    const selectedIndex = Number(button.dataset.index);
    const update = buildMultipleChoiceUpdate(widget, selectedIndex);
    await updateWidgetState(
      sceneId,
      widgetId,
      update.state,
      update.preview
    );
    return;
  }

  if (button.dataset.action === "toggle-power") {
    const value = Number(button.dataset.value);
    const update = buildPowerToggleUpdate(scene, widget, current, value);
    await updateWidgetState(
      sceneId,
      widgetId,
      update.state,
      update.preview
    );
    return;
  }

  if (button.dataset.action === "toggle-bit") {
    const rowIndex = Number(button.dataset.rowIndex);
    const bitIndex = Number(button.dataset.bitIndex);
    const update = buildBinaryToggleUpdate(widget, current, rowIndex, bitIndex);
    await updateWidgetState(
      sceneId,
      widgetId,
      update.state,
      update.preview
    );
    return;
  }

  if (button.dataset.action === "match-pair-option") {
    const pairIndex = Number(button.dataset.pairIndex);
    const rightValue = button.dataset.rightValue;
    const update = buildMatchPairUpdate(widget, current, pairIndex, rightValue);
    await updateWidgetState(sceneId, widgetId, update.state, update.preview);
    return;
  }

  if (button.dataset.action === "move-order-item") {
    const itemIndex = Number(button.dataset.itemIndex);
    const delta = Number(button.dataset.delta);
    const update = buildOrderingMoveUpdate(widget, current, itemIndex, delta);
    await updateWidgetState(sceneId, widgetId, update.state, update.preview);
  }
}

async function runCode() {
  if (!state.runId || !state.sessionId) throw new Error("Сначала подключись к уроку");
  const scene = currentScene();
  els.codeRunMeta.textContent = "Запуск...";
  const result = await api("/lesson-mode/code-runs", {
    method: "POST",
    body: JSON.stringify({
      lesson_run_id: state.runId,
      session_id: state.sessionId,
      scene_id: scene?.id || null,
      source_code: els.codeEditor.value,
    }),
  });

  els.codeRunMeta.textContent = `${result.status} • ${result.duration_ms} мс`;
  els.codeOutput.textContent =
    [
      result.stdout_text ? `ВЫВОД:\n${result.stdout_text}` : "",
      result.stderr_text ? `ОШИБКА:\n${result.stderr_text}` : "",
      result.friendly_error ? `ПОДСКАЗКА:\n${result.friendly_error}` : "",
    ]
      .filter(Boolean)
      .join("\n\n") || "Пока нет вывода.";

  await api(`/lesson-runs/${state.runId}/participants/${state.sessionId}/preview`, {
    method: "POST",
    body: JSON.stringify({
      preview: {
        summary: "Python runner",
        metric: result.status,
        value: result.friendly_error || result.stdout_text || "запуск завершен",
      },
    }),
  });
  await syncState();
}

function installPolling() {
  clearInterval(state.pollTimer);
  state.pollTimer = setInterval(async () => {
    try {
      await syncState();
    } catch {
      // Silent poll loop is enough for the prototype.
    }
  }, 2000);
}

function bindEvents() {
  document.getElementById("student-login-btn").addEventListener("click", async () => {
    try {
      await login();
      setStatus("Ученик вошел в систему", "ok");
    } catch (error) {
      setStatus(error.message, "bad");
    }
  });

  document.getElementById("use-current-run-btn").addEventListener("click", () => {
    const storedRunId = localStorage.getItem(CURRENT_RUN_STORAGE_KEY);
    if (storedRunId) {
      els.studentRunIdInput.value = storedRunId;
    }
  });

  document.getElementById("student-join-btn").addEventListener("click", async () => {
    try {
      await joinRun();
      setStatus("Ученик подключился к уроку", "ok");
    } catch (error) {
      setStatus(error.message, "bad");
    }
  });

  document.getElementById("student-refresh-btn").addEventListener("click", async () => {
    try {
      await syncState();
      setStatus("Экран ученика синхронизирован", "ok");
    } catch (error) {
      setStatus(error.message, "bad");
    }
  });

  els.prevBtn.addEventListener("click", async () => {
    try {
      const current = state.participant?.current_scene_index ?? 0;
      await navigate(current - 1);
      setStatus("Переход назад выполнен", "ok");
    } catch (error) {
      setStatus(error.message, "bad");
    }
  });

  els.nextBtn.addEventListener("click", async () => {
    try {
      const current = state.participant?.current_scene_index ?? 0;
      await navigate(current + 1);
      setStatus("Переход вперед выполнен", "ok");
    } catch (error) {
      setStatus(error.message, "bad");
    }
  });

  els.studentWidgets.addEventListener("click", async (event) => {
    try {
      await handleWidgetAction(event);
    } catch (error) {
      setStatus(error.message, "bad");
    }
  });

  document.getElementById("run-code-btn").addEventListener("click", async () => {
    try {
      await runCode();
      setStatus("Код выполнен", "ok");
    } catch (error) {
      setStatus(error.message, "bad");
    }
  });
}

async function init() {
  bindEvents();
  installPolling();
  await checkHealth();

  const storedRunId = localStorage.getItem(CURRENT_RUN_STORAGE_KEY);
  const storedSessionId = localStorage.getItem(CURRENT_SESSION_STORAGE_KEY);
  if (storedRunId) {
    state.runId = Number(storedRunId);
    els.studentRunIdInput.value = storedRunId;
  }
  if (storedSessionId) {
    state.sessionId = Number(storedSessionId);
    els.studentSessionMeta.textContent = `Сессия #${storedSessionId} сохранена локально`;
  }
  if (state.runId && state.sessionId) {
    try {
      await syncState();
    } catch {
      // Ignore bootstrap sync failures.
    }
  }
}

init();
