import { LessonSceneCanvas } from './LessonSceneCanvas'
import { renderProjectedWidget, renderTeacherWidget, summarizeWidgetProgress } from './boardWidgets'
import {
  normalizeParticipantInspection,
  normalizeScene,
  type Participant,
  type ParticipantInspection,
  type Scene,
} from './lessonRuntimeModels'
import { normalizeWidgetLayout } from './sceneLayout'

function formatStars(starsTenths: number) {
  return (Number(starsTenths || 0) / 10).toFixed(1)
}

export function TeacherBoardRuntime({
  scene,
  currentSceneIndex,
  lessonSceneCount,
  highestUnlockedSceneIndex,
  participants,
  projectedInspection,
}: {
  scene: Scene | null
  currentSceneIndex: number
  lessonSceneCount: number
  highestUnlockedSceneIndex: number
  participants: Participant[]
  projectedInspection: ParticipantInspection | null
}) {
  if (!scene) {
    return <div className="empty-state">Сцена не выбрана.</div>
  }

  const normalizedScene = normalizeScene(scene)
  const participantsOnScene = participants.filter((participant) => participant.current_scene_index === currentSceneIndex)
  const solvedWidgets = normalizedScene.widgets.reduce((count, widget) => {
    const solvedCount = participants.filter(
      (participant) => participant.progress?.[String(normalizedScene.id)]?.[String(widget.id)]?.completed,
    ).length
    return count + (solvedCount > 0 ? 1 : 0)
  }, 0)
  const projectedStudentName = projectedInspection?.participant.student_name || null

  return (
    <div className="teacher-board-runtime">
      <div className="scene-board scene-float-in board-scene-stage">
        <div className="row board-scene-stage-top">
          <div className="board-scene-title-wrap">
            <span className="metric">Сцена {currentSceneIndex + 1} / {lessonSceneCount}</span>
            <span className="student-badge">{normalizedScene.scene_type || 'board'}</span>
            {projectedStudentName ? <span className="student-badge">на доске: {projectedStudentName}</span> : null}
          </div>
          <div className="board-scene-pulse">
            <span>открыто до {highestUnlockedSceneIndex}</span>
            <span>{participantsOnScene.length} на сцене</span>
            <span>{normalizedScene.widgets.length} видж.</span>
            <span>{solvedWidgets} уже в работе</span>
          </div>
        </div>
        <div className="scene-board-title">{normalizedScene.title}</div>
        <div className="scene-board-text">{normalizedScene.notes_text || 'Запусти урок, и здесь появится доска учителя.'}</div>
        <div className="board-scene-summary-grid">
          <div className="board-scene-summary-card">
            <span>Класс на этом шаге</span>
            <strong>{participantsOnScene.length}</strong>
          </div>
          <div className="board-scene-summary-card">
            <span>Виджетов в сцене</span>
            <strong>{normalizedScene.widgets.length}</strong>
          </div>
          <div className="board-scene-summary-card">
            <span>С unlock до</span>
            <strong>{highestUnlockedSceneIndex}</strong>
          </div>
          <div className="board-scene-summary-card">
            <span>Projection</span>
            <strong>{projectedStudentName || 'выкл.'}</strong>
          </div>
        </div>
      </div>

      {projectedInspection ? <ProjectedStudentWorkspace inspection={projectedInspection} /> : null}

      <LessonSceneCanvas
        rawLayout={normalizedScene.layout}
        mode="teacher-live"
        widgets={normalizedScene.widgets.map((widget, index) => ({
          id: widget.id,
          layout: normalizeWidgetLayout(widget.layout, index),
          className: 'teacher-runtime-widget',
          content: renderTeacherWidget(normalizedScene, widget, participants, highestUnlockedSceneIndex),
        }))}
        className="teacher-runtime-canvas"
      />
    </div>
  )
}

