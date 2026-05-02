const state = {
  lessons: [],
  teacher: {
    runId: null,
    run: null,
    lesson: null,
  },
  student: {
    sessionId: null,
    runId: null,
    run: null,
    lesson: null,
    participant: null,
  },
  pollTimer: null,
};

const els = {
  globalStatus: document.getElementById("global-status"),
  lessonSelect: document.getElementById("lesson-select"),
  teacherClassInput: document.getElementById("teacher-class-input"),
  teacherRunMeta: document.getElementById("teacher-run-meta"),
  teacherScenes: document.getElementById("teacher-scenes"),
  teacherCurrentScene: document.getElementById("teacher-current-scene"),
  teacherStudentTiles: document.getElementById("teacher-student-tiles"),
  teacherStudentCount: document.getElementById("teacher-student-count"),
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
      // Ignore parse failures; plain text fallback is enough.
    }
    throw new Error(detail);
  }
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }
  return response.text();
}

function setStatus(text, kind = "muted") {
  els.globalStatus.textContent = text;
  els.globalStatus.className = `status-pill ${kind}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function currentStudentScene() {
  const lesson = state.student.lesson;
  const participant = state.student.participant;
  if (!lesson || !participant) return null;
  return lesson.scenes?.[participant.current_scene_index] || null;
}

function progressForWidget(sceneId, widgetId) {
  const progress = state.student.participant?.progress || {};
  return progress?.[String(sceneId)]?.[String(widgetId)] || null;
}

async function checkHealth() {
  try {
    await api("/health");
    setStatus("API: online", "ok");
  } catch (error) {
    setStatus(`API error: ${error.message}`, "bad");
  }
}

async function loadLessons(selectNewest = false) {
  const lessons = await api("/lessons");
  state.lessons = lessons;
  els.lessonSelect.innerHTML = lessons
    .map(
      (lesson) =>
        `<option value="${lesson.id}">${escapeHtml(lesson.title)} (${escapeHtml(
          lesson.topic || "no topic"
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

function renderTeacherRun() {
  const run = state.teacher.run;
  const lesson = state.teacher.lesson;
  if (!run || !lesson) {
    els.teacherRunMeta.textContent = "No active run";
    els.teacherScenes.innerHTML = "";
    els.teacherCurrentScene.innerHTML = "Start a run to unlock the board.";
    els.teacherStudentTiles.innerHTML = "";
    els.teacherStudentCount.textContent = "0 students";
    return;
  }

  els.teacherRunMeta.textContent = `Run #${run.id} • class ${run.class_name || "?"}`;
  els.teacherScenes.innerHTML = lesson.scenes
    .map((scene, index) => {
      const classes = ["scene-chip"];
      if (index === run.current_scene_index) classes.push("current");
      if (index > run.highest_unlocked_scene_index) classes.push("locked");
      return `<button class="${classes.join(" ")}" data-scene-index="${index}">${index + 1}. ${escapeHtml(
        scene.title
      )}</button>`;
    })
    .join("");

  const scene = lesson.scenes[run.current_scene_index];
  els.teacherCurrentScene.innerHTML = scene
    ? `
      <div class="metric">Current scene: ${run.current_scene_index + 1} / ${lesson.scenes.length}</div>
      <div><strong>${escapeHtml(scene.title)}</strong></div>
      <div>${escapeHtml(scene.notes_text || "No notes yet.")}</div>
    `
    : "No scene selected.";

  const participants = run.participants || [];
  els.teacherStudentCount.textContent = `${participants.length} students`;
  els.teacherStudentTiles.innerHTML = participants.length
    ? participants
        .map((participant) => {
          const preview = participant.preview || {};
          const previewLines = [
            preview.summary || `Scene ${participant.current_scene_index + 1}`,
            preview.metric ? `Metric: ${preview.metric}` : "",
            preview.value ? `Value: ${preview.value}` : "",
          ]
            .filter(Boolean)
            .join("\n");
          return `
            <div class="student-tile">
              <div class="name">${escapeHtml(participant.student_name || "Unknown")}</div>
              <div class="muted">${escapeHtml(participant.class_name || "")}</div>
              <div class="tag-row">
                <span class="tag">scene ${participant.current_scene_index + 1}</span>
                <span class="tag">${(participant.stars_tenths / 10).toFixed(1)} stars</span>
                <span class="tag">${participant.activity_points} activity</span>
              </div>
              <div class="preview">${escapeHtml(previewLines || "No preview yet")}</div>
              <button class="secondary-btn award-star-btn" data-session-id="${participant.session_id}">+0.1 star</button>
            </div>
          `;
        })
        .join("")
    : `<div class="empty-state">No students joined this lesson run yet.</div>`;
}

function renderStudentScene() {
  const run = state.student.run;
  const lesson = state.student.lesson;
  const participant = state.student.participant;
  if (!run || !lesson || !participant) {
    els.studentRunMeta.textContent = "No joined lesson run";
    els.studentSceneMeta.textContent = "Join a lesson run to begin.";
    els.studentSceneTitle.textContent = "";
    els.studentWidgets.innerHTML = "";
    els.prevBtn.disabled = true;
    els.nextBtn.disabled = true;
    return;
  }

  const scene = currentStudentScene();
  els.studentRunMeta.textContent = `Run #${run.id} • unlocked up to scene ${
    run.highest_unlocked_scene_index + 1
  }`;
  els.studentSceneMeta.textContent = `You are on scene ${participant.current_scene_index + 1}. Teacher focus: ${
    run.current_scene_index + 1
  }. Stars: ${(participant.stars_tenths / 10).toFixed(1)}.`;
  els.studentSceneTitle.textContent = scene?.title || "Scene unavailable";
  els.prevBtn.disabled = participant.current_scene_index <= 0;
  els.nextBtn.disabled = participant.current_scene_index >= run.highest_unlocked_scene_index;

  if (!scene) {
    els.studentWidgets.innerHTML = `<div class="empty-state">Scene not available.</div>`;
    return;
  }

  els.studentWidgets.innerHTML = scene.widgets.map((widget) => renderWidget(scene, widget)).join("");
}

function renderWidget(scene, widget) {
  const progress = progressForWidget(scene.id, widget.id) || {};
  if (widget.widget_type === "multiple_choice") {
    const options = widget.config.options || [];
    const selectedIndex = progress.selected_index;
    const completed = !!progress.completed;
    return `
      <div class="widget-card" data-widget-id="${widget.id}" data-scene-id="${scene.id}">
        <h4>${escapeHtml(widget.title || "Multiple choice")}</h4>
        <p>${escapeHtml(widget.config.question || "")}</p>
        <div class="option-list">
          ${options
            .map(
              (option, index) => `
                <button
                  class="option-btn ${selectedIndex === index ? "active" : ""}"
                  data-action="choice-option"
                  data-scene-id="${scene.id}"
                  data-widget-id="${widget.id}"
                  data-index="${index}"
                >${escapeHtml(option)}</button>
              `
            )
            .join("")}
        </div>
        <div class="muted">${completed ? "Correct answer locked in." : "Choose one answer."}</div>
      </div>
    `;
  }

  if (widget.widget_type === "powers_of_two_picker") {
    const selectedValues = Array.isArray(progress.selected_values) ? progress.selected_values : [];
    const selectedSum = selectedValues.reduce((sum, value) => sum + value, 0);
    const target = widget.config.target_value || 0;
    return `
      <div class="widget-card" data-widget-id="${widget.id}" data-scene-id="${scene.id}">
        <h4>${escapeHtml(widget.title || "Powers of two")}</h4>
        <p>Target value: <span class="metric">${target}</span></p>
        <div class="power-grid">
          ${(widget.config.values || [])
            .map(
              (value) => `
                <button
                  class="power-btn ${selectedValues.includes(value) ? "active" : ""}"
                  data-action="toggle-power"
                  data-scene-id="${scene.id}"
                  data-widget-id="${widget.id}"
                  data-value="${value}"
                >${value}</button>
              `
            )
            .join("")}
        </div>
        <div class="muted">Current sum: ${selectedSum} ${progress.completed ? "• completed" : ""}</div>
      </div>
    `;
  }

  if (widget.widget_type === "binary_decomposition") {
    const rows = Array.isArray(progress.rows) ? progress.rows : [];
    return `
      <div class="widget-card" data-widget-id="${widget.id}" data-scene-id="${scene.id}">
        <h4>${escapeHtml(widget.title || "Binary decomposition")}</h4>
        ${(
          widget.config.tasks || []
        )
          .map((task, rowIndex) => {
            const row = rows[rowIndex] || { bits: Array(task.bit_count || 8).fill(0) };
            const bits = Array.isArray(row.bits) ? row.bits : Array(task.bit_count || 8).fill(0);
            const value = bits.reduce((sum, bit, bitIndex) => {
              const power = bits.length - bitIndex - 1;
              return sum + (bit ? 2 ** power : 0);
            }, 0);
            return `
              <div class="binary-row">
                <div class="row">
                  <span class="metric">Target ${task.target_value}</span>
                  <span class="muted">Current ${value}</span>
                </div>
                <div class="bits-grid">
                  ${bits
                    .map(
                      (bit, bitIndex) => `
                        <button
                          class="bit-btn ${bit ? "active" : ""}"
                          data-action="toggle-bit"
                          data-scene-id="${scene.id}"
                          data-widget-id="${widget.id}"
                          data-row-index="${rowIndex}"
                          data-bit-index="${bitIndex}"
                        >${bit}</button>
                      `
                    )
                    .join("")}
                </div>
              </div>
            `;
          })
          .join("")}
        <div class="muted">${progress.completed ? "All targets matched." : "Toggle bits until the number matches."}</div>
      </div>
    `;
  }

  return `
    <div class="widget-card">
      <h4>${escapeHtml(widget.title || widget.widget_type)}</h4>
      <p>Widget renderer not implemented yet.</p>
    </div>
  `;
}

async function createRun() {
  const lessonId = Number(els.lessonSelect.value);
  if (!lessonId) throw new Error("Select a lesson first");

  const payload = {
    lesson_id: lessonId,
    class_name: els.teacherClassInput.value.trim().toUpperCase(),
  };
  const response = await api("/lesson-runs", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  state.teacher.runId = response.run.id;
  state.teacher.run = response.run;
  state.teacher.lesson = response.lesson;
  els.studentRunIdInput.value = String(response.run.id);
  renderTeacherRun();
}

async function syncTeacherRun() {
  if (!state.teacher.runId) return;
  const response = await api(`/lesson-runs/${state.teacher.runId}`);
  state.teacher.run = response.run;
  state.teacher.lesson = response.lesson;
  renderTeacherRun();
}

async function syncStudent() {
  if (!state.student.runId || !state.student.sessionId) return;
  const [runResponse, participant] = await Promise.all([
    api(`/lesson-runs/${state.student.runId}`),
    api(`/lesson-runs/${state.student.runId}/participants/${state.student.sessionId}`),
  ]);
  state.student.run = runResponse.run;
  state.student.lesson = runResponse.lesson;
  state.student.participant = participant;
  renderStudentScene();
}

async function loginStudent() {
  const payload = {
    student_name: els.studentNameInput.value.trim(),
    class_name: els.studentClassInput.value.trim().toUpperCase(),
  };
  const session = await api("/login", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  state.student.sessionId = session.session_id;
  els.studentSessionMeta.textContent = `Session #${session.session_id} • code ${session.session_display_code}`;
}

async function joinRun() {
  if (!state.student.sessionId) throw new Error("Login first");
  const runId = Number(els.studentRunIdInput.value);
  if (!runId) throw new Error("Enter a run id");

  const response = await api(`/lesson-runs/${runId}/join`, {
    method: "POST",
    body: JSON.stringify({ session_id: state.student.sessionId }),
  });
  state.student.runId = runId;
  state.student.run = response.run;
  state.student.lesson = state.teacher.runId === runId ? state.teacher.lesson : null;
  state.student.participant = response.participant;
  renderStudentScene();
}

async function advanceTeacher(sceneIndex = null) {
  if (!state.teacher.runId) throw new Error("Start a run first");
  const run = await api(`/lesson-runs/${state.teacher.runId}/advance`, {
    method: "POST",
    body: JSON.stringify({ scene_index: sceneIndex }),
  });
  state.teacher.run = run;
  renderTeacherRun();
}

async function navigateStudent(sceneIndex) {
  if (!state.student.runId || !state.student.sessionId) return;
  await api(`/lesson-runs/${state.student.runId}/participants/${state.student.sessionId}/navigate`, {
    method: "POST",
    body: JSON.stringify({ scene_index: sceneIndex }),
  });
  await syncStudent();
}

async function awardStar(sessionId) {
  await api(`/lesson-runs/${state.teacher.runId}/participants/${sessionId}/stars`, {
    method: "POST",
    body: JSON.stringify({ delta_tenths: 1 }),
  });
  await syncTeacherRun();
  if (state.student.sessionId === Number(sessionId)) {
    await syncStudent();
  }
}

async function updateWidgetState(sceneId, widgetId, widgetState, preview, activityDelta = 1) {
  await api(`/lesson-runs/${state.student.runId}/participants/${state.student.sessionId}/widget-state`, {
    method: "POST",
    body: JSON.stringify({
      scene_id: sceneId,
      widget_id: widgetId,
      state: widgetState,
      preview,
      activity_delta: activityDelta,
    }),
  });
  await syncStudent();
}

async function handleWidgetAction(event) {
  const button = event.target.closest("[data-action]");
  if (!button || !state.student.runId || !state.student.sessionId) return;

  const sceneId = Number(button.dataset.sceneId);
  const widgetId = Number(button.dataset.widgetId);
  const scene = currentStudentScene();
  const widget = scene?.widgets?.find((item) => item.id === widgetId);
  if (!scene || !widget) return;

  const current = progressForWidget(sceneId, widgetId) || {};

  if (button.dataset.action === "choice-option") {
    const selectedIndex = Number(button.dataset.index);
    const completed = selectedIndex === widget.config.correct_index;
    await updateWidgetState(
      sceneId,
      widgetId,
      { selected_index: selectedIndex, completed, submitted: true },
      {
        summary: widget.title,
        metric: "choice",
        value: completed ? "correct" : "incorrect",
      }
    );
    return;
  }

  if (button.dataset.action === "toggle-power") {
    const value = Number(button.dataset.value);
    const selectedValues = Array.isArray(current.selected_values) ? [...current.selected_values] : [];
    const idx = selectedValues.indexOf(value);
    if (idx >= 0) selectedValues.splice(idx, 1);
    else selectedValues.push(value);
    selectedValues.sort((a, b) => b - a);
    const sum = selectedValues.reduce((acc, item) => acc + item, 0);
    const completed = sum === Number(widget.config.target_value || 0);
    await updateWidgetState(
      sceneId,
      widgetId,
      { selected_values: selectedValues, completed, sum },
      {
        summary: widget.title,
        metric: "sum",
        value: `${sum}/${widget.config.target_value}`,
      }
    );
    return;
  }

  if (button.dataset.action === "toggle-bit") {
    const tasks = widget.config.tasks || [];
    const rowIndex = Number(button.dataset.rowIndex);
    const bitIndex = Number(button.dataset.bitIndex);
    const rows = Array.isArray(current.rows)
      ? current.rows.map((row) => ({ bits: [...(row.bits || [])] }))
      : tasks.map((task) => ({ bits: Array(task.bit_count || 8).fill(0) }));
    rows[rowIndex].bits[bitIndex] = rows[rowIndex].bits[bitIndex] ? 0 : 1;
    const allComplete = rows.every((row, index) => {
      const bits = row.bits || [];
      const value = bits.reduce((sum, bit, i) => {
        const power = bits.length - i - 1;
        return sum + (bit ? 2 ** power : 0);
      }, 0);
      return value === tasks[index].target_value;
    });
    const previewValue = rows
      .map((row) => (row.bits || []).join(""))
      .join(" | ");
    await updateWidgetState(
      sceneId,
      widgetId,
      { rows, completed: allComplete },
      {
        summary: widget.title,
        metric: "bits",
        value: previewValue,
      }
    );
  }
}

async function runCode() {
  if (!state.student.runId || !state.student.sessionId) throw new Error("Join a run first");
  const scene = currentStudentScene();
  els.codeRunMeta.textContent = "Running...";
  const result = await api("/lesson-mode/code-runs", {
    method: "POST",
    body: JSON.stringify({
      lesson_run_id: state.student.runId,
      session_id: state.student.sessionId,
      scene_id: scene?.id || null,
      source_code: els.codeEditor.value,
    }),
  });
  els.codeRunMeta.textContent = `${result.status} • ${result.duration_ms} ms`;
  els.codeOutput.textContent = [
    result.stdout_text ? `STDOUT:\n${result.stdout_text}` : "",
    result.stderr_text ? `STDERR:\n${result.stderr_text}` : "",
    result.friendly_error ? `HINT:\n${result.friendly_error}` : "",
  ]
    .filter(Boolean)
    .join("\n\n") || "No output.";

  await api(`/lesson-runs/${state.student.runId}/participants/${state.student.sessionId}/preview`, {
    method: "POST",
    body: JSON.stringify({
      preview: {
        summary: "Python runner",
        metric: result.status,
        value: result.friendly_error || result.stdout_text || "run complete",
      },
    }),
  });
  await syncStudent();
}

function installPolling() {
  clearInterval(state.pollTimer);
  state.pollTimer = setInterval(async () => {
    try {
      await Promise.all([syncTeacherRun(), syncStudent()]);
    } catch {
      // Silent poll loop; user can still sync manually.
    }
  }, 2000);
}

function bindEvents() {
  document.getElementById("ensure-demo-btn").addEventListener("click", async () => {
    try {
      await ensureDemoLesson();
      setStatus("Demo lesson ensured", "ok");
    } catch (error) {
      setStatus(error.message, "bad");
    }
  });

  document.getElementById("load-lessons-btn").addEventListener("click", async () => {
    try {
      await loadLessons();
      setStatus("Lesson library loaded", "ok");
    } catch (error) {
      setStatus(error.message, "bad");
    }
  });

  document.getElementById("start-run-btn").addEventListener("click", async () => {
    try {
      await createRun();
      await syncTeacherRun();
      setStatus("Lesson run started", "ok");
    } catch (error) {
      setStatus(error.message, "bad");
    }
  });

  document.getElementById("teacher-next-scene-btn").addEventListener("click", async () => {
    try {
      await advanceTeacher();
      setStatus("Teacher advanced the lesson", "ok");
    } catch (error) {
      setStatus(error.message, "bad");
    }
  });

  document.getElementById("teacher-refresh-btn").addEventListener("click", async () => {
    try {
      await syncTeacherRun();
      setStatus("Teacher view refreshed", "ok");
    } catch (error) {
      setStatus(error.message, "bad");
    }
  });

  els.teacherScenes.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-scene-index]");
    if (!button) return;
    try {
      await advanceTeacher(Number(button.dataset.sceneIndex));
      setStatus(`Teacher jumped to scene ${Number(button.dataset.sceneIndex) + 1}`, "ok");
    } catch (error) {
      setStatus(error.message, "bad");
    }
  });

  els.teacherStudentTiles.addEventListener("click", async (event) => {
    const button = event.target.closest(".award-star-btn");
    if (!button) return;
    try {
      await awardStar(Number(button.dataset.sessionId));
      setStatus("Teacher awarded +0.1 star", "ok");
    } catch (error) {
      setStatus(error.message, "bad");
    }
  });

  document.getElementById("student-login-btn").addEventListener("click", async () => {
    try {
      await loginStudent();
      setStatus("Student logged in", "ok");
    } catch (error) {
      setStatus(error.message, "bad");
    }
  });

  document.getElementById("use-current-run-btn").addEventListener("click", () => {
    if (state.teacher.runId) {
      els.studentRunIdInput.value = String(state.teacher.runId);
    }
  });

  document.getElementById("student-join-btn").addEventListener("click", async () => {
    try {
      await joinRun();
      await syncStudent();
      setStatus("Student joined the lesson run", "ok");
    } catch (error) {
      setStatus(error.message, "bad");
    }
  });

  document.getElementById("student-refresh-btn").addEventListener("click", async () => {
    try {
      await syncStudent();
      setStatus("Student view synced", "ok");
    } catch (error) {
      setStatus(error.message, "bad");
    }
  });

  els.prevBtn.addEventListener("click", async () => {
    try {
      const current = state.student.participant?.current_scene_index ?? 0;
      await navigateStudent(current - 1);
      setStatus("Moved back one scene", "ok");
    } catch (error) {
      setStatus(error.message, "bad");
    }
  });

  els.nextBtn.addEventListener("click", async () => {
    try {
      const current = state.student.participant?.current_scene_index ?? 0;
      await navigateStudent(current + 1);
      setStatus("Moved forward within unlocked scenes", "ok");
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
      setStatus("Code executed", "ok");
    } catch (error) {
      setStatus(error.message, "bad");
    }
  });
}

async function init() {
  bindEvents();
  installPolling();
  await checkHealth();
  try {
    await loadLessons(true);
  } catch (error) {
    setStatus(error.message, "bad");
  }
}

init();
