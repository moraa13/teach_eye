/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Виджеты ученика/учителя в рантайме: разметка и колбэки. Геометрия на доске учителя в редакторе — в tldraw, не здесь.
 */
import type { PointerEvent as ReactPointerEvent, ReactNode, SyntheticEvent } from 'react'
import type { Participant, Scene, Widget } from './lessonRuntimeModels'

export type PowerModel = {
  values: number[]
  selectedValues: number[]
  selectedSum: number
  binaryString: string
  targetValue: number
  expression: string
  taskText: string
  contextTitle: string
  nodeAddress: string
  maskAddress: string
  answerLabel: string
  teacherBoardText: string
  completed: boolean
}

export type StudentWidgetCallbacks = {
  onSelectMultipleChoice?: (widget: Widget, index: number) => void
  onTogglePowerValue?: (widget: Widget, value: number) => void
  onToggleBinaryBit?: (widget: Widget, rowIndex: number, bitIndex: number) => void
  onSetMatchPair?: (widget: Widget, pairIndex: number, value: string) => void
  onMoveOrderingItem?: (widget: Widget, itemIndex: number, direction: -1 | 1) => void
}

/** Не использовать `disabled` в режиме наблюдателя: события «пробиваются» на холст tldraw. */
function blockEventWhenSpectator(e: SyntheticEvent, isSpectator: boolean) {
  if (!isSpectator) return
  e.preventDefault()
  e.stopPropagation()
}

function absorbWidgetPointerDown(e: ReactPointerEvent<Element>, isSpectator: boolean) {
  e.stopPropagation()
  if (isSpectator) e.preventDefault()
}

/**
 * Слой превью редактора: tldraw (карандаш и др.) вешает слушатели выше — гасим capture,
 * чтобы взаимодействие не уходило в инструмент рисования.
 */
function blockPointerFromReachingTldrawHost(e: ReactPointerEvent<HTMLDivElement>) {
  e.stopPropagation()
  e.nativeEvent.stopImmediatePropagation()
}

export function widgetProgress(participant: Participant | null | undefined, sceneId: number, widgetId: number) {
  return participant?.progress?.[String(sceneId)]?.[String(widgetId)] || {}
}

export function computeBinaryStringFromValues(selectedValues: number[], values: number[]) {
  const active = new Set(selectedValues)
  return values.map((value) => (active.has(value) ? '1' : '0')).join('')
}

export function buildBinaryValue(bits: number[]) {
  return bits.reduce((sum, bit, bitIndex) => {
    const power = bits.length - bitIndex - 1
    return sum + (bit ? 2 ** power : 0)
  }, 0)
}

const UNICODE_SUPERSCRIPT_DIGITS = '⁰¹²³⁴⁵⁶⁷⁸⁹'

/** Показатель как Unicode-суперскрипт: 7 → ⁷, 10 → ¹⁰ */
export function exponentToUnicodeSuperscript(exp: number): string {
  if (!Number.isFinite(exp)) return '?'
  const n = Math.floor(Math.abs(exp))
  return String(n)
    .split('')
    .map((ch) => {
      const d = ch.charCodeAt(0) - 48
      return d >= 0 && d <= 9 ? UNICODE_SUPERSCRIPT_DIGITS[d]! : ch
    })
    .join('')
}

/** Запись вида 2⁷ (без ASCII `2^7`). */
export function formatPowerOfTwoNotation(exp: number): string {
  return `2${exponentToUnicodeSuperscript(exp)}`
}

export function getPairDefinitions(widget: Widget) {
  return Array.isArray(widget.config.pairs) ? widget.config.pairs : []
}

export function getOrderingItems(widget: Widget) {
  if (widget.widget_type === 'algorithm_steps') return Array.isArray(widget.config.steps) ? widget.config.steps : []
  if (widget.widget_type === 'code_puzzle') return Array.isArray(widget.config.lines) ? widget.config.lines : []
  return []
}

export function getInitialOrdering(widget: Widget) {
  const initial = Array.isArray(widget.config.initial_order) ? widget.config.initial_order : []
  if (initial.length > 0) return [...initial]
  return [...getOrderingItems(widget)]
}