export function StudentTiles({
  participants,
  selectedSessionId,
  projectedSessionId,
  onInspect,
  onAwardStar,
}: {
  participants: Participant[]
  selectedSessionId: number | null
  projectedSessionId: number | null
  onInspect: (sessionId: number) => void
  onAwardStar: (sessionId: number) => void
}) {
  if (!participants.length) {
    return <div className="empty-state">Пока никто не подключился к уроку.</div>
  }
  return (
    <div className="student-grid">
      {participants.map((participant) => (
        <div
          key={participant.session_id}
          className={`student-card scene-float-in ${
            selectedSessionId === participant.session_id ? 'student-card-selected' : ''
          } ${projectedSessionId === participant.session_id ? 'student-card-projected' : ''}`}
        >
          <div className="student-name">{participant.student_name}</div>
          <div className="student-meta">{participant.class_name}</div>
          <div className="student-badges">
            <span>{formatStars(participant.stars_tenths)} звезды</span>
            <span>{participant.activity_points} активность</span>
            <span>сцена {participant.current_scene_index + 1}</span>
            {selectedSessionId === participant.session_id ? <span>фокус</span> : null}
            {projectedSessionId === participant.session_id ? <span>на доске</span> : null}
          </div>
          <div className="student-preview">
            {participant.preview?.summary || 'Превью пока нет'}
            {'\n'}
            {participant.preview?.metric || ''}
            {'\n'}
            {participant.preview?.value || ''}
          </div>
          <div className="student-preview-meta">
            {participant.preview?.metric || 'метрика появится после первого действия'}
          </div>
          <div className="card-actions">
            <button className="ghost" onClick={() => onInspect(participant.session_id)}>
              {selectedSessionId === participant.session_id ? 'Открыт' : 'Открыть'}
            </button>
            <button className="ghost" onClick={() => onAwardStar(participant.session_id)}>
              +0.1 звезды
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

export function FocusPanel({
  inspection,
  projected,
  onToggleProjection,
  onRefresh,
}: {
  inspection: ParticipantInspection | null
  projected: boolean
  onToggleProjection: (sessionId: number) => void
  onRefresh: (sessionId: number) => void
}) {
  if (!inspection) {
    return <div className="empty-state">Выбери ученика, чтобы открыть его сцену, прогресс и код.</div>
  }
  const normalizedInspection = normalizeParticipantInspection(inspection)
  const participant = normalizedInspection.participant
  const scene = normalizedInspection.scene
  const progress = participant.progress?.[String(scene.id)] || {}
  const latestCodeRun = normalizedInspection.code_runs[0] || null
  return (
    <div className="focus-inspect-grid">
      <div className="focus-panel">
        <div className="row">
          <div>
            <div className="scene-board-title">{participant.student_name || 'Ученик'}</div>
            <div className="student-meta">{participant.class_name || ''}</div>
          </div>
          <div className="student-badges">
            <span>{formatStars(participant.stars_tenths)} звезды</span>
            <span>{participant.activity_points} активность</span>
            <span>сцена {participant.current_scene_index + 1}</span>
          </div>
        </div>
        <div className="scene-board-text">
          {scene.title} • {scene.notes_text || 'Без заметок'}
        </div>
        <div className="widget-stat-grid">
          <div className="widget-stat-card">
            <span className="info-text">Превью</span>
            <strong>{participant.preview?.summary || 'нет'}</strong>
          </div>
          <div className="widget-stat-card">
            <span className="info-text">Метрика</span>
            <strong>{participant.preview?.metric || '—'}</strong>
          </div>
          <div className="widget-stat-card">
            <span className="info-text">Значение</span>
            <strong>{participant.preview?.value || '—'}</strong>
          </div>
        </div>
        <div className="card-actions">
          <button className="ghost" onClick={() => onToggleProjection(participant.session_id)}>
            {projected ? 'Убрать с доски' : 'Показать на доске'}
          </button>
          <button className="ghost" onClick={() => onRefresh(participant.session_id)}>
            Обновить фокус
          </button>
        </div>
      </div>

      <div className="focus-widget-list">
        {scene.widgets.map((widget) => (
          <div className="focus-widget-item" key={widget.id}>
            <strong>{widget.title || widget.widget_type}</strong>
            <div className="student-meta">{summarizeWidgetProgress(widget, progress[String(widget.id)] || {})}</div>
          </div>
        ))}
      </div>

      <div className="focus-code-list">
        <div className="card-title">Последние запуски Python</div>
        {latestCodeRun ? (
          <div className="focus-code-item focus-code-item-primary">
            <div className="row">
              <strong>{latestCodeRun.scene_title || 'Без сцены'}</strong>
              <span className="student-badge">{latestCodeRun.status || 'ok'}</span>
            </div>
            <div className="student-meta">
              {latestCodeRun.duration_ms ? `Последний запуск: ${latestCodeRun.duration_ms} мс` : 'Последний запуск готов'}
            </div>
            <pre className="focus-code-preview">
              {latestCodeRun.stdout_text || latestCodeRun.friendly_error || latestCodeRun.stderr_text || 'Без вывода'}
            </pre>
          </div>
        ) : null}
        {normalizedInspection.code_runs.length ? normalizedInspection.code_runs.map((codeRun) => (
          <div className="focus-code-item" key={codeRun.id}>
            <div className="row">
              <strong>{codeRun.scene_title || 'Без сцены'}</strong>
              <span className="student-badge">{codeRun.status || 'ok'}</span>
            </div>
            <div className="student-meta">{codeRun.friendly_error || codeRun.stdout_text || codeRun.stderr_text || 'Без вывода'}</div>
          </div>
        )) : <div className="empty-state">Ученик пока не запускал код в этом уроке.</div>}
      </div>
    </div>
  )
}

function ProjectedStudentWorkspace({ inspection }: { inspection: ParticipantInspection }) {
  const normalizedInspection = normalizeParticipantInspection(inspection)
  const participant = normalizedInspection.participant
  const scene = normalizedInspection.scene
  const sceneProgress = participant.progress?.[String(scene.id)] || {}
  const latestCodeRun = normalizedInspection.code_runs?.[0] || null

  return (
    <div className="projected-student-card projected-student-workspace">
      <div className="row">
        <span className="metric">Показ на доске</span>
        <span className="student-badge">{participant.class_name || ''}</span>
        <span className="student-badge">сцена {participant.current_scene_index + 1}</span>
      </div>
      <div className="scene-board-title">{participant.student_name || 'Ученик'}</div>
      <div className="scene-board-text">{scene.title || 'Текущая сцена ученика'}</div>
      <div className="widget-stat-grid">
        <div className="widget-stat-card">
          <span className="info-text">Превью</span>
          <strong>{participant.preview?.summary || 'нет'}</strong>
        </div>
        <div className="widget-stat-card">
          <span className="info-text">Метрика</span>
          <strong>{participant.preview?.metric || '—'}</strong>
        </div>
        <div className="widget-stat-card">
          <span className="info-text">Значение</span>
          <strong>{participant.preview?.value || '—'}</strong>
        </div>
      </div>
      <LessonSceneCanvas
        rawLayout={scene.layout}
        mode="student-spectator"
        widgets={scene.widgets.map((widget, index) => ({
          id: widget.id,
          layout: normalizeWidgetLayout(widget.layout, index),
          className: 'teacher-runtime-widget projected-runtime-widget',
          content: renderProjectedWidget(scene, widget, sceneProgress[String(widget.id)] || {}),
        }))}
        className="teacher-runtime-canvas projected-runtime-canvas"
      />
      {latestCodeRun ? (
        <div className="projected-code-snippet">
          <div className="row">
            <strong>Последний запуск Python</strong>
            <span className="student-badge">{latestCodeRun.status || 'ok'}</span>
          </div>
          <pre>{latestCodeRun.source_code || ''}</pre>
          <pre>{latestCodeRun.stdout_text || latestCodeRun.friendly_error || latestCodeRun.stderr_text || 'Без вывода'}</pre>
        </div>
      ) : null}
    </div>
  )
}
