type StudentLauncherScreenProps = {
  studentName: string
  studentClassName: string
  studentSessionId: number | null
  studentSessionCode: string
  studentRunIdInput: string
  hasActiveRun: boolean
  onChangeStudentName: (value: string) => void
  onChangeStudentClassName: (value: string) => void
  onLoginAndOpen: () => void
  onOpenStudentWindow: () => void
}

export function StudentLauncherScreen({
  studentName,
  studentClassName,
  studentSessionId,
  studentSessionCode,
  studentRunIdInput,
  hasActiveRun,
  onChangeStudentName,
  onChangeStudentClassName,
  onLoginAndOpen,
  onOpenStudentWindow,
}: StudentLauncherScreenProps) {
  return (
    <section className="screen">
      <section className="desktop-hero compact">
        <div>
          <div className="desktop-badge">Student launcher</div>
          <h1>Вход ученика</h1>
          <p>Это лаунчер: здесь ученик создает или продолжает сессию, а само обучение идет в отдельном student window.</p>
        </div>
      </section>

      <div className="content-grid launcher-grid">
        <section className="card">
          <div className="card-title">Профиль ученика</div>
          <label className="field">
            <span>Класс</span>
            <input value={studentClassName} onChange={(event) => onChangeStudentClassName(event.target.value)} />
          </label>
          <label className="field">
            <span>Фамилия и имя</span>
            <input value={studentName} onChange={(event) => onChangeStudentName(event.target.value)} />
          </label>
          <div className="card-actions">
            <button onClick={onLoginAndOpen}>Войти и открыть окно</button>
            <button className="ghost" onClick={onOpenStudentWindow}>
              Открыть student window
            </button>
          </div>
          <div className="info-text">
            {studentSessionId ? `Активная сессия #${studentSessionId} • код ${studentSessionCode}` : 'Сессия еще не создана'}
          </div>
        </section>

        <section className="card">
          <div className="card-title">Продолжение обучения</div>
          <div className="sidebar-stat-list">
            <div className="sidebar-stat">
              <span>Сохраненный run</span>
              <strong>{studentRunIdInput || 'нет'}</strong>
            </div>
            <div className="sidebar-stat">
              <span>Можно продолжить</span>
              <strong>{studentSessionId && hasActiveRun ? 'да' : 'пока нет'}</strong>
            </div>
          </div>
          <div className="info-text">
            Если student window вылетит, прогресс хранится в lesson runtime и при повторном открытии окно должно продолжить ту же сессию.
          </div>
        </section>
      </div>
    </section>
  )
}
