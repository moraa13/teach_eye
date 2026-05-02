export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function widgetProgressFromParticipant(participant, sceneId, widgetId) {
  return participant?.progress?.[String(sceneId)]?.[String(widgetId)] || {};
}

export function computeBinaryStringFromValues(selectedValues, values) {
  const activeValues = new Set(selectedValues);
  return values.map((value) => (activeValues.has(value) ? "1" : "0")).join("");
}

export function buildBinaryValue(bits) {
  return bits.reduce((sum, bit, bitIndex) => {
    const power = bits.length - bitIndex - 1;
    return sum + (bit ? 2 ** power : 0);
  }, 0);
}

export function buildPowerWidgetModel(widget, progress, scene) {
  const values = widget.config.values || [128, 64, 32, 16, 8, 4, 2, 1];
  const selectedValues = Array.isArray(progress.selected_values) ? progress.selected_values : [];
  const selectedSum =
    typeof progress.sum === "number"
      ? progress.sum
      : selectedValues.reduce((sum, value) => sum + value, 0);
  const binaryString =
    typeof progress.binary_string === "string"
      ? progress.binary_string
      : computeBinaryStringFromValues(selectedValues, values);
  return {
    values,
    selectedValues,
    selectedSum,
    binaryString,
    expression: selectedValues.length ? `${selectedValues.join(" + ")} = ${selectedSum}` : `0 = ${selectedSum}`,
    targetValue: Number(widget.config.target_value || 0),
    contextTitle: widget.config.context_title || "Контекст задачи",
    taskText:
      widget.config.task_text ||
      "Собери нужное число через степени двойки. Каждое нажатие сразу меняет сумму и двоичную запись.",
    nodeAddress: widget.config.node_address || "191.89.109.206",
    maskAddress: widget.config.mask_address || "255.255.224.0",
    answerLabel: widget.config.answer_label || "Текущий ответ",
    teacherBoardText:
      widget.config.teacher_board_text ||
      scene.notes_text ||
      "Здесь будет объяснение шага от учителя для текущей сцены.",
    completed: !!progress.completed,
  };
}

export function summarizeWidgetProgress(widget, progress) {
  if (!progress || Object.keys(progress).length === 0) {
    return "еще не начато";
  }
  if (widget.widget_type === "multiple_choice" && typeof progress.selected_index === "number") {
    return progress.completed ? `вариант ${progress.selected_index + 1} • верно` : `вариант ${progress.selected_index + 1}`;
  }
  if (widget.widget_type === "powers_of_two_picker") {
    const sum = typeof progress.sum === "number" ? progress.sum : 0;
    const binary = typeof progress.binary_string === "string" ? progress.binary_string : "";
    return progress.completed ? `${sum} • ${binary} • решено` : `${sum} • ${binary}`;
  }
  if (widget.widget_type === "binary_decomposition") {
    const rows = Array.isArray(progress.rows) ? progress.rows.length : 0;
    return progress.completed ? `все ${rows} строки совпали` : `${rows} строк в работе`;
  }
  if (widget.widget_type === "match_pairs") {
    const total = Array.isArray(widget.config.pairs) ? widget.config.pairs.length : 0;
    const matched = progress.matched_count ?? Object.keys(progress.matches || {}).length;
    return progress.completed ? `${matched}/${total} пар собрано` : `${matched}/${total} пар`;
  }
  if (widget.widget_type === "algorithm_steps" || widget.widget_type === "code_puzzle") {
    const total = Array.isArray(progress.order) ? progress.order.length : 0;
    return progress.completed ? `порядок собран (${total} шагов)` : `собирает порядок (${total} шагов)`;
  }
  return progress.completed ? "завершено" : "в процессе";
}

export function buildMultipleChoiceUpdate(widget, selectedIndex) {
  const completed = selectedIndex === widget.config.correct_index;
  return {
    state: { selected_index: selectedIndex, completed, submitted: true },
    preview: {
      summary: widget.title,
      metric: "вариант",
      value: completed ? "верно" : "неверно",
    },
  };
}

