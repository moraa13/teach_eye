import { useEffect } from 'react'
import { TeacherBoardEditor } from './TeacherBoardEditor'
import { TeacherBoardRuntime } from './boardRuntimeView'
import type { Lesson, LessonRun, StatusKind } from './appTypes'
import type { ParticipantInspection, Scene } from './lessonRuntimeModels'
import { invoke } from '@tauri-apps/api/core'

const DEBUG_BOARD_MOUNT_LOGS = true

export function TeacherBoardScreen({
  statusKind,
  currentLessonLabel,
  teacherRun,
  teacherClassName,
  teacherWorkspaceMode,
  onSetWorkspaceMode,
  onRefresh,
  teacherSceneList,
  editorSceneIndex,
  currentEditorScene,
  editorLesson,
  onSelectEditorScene,
  onOpenTeacherScene,
  editorSceneAnimKey,
  currentTeacherScene,
  teacherLesson,
  projectedInspection,
  projectedSessionId,
  selectedInspection,
  onChangeEditorLesson,
  onSaveLesson,
  isSavingLesson,
  editorDirty,
  onCreateEmptyBoardDraft,
  onCreateStarterBoardLesson,
}: {
  statusKind: StatusKind
  currentLessonLabel: string | null
  teacherRun: LessonRun | null
  teacherClassName: string
  teacherWorkspaceMode: 'editor' | 'runtime'
  onSetWorkspaceMode: (mode: 'editor' | 'runtime') => void
  onRefresh: () => void
  teacherSceneList: Scene[]
  editorSceneIndex: number
  currentEditorScene: Scene | null
  editorLesson: Lesson | null
  onSelectEditorScene: (sceneIndex: number) => void
  onOpenTeacherScene: (sceneIndex?: number) => void
  editorSceneAnimKey: number
  currentTeacherScene: Scene | null
  teacherLesson: Lesson | null
  projectedInspection: ParticipantInspection | null
  projectedSessionId: number | null
  selectedInspection: ParticipantInspection | null
  onChangeEditorLesson: (lesson: Lesson) => void
  onSaveLesson: () => void
  isSavingLesson: boolean
  editorDirty: boolean
  onCreateEmptyBoardDraft: () => void
  onCreateStarterBoardLesson: () => void
}) {
  const needsEditorSetup = teacherWorkspaceMode === 'editor' && !editorLesson

  useEffect(() => {
    const onErr = (event: ErrorEvent) => {
      // #region agent log
      fetch('http://127.0.0.1:7711/ingest/ea4dba9c-75d7-4a3b-928e-7c8b2a9adba1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'ac6ffd' },
        body: JSON.stringify({
          sessionId: 'ac6ffd',
          runId: 'dbg-board',
          hypothesisId: 'H3',
          location: 'TeacherBoardScreen.tsx:window.onerror',
          message: String(event.message),
          data: {
            filename: event.filename,
            lineno: event.lineno,
            colno: event.colno,
            stack: event.error instanceof Error ? event.error.stack : undefined,
          },
          timestamp: Date.now(),
        }),
      }).catch(() => {})
      // #endregion
    }
    const onRej = (event: PromiseRejectionEvent) => {
      // #region agent log
      const reason = event.reason
      fetch('http://127.0.0.1:7711/ingest/ea4dba9c-75d7-4a3b-928e-7c8b2a9adba1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'ac6ffd' },
        body: JSON.stringify({
          sessionId: 'ac6ffd',
          runId: 'dbg-board',
          hypothesisId: 'H3',
          location: 'TeacherBoardScreen.tsx:unhandledrejection',
          message: 'unhandledrejection',
          data: {
            err: reason instanceof Error ? reason.message : String(reason),
            stack: reason instanceof Error ? reason.stack : undefined,
          },
          timestamp: Date.now(),
        }),
      }).catch(() => {})
      // #endregion
    }
    window.addEventListener('error', onErr)
    window.addEventListener('unhandledrejection', onRej)
    return () => {
      window.removeEventListener('error', onErr)
      window.removeEventListener('unhandledrejection', onRej)
    }
  }, [])

  useEffect(() => {
    if (!DEBUG_BOARD_MOUNT_LOGS) return
    // #region agent log
    const line = JSON.stringify({
      sessionId: 'ffe9af',
      runId: 'pre-fix',
      hypothesisId: 'H2',
      location: 'TeacherBoardScreen.tsx:56',
      message: 'TeacherBoardScreen:mount',
      data: {
        teacherWorkspaceMode,
        lessonId: editorLesson?.id ?? teacherLesson?.id ?? null,
        sceneCount: editorLesson?.scenes.length ?? teacherLesson?.scenes.length ?? 0,
      },
      timestamp: Date.now(),
    })
    fetch('http://127.0.0.1:7711/ingest/ea4dba9c-75d7-4a3b-928e-7c8b2a9adba1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'ffe9af' },
      body: line,
    }).catch(() => {})
    invoke('append_debug_log', { line: `${line}\n` }).catch(() => {})
    // #endregion

    // #region agent log
    fetch('http://127.0.0.1:7711/ingest/ea4dba9c-75d7-4a3b-928e-7c8b2a9adba1',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d405cf'},body:JSON.stringify({sessionId:'d405cf',runId:'pre-fix',hypothesisId:'H3',location:'TeacherBoardScreen.tsx:82',message:'teacher_board_screen_mount',data:{teacherWorkspaceMode,lessonId:editorLesson?.id??teacherLesson?.id??null,editorSceneIndex,teacherSceneCount:teacherSceneList.length,currentEditorSceneId:currentEditorScene?.id??null,currentTeacherSceneId:currentTeacherScene?.id??null},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
  }, [
    currentEditorScene?.id,
    currentTeacherScene?.id,
    editorLesson?.id,
    editorLesson?.scenes.length,
    editorSceneIndex,
    teacherLesson?.id,
    teacherLesson?.scenes.length,
    teacherSceneList.length,
    teacherWorkspaceMode,
  ])

  if (teacherWorkspaceMode === 'editor') {
    return (
      <section className="screen board-window-shell board-window-editor-shell">
        {needsEditorSetup ? (
          <section className="card board-window-empty">
            <div className="card-title">Доска еще не подготовлена</div>
            <p className="info-text">
              Создай локальный draft или стартовый board-урок, чтобы сразу перейти в полноценное рабочее пространство.
            </p>
            <div className="card-actions">
              <button onClick={onCreateEmptyBoardDraft}>Пустая доска</button>
              <button className="ghost" onClick={onCreateStarterBoardLesson}>
                Новый board-урок
              </button>
            </div>
          </section>
        ) : (
          <TeacherBoardEditor
            lesson={editorLesson}
            sceneIndex={editorSceneIndex}
            onSceneIndexChange={onSelectEditorScene}
            onLessonChange={onChangeEditorLesson}
            onSave={onSaveLesson}
            saving={isSavingLesson}
            dirty={editorDirty}
          />
        )}
      </section>
    )
  }

  return (
    <section className="screen">
      <section className="desktop-hero board-hero">
        <div>
          <div className="desktop-badge">Teacher board window</div>
          <h1>Чистая доска учителя</h1>
          <p>Отдельное рабочее пространство для сцены, рисования, текста, фигур и present/live режима без перегруженного пульта.</p>
        </div>
        <div className="desktop-hero-metrics">
          <div className="desktop-hero-card">
            <span>Статус API</span>
            <strong>{statusKind === 'ok' ? 'Готово к работе' : 'Нужно подключение'}</strong>
          </div>
          <div className="desktop-hero-card">
            <span>Урок</span>
            <strong>{currentLessonLabel || 'Открой или создай доску'}</strong>
          </div>
          <div className="desktop-hero-card">
            <span>Режим доски</span>
            <strong>Live runtime</strong>
          </div>
          <div className="desktop-hero-card">
            <span>Класс</span>
            <strong>{teacherRun?.class_name || teacherClassName || '8А'}</strong>
          </div>
        </div>
      </section>

      <header className="screen-header">
        <div>
          <h1>Teacher Board</h1>
          <p>Canvas-first окно: сцена, scene strip и переключение между authoring и live view.</p>
        </div>
        <div className="screen-header-actions">
          <div className="workspace-mode-switch">
            <button className="ghost" onClick={() => onSetWorkspaceMode('editor')}>
              Editor
            </button>
            <button className="active" onClick={() => onSetWorkspaceMode('runtime')} disabled={!teacherRun}>
              Live runtime
            </button>
          </div>
          <button className="ghost" onClick={onRefresh}>
            Обновить
          </button>
        </div>
      </header>

      <div className="content-grid board-screen-grid">
        <section className="card">
          <div className="card-title">Сцены урока</div>
          <div className="scene-chip-list">
            {teacherSceneList.map((scene, index) => (
              <button
                key={scene.id}
                className={`scene-chip ${teacherRun?.current_scene_index === index ? 'current' : ''} ${
                  teacherRun && index > teacherRun.highest_unlocked_scene_index ? 'locked' : ''
                }`}
                onClick={() => onOpenTeacherScene(index)}
              >
                {index + 1}. {scene.title}
              </button>
            ))}
          </div>
          <button className="ghost" onClick={() => onOpenTeacherScene()}>
            Следующая сцена
          </button>
          <div className="info-text">
            {teacherRun
              ? `Открыто ученикам до сцены ${teacherRun.highest_unlocked_scene_index + 1}`
              : 'Урок еще не запущен'}
          </div>
        </section>

        <section className="card card-wide board-main-card">
          <div className="card-title">Teacher Live Board</div>
          <div key={editorSceneAnimKey}>
            <TeacherBoardRuntime
              scene={currentTeacherScene}
              currentSceneIndex={teacherRun?.current_scene_index ?? 0}
              lessonSceneCount={teacherLesson?.scenes.length ?? 0}
              highestUnlockedSceneIndex={(teacherRun?.highest_unlocked_scene_index ?? 0) + 1}
              participants={teacherRun?.participants ?? []}
              projectedInspection={
                projectedSessionId && selectedInspection?.participant.session_id === projectedSessionId
                  ? selectedInspection
                  : projectedInspection
              }
            />
          </div>
        </section>
      </div>
    </section>
  )
}
