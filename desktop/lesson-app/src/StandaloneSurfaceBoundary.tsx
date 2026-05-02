import { Component, type ReactNode } from 'react'

type Props = {
  title: string
  details?: ReactNode
  children: ReactNode
}

type State = {
  error: Error | null
}

export class StandaloneSurfaceBoundary extends Component<Props, State> {
  override state: State = {
    error: null,
  }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  override componentDidCatch(error: Error) {
    console.error('Standalone surface crashed:', error)
    // #region agent log
    fetch('http://127.0.0.1:7711/ingest/ea4dba9c-75d7-4a3b-928e-7c8b2a9adba1',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d405cf'},body:JSON.stringify({sessionId:'d405cf',runId:'pre-fix',hypothesisId:'H4',location:'StandaloneSurfaceBoundary.tsx:26',message:'surface_boundary_caught_error',data:{title:this.props.title,errorName:error.name,errorMessage:error.message,stack:error.stack??null},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
  }

  override render() {
    if (!this.state.error) {
      return this.props.children
    }

    return (
      <section className="screen">
        <section className="card board-crash-card">
          <div className="desktop-badge">Surface error</div>
          <div className="card-title">{this.props.title}</div>
          <div className="info-text">
            Окно не смогло корректно отрисоваться. Ошибка больше не скрыта белым экраном и теперь видна прямо в surface.
          </div>
          {this.props.details ? <div className="scene-board-text">{this.props.details}</div> : null}
          <pre className="board-crash-pre">{this.state.error.stack || this.state.error.message}</pre>
        </section>
      </section>
    )
  }
}
