import { LessonSceneCanvas } from './LessonSceneCanvas'
import { renderStudentWidget, type StudentWidgetCallbacks } from './boardWidgets'
import type { LessonRun } from './appTypes'
import type { Participant, Scene } from './lessonRuntimeModels'
import { normalizeWidgetLayout } from './sceneLayout'

export function StudentScreen({
  studentClassName,
  studentName,
  studentSessionId,
  studentSessionCode,
  studentRunIdInput,
  studentRun,
  studentParticipant,
  studentScene,
  studentSceneAnimKey,
  studentCanvasMode,
  code,
  codeOutput,
  onChangeStudentClassName,
  onChangeStudentName,
  onLoginStudent,
  onChangeStudentRunIdInput,
  onUseCurrentRun,
  onJoinStudentRun,
  onSyncStudent,
  onNavigateStudent,
  onChangeCode,
  onRunCode,
  widgetCallbacks,
}: {
  studentClassName: string
  studentName: string
  studentSessionId: number | null
  studentSessionCode: string
  studentRunIdInput: string
  studentRun: LessonRun | null
  studentParticipant: Participant | null
  studentScene: Scene | null
  studentSceneAnimKey: number
  studentCanvasMode: 'student-interactive' | 'student-spectator'
  code: string
  codeOutput: string
  onChangeStudentClassName: (value: string) => void
  onChangeStudentName: (value: string) => void
  onLoginStudent: () => void
  onChangeStudentRunIdInput: (value: string) => void
  onUseCurrentRun: () => void
  onJoinStudentRun: () => void
  onSyncStudent: () => void
  onNavigateStudent: (delta: -1 | 1) => void
  onChangeCode: (value: string) => void
  onRunCode: () => void
  widgetCallbacks: StudentWidgetCallbacks
}) {
  const sceneProgress = studentScene && studentParticipant ? studentParticipant.progress?.[String(studentScene.id)] || {} : {}
  const canInteractWithScene = studentCanvasMode === 'student-interactive'

  return (
    <section className="screen">
      <section className="desktop-hero compact">
        <div>
          <div className="desktop-badge">Student window</div>
          <h1>Рабочее место ученика</h1>
          <p>Общая доска урока, интерактивные виджеты и запуск Python-кода внутри отдельного student surface.</p>
        </div>
      </section>

      <header className="screen-header">
        <div>
          <h1>Экран ученика</h1>
          <p>Та же сцена, что видит учитель: надписи, фигуры и интерактивные виджеты на одном canvas.</p>
        </div>
        <button className="ghost" onClick={onSyncStudent}>
          Синхронизировать
        </button>
      </header>

      <div className="content-grid student-grid-layout">
        <section className="card">
          <div className="card-title">Сессия</div>
          <label className="field">
            <span>Класс</span>
            <input value={studentClassName} onChange={(event) => onChangeStudentClassName(event.target.value)} />
          </label>
          <label className="field">
            <span>Фамилия и имя</span>
            <input value={studentName} onChange={(event) => onChangeStudentName(event.target.value)} />
          </label>
          <button onClick={onLoginStudent}>Войти</button>
          <div className="info-text">
            {studentSessionId ? `Сессия #${studentSessionId} • код ${studentSessionCode}` : 'Сессия еще не создана'}
          </div>
        </section>

        <section className="card">
          <div className="card-title">Подключение к уроку</div>
          <label className="field">
            <span>ID урока</span>
            <input value={studentRunIdInput} onChange={(event) => onChangeStudentRunIdInput(event.target.value)} />
          </label>
          <div className="card-actions">
            <button className="ghost" onClick={onUseCurrentRun}>
              Подставить текущий урок
            </button>
            <button onClick={onJoinStudentRun}>Подключиться</button>
          </div>
          <div className="info-text">
            {studentRun ? `Урок #${studentRun.id} • открыто до сцены ${studentRun.highest_unlocked_scene_index + 1}` : 'Пока не подключен к уроку'}
          </div>
        </section>

        <section className="card card-wide">
          <div className="scene-toolbar">
            <div>
              <div className="card-title">Текущая сцена</div>
              <div className="info-text">
                {studentParticipant
                  ? `Ты на сцене ${studentParticipant.current_scene_index + 1}. Учитель сейчас на ${(studentRun?.current_scene_index ?? 0) + 1}.`
                  : 'Подключись к уроку, чтобы начать.'}
              </div>
            </div>
            <div className="card-actions">
              <button className="ghost" disabled={!studentParticipant || studentParticipant.current_scene_index <= 0} onClick={() => onNavigateStudent(-1)}>
                Назад
              </button>
              <button
                className="ghost"
                disabled={
                  !studentParticipant ||
                  !studentRun ||
                  studentParticipant.current_scene_index >= studentRun.highest_unlocked_scene_index
                }
                onClick={() => onNavigateStudent(1)}
              >
                Вперед
              </button>
            </div>
          </div>

          {studentScene ? (
            <div key={studentSceneAnimKey} className="student-scene-shell scene-float-in">
              <div className="student-scene-meta">
                <div className="scene-board-title">{studentScene.title}</div>
                <div className="scene-board-text">
                  {studentScene.notes_text || 'Учитель еще не добавил пояснение к этой сцене.'}
                </div>
                <div className="footer-metrics">
                  <span>Режим: {canInteractWithScene ? 'interactive' : 'spectator'}</span>
                  <span>Виджетов: {studentScene.widgets.length}</span>
                  <span>Звезды: {studentParticipant ? (studentParticipant.stars_tenths / 10).toFixed(1) : '0.0'}</span>
                  <span>Версия прогресса: {studentParticipant?.progress_version ?? 0}</span>
                </div>
              </div>

              <LessonSceneCanvas
                rawLayout={studentScene.layout}
                mode={studentCanvasMode}
                widgets={studentScene.widgets.map((widget, index) => ({
                  id: widget.id,
                  layout: normalizeWidgetLayout(widget.layout, index),
                  className: `student-runtime-widget ${canInteractWithScene ? 'student-runtime-widget-interactive' : 'student-runtime-widget-spectator'}`,
                  content: renderStudentWidget(
                    studentScene,
                    widget,
                    sceneProgress[String(widget.id)] || {},
                    widgetCallbacks,
                    studentCanvasMode,
                  ),
                }))}
                className="student-runtime-canvas"
              />
            </div>
          ) : (
            <div className="empty-state">Подключись к уроку и дождись, когда учитель откроет сцену на общей доске.</div>
          )}
        </section>

        <section className="card card-wide">
          <div className="scene-toolbar">
            <div className="card-title">Python runner</div>
            <button onClick={onRunCode}>Запустить код</button>
          </div>
          <textarea className="code-editor" value={code} onChange={(event) => onChangeCode(event.target.value)} />
          <pre className="code-output">{codeOutput}</pre>
        </section>
      </div>
    </section>
  )
}