export function buildPowerModel(widget: Widget, progress: Record<string, any>, scene: Scene): PowerModel {
  const values = Array.isArray(widget.config.values) ? widget.config.values : [128, 64, 32, 16, 8, 4, 2, 1]
  const selectedValues = Array.isArray(progress.selected_values) ? progress.selected_values : []
  const selectedSum =
    typeof progress.sum === 'number'
      ? progress.sum
      : selectedValues.reduce((sum: number, value: number) => sum + value, 0)
  const binaryString =
    typeof progress.binary_string === 'string'
      ? progress.binary_string
      : computeBinaryStringFromValues(selectedValues, values)
  return {
    values,
    selectedValues,
    selectedSum,
    binaryString,
    targetValue: Number(widget.config.target_value || 0),
    contextTitle: widget.config.context_title || 'Контекст задачи',
    taskText: widget.config.task_text || scene.notes_text || '',
    nodeAddress: widget.config.node_address || '—',
    maskAddress: widget.config.mask_address || '—',
    answerLabel: widget.config.answer_label || 'Цель',
    teacherBoardText: widget.config.teacher_board_text || scene.notes_text || 'Пояснение к текущей сцене.',
    completed: !!progress.completed,
    expression: selectedValues.length ? `${selectedValues.join(' + ')} = ${selectedSum}` : `0 = ${selectedSum}`,
  }
}

export function summarizeWidgetProgress(widget: Widget, progress: Record<string, any>) {
  if (!progress || Object.keys(progress).length === 0) return 'еще не начато'
  if (widget.widget_type === 'multiple_choice' && typeof progress.selected_index === 'number') {
    return progress.completed ? `вариант ${progress.selected_index + 1} • верно` : `вариант ${progress.selected_index + 1}`
  }
  if (widget.widget_type === 'powers_of_two_picker') {
    const sum = typeof progress.sum === 'number' ? progress.sum : 0
    const binary = typeof progress.binary_string === 'string' ? progress.binary_string : ''
    return progress.completed ? `${sum} • ${binary} • решено` : `${sum} • ${binary}`
  }
  if (widget.widget_type === 'binary_decomposition') {
    const rows = Array.isArray(progress.rows) ? progress.rows.length : 0
    return progress.completed ? `все ${rows} строки совпали` : `${rows} строк в работе`
  }
  if (widget.widget_type === 'match_pairs') {
    const total = Array.isArray(widget.config.pairs) ? widget.config.pairs.length : 0
    const matched = progress.matched_count ?? Object.keys(progress.matches || {}).length
    return progress.completed ? `${matched}/${total} пар собрано` : `${matched}/${total} пар`
  }
  if (widget.widget_type === 'algorithm_steps' || widget.widget_type === 'code_puzzle') {
    const total = Array.isArray(progress.order) ? progress.order.length : 0
    return progress.completed ? `порядок собран (${total} шагов)` : `собирает порядок (${total} шагов)`
  }
  return progress.completed ? 'завершено' : 'в процессе'
}

export function countSolvedParticipants(scene: Scene, widget: Widget, participants: Participant[]) {
  return participants.filter((participant) => widgetProgress(participant, scene.id, widget.id)?.completed).length
}