export function buildPowerToggleUpdate(scene, widget, current, value) {
  const pickerValues = widget.config.values || [128, 64, 32, 16, 8, 4, 2, 1];
  const selectedValues = Array.isArray(current.selected_values) ? [...current.selected_values] : [];
  const idx = selectedValues.indexOf(value);
  if (idx >= 0) selectedValues.splice(idx, 1);
  else selectedValues.push(value);
  selectedValues.sort((a, b) => b - a);
  const sum = selectedValues.reduce((acc, item) => acc + item, 0);
  const completed = sum === Number(widget.config.target_value || 0);
  const binaryString = computeBinaryStringFromValues(selectedValues, pickerValues);
  return {
    state: { selected_values: selectedValues, completed, sum, binary_string: binaryString },
    preview: {
      summary: "Битовый калькулятор",
      metric: binaryString,
      value: `${sum} / ${widget.config.target_value}`,
    },
    model: buildPowerWidgetModel(widget, { selected_values: selectedValues, completed, sum, binary_string: binaryString }, scene),
  };
}

export function buildBinaryToggleUpdate(widget, current, rowIndex, bitIndex) {
  const tasks = widget.config.tasks || [];
  const rows = Array.isArray(current.rows)
    ? current.rows.map((row) => ({ bits: [...(row.bits || [])] }))
    : tasks.map((task) => ({ bits: Array(task.bit_count || 8).fill(0) }));
  rows[rowIndex].bits[bitIndex] = rows[rowIndex].bits[bitIndex] ? 0 : 1;
  const allComplete = rows.every((row, index) => buildBinaryValue(row.bits || []) === tasks[index].target_value);
  const previewValue = rows
    .map((row) => (row.bits || []).join(""))
    .join(" | ");
  return {
    state: { rows, completed: allComplete },
    preview: {
      summary: widget.title,
      metric: "биты",
      value: previewValue,
    },
  };
}

function getPairDefinitions(widget) {
  return Array.isArray(widget.config.pairs) ? widget.config.pairs : [];
}

function buildMatchPairsState(widget, matches) {
  const pairs = getPairDefinitions(widget);
  const matchedCount = pairs.filter((pair, index) => matches[String(index)] === pair.right).length;
  return {
    state: {
      matches,
      matched_count: matchedCount,
      completed: matchedCount === pairs.length && pairs.length > 0,
    },
    preview: {
      summary: widget.title,
      metric: "пары",
      value: `${matchedCount}/${pairs.length}`,
    },
  };
}

export function buildMatchPairUpdate(widget, current, pairIndex, rightValue) {
  const matches = { ...(current.matches || {}) };
  matches[String(pairIndex)] = rightValue;
  return buildMatchPairsState(widget, matches);
}

function getOrderingItems(widget) {
  if (widget.widget_type === "algorithm_steps") {
    return Array.isArray(widget.config.steps) ? widget.config.steps : [];
  }
  if (widget.widget_type === "code_puzzle") {
    return Array.isArray(widget.config.lines) ? widget.config.lines : [];
  }
  return [];
}

function getInitialOrdering(widget) {
  const initial = Array.isArray(widget.config.initial_order) ? widget.config.initial_order : [];
  if (initial.length > 0) return [...initial];
  return [...getOrderingItems(widget)];
}

export function buildOrderingMoveUpdate(widget, current, itemIndex, delta) {
  const order = Array.isArray(current.order) && current.order.length > 0 ? [...current.order] : getInitialOrdering(widget);
  const nextIndex = itemIndex + delta;
  if (nextIndex < 0 || nextIndex >= order.length) {
    const completed = JSON.stringify(order) === JSON.stringify(getOrderingItems(widget));
    return {
      state: { order, completed },
      preview: {
        summary: widget.title,
        metric: "порядок",
        value: completed ? "готово" : `${order.slice(0, 2).join(" -> ")}`,
      },
    };
  }
  const [item] = order.splice(itemIndex, 1);
  order.splice(nextIndex, 0, item);
  const completed = JSON.stringify(order) === JSON.stringify(getOrderingItems(widget));
  return {
    state: { order, completed },
    preview: {
      summary: widget.title,
      metric: "порядок",
      value: completed ? "готово" : order.slice(0, 2).join(" -> "),
    },
  };
}

