import { FocusPanel, StudentTiles } from './boardRuntimeView'
import type { LessonRun, LessonSummary, StatusKind } from './appTypes'
import type { ParticipantInspection, Scene } from './lessonRuntimeModels'

export function TeacherControlScreen({
  statusKind,
  currentLessonLabel,
  teacherRun,
  teacherClassName,
  lessons,
  selectedLessonId,
  teacherSceneList,
  editorSceneIndex,
  teacherWorkspaceMode,
  currentEditorScene,
  onEnsureDemoLesson,
  onCreateEmptyBoardDraft,
  onCreateStarterBoardLesson,
  onRefreshLibrary,
  onSelectLesson,
  onChangeClassName,
  onOpenBoardEditor,
  onStartTeacherRun,
  onOpenTeacherScene,
  selectedSessionId,
  projectedSessionId,
  selectedInspection,
  onInspectStudent,
  onAwardStar,
  onToggleProjection,
}: {
  statusKind: StatusKind
  currentLessonLabel: string | null
  teacherRun: LessonRun | null
  teacherClassName: string
  lessons: LessonSummary[]
  selectedLessonId: number | null
  teacherSceneList: Scene[]
  editorSceneIndex: number
  teacherWorkspaceMode: 'editor' | 'runtime'
  currentEditorScene: Scene | null
  onEnsureDemoLesson: () => void
  onCreateEmptyBoardDraft: () => void
  onCreateStarterBoardLesson: () => void
  onRefreshLibrary: () => void
  onSelectLesson: (lessonId: number) => void
  onChangeClassName: (value: string) => void
  onOpenBoardEditor: () => void
  onStartTeacherRun: () => void
  onOpenTeacherScene: (sceneIndex?: number) => void
  selectedSessionId: number | null
  projectedSessionId: number | null
  selectedInspection: ParticipantInspection | null
  onInspectStudent: (sessionId: number, showStatus?: boolean) => void
  onAwardStar: (sessionId: number) => void
  onToggleProjection: (sessionId: number) => void
}) {
  return (
    <section className="screen">
      <section className="desktop-hero control-hero">
        <div>
          <div className="desktop-badge">Teacher control window</div>
          <h1>Пульт учителя</h1>
          <p>Здесь живут библиотека уроков, запуск, сцены, студенты, статистика и управление projection, а не сам canvas.</p>
        </div>
        <div className="desktop-hero-metrics">
          <div className="desktop-hero-card">
            <span>Статус API</span>
            <strong>{statusKind === 'ok' ? 'На связи' : 'Нужно подключение'}</strong>
          </div>
          <div className="desktop-hero-card">
            <span>Урок</span>
            <strong>{currentLessonLabel || 'Выбери или создай доску'}</strong>
          </div>
          <div className="desktop-hero-card">
            <span>Класс</span>
            <strong>{teacherRun?.class_name || teacherClassName || '8А'}</strong>
          </div>
          <div className="desktop-hero-card">
            <span>Ученики онлайн</span>
            <strong>{teacherRun?.participants.length ?? 0}</strong>
          </div>
        </div>
      </section>

      <header className="screen-header">
        <div>
          <h1>Teacher Control</h1>
          <p>Пульт для lesson library, scene control, student monitoring и быстрого перехода на board.</p>
        </div>
      </header>

      <div className="content-grid teacher-grid">
        <section className="card">
          <div className="card-title">Библиотека уроков</div>
          <div className="card-actions">
            <button onClick={onEnsureDemoLesson}>Создать demo-урок</button>
            <button className="ghost" onClick={onCreateEmptyBoardDraft}>
              Пустая доска
            </button>
            <button className="ghost" onClick={onCreateStarterBoardLesson}>
              Новый board-урок
            </button>
            <button className="ghost" onClick={onRefreshLibrary}>
              Обновить список
            </button>
          </div>

          <label className="field">
            <span>Урок</span>
            <select
              value={selectedLessonId ?? ''}
              onChange={(event) => {
                const nextLessonId = Number(event.target.value)
                if (!nextLessonId) return
                onSelectLesson(nextLessonId)
              }}
            >
              <option value="">Выбери урок...</option>
              {lessons.map((lesson) => (
                <option key={lesson.id} value={lesson.id}>
                  {lesson.title} ({lesson.topic || 'без темы'})
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Класс</span>
            <input value={teacherClassName} onChange={(event) => onChangeClassName(event.target.value)} />
          </label>

          <div className="card-actions">
            <button className="ghost" onClick={onOpenBoardEditor}>
              Открыть доску
            </button>
            <button onClick={onStartTeacherRun}>Запустить урок</button>
          </div>
        </section>

        <section className="card">
          <div className="card-title">{teacherWorkspaceMode === 'editor' ? 'Сцены урока' : 'Сцены live-урока'}</div>
          <div className="scene-chip-list">
            {teacherSceneList.map((scene, index) => (
              <button
                key={scene.id}
                className={`scene-chip ${
                  (teacherWorkspaceMode === 'editor' ? editorSceneIndex : teacherRun?.current_scene_index) === index ? 'current' : ''
                } ${teacherWorkspaceMode === 'runtime' && teacherRun && index > teacherRun.highest_unlocked_scene_index ? 'locked' : ''}`}
                onClick={() => onOpenTeacherScene(index)}
              >
                {index + 1}. {scene.title}
              </button>
            ))}
          </div>
          {teacherWorkspaceMode === 'runtime' ? (
            <button className="ghost" onClick={() => onOpenTeacherScene()}>
              Следующая сцена
            </button>
          ) : null}
          <div className="info-text">
            {teacherWorkspaceMode === 'editor'
              ? currentEditorScene
                ? `Готова к редактированию сцена ${editorSceneIndex + 1}`
                : 'Выбери урок и открой доску'
              : teacherRun
              ? `Открыто ученикам до сцены ${teacherRun.highest_unlocked_scene_index + 1}`
              : 'Урок еще не запущен'}
          </div>
        </section>

        <section className="card card-wide">
          <div className="card-title">Ученики {teacherRun ? `(${teacherRun.participants.length})` : '(0)'}</div>
          <StudentTiles
            participants={teacherRun?.participants ?? []}
            selectedSessionId={selectedSessionId}
            projectedSessionId={projectedSessionId}
            onInspect={(sessionId) => void onInspectStudent(sessionId)}
            onAwardStar={(sessionId) => void onAwardStar(sessionId)}
          />
        </section>

        <section className="card card-wide">
          <div className="card-title">Фокус ученика</div>
          <FocusPanel
            inspection={selectedInspection}
            projected={!!selectedInspection && projectedSessionId === selectedInspection.participant.session_id}
            onToggleProjection={onToggleProjection}
            onRefresh={(sessionId) => void onInspectStudent(sessionId, false)}
          />
        </section>
      </div>
    </section>
  )
}