export function renderTeacherWidget(
  scene: Scene,
  widget: Widget,
  participants: Participant[],
  highestUnlockedSceneIndex: number,
): ReactNode {
  if (widget.widget_type === 'multiple_choice') {
    const options = Array.isArray(widget.config.options) ? widget.config.options : []
    const currentStates = participants
      .map((participant) => widgetProgress(participant, scene.id, widget.id))
      .filter((progress) => typeof progress.selected_index === 'number')
    const completedCount = currentStates.filter((progress) => progress.completed).length
    return (
      <div className="board-widget-card" key={widget.id}>
        <div className="card-title">{widget.title || 'Вопрос с вариантами'}</div>
        <div className="info-text">{widget.config.question || ''}</div>
        <div className="widget-stat-grid">
          <div className="widget-stat-card">
            <span className="info-text">Ответили</span>
            <strong>{currentStates.length}</strong>
          </div>
          <div className="widget-stat-card">
            <span className="info-text">Верно</span>
            <strong>{completedCount}</strong>
          </div>
        </div>
        <div className="option-heat-list">
          {options.map((option: string, index: number) => {
            const count = currentStates.filter((progress) => progress.selected_index === index).length
            const percent = currentStates.length ? Math.round((count / currentStates.length) * 100) : 0
            return (
              <div className={`option-heat-row ${index === widget.config.correct_index ? 'correct' : ''}`} key={`${widget.id}-${index}`}>
                <div className="row">
                  <strong>{option}</strong>
                  <span className="metric">{count}</span>
                </div>
                <div className="progress-strip">
                  <span style={{ width: `${percent}%` }} />
                </div>
                <div className="info-text">{percent}% класса выбрали этот ответ</div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  if (widget.widget_type === 'powers_of_two_picker') {
    const currentStates = participants
      .map((participant) => ({
        participant,
        progress: widgetProgress(participant, scene.id, widget.id),
      }))
      .filter(({ progress }) => Array.isArray(progress.selected_values) || progress.completed)
    const targetValue = Number(widget.config.target_value || 0)
    const solvedCount = currentStates.filter(({ progress }) => progress.completed).length
    return (
      <div className="board-widget-card board-widget-power" key={widget.id}>
        <div className="card-title">{widget.title || 'Степени двойки'}</div>
        <div className="power-workspace desktop-board-power">
          <div className="power-left-column">
            <div className="context-card green">
              <div className="context-title">{widget.config.context_title || 'Контекст задачи'}</div>
              <div className="context-copy">{widget.config.task_text || scene.notes_text || ''}</div>
              <div className="kv-grid">
                <span>Адрес узла:</span>
                <strong>{widget.config.node_address || '—'}</strong>
                <span>Маска:</span>
                <strong>{widget.config.mask_address || '—'}</strong>
                <span>{widget.config.answer_label || 'Цель'}:</span>
                <strong>{targetValue}</strong>
              </div>
            </div>
            <div className="context-card purple">
              <div className="context-title">Прогресс класса</div>
              <div className="widget-stat-grid">
                <div className="widget-stat-card">
                  <span className="info-text">Решили</span>
                  <strong>{solvedCount}</strong>
                </div>
                <div className="widget-stat-card">
                  <span className="info-text">В работе</span>
                  <strong>{currentStates.length}</strong>
                </div>
              </div>
              <div className="participant-sample-list">
                {currentStates.length ? currentStates.slice(0, 5).map(({ participant, progress }) => {
                  const model = buildPowerModel(widget, progress, scene)
                  return (
                    <div className="participant-sample-item" key={`${widget.id}-${participant.session_id}`}>
                      <span>{participant.student_name || 'Ученик'}</span>
                      <span>{model.selectedSum} • {model.binaryString}</span>
                    </div>
                  )
                }) : <div className="info-text">Пока никто не начал собирать число.</div>}
              </div>
            </div>
          </div>
          <div className="teacher-board">
            <div className="context-title">Доска учителя</div>
            <div className="context-copy">{widget.config.teacher_board_text || scene.notes_text || ''}</div>
            <div className="footer-metrics">
              <span>Открыто до сцены {highestUnlockedSceneIndex}</span>
              <span>Решили: {solvedCount}</span>
              <span>Награда: {(Number(widget.config.reward_tenths || 0) / 10).toFixed(1)}</span>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (widget.widget_type === 'binary_decomposition') {
    const tasks = Array.isArray(widget.config.tasks) ? widget.config.tasks : []
    const participantStates = participants.map((participant) => widgetProgress(participant, scene.id, widget.id))
    const completedCount = participantStates.filter((progress) => progress.completed).length
    return (
      <div className="board-widget-card" key={widget.id}>
        <div className="card-title">{widget.title || 'Двоичное разложение'}</div>
        <div className="widget-stat-grid">
          <div className="widget-stat-card">
            <span className="info-text">Решили полностью</span>
            <strong>{completedCount}</strong>
          </div>
          <div className="widget-stat-card">
            <span className="info-text">Заданий в сцене</span>
            <strong>{tasks.length}</strong>
          </div>
        </div>
        {tasks.map((task: { target_value: number; bit_count: number }, rowIndex: number) => {
          const solvedByRow = participantStates.filter((progress) => {
            const rows = Array.isArray(progress.rows) ? progress.rows : []
            const row = rows[rowIndex] || {}
            const bits = Array.isArray(row.bits) ? row.bits : Array(task.bit_count || 8).fill(0)
            return buildBinaryValue(bits) === Number(task.target_value)
          }).length
          return (
            <div className="option-heat-row" key={`${widget.id}-${rowIndex}`}>
              <div className="row">
                <strong>Цель {Number(task.target_value)}</strong>
                <span className="metric">{solvedByRow}</span>
              </div>
              <div className="info-text">Совпало у {solvedByRow} учеников из {participants.length}</div>
            </div>
          )
        })}
      </div>
    )
  }

  if (widget.widget_type === 'match_pairs') {
    const pairs = getPairDefinitions(widget)
    const participantStates = participants.map((participant) => widgetProgress(participant, scene.id, widget.id))
    const completedCount = participantStates.filter((progress) => progress.completed).length
    return (
      <div className="board-widget-card" key={widget.id}>
        <div className="card-title">{widget.title || 'Сопоставление'}</div>
        <div className="widget-stat-grid">
          <div className="widget-stat-card">
            <span className="info-text">Решили</span>
            <strong>{completedCount}</strong>
          </div>
          <div className="widget-stat-card">
            <span className="info-text">Пар в сцене</span>
            <strong>{pairs.length}</strong>
          </div>
        </div>
      </div>
    )
  }

  if (widget.widget_type === 'algorithm_steps' || widget.widget_type === 'code_puzzle') {
    const participantStates = participants.map((participant) => widgetProgress(participant, scene.id, widget.id))
    const completedCount = participantStates.filter((progress) => progress.completed).length
    return (
      <div className="board-widget-card" key={widget.id}>
        <div className="card-title">{widget.title || widget.widget_type}</div>
        <div className="widget-stat-grid">
          <div className="widget-stat-card">
            <span className="info-text">Решили</span>
            <strong>{completedCount}</strong>
          </div>
          <div className="widget-stat-card">
            <span className="info-text">Шагов</span>
            <strong>{getOrderingItems(widget).length}</strong>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="board-widget-card" key={widget.id}>
      <div className="card-title">{widget.title || widget.widget_type}</div>
      <div className="info-text">{scene.notes_text || 'Рендер виджета еще не реализован в desktop shell.'}</div>
    </div>
  )
}

export function renderProjectedWidget(scene: Scene, widget: Widget, progress: Record<string, any>) {
  if (widget.widget_type === 'multiple_choice') {
    const options = Array.isArray(widget.config.options) ? widget.config.options : []
    const selectedIndex = progress.selected_index
    return (
      <div className="board-widget-card" key={widget.id}>
        <div className="card-title">{widget.title || 'Вопрос с вариантами'}</div>
        <div className="info-text">{widget.config.question || ''}</div>
        <div className="option-list">
          {options.map((option: string, index: number) => (
            <div className={`option-btn ${selectedIndex === index ? 'active' : ''}`} key={`${widget.id}-${index}`}>
              {option}
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (widget.widget_type === 'powers_of_two_picker') {
    const model = buildPowerModel(widget, progress, scene)
    return (
      <div className="board-widget-card board-widget-power" key={widget.id}>
        <div className="card-title">{widget.title || 'Степени двойки'}</div>
        <div className="power-workspace desktop-board-power">
          <div className="power-left-column">
            <div className="context-card green">
              <div className="context-title">{model.contextTitle}</div>
              <div className="context-copy">{model.taskText}</div>
              <div className="kv-grid">
                <span>Адрес узла:</span>
                <strong>{model.nodeAddress}</strong>
                <span>Маска:</span>
                <strong>{model.maskAddress}</strong>
                <span>{model.answerLabel}:</span>
                <strong>{model.selectedSum}</strong>
              </div>
            </div>
            <div className="context-card rose">
              <div className="context-title">Ход ученика</div>
              <div className="formula-text">{model.expression}</div>
              <div className="context-copy">Двоичный вид: {model.binaryString}</div>
            </div>
          </div>
          <div className="teacher-board">
            <div className="context-title">Пояснение сцены</div>
            <div className="context-copy">{model.teacherBoardText}</div>
            <div className="footer-metrics">
              <span>Цель: {model.targetValue}</span>
              <span>Сумма: {model.selectedSum}</span>
              <span>{model.completed ? 'Решено' : 'В процессе'}</span>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (widget.widget_type === 'binary_decomposition') {
    const rows = Array.isArray(progress.rows) ? progress.rows : []
    return (
      <div className="board-widget-card" key={widget.id}>
        <div className="card-title">{widget.title || 'Двоичное разложение'}</div>
        {(Array.isArray(widget.config.tasks) ? widget.config.tasks : []).map((task: { target_value: number; bit_count: number }, rowIndex: number) => {
          const row = rows[rowIndex] || { bits: Array(task.bit_count || 8).fill(0) }
          const bits = Array.isArray(row.bits) ? row.bits : Array(task.bit_count || 8).fill(0)
          const value = buildBinaryValue(bits)
          return (
            <div className="option-heat-row" key={`${widget.id}-${rowIndex}`}>
              <div className="row">
                <span className="metric">Цель {task.target_value}</span>
                <span className="student-meta">Сейчас {value}</span>
              </div>
              <div className="bits-grid">
                {bits.map((bit: number, bitIndex: number) => (
                  <div className={`bit-btn ${bit ? 'active' : ''}`} key={`${widget.id}-${rowIndex}-${bitIndex}`}>
                    {bit}
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  if (widget.widget_type === 'match_pairs') {
    const pairs = getPairDefinitions(widget)
    const matches = progress.matches || {}
    return (
      <div className="board-widget-card" key={widget.id}>
        <div className="card-title">{widget.title || 'Сопоставь пары'}</div>
        <div className="match-pair-list">
          {pairs.map((pair: { left: string; right: string }, pairIndex: number) => (
            <div className="match-pair-row" key={`${widget.id}-${pairIndex}`}>
              <div className="match-pair-left">{pair.left}</div>
              <div className="row">
                <span className="student-badge">Ответ ученика</span>
                <strong>{matches[String(pairIndex)] || 'еще не выбран'}</strong>
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (widget.widget_type === 'algorithm_steps' || widget.widget_type === 'code_puzzle') {
    const order = Array.isArray(progress.order) && progress.order.length > 0 ? progress.order : getInitialOrdering(widget)
    const isCode = widget.widget_type === 'code_puzzle'
    return (
      <div className="board-widget-card" key={widget.id}>
        <div className="card-title">{widget.title || (isCode ? 'Код-пазл' : 'Алгоритм')}</div>
        <div className="ordering-list">
          {order.map((item: string, itemIndex: number) => (
            <div className="ordering-row" key={`${widget.id}-${itemIndex}`}>
              <div className="row">
                <span className="student-badge">Шаг {itemIndex + 1}</span>
                {progress.completed ? <span className="student-badge">готово</span> : null}
              </div>
              <div className={`ordering-copy ${isCode ? 'ordering-copy-code' : ''}`}>{item}</div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="board-widget-card" key={widget.id}>
      <div className="card-title">{widget.title || widget.widget_type}</div>
      <div className="student-meta">{summarizeWidgetProgress(widget, progress)}</div>
    </div>
  )
}

export function renderStudentWidget(
  scene: Scene,
  widget: Widget,
  progress: Record<string, any>,
  callbacks: StudentWidgetCallbacks,
  mode: 'student-interactive' | 'student-spectator' = 'student-interactive',
) {
  const isSpectator = mode === 'student-spectator'

  if (widget.widget_type === 'multiple_choice') {
    const options = Array.isArray(widget.config.options) ? widget.config.options : []
    const selectedIndex = typeof progress.selected_index === 'number' ? progress.selected_index : null
    return (
      <div className="board-widget-card" key={widget.id}>
        <div className="card-title">{widget.title || 'Вопрос с вариантами'}</div>
        <div className="info-text">{widget.config.question || scene.notes_text || ''}</div>
        <div className="option-list">
          {options.map((option: string, index: number) => (
            <button
              key={`${widget.id}-${index}`}
              type="button"
              className={`option-btn ${selectedIndex === index ? 'active' : ''}${isSpectator ? ' widget-spectator-inert' : ''}`}
              aria-disabled={isSpectator}
              onPointerDown={(e) => absorbWidgetPointerDown(e, isSpectator)}
              onClick={(e) => {
                blockEventWhenSpectator(e, isSpectator)
                e.stopPropagation()
                if (isSpectator) return
                callbacks.onSelectMultipleChoice?.(widget, index)
              }}
            >
              {option}
            </button>
          ))}
        </div>
      </div>
    )
  }

  if (widget.widget_type === 'powers_of_two_picker') {
    const model = buildPowerModel(widget, progress, scene)
    return (
      <div className="board-widget-card board-widget-power" key={widget.id}>
        <div className="card-title">{widget.title || 'Степени двойки'}</div>
        <div className="power-workspace desktop-board-power">
          <div className="power-left-column">
            <div className="context-card green">
              <div className="context-title">{model.contextTitle}</div>
              <div className="context-copy">{model.taskText}</div>
              <div className="kv-grid">
                <span>Адрес узла:</span>
                <strong>{model.nodeAddress}</strong>
                <span>Маска:</span>
                <strong>{model.maskAddress}</strong>
                <span>{model.answerLabel}:</span>
                <strong>{model.selectedSum}</strong>
              </div>
            </div>
            <div className="context-card rose">
              <div className="context-title">Текущий шаг</div>
              <div className="formula-text">{model.expression}</div>
              <div className="context-copy">Двоичный вид: {model.binaryString}</div>
            </div>
            <div className="context-card purple">
              <div className="context-title">Калькулятор степеней двойки</div>
              <div className="power-two-table" role="group" aria-label="Таблица степеней двойки, выбор слагаемых">
                <div className="power-two-table-head">
                  <span>Степень</span>
                  <span>Значение</span>
                </div>
                {model.values.map((value, index) => {
                  const exp = model.values.length - index - 1
                  const selected = model.selectedValues.includes(value)
                  return (
                    <button
                      key={value}
                      type="button"
                      className={`power-two-table-row ${selected ? 'active' : ''}${isSpectator ? ' widget-spectator-inert' : ''}`}
                      aria-pressed={selected}
                      aria-disabled={isSpectator}
                      aria-label={`${formatPowerOfTwoNotation(exp)} равно ${value}, ${selected ? 'выбрано' : 'не выбрано'}`}
                      onPointerDown={(e) => absorbWidgetPointerDown(e, isSpectator)}
                      onClick={(e) => {
                        blockEventWhenSpectator(e, isSpectator)
                        e.stopPropagation()
                        if (isSpectator) return
                        callbacks.onTogglePowerValue?.(widget, value)
                      }}
                    >
                      <span className="power-two-expr">{formatPowerOfTwoNotation(exp)}</span>
                      <span className="power-two-val">{value}</span>
                    </button>
                  )
                })}
              </div>
              <div className="binary-strip">
                {model.binaryString.split('').map((bit, index) => (
                  <div key={`${bit}-${index}`} className={`binary-cell ${bit === '1' ? 'active' : ''}`}>
                    <strong>{bit}</strong>
                    <small>{formatPowerOfTwoNotation(model.values.length - index - 1)}</small>
                  </div>
                ))}
              </div>
              <div className="footer-metrics">
                <span>Цель: {model.targetValue}</span>
                <span>Сейчас: {model.selectedSum}</span>
                <span className={model.completed ? 'ok' : 'muted'}>
                  {model.completed ? 'Совпало, молодец' : isSpectator ? 'Наблюдение' : 'Собери правильную сумму'}
                </span>
              </div>
            </div>
          </div>
          <div className="teacher-board">
            <div className="context-title">Доска учителя</div>
            <div className="context-copy">{model.teacherBoardText}</div>
            <div className="footer-metrics">
              <span>Цель: {model.targetValue}</span>
              <span>Сумма: {model.selectedSum}</span>
              <span>Биты: {model.binaryString}</span>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (widget.widget_type === 'binary_decomposition') {
    const tasks = Array.isArray(widget.config.tasks) ? widget.config.tasks : []
    const rows = Array.isArray(progress.rows) ? progress.rows : []
    return (
      <div className="board-widget-card" key={widget.id}>
        <div className="card-title">{widget.title || 'Двоичное разложение'}</div>
        <div className="info-text">{scene.notes_text || 'Поставь единицы на нужные разряды.'}</div>
        {tasks.map((task: { target_value: number; bit_count: number }, rowIndex: number) => {
          const row = rows[rowIndex] || { bits: Array(task.bit_count || 8).fill(0) }
          const bits = Array.isArray(row.bits) ? row.bits : Array(task.bit_count || 8).fill(0)
          const value = buildBinaryValue(bits)
          return (
            <div className="option-heat-row" key={`${widget.id}-${rowIndex}`}>
              <div className="row">
                <span className="metric">Цель {task.target_value}</span>
                <span className="student-meta">Сейчас {value}</span>
              </div>
              <div className="bits-grid">
                {bits.map((bit: number, bitIndex: number) => (
                  <button
                    key={`${widget.id}-${rowIndex}-${bitIndex}`}
                    type="button"
                    className={`bit-btn ${bit ? 'active' : ''}${isSpectator ? ' widget-spectator-inert' : ''}`}
                    aria-disabled={isSpectator}
                    onPointerDown={(e) => absorbWidgetPointerDown(e, isSpectator)}
                    onClick={(e) => {
                      blockEventWhenSpectator(e, isSpectator)
                      e.stopPropagation()
                      if (isSpectator) return
                      callbacks.onToggleBinaryBit?.(widget, rowIndex, bitIndex)
                    }}
                  >
                    {bit}
                  </button>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  if (widget.widget_type === 'match_pairs') {
    const pairs = getPairDefinitions(widget)
    const matches = progress.matches || {}
    const options = pairs.map((pair: { right: string }) => pair.right)
    return (
      <div className="board-widget-card" key={widget.id}>
        <div className="card-title">{widget.title || 'Сопоставь пары'}</div>
        <div className="match-pair-list">
          {pairs.map((pair: { left: string }, pairIndex: number) => (
            <div className="match-pair-row" key={`${widget.id}-${pairIndex}`}>
              <div className="match-pair-left">{pair.left}</div>
              {isSpectator ? (
                <div className="row">
                  <span className="student-badge">Ответ</span>
                  <strong>{matches[String(pairIndex)] || 'еще не выбран'}</strong>
                </div>
              ) : (
                <select
                  value={matches[String(pairIndex)] || ''}
                  onPointerDown={(e) => e.stopPropagation()}
                  onChange={(event) => callbacks.onSetMatchPair?.(widget, pairIndex, event.target.value)}
                >
                  <option value="">Выбери пару</option>
                  {options.map((option, optionIndex) => (
                    <option key={`${widget.id}-pair-option-${optionIndex}`} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              )}
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (widget.widget_type === 'algorithm_steps' || widget.widget_type === 'code_puzzle') {
    const order = Array.isArray(progress.order) && progress.order.length > 0 ? progress.order : getInitialOrdering(widget)
    const isCode = widget.widget_type === 'code_puzzle'
    return (
      <div className="board-widget-card" key={widget.id}>
        <div className="card-title">{widget.title || (isCode ? 'Код-пазл' : 'Алгоритм')}</div>
        <div className="ordering-list">
          {order.map((item: string, itemIndex: number) => (
            <div className="ordering-row" key={`${widget.id}-${itemIndex}`}>
              <div className="row">
                <span className="student-badge">Шаг {itemIndex + 1}</span>
                <div className="ordering-actions">
                  {!isSpectator ? (
                    <>
                      <button
                        type="button"
                        className="ghost"
                        disabled={itemIndex <= 0}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={() => callbacks.onMoveOrderingItem?.(widget, itemIndex, -1)}
                      >
                        Вверх
                      </button>
                      <button
                        type="button"
                        className="ghost"
                        disabled={itemIndex >= order.length - 1}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={() => callbacks.onMoveOrderingItem?.(widget, itemIndex, 1)}
                      >
                        Вниз
                      </button>
                    </>
                  ) : null}
                  {progress.completed ? <span className="student-badge">готово</span> : null}
                </div>
              </div>
              <div className={`ordering-copy ${isCode ? 'ordering-copy-code' : ''}`}>{item}</div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="board-widget-card" key={widget.id}>
      <div className="card-title">{widget.title || widget.widget_type}</div>
      <div className="student-meta">{summarizeWidgetProgress(widget, progress)}</div>
    </div>
  )
}

/** Превью на доске учителя (tldraw): тот же UI, что у ученика, но без взаимодействия. */
export function renderBoardWidgetEditorPreview(scene: Scene, widget: Widget) {
  return (
    <div
      className="board-widget-editor-preview-blocker"
      onPointerDownCapture={blockPointerFromReachingTldrawHost}
      onPointerMoveCapture={(e) => {
        if (e.buttons !== 0) blockPointerFromReachingTldrawHost(e)
      }}
      onPointerUpCapture={blockPointerFromReachingTldrawHost}
    >
      {renderStudentWidget(scene, widget, {}, {}, 'student-spectator')}
    </div>
  )
}