export function renderStudentWidget(scene, widget, progress, sceneChanged = false, widgetIndex = 0) {
  const enterClass = sceneChanged ? ` scene-float-in delay-${Math.min(widgetIndex, 4)}` : "";

  if (widget.widget_type === "multiple_choice") {
    const options = widget.config.options || [];
    const selectedIndex = progress.selected_index;
    const completed = !!progress.completed;
    return `
      <div class="widget-card${enterClass}">
        <h4>${escapeHtml(widget.title || "Вопрос с вариантами")}</h4>
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
        <div class="muted">${completed ? "Правильный ответ засчитан." : "Выбери один вариант ответа."}</div>
      </div>
    `;
  }

  if (widget.widget_type === "powers_of_two_picker") {
    const model = buildPowerWidgetModel(widget, progress, scene);
    return `
      <div class="widget-card widget-card--power${enterClass}">
        <h4>${escapeHtml(widget.title || "Степени двойки")}</h4>
        <div class="power-workspace">
          <div class="power-left-col">
            <div class="context-card-green${sceneChanged ? " scene-float-in delay-0" : ""}">
              <div class="context-card-title">${escapeHtml(model.contextTitle)}</div>
              <div class="context-card-text">${escapeHtml(model.taskText)}</div>
              <div class="kv-grid">
                <span>Адрес узла:</span>
                <strong>${escapeHtml(model.nodeAddress)}</strong>
                <span>Маска:</span>
                <strong>${escapeHtml(model.maskAddress)}</strong>
                <span>${escapeHtml(model.answerLabel)}:</span>
                <strong>${model.selectedSum}</strong>
              </div>
            </div>
            <div class="formula-card-rose${sceneChanged ? " scene-float-in delay-1" : ""}">
              <div class="formula-title">Текущий шаг</div>
              <div class="formula-expression">${escapeHtml(model.expression)}</div>
              <div class="formula-subline">Двоичный вид: ${model.binaryString}</div>
            </div>
            <div class="calculator-card-purple${sceneChanged ? " scene-float-in delay-2" : ""}">
              <div class="calculator-title">Калькулятор степеней двойки</div>
              <div class="power-grid power-grid--calculator">
                ${model.values
                  .map(
                    (value, index) => `
                      <button
                        class="power-btn ${model.selectedValues.includes(value) ? "active" : ""}"
                        data-action="toggle-power"
                        data-scene-id="${scene.id}"
                        data-widget-id="${widget.id}"
                        data-value="${value}"
                      >
                        <span class="power-value">${value}</span>
                        <span class="power-meta">2^${model.values.length - index - 1}</span>
                      </button>
                    `
                  )
                  .join("")}
              </div>
              <div class="binary-strip">
                ${model.binaryString
                  .split("")
                  .map(
                    (bit, index) => `
                      <div class="binary-cell ${bit === "1" ? "active" : ""}">
                        <span>${bit}</span>
                        <small>2^${model.values.length - index - 1}</small>
                      </div>
                    `
                  )
                  .join("")}
              </div>
              <div class="calculator-footer">
                <span>Цель: <strong>${model.targetValue}</strong></span>
                <span>Сейчас: <strong>${model.selectedSum}</strong></span>
                <span class="${model.completed ? "ok" : "muted"}">${
                  model.completed ? "Совпало, молодец" : "Собери правильную сумму"
                }</span>
              </div>
            </div>
          </div>
          <div class="teacher-board-card${sceneChanged ? " scene-float-in delay-3" : ""}">
            <div class="teacher-board-title">Доска учителя</div>
            <div class="teacher-board-text">${escapeHtml(model.teacherBoardText)}</div>
            <div class="teacher-board-metrics">
              <span>Цель: ${model.targetValue}</span>
              <span>Сумма: ${model.selectedSum}</span>
              <span>Биты: ${model.binaryString}</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  if (widget.widget_type === "binary_decomposition") {
    const rows = Array.isArray(progress.rows) ? progress.rows : [];
    return `
      <div class="widget-card${enterClass}">
        <h4>${escapeHtml(widget.title || "Двоичное разложение")}</h4>
        ${(widget.config.tasks || [])
          .map((task, rowIndex) => {
            const row = rows[rowIndex] || { bits: Array(task.bit_count || 8).fill(0) };
            const bits = Array.isArray(row.bits) ? row.bits : Array(task.bit_count || 8).fill(0);
            const value = buildBinaryValue(bits);
            return `
              <div class="binary-row">
                <div class="row">
                  <span class="metric">Цель ${task.target_value}</span>
                  <span class="muted">Сейчас ${value}</span>
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
        <div class="muted">${progress.completed ? "Все цели совпали." : "Переключай биты, пока число не совпадет."}</div>
      </div>
    `;
  }

  if (widget.widget_type === "match_pairs") {
    const pairs = getPairDefinitions(widget);
    const matches = progress.matches || {};
    const matchedCount = progress.matched_count ?? pairs.filter((pair, index) => matches[String(index)] === pair.right).length;
    return `
      <div class="widget-card${enterClass}">
        <h4>${escapeHtml(widget.title || "Сопоставь пары")}</h4>
        <div class="muted">Собрано пар: ${matchedCount}/${pairs.length}</div>
        <div class="match-pair-list">
          ${pairs
            .map(
              (pair, pairIndex) => `
                <div class="match-pair-row">
                  <div class="match-pair-left">${escapeHtml(pair.left)}</div>
                  <div class="option-list">
                    ${(widget.config.right_options || pairs.map((item) => item.right))
                      .map(
                        (option) => `
                          <button
                            class="option-btn ${matches[String(pairIndex)] === option ? "active" : ""}"
                            data-action="match-pair-option"
                            data-scene-id="${scene.id}"
                            data-widget-id="${widget.id}"
                            data-pair-index="${pairIndex}"
                            data-right-value="${escapeHtml(option)}"
                          >${escapeHtml(option)}</button>
                        `
                      )
                      .join("")}
                  </div>
                </div>
              `
            )
            .join("")}
        </div>
        <div class="muted">${progress.completed ? "Все пары совпали." : "Подбери правильные соответствия."}</div>
      </div>
    `;
  }

  if (widget.widget_type === "algorithm_steps" || widget.widget_type === "code_puzzle") {
    const order = Array.isArray(progress.order) && progress.order.length > 0 ? progress.order : getInitialOrdering(widget);
    const isCode = widget.widget_type === "code_puzzle";
    return `
      <div class="widget-card${enterClass}">
        <h4>${escapeHtml(widget.title || (isCode ? "Код-пазл" : "Алгоритм"))}</h4>
        <div class="ordering-list">
          ${order
            .map(
              (item, itemIndex) => `
                <div class="ordering-row">
                  <div class="ordering-copy ${isCode ? "ordering-copy-code" : ""}">${escapeHtml(item)}</div>
                  <div class="row">
                    <button
                      class="secondary-btn ordering-move-btn"
                      data-action="move-order-item"
                      data-scene-id="${scene.id}"
                      data-widget-id="${widget.id}"
                      data-item-index="${itemIndex}"
                      data-delta="-1"
                    >Вверх</button>
                    <button
                      class="secondary-btn ordering-move-btn"
                      data-action="move-order-item"
                      data-scene-id="${scene.id}"
                      data-widget-id="${widget.id}"
                      data-item-index="${itemIndex}"
                      data-delta="1"
                    >Вниз</button>
                  </div>
                </div>
              `
            )
            .join("")}
        </div>
        <div class="muted">${progress.completed ? "Порядок собран верно." : "Переставляй строки, пока порядок не станет верным."}</div>
      </div>
    `;
  }

  return `
    <div class="widget-card${enterClass}">
      <h4>${escapeHtml(widget.title || widget.widget_type)}</h4>
      <p>Рендер этого виджета пока не реализован.</p>
    </div>
  `;
}

export function renderTeacherWidget(scene, widget, participants, runState, sceneChanged = false, widgetIndex = 0) {
  const enterClass = sceneChanged ? ` scene-float-in delay-${Math.min(widgetIndex + 1, 4)}` : "";

  if (widget.widget_type === "multiple_choice") {
    const options = widget.config.options || [];
    const currentStates = participants
      .map((participant) => widgetProgressFromParticipant(participant, scene.id, widget.id))
      .filter((progress) => typeof progress.selected_index === "number");
    const completedCount = currentStates.filter((progress) => progress.completed).length;
    return `
      <div class="widget-card${enterClass}">
        <h4>${escapeHtml(widget.title || "Вопрос с вариантами")}</h4>
        <p>${escapeHtml(widget.config.question || "")}</p>
        <div class="widget-stat-grid">
          <div class="widget-stat-card">
            <span class="muted">Ответили</span>
            <strong>${currentStates.length}</strong>
          </div>
          <div class="widget-stat-card">
            <span class="muted">Верно</span>
            <strong>${completedCount}</strong>
          </div>
          <div class="widget-stat-card">
            <span class="muted">Награда</span>
            <strong>${Number(widget.config.reward_tenths || 0) / 10}</strong>
          </div>
        </div>
        <div class="option-heat-list">
          ${options
            .map((option, index) => {
              const count = currentStates.filter((progress) => progress.selected_index === index).length;
              const percent = currentStates.length ? Math.round((count / currentStates.length) * 100) : 0;
              return `
                <div class="option-heat-row ${index === widget.config.correct_index ? "correct" : ""}">
                  <div class="row">
                    <strong>${escapeHtml(option)}</strong>
                    <span class="metric">${count}</span>
                  </div>
                  <div class="progress-strip">
                    <span style="width:${percent}%"></span>
                  </div>
                  <div class="muted">${percent}% класса выбрали этот ответ</div>
                </div>
              `;
            })
            .join("")}
        </div>
      </div>
    `;
  }

  if (widget.widget_type === "powers_of_two_picker") {
    const currentStates = participants
      .map((participant) => ({
        participant,
        progress: widgetProgressFromParticipant(participant, scene.id, widget.id),
      }))
      .filter(({ progress }) => Array.isArray(progress.selected_values) || progress.completed);
    const targetValue = Number(widget.config.target_value || 0);
    const solvedCount = currentStates.filter(({ progress }) => progress.completed).length;
    const activeCount = currentStates.length;
    const samples = currentStates
      .slice(0, 5)
      .map(({ participant, progress }) => {
        const model = buildPowerWidgetModel(widget, progress, scene);
        return `
          <div class="participant-sample-item">
            <span>${escapeHtml(participant.student_name || "Ученик")}</span>
            <span>${model.selectedSum} • ${model.binaryString}</span>
          </div>
        `;
      })
      .join("");
    return `
      <div class="widget-card widget-card--power${enterClass}">
        <h4>${escapeHtml(widget.title || "Степени двойки")}</h4>
        <div class="power-workspace">
          <div class="power-left-col">
            <div class="context-card-green">
              <div class="context-card-title">${escapeHtml(widget.config.context_title || "Контекст задачи")}</div>
              <div class="context-card-text">${escapeHtml(widget.config.task_text || scene.notes_text || "")}</div>
              <div class="kv-grid">
                <span>Адрес узла:</span>
                <strong>${escapeHtml(widget.config.node_address || "—")}</strong>
                <span>Маска:</span>
                <strong>${escapeHtml(widget.config.mask_address || "—")}</strong>
                <span>${escapeHtml(widget.config.answer_label || "Цель")}:</span>
                <strong>${targetValue}</strong>
              </div>
            </div>
            <div class="calculator-card-purple">
              <div class="calculator-title">Прогресс класса</div>
              <div class="widget-stat-grid">
                <div class="widget-stat-card">
                  <span class="muted">Решили</span>
                  <strong>${solvedCount}</strong>
                </div>
                <div class="widget-stat-card">
                  <span class="muted">В работе</span>
                  <strong>${activeCount}</strong>
                </div>
                <div class="widget-stat-card">
                  <span class="muted">Цель</span>
                  <strong>${targetValue}</strong>
                </div>
              </div>
              <div class="participant-sample-list">
                ${samples || `<div class="muted">Пока никто не начал собирать число.</div>`}
              </div>
            </div>
          </div>
          <div class="teacher-board-card">
            <div>
              <div class="teacher-board-title">Доска учителя</div>
              <div class="teacher-board-text">${escapeHtml(
                widget.config.teacher_board_text || scene.notes_text || "Пояснение к текущей сцене появится здесь."
              )}</div>
            </div>
            <div class="teacher-board-metrics">
              <span>Открыто ученикам: ${runState.highestUnlockedSceneIndex}</span>
              <span>Решили: ${solvedCount}</span>
              <span>Награда: ${(Number(widget.config.reward_tenths || 0) / 10).toFixed(1)}</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  if (widget.widget_type === "binary_decomposition") {
    const tasks = widget.config.tasks || [];
    const participantStates = participants.map((participant) => ({
      participant,
      progress: widgetProgressFromParticipant(participant, scene.id, widget.id),
    }));
    const completedCount = participantStates.filter(({ progress }) => progress.completed).length;
    return `
      <div class="widget-card${enterClass}">
        <h4>${escapeHtml(widget.title || "Двоичное разложение")}</h4>
        <div class="widget-stat-grid">
          <div class="widget-stat-card">
            <span class="muted">Решили полностью</span>
            <strong>${completedCount}</strong>
          </div>
          <div class="widget-stat-card">
            <span class="muted">Заданий в сцене</span>
            <strong>${tasks.length}</strong>
          </div>
        </div>
        ${tasks
          .map((task, rowIndex) => {
            const solvedByRow = participantStates.filter(({ progress }) => {
              const rows = Array.isArray(progress.rows) ? progress.rows : [];
              const row = rows[rowIndex] || {};
              const bits = Array.isArray(row.bits) ? row.bits : Array(task.bit_count || 8).fill(0);
              return buildBinaryValue(bits) === Number(task.target_value);
            }).length;
            return `
              <div class="option-heat-row">
                <div class="row">
                  <strong>Цель ${Number(task.target_value)}</strong>
                  <span class="metric">${solvedByRow}</span>
                </div>
                <div class="muted">Совпало у ${solvedByRow} учеников из ${participants.length}</div>
              </div>
            `;
          })
          .join("")}
      </div>
    `;
  }

  if (widget.widget_type === "match_pairs") {
    const pairs = getPairDefinitions(widget);
    const participantStates = participants.map((participant) => widgetProgressFromParticipant(participant, scene.id, widget.id));
    const completedCount = participantStates.filter((progress) => progress.completed).length;
    return `
      <div class="widget-card${enterClass}">
        <h4>${escapeHtml(widget.title || "Сопоставление")}</h4>
        <div class="widget-stat-grid">
          <div class="widget-stat-card">
            <span class="muted">Решили</span>
            <strong>${completedCount}</strong>
          </div>
          <div class="widget-stat-card">
            <span class="muted">Пар в сцене</span>
            <strong>${pairs.length}</strong>
          </div>
        </div>
        ${pairs
          .map((pair, pairIndex) => {
            const matched = participantStates.filter((progress) => (progress.matches || {})[String(pairIndex)] === pair.right).length;
            return `
              <div class="option-heat-row">
                <div class="row">
                  <strong>${escapeHtml(pair.left)}</strong>
                  <span class="metric">${matched}</span>
                </div>
                <div class="muted">Правильную пару собрали ${matched} учеников</div>
              </div>
            `;
          })
          .join("")}
      </div>
    `;
  }

  if (widget.widget_type === "algorithm_steps" || widget.widget_type === "code_puzzle") {
    const participantStates = participants.map((participant) => widgetProgressFromParticipant(participant, scene.id, widget.id));
    const completedCount = participantStates.filter((progress) => progress.completed).length;
    const totalItems = getOrderingItems(widget).length;
    return `
      <div class="widget-card${enterClass}">
        <h4>${escapeHtml(widget.title || (widget.widget_type === "code_puzzle" ? "Код-пазл" : "Алгоритм"))}</h4>
        <div class="widget-stat-grid">
          <div class="widget-stat-card">
            <span class="muted">Собрали порядок</span>
            <strong>${completedCount}</strong>
          </div>
          <div class="widget-stat-card">
            <span class="muted">Элементов</span>
            <strong>${totalItems}</strong>
          </div>
        </div>
        <div class="participant-sample-list">
          ${participantStates
            .slice(0, 5)
            .map((progress, index) => {
              const order = Array.isArray(progress.order) && progress.order.length > 0 ? progress.order : getInitialOrdering(widget);
              return `
                <div class="participant-sample-item">
                  <span>Попытка ${index + 1}</span>
                  <span>${escapeHtml(order.slice(0, 2).join(" -> ") || "еще без шагов")}</span>
                </div>
              `;
            })
            .join("") || `<div class="muted">Пока никто не менял порядок шагов.</div>`}
        </div>
      </div>
    `;
  }

  return `
    <div class="widget-card${enterClass}">
      <h4>${escapeHtml(widget.title || widget.widget_type)}</h4>
      <p>${escapeHtml(scene.notes_text || "Для этого виджета teacher-board рендер появится в следующем проходе.")}</p>
      <div class="tag-row">
        <span class="tag">${escapeHtml(widget.widget_type)}</span>
        <span class="tag">layout: ${escapeHtml(widget.layout?.preset || scene.layout?.preset || "custom")}</span>
      </div>
    </div>
  `;
}

function renderProjectedWidget(scene, widget, progress) {
  if (widget.widget_type === "multiple_choice") {
    const options = widget.config.options || [];
    const selectedIndex = progress.selected_index;
    return `
      <div class="widget-card">
        <h4>${escapeHtml(widget.title || "Вопрос с вариантами")}</h4>
        <p>${escapeHtml(widget.config.question || "")}</p>
        <div class="option-list">
          ${options
            .map(
              (option, index) => `
                <div class="option-btn ${selectedIndex === index ? "active" : ""}">${escapeHtml(option)}</div>
              `
            )
            .join("")}
        </div>
        <div class="muted">${progress.completed ? "Ученик выбрал правильный вариант." : "Текущий выбор ученика показан выше."}</div>
      </div>
    `;
  }

  if (widget.widget_type === "powers_of_two_picker") {
    const model = buildPowerWidgetModel(widget, progress, scene);
    return `
      <div class="widget-card widget-card--power">
        <h4>${escapeHtml(widget.title || "Степени двойки")}</h4>
        <div class="power-workspace">
          <div class="power-left-col">
            <div class="context-card-green">
              <div class="context-card-title">${escapeHtml(model.contextTitle)}</div>
              <div class="context-card-text">${escapeHtml(model.taskText)}</div>
              <div class="kv-grid">
                <span>Адрес узла:</span>
                <strong>${escapeHtml(model.nodeAddress)}</strong>
                <span>Маска:</span>
                <strong>${escapeHtml(model.maskAddress)}</strong>
                <span>${escapeHtml(model.answerLabel)}:</span>
                <strong>${model.selectedSum}</strong>
              </div>
            </div>
            <div class="formula-card-rose">
              <div class="formula-title">Ход ученика</div>
              <div class="formula-expression">${escapeHtml(model.expression)}</div>
              <div class="formula-subline">Двоичный вид: ${model.binaryString}</div>
            </div>
            <div class="calculator-card-purple">
              <div class="calculator-title">Выбранные биты</div>
              <div class="binary-strip">
                ${model.binaryString
                  .split("")
                  .map(
                    (bit, index) => `
                      <div class="binary-cell ${bit === "1" ? "active" : ""}">
                        <span>${bit}</span>
                        <small>2^${model.values.length - index - 1}</small>
                      </div>
                    `
                  )
                  .join("")}
              </div>
            </div>
          </div>
          <div class="teacher-board-card">
            <div class="teacher-board-title">Пояснение сцены</div>
            <div class="teacher-board-text">${escapeHtml(model.teacherBoardText)}</div>
            <div class="teacher-board-metrics">
              <span>Цель: ${model.targetValue}</span>
              <span>Сумма: ${model.selectedSum}</span>
              <span>${model.completed ? "Решено" : "В процессе"}</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  if (widget.widget_type === "binary_decomposition") {
    const rows = Array.isArray(progress.rows) ? progress.rows : [];
    return `
      <div class="widget-card">
        <h4>${escapeHtml(widget.title || "Двоичное разложение")}</h4>
        ${(widget.config.tasks || [])
          .map((task, rowIndex) => {
            const row = rows[rowIndex] || { bits: Array(task.bit_count || 8).fill(0) };
            const bits = Array.isArray(row.bits) ? row.bits : Array(task.bit_count || 8).fill(0);
            const value = buildBinaryValue(bits);
            return `
              <div class="binary-row">
                <div class="row">
                  <span class="metric">Цель ${task.target_value}</span>
                  <span class="muted">Сейчас ${value}</span>
                </div>
                <div class="bits-grid">
                  ${bits
                    .map(
                      (bit) => `
                        <div class="bit-btn ${bit ? "active" : ""}">${bit}</div>
                      `
                    )
                    .join("")}
                </div>
              </div>
            `;
          })
          .join("")}
      </div>
    `;
  }

  if (widget.widget_type === "match_pairs") {
    const pairs = getPairDefinitions(widget);
    const matches = progress.matches || {};
    return `
      <div class="widget-card">
        <h4>${escapeHtml(widget.title || "Сопоставь пары")}</h4>
        <div class="match-pair-list">
          ${pairs
            .map(
              (pair, pairIndex) => `
                <div class="match-pair-row">
                  <div class="match-pair-left">${escapeHtml(pair.left)}</div>
                  <div class="row">
                    <span class="tag">Ответ ученика</span>
                    <strong>${escapeHtml(matches[String(pairIndex)] || "еще не выбран")}</strong>
                  </div>
                </div>
              `
            )
            .join("")}
        </div>
      </div>
    `;
  }

  if (widget.widget_type === "algorithm_steps" || widget.widget_type === "code_puzzle") {
    const order = Array.isArray(progress.order) && progress.order.length > 0 ? progress.order : getInitialOrdering(widget);
    const isCode = widget.widget_type === "code_puzzle";
    return `
      <div class="widget-card">
        <h4>${escapeHtml(widget.title || (isCode ? "Код-пазл" : "Алгоритм"))}</h4>
        <div class="ordering-list">
          ${order
            .map(
              (item, itemIndex) => `
                <div class="ordering-row">
                  <div class="row">
                    <span class="tag">Шаг ${itemIndex + 1}</span>
                    ${progress.completed ? `<span class="tag">готово</span>` : ""}
                  </div>
                  <div class="ordering-copy ${isCode ? "ordering-copy-code" : ""}">${escapeHtml(item)}</div>
                </div>
              `
            )
            .join("")}
        </div>
      </div>
    `;
  }

  return `
    <div class="widget-card">
      <h4>${escapeHtml(widget.title || widget.widget_type)}</h4>
      <p>${escapeHtml(summarizeWidgetProgress(widget, progress))}</p>
    </div>
  `;
}

export function renderProjectedStudentWorkspace(inspection) {
  if (!inspection) return "";
  const participant = inspection.participant || {};
  const scene = inspection.scene || {};
  const sceneProgress = participant.progress?.[String(scene.id)] || {};
  const latestCodeRun = inspection.code_runs?.[0] || null;
  return `
    <div class="projected-student-card projected-student-workspace">
      <div class="row">
        <span class="metric">Показ на доске</span>
        <span class="tag">${escapeHtml(participant.class_name || "")}</span>
        <span class="tag">сцена ${Number(participant.current_scene_index ?? 0) + 1}</span>
      </div>
      <div class="scene-title">${escapeHtml(participant.student_name || "Ученик")}</div>
      <div class="teacher-board-copy">${escapeHtml(scene.title || "Текущая сцена ученика")}</div>
      <div class="projected-widget-stack">
        ${(scene.widgets || [])
          .map((widget) => renderProjectedWidget(scene, widget, sceneProgress[String(widget.id)] || {}))
          .join("")}
      </div>
      ${
        latestCodeRun
          ? `
            <div class="projected-code-snippet">
              <div class="row">
                <strong>Последний запуск Python</strong>
                <span class="tag">${escapeHtml(latestCodeRun.status || "ok")}</span>
              </div>
              <pre>${escapeHtml(latestCodeRun.source_code || "")}</pre>
              <pre>${escapeHtml(
                latestCodeRun.stdout_text ||
                  latestCodeRun.friendly_error ||
                  latestCodeRun.stderr_text ||
                  "Без вывода"
              )}</pre>
            </div>
          `
          : ""
      }
    </div>
  `;
}
