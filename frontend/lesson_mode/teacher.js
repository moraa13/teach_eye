import {
  escapeHtml,
  renderProjectedStudentWorkspace,
  renderTeacherWidget,
  summarizeWidgetProgress,
} from "./widget_runtime.js";

const CURRENT_RUN_STORAGE_KEY = "teachereye.lessonMode.currentRunId";

const state = {
  lessons: [],
  runId: null,
  run: null,
  lesson: null,
  pollTimer: null,
  lastSceneId: null,
  selectedSessionId: null,
  selectedInspection: null,
  projectedSessionId: null,
};

const els = {
  status: document.getElementById("global-status"),
  lessonSelect: document.getElementById("lesson-select"),
  teacherClassInput: document.getElementById("teacher-class-input"),
  teacherRunMeta: document.getElementById("teacher-run-meta"),
  teacherScenes: document.getElementById("teacher-scenes"),
  teacherCurrentScene: document.getElementById("teacher-current-scene"),
  teacherStudentTiles: document.getElementById("teacher-student-tiles"),
  teacherStudentCount: document.getElementById("teacher-student-count"),
  teacherStudentFocus: document.getElementById("teacher-student-focus"),
  teacherFocusMeta: document.getElementById("teacher-focus-meta"),
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

function formatStars(starsTenths) {
  return (Number(starsTenths || 0) / 10).toFixed(1);
}

function currentProjectedInspection() {
  if (!state.selectedInspection || !state.projectedSessionId) return null;
  return state.selectedInspection.participant?.session_id === state.projectedSessionId ? state.selectedInspection : null;
}

function renderProjectedStudent(projectedInspection) {
  return renderProjectedStudentWorkspace(projectedInspection);
}

function renderInspectionPanel() {
  const inspection = state.selectedInspection;
  if (!inspection) {
    els.teacherFocusMeta.textContent = "Никто не выбран";
    els.teacherStudentFocus.innerHTML =
      "Выбери ученика из плиток, чтобы открыть его сцену, прогресс и последние запуски кода.";
    return;
  }

  const participant = inspection.participant;
  const scene = inspection.scene;
  const projected = participant.session_id === state.projectedSessionId;
  const progress = participant.progress?.[String(scene.id)] || {};
  els.teacherFocusMeta.textContent = `${participant.student_name || "Ученик"} • сцена ${participant.current_scene_index + 1}`;
  els.teacherStudentFocus.innerHTML = `
    <div class="focus-inspect-grid">
      <div class="focus-panel">
        <div class="row">
          <div>
            <div class="scene-title">${escapeHtml(participant.student_name || "Ученик")}</div>
            <div class="muted">${escapeHtml(participant.class_name || "")}</div>
          </div>
          <div class="tag-row">
            <span class="tag">${formatStars(participant.stars_tenths)} звезды</span>
            <span class="tag">${participant.activity_points} активность</span>
            <span class="tag">scene ${participant.current_scene_index + 1}</span>
          </div>
        </div>
        <div class="focus-panel-copy">
          ${escapeHtml(scene.title || "Сцена")} • ${escapeHtml(scene.notes_text || "Без заметок")}
        </div>
        <div class="row">
          <button class="secondary-btn project-student-btn" data-session-id="${participant.session_id}">
            ${projected ? "Убрать с доски" : "Показать на доске"}
          </button>
          <button class="secondary-btn inspect-refresh-btn" data-session-id="${participant.session_id}">
            Обновить фокус
          </button>
        </div>
      </div>
      <div class="focus-widget-list">
        ${scene.widgets
          .map((widget) => {
            const widgetState = progress[String(widget.id)] || {};
            return `
              <div class="focus-widget-item">
                <strong>${escapeHtml(widget.title || widget.widget_type)}</strong>
                <div class="muted">${escapeHtml(summarizeWidgetProgress(widget, widgetState))}</div>
              </div>
            `;
          })
          .join("")}
      </div>
      <div class="focus-code-list">
        <div class="focus-subtitle">Последние запуски Python</div>
        ${
          inspection.code_runs?.length
            ? inspection.code_runs
                .map(
                  (codeRun) => `
                    <div class="focus-code-item">
                      <div class="row">
                        <strong>${escapeHtml(codeRun.scene_title || "Без сцены")}</strong>
                        <span class="tag">${escapeHtml(codeRun.status || "ok")}</span>
                      </div>
                      <div class="muted">${escapeHtml(
                        codeRun.friendly_error || codeRun.stdout_text || codeRun.stderr_text || "Без вывода"
                      )}</div>
                    </div>
                  `
                )
                .join("")
            : `<div class="empty-state">Ученик пока не запускал код в этом уроке.</div>`
        }
      </div>
    </div>
  `;
}

function renderBoardRuntime(scene, run, lesson, participants, sceneChanged = false, projectedInspection = null) {
  if (!scene) {
    return "Сцена не выбрана.";
  }

  return `
    <div class="teacher-board-runtime">
      <div class="teacher-board-header${sceneChanged ? " scene-float-in delay-0" : ""}">
        <div class="row">
          <span class="metric">Сцена ${run.current_scene_index + 1} / ${lesson.scenes.length}</span>
          <span class="tag">${escapeHtml(scene.scene_type || "board")}</span>
          <span class="tag">layout: ${escapeHtml(scene.layout?.preset || "custom")}</span>
        </div>
        <div class="scene-title">${escapeHtml(scene.title)}</div>
        <div class="teacher-board-copy">${escapeHtml(scene.notes_text || "Заметок пока нет.")}</div>
      </div>
      ${renderProjectedStudent(projectedInspection)}
      <div class="widget-stack">
        ${scene.widgets
          .map((widget, index) =>
            renderTeacherWidget(
              scene,
              widget,
              participants,
              { highestUnlockedSceneIndex: (run?.highest_unlocked_scene_index || 0) + 1 },
              sceneChanged,
              index
            )
          )
          .join("")}
      </div>
    </div>
  `;
}

async function checkHealth() {
  try {
    await api("/health");
    setStatus("API: сервер на связи", "ok");
  } catch (error) {
    setStatus(`Ошибка API: ${error.message}`, "bad");
  }
}

async function loadLessons(selectNewest = false) {
  const lessons = await api("/lessons");
  state.lessons = lessons;
  els.lessonSelect.innerHTML = lessons
    .map(
      (lesson) =>
        `<option value="${lesson.id}">${escapeHtml(lesson.title)} (${escapeHtml(
          lesson.topic || "без темы"
        )})</option>`
    )
    .join("");
  if (selectNewest && lessons.length) {
    els.lessonSelect.value = String(lessons[0].id);
  }
}

async function ensureDemoLesson() {
  await api("/lessons/demo/ip-powers", { method: "POST" });
  await loadLessons(true);
}

function renderRun() {
  if (!state.run || !state.lesson) {
    els.teacherRunMeta.textContent = "Активного урока нет";
    els.teacherScenes.innerHTML = "";
    els.teacherCurrentScene.innerHTML = "Сначала запусти урок, и здесь появится текущая сцена.";
    els.teacherStudentTiles.innerHTML = "";
    els.teacherStudentCount.textContent = "0 учеников";
    renderInspectionPanel();
    return;
  }

  const run = state.run;
  const lesson = state.lesson;
  const scene = lesson.scenes[run.current_scene_index];
  const sceneChanged = state.lastSceneId !== scene?.id;
  const participants = run.participants || [];

  els.teacherRunMeta.textContent = `Урок #${run.id} • класс ${run.class_name || "?"}`;
  els.teacherScenes.innerHTML = lesson.scenes
    .map((sceneItem, index) => {
      const classes = ["scene-chip"];
      if (index === run.current_scene_index) classes.push("current");
      if (index > run.highest_unlocked_scene_index) classes.push("locked");
      return `<button class="${classes.join(" ")}" data-scene-index="${index}">${index + 1}. ${escapeHtml(
        sceneItem.title
      )}</button>`;
    })
    .join("");

  els.teacherCurrentScene.innerHTML = renderBoardRuntime(
    scene,
    run,
    lesson,
    participants,
    sceneChanged,
    currentProjectedInspection()
  );
  els.teacherStudentCount.textContent = `${participants.length} учеников`;
  els.teacherStudentTiles.innerHTML = participants.length
    ? participants
        .map((participant) => {
          const preview = participant.preview || {};
          const previewLines = [
            preview.summary || `Сцена ${participant.current_scene_index + 1}`,
            preview.metric ? `Метрика: ${preview.metric}` : "",
            preview.value ? `Значение: ${preview.value}` : "",
          ]
            .filter(Boolean)
            .join("\n");
          return `
            <div class="student-tile${sceneChanged ? " scene-float-in delay-1" : ""}">
              <div class="name">${escapeHtml(participant.student_name || "Без имени")}</div>
              <div class="muted">${escapeHtml(participant.class_name || "")}</div>
              <div class="tag-row">
                <span class="tag">сцена ${participant.current_scene_index + 1}</span>
                <span class="tag">${formatStars(participant.stars_tenths)} звезды</span>
                <span class="tag">${participant.activity_points} активность</span>
              </div>
              <div class="preview">${escapeHtml(previewLines || "Превью пока нет")}</div>
              <div class="row">
                <button class="secondary-btn inspect-student-btn" data-session-id="${participant.session_id}">Открыть</button>
                <button class="secondary-btn award-star-btn" data-session-id="${participant.session_id}">+0.1 звезды</button>
              </div>
            </div>
          `;
        })
        .join("")
    : `<div class="empty-state">Пока никто не подключился к этому уроку.</div>`;
  renderInspectionPanel();
  state.lastSceneId = scene?.id || null;
}

async function startRun() {
  const lessonId = Number(els.lessonSelect.value);
  if (!lessonId) throw new Error("Сначала выбери урок");
  const payload = {
    lesson_id: lessonId,
    class_name: els.teacherClassInput.value.trim().toUpperCase(),
  };
  const response = await api("/lesson-runs", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  state.runId = response.run.id;
  state.run = response.run;
  state.lesson = response.lesson;
  localStorage.setItem(CURRENT_RUN_STORAGE_KEY, String(response.run.id));
  renderRun();
}

async function syncRun() {
  if (!state.runId) return;
  const response = await api(`/lesson-runs/${state.runId}`);
  state.run = response.run;
  state.lesson = response.lesson;
  if (state.selectedSessionId) {
    try {
      state.selectedInspection = await api(
        `/lesson-runs/${state.runId}/participants/${state.selectedSessionId}/inspect`
      );
    } catch {
      state.selectedInspection = null;
      state.selectedSessionId = null;
      state.projectedSessionId = null;
    }
  }
  renderRun();
}

async function inspectStudent(sessionId) {
  if (!state.runId) return;
  state.selectedSessionId = sessionId;
  state.selectedInspection = await api(`/lesson-runs/${state.runId}/participants/${sessionId}/inspect`);
  renderRun();
}

async function advanceRun(sceneIndex = null) {
  if (!state.runId) throw new Error("Сначала запусти урок");
  state.run = await api(`/lesson-runs/${state.runId}/advance`, {
    method: "POST",
    body: JSON.stringify({ scene_index: sceneIndex }),
  });
  renderRun();
}

async function awardStar(sessionId) {
  await api(`/lesson-runs/${state.runId}/participants/${sessionId}/stars`, {
    method: "POST",
    body: JSON.stringify({ delta_tenths: 1, reason: "teacher board quick award" }),
  });
  await syncRun();
}

function installPolling() {
  clearInterval(state.pollTimer);
  state.pollTimer = setInterval(async () => {
    try {
      await syncRun();
    } catch {
      // Silent poll loop is enough for the prototype.
    }
  }, 2000);
}

function bindEvents() {
  document.getElementById("ensure-demo-btn").addEventListener("click", async () => {
    try {
      await ensureDemoLesson();
      setStatus("Demo-урок готов", "ok");
    } catch (error) {
      setStatus(error.message, "bad");
    }
  });

  document.getElementById("load-lessons-btn").addEventListener("click", async () => {
    try {
      await loadLessons();
      setStatus("Библиотека уроков загружена", "ok");
    } catch (error) {
      setStatus(error.message, "bad");
    }
  });

  document.getElementById("start-run-btn").addEventListener("click", async () => {
    try {
      await startRun();
      await syncRun();
      setStatus("Урок запущен", "ok");
    } catch (error) {
      setStatus(error.message, "bad");
    }
  });

  document.getElementById("teacher-next-scene-btn").addEventListener("click", async () => {
    try {
      await advanceRun();
      setStatus("Открыта следующая сцена", "ok");
    } catch (error) {
      setStatus(error.message, "bad");
    }
  });

  document.getElementById("teacher-refresh-btn").addEventListener("click", async () => {
    try {
      await syncRun();
      setStatus("Панель учителя обновлена", "ok");
    } catch (error) {
      setStatus(error.message, "bad");
    }
  });

  els.teacherScenes.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-scene-index]");
    if (!button) return;
    try {
      await advanceRun(Number(button.dataset.sceneIndex));
      setStatus(`Открыта сцена ${Number(button.dataset.sceneIndex) + 1}`, "ok");
    } catch (error) {
      setStatus(error.message, "bad");
    }
  });

  els.teacherStudentTiles.addEventListener("click", async (event) => {
    const button = event.target.closest(".award-star-btn");
    const inspectButton = event.target.closest(".inspect-student-btn");
    if (inspectButton) {
      try {
        await inspectStudent(Number(inspectButton.dataset.sessionId));
        setStatus("Фокус ученика открыт", "ok");
      } catch (error) {
        setStatus(error.message, "bad");
      }
      return;
    }
    if (!button) return;
    try {
      await awardStar(Number(button.dataset.sessionId));
      setStatus("Учитель выдал +0.1 звезды", "ok");
    } catch (error) {
      setStatus(error.message, "bad");
    }
  });

  els.teacherStudentFocus.addEventListener("click", async (event) => {
    const projectButton = event.target.closest(".project-student-btn");
    if (projectButton) {
      const sessionId = Number(projectButton.dataset.sessionId);
      state.projectedSessionId = state.projectedSessionId === sessionId ? null : sessionId;
      renderRun();
      setStatus(
        state.projectedSessionId ? "Работа ученика выведена на доску" : "Показ работы на доске выключен",
        "ok"
      );
      return;
    }

    const refreshButton = event.target.closest(".inspect-refresh-btn");
    if (refreshButton) {
      try {
        await inspectStudent(Number(refreshButton.dataset.sessionId));
        setStatus("Фокус ученика обновлен", "ok");
      } catch (error) {
        setStatus(error.message, "bad");
      }
    }
  });
}

async function init() {
  bindEvents();
  installPolling();
  await checkHealth();
  try {
    await loadLessons(true);
    const storedRunId = localStorage.getItem(CURRENT_RUN_STORAGE_KEY);
    if (storedRunId) {
      state.runId = Number(storedRunId);
      await syncRun();
    }
  } catch (error) {
    setStatus(error.message, "bad");
  }
}

init();
