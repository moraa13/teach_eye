import './App.css'
import { useEffect } from 'react'
import { TeacherBoardScreen } from './TeacherBoardScreen'
import { TeacherControlScreen } from './TeacherControlScreen'
import { StudentScreen } from './StudentScreen'
import { StudentLauncherScreen } from './StudentLauncherScreen'
import { StandaloneSurfaceBoundary } from './StandaloneSurfaceBoundary'
import { useDesktopAppState } from './useDesktopAppState'

function App() {
  const { shell, api, teacher, student } = useDesktopAppState()

  useEffect(() => {
    // #region agent log
    fetch('http://127.0.0.1:7711/ingest/ea4dba9c-75d7-4a3b-928e-7c8b2a9adba1',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d405cf'},body:JSON.stringify({sessionId:'d405cf',runId:'pre-fix',hypothesisId:'H2',location:'App.tsx:12',message:'app_route_resolved',data:{windowKind:shell.windowKind,role:shell.role,currentLessonLabel:shell.currentLessonLabel,teacherMode:teacher.teacherWorkspaceMode,sceneCount:teacher.teacherSceneList.length},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
  }, [shell.currentLessonLabel, shell.role, shell.windowKind, teacher.teacherSceneList.length, teacher.teacherWorkspaceMode])

  const teacherBoardScreen = (
    <StandaloneSurfaceBoundary
      title="Teacher Board surface crashed"
      details={
        <>
          <strong>Урок:</strong> {shell.currentLessonLabel || 'не выбран'}
          <br />
          <strong>Режим:</strong> {teacher.teacherWorkspaceMode}
          <br />
          <strong>Сцены:</strong> {teacher.teacherSceneList.length}
        </>
      }
    >
      <TeacherBoardScreen
        statusKind={shell.statusKind}
        currentLessonLabel={shell.currentLessonLabel}
        teacherRun={teacher.teacherRun}
        teacherClassName={teacher.teacherClassName}
        teacherWorkspaceMode={teacher.teacherWorkspaceMode}
        onSetWorkspaceMode={teacher.setTeacherWorkspaceMode}
        onRefresh={() => void teacher.syncTeacherRun()}
        teacherSceneList={teacher.teacherSceneList}
        editorSceneIndex={teacher.editorSceneIndex}
        currentEditorScene={teacher.currentEditorScene}
        editorLesson={teacher.editorLesson}
        onSelectEditorScene={teacher.setEditorSceneIndex}
        onOpenTeacherScene={(sceneIndex) => void teacher.openTeacherScene(sceneIndex)}
        editorSceneAnimKey={teacher.teacherSceneAnimKey}
        currentTeacherScene={teacher.currentTeacherScene}
        teacherLesson={teacher.teacherLesson}
        projectedInspection={
          teacher.projectedSessionId && teacher.selectedInspection?.participant.session_id === teacher.projectedSessionId
            ? teacher.selectedInspection
            : null
        }
        projectedSessionId={teacher.projectedSessionId}
        selectedInspection={teacher.selectedInspection}
        onChangeEditorLesson={teacher.changeEditorLesson}
        onSaveLesson={() => void teacher.saveEditedLesson()}
        isSavingLesson={teacher.isSavingLesson}
        editorDirty={teacher.editorDirty}
      />
    </StandaloneSurfaceBoundary>
  )

  const teacherControlScreen = (
    <TeacherControlScreen
      statusKind={shell.statusKind}
      currentLessonLabel={shell.currentLessonLabel}
      teacherRun={teacher.teacherRun}
      teacherClassName={teacher.teacherClassName}
      lessons={teacher.lessons}
      selectedLessonId={teacher.selectedLessonId}
      teacherSceneList={teacher.teacherSceneList}
      editorSceneIndex={teacher.editorSceneIndex}
      teacherWorkspaceMode={teacher.teacherWorkspaceMode}
      currentEditorScene={teacher.currentEditorScene}
      onEnsureDemoLesson={() => void teacher.ensureDemoLesson()}
      onCreateEmptyBoardDraft={teacher.createEmptyBoardDraft}
      onCreateStarterBoardLesson={() => void teacher.createStarterBoardLesson()}
      onRefreshLibrary={() => void teacher.loadLessonLibrary()}
      onSelectLesson={teacher.selectLesson}
      onChangeClassName={teacher.setTeacherClassName}
      onOpenBoardEditor={teacher.openBoardEditor}
      onStartTeacherRun={() => void teacher.startTeacherRun()}
      onOpenTeacherScene={(sceneIndex) =>
        teacher.teacherWorkspaceMode === 'editor'
          ? teacher.setEditorSceneIndex(sceneIndex ?? teacher.editorSceneIndex)
          : void teacher.openTeacherScene(sceneIndex)
      }
      selectedSessionId={teacher.selectedSessionId}
      projectedSessionId={teacher.projectedSessionId}
      selectedInspection={teacher.selectedInspection}
      onInspectStudent={(sessionId, showStatus) => void teacher.inspectStudent(sessionId, showStatus)}
      onAwardStar={(sessionId) => void teacher.awardStar(sessionId)}
      onToggleProjection={teacher.toggleProjectedStudent}
    />
  )

  const studentScreen = (
    <StandaloneSurfaceBoundary
      title="Student surface crashed"
      details={
        <>
          <strong>Урок:</strong> {student.studentRun ? `#${student.studentRun.id}` : 'не подключен'}
          <br />
          <strong>Сцена:</strong> {student.studentCurrentScene?.title || 'не выбрана'}
          <br />
          <strong>Ученик:</strong> {student.studentParticipant?.student_name || student.studentName}
        </>
      }
    >
      <StudentScreen
        studentClassName={student.studentClassName}
        studentName={student.studentName}
        studentSessionId={student.studentSessionId}
        studentSessionCode={student.studentSessionCode}
        studentRunIdInput={student.studentRunIdInput}
        studentRun={student.studentRun}
        studentParticipant={student.studentParticipant}
        studentScene={student.studentCurrentScene}
        studentSceneAnimKey={student.studentSceneAnimKey}
        studentCanvasMode={student.studentCanvasMode}
        code={student.code}
        codeOutput={student.codeOutput}
        onChangeStudentClassName={student.setStudentClassName}
        onChangeStudentName={student.setStudentName}
        onLoginStudent={() => void student.loginStudent()}
        onChangeStudentRunIdInput={student.setStudentRunIdInput}
        onUseCurrentRun={student.useCurrentRun}
        onJoinStudentRun={() => void student.joinStudentRun()}
        onSyncStudent={() => void student.syncStudentState()}
        onNavigateStudent={(delta) => void student.navigateStudent(delta)}
        onChangeCode={student.setCode}
        onRunCode={() => void student.runCode()}
        widgetCallbacks={student.widgetCallbacks}
      />
    </StandaloneSurfaceBoundary>
  )

  if (shell.windowKind === 'teacher-board') {
    return <main className="workspace workspace-standalone">{teacherBoardScreen}</main>
  }

  if (shell.windowKind === 'teacher-control') {
    return <main className="workspace workspace-standalone">{teacherControlScreen}</main>
  }

  if (shell.windowKind === 'student') {
    return <main className="workspace workspace-standalone">{studentScreen}</main>
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div>
          <div className="desktop-badge">Teacher board desktop</div>
          <div className="brand">TeachEye Board</div>
          <div className="brand-subtitle">Главный launcher и data hub: здесь живут API, история, стата и кнопки открытия отдельных окон.</div>
        </div>

        <div className="role-switch">
          <button className={shell.role === 'teacher' ? 'active' : ''} onClick={() => shell.setRole('teacher')}>
            Учитель
          </button>
          <button className={shell.role === 'student' ? 'active' : ''} onClick={() => shell.setRole('student')}>
            Ученик
          </button>
        </div>

        <div className={`status-card ${shell.statusKind}`}>{shell.status}</div>

        <div className="sidebar-panel">
          <div className="card-title">Сводка сессии</div>
          <div className="sidebar-stat-list">
            <div className="sidebar-stat">
              <span>Режим</span>
              <strong>{shell.role === 'teacher' ? 'Учитель' : 'Ученик'}</strong>
            </div>
            <div className="sidebar-stat">
              <span>Backend</span>
              <strong>{shell.statusKind === 'ok' ? 'на связи' : 'недоступен'}</strong>
            </div>
            <div className="sidebar-stat">
              <span>Выбранный урок</span>
              <strong>{shell.currentLessonLabel || 'не выбран'}</strong>
            </div>
            <div className="sidebar-stat">
              <span>Активный запуск</span>
              <strong>{teacher.teacherRun ? `урок #${teacher.teacherRun.id}` : 'еще не запущен'}</strong>
            </div>
            <div className="sidebar-stat">
              <span>Показ на доске</span>
              <strong>{shell.projectedStudentName || 'никого'}</strong>
            </div>
          </div>
        </div>

        <div className="sidebar-panel">
          <div className="card-title">Подключение к API</div>
          <label className="field">
            <span>Адрес backend</span>
            <input value={api.apiBaseInput} onChange={(event) => api.setApiBaseInput(event.target.value)} />
          </label>
          <div className="card-actions">
            <button onClick={() => void api.applyApiBase()}>Сохранить и проверить</button>
            <button className="ghost" onClick={() => void api.checkHealth()}>
              Пинг
            </button>
          </div>
          <div className="card-actions">
            <button className="ghost" onClick={() => api.setApiBaseInput(api.defaultApiBase)}>
              Локальный сервер
            </button>
            <button className="ghost" onClick={() => api.setApiBaseInput(api.lanApiBase)}>
              LAN пример
            </button>
          </div>
          <div className="info-text">Текущий адрес: {api.apiBase}</div>
          <div className="info-text">Для локального сервера обычно нужен `http://127.0.0.1:8000`.</div>
        </div>

        <div className="sidebar-panel">
          <div className="card-title">Окна</div>
          <div className="card-actions">
            <button className="ghost" onClick={() => void api.openSurfaceWindow('teacher', 'board')}>
              Board window
            </button>
            <button className="ghost" onClick={() => void api.openSurfaceWindow('teacher', 'control')}>
              Control window
            </button>
            <button className="ghost" onClick={() => void api.openSurfaceWindow('student', 'student')}>
              Student window
            </button>
          </div>
          <div className="info-text">Каждое окно открывается отдельно и подхватывает surface через Tauri label + query params.</div>
        </div>

        <div className="sidebar-note">
          Если видишь `Failed to fetch`, это почти всегда значит, что backend не запущен или приложение смотрит не на тот адрес API. После смены адреса нажми `Сохранить и проверить`.
        </div>
      </aside>

      <main className="workspace">
        {shell.role === 'teacher' ? (
          teacherControlScreen
        ) : (
          <StudentLauncherScreen
            studentClassName={student.studentClassName}
            studentName={student.studentName}
            studentSessionId={student.studentSessionId}
            studentSessionCode={student.studentSessionCode}
            studentRunIdInput={student.studentRunIdInput}
            hasActiveRun={Boolean(student.studentRunIdInput)}
            onChangeStudentClassName={student.setStudentClassName}
            onChangeStudentName={student.setStudentName}
            onLoginAndOpen={() => void student.loginAndOpenStudentWindow()}
            onOpenStudentWindow={() => void api.openSurfaceWindow('student', 'student')}
          />
        )}
      </main>
    </div>
  )
}

export default App
