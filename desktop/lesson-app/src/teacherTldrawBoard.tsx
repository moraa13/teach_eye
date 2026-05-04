import { invoke } from '@tauri-apps/api/core'
import {
  Component,
  forwardRef,
  type ErrorInfo,
  type ReactNode,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react'
import { Tldraw, useEditor, type Editor, type TLEditorSnapshot, type TLShape } from 'tldraw'
import 'tldraw/tldraw.css'

import { TeachEyeWidgetShapeUtil } from './teachEyeWidgetShape'
import { buildTeachEyeShapePartialFromWidget, mergeWidgetFromTeachEyeShape, type TeachEyeShapeLike } from './teachEyeShapes/lessonBridge'
import { isTeachEyeManagedShapeType } from './teachEyeShapes/constants'
import { TEACH_EYE_NATIVE_SHAPE_UTILS } from './teachEyeShapes/nativeShapes'
import type { Widget } from './lessonRuntimeModels'

const PERSIST_DEBOUNCE_MS = 380

function widgetIdsFingerprintFromShapes(shapes: Array<{ props: { widgetId: number } }>): string {
  return shapes.map((s) => s.props.widgetId).sort((a, b) => a - b).join(',')
}

function widgetIdsFingerprintFromWidgets(widgets: Widget[]): string {
  return widgets.map((w) => w.id).sort((a, b) => a - b).join(',')
}

/** Strip session for mount — persisted session breaks reload when tldraw session schema drifts (hypothesis H12). */
function mountSnapshotDocumentOnly(o: Record<string, unknown>): TLEditorSnapshot | undefined {
  if (!(o.document && typeof o.document === 'object')) return undefined
  return { document: o.document as TLEditorSnapshot['document'] } as TLEditorSnapshot
}

/** Store only `document` in lesson layout (stable JSON + reload). */
export function snapshotForLessonPersistence(snapshot: TLEditorSnapshot): unknown {
  if (snapshot && typeof snapshot === 'object' && 'document' in snapshot && snapshot.document)
    return { document: snapshot.document }
  return snapshot
}

/** Layout field may store a full editor snapshot ({ document, session }) or only document { store, schema }. */
export function layoutSnapshotToTldraw(raw: unknown): TLEditorSnapshot | undefined {
  if (!raw || typeof raw !== 'object') {
    // #region agent log
    fetch('http://127.0.0.1:7711/ingest/ea4dba9c-75d7-4a3b-928e-7c8b2a9adba1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'ac6ffd' },
      body: JSON.stringify({
        sessionId: 'ac6ffd',
        runId: 'dbg-board',
        hypothesisId: 'H2',
        location: 'teacherTldrawBoard.tsx:layoutSnapshotToTldraw',
        message: 'snapshot parse branch',
        data: { branch: 'undefined', rawType: typeof raw },
        timestamp: Date.now(),
      }),
    }).catch(() => {})
    // #endregion
    return undefined
  }
  const o = raw as Record<string, unknown>
  if ('document' in o && o.document && typeof o.document === 'object') {
    // #region agent log
    fetch('http://127.0.0.1:7711/ingest/ea4dba9c-75d7-4a3b-928e-7c8b2a9adba1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'ac6ffd' },
      body: JSON.stringify({
        sessionId: 'ac6ffd',
        runId: 'dbg-board',
        hypothesisId: 'H2',
        location: 'teacherTldrawBoard.tsx:layoutSnapshotToTldraw',
        message: 'snapshot parse branch',
        data: { branch: 'full-document', topKeys: Object.keys(o) },
        timestamp: Date.now(),
      }),
    }).catch(() => {})
    // #endregion
    return mountSnapshotDocumentOnly(o)!
  }
  if ('store' in o && 'schema' in o) {
    // #region agent log
    fetch('http://127.0.0.1:7711/ingest/ea4dba9c-75d7-4a3b-928e-7c8b2a9adba1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'ac6ffd' },
      body: JSON.stringify({
        sessionId: 'ac6ffd',
        runId: 'dbg-board',
        hypothesisId: 'H2',
        location: 'teacherTldrawBoard.tsx:layoutSnapshotToTldraw',
        message: 'snapshot parse branch',
        data: { branch: 'document-only' },
        timestamp: Date.now(),
      }),
    }).catch(() => {})
    // #endregion
    return { document: raw as TLEditorSnapshot['document'] } as TLEditorSnapshot
  }
  // #region agent log
  fetch('http://127.0.0.1:7711/ingest/ea4dba9c-75d7-4a3b-928e-7c8b2a9adba1', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'ac6ffd' },
    body: JSON.stringify({
      sessionId: 'ac6ffd',
      runId: 'dbg-board',
      hypothesisId: 'H2',
      location: 'teacherTldrawBoard.tsx:layoutSnapshotToTldraw',
      message: 'snapshot parse branch',
      data: { branch: 'no-match', topKeys: Object.keys(o) },
      timestamp: Date.now(),
    }),
  }).catch(() => {})
  // #endregion
  return undefined
}

const TEACH_EYE_BOARD_SHAPE_UTILS = [...TEACH_EYE_NATIVE_SHAPE_UTILS, TeachEyeWidgetShapeUtil]

function isTeachEyeManagedBoardShape(shape: TLShape): boolean {
  return isTeachEyeManagedShapeType(shape.type)
}

function getSelectedTeachEyeWidgetId(editor: Editor): number | null {
  for (const id of editor.getSelectedShapeIds()) {
    const shape = editor.getShape(id)
    if (shape && isTeachEyeManagedBoardShape(shape)) {
      return (shape as unknown as { props: { widgetId: number } }).props.widgetId
    }
  }
  return null
}

class TldrawBoardErrorBoundary extends Component<{ children: ReactNode }, { err: Error | null }> {
  override state = { err: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { err: error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('TldrawBoardErrorBoundary', error, info)
    // #region agent log
    fetch('http://127.0.0.1:7711/ingest/ea4dba9c-75d7-4a3b-928e-7c8b2a9adba1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'ac6ffd' },
      body: JSON.stringify({
        sessionId: 'ac6ffd',
        runId: 'session-strip-fix',
        hypothesisId: 'H12',
        location: 'teacherTldrawBoard.tsx:TldrawBoardErrorBoundary',
        message: error.message,
        data: {
          stack: error.stack ?? null,
          componentStack: info.componentStack,
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {})
    // #endregion
  }

  override render() {
    if (this.state.err) {
      return (
        <div className="teacher-tldraw-root" style={{ padding: 16, color: '#fecaca', overflow: 'auto' }}>
          <strong style={{ display: 'block', marginBottom: 8 }}>Ошибка доски (tldraw)</strong>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, margin: 0 }}>{this.state.err.stack || this.state.err.message}</pre>
        </div>
      )
    }
    return this.props.children
  }
}

/** Снимок доски; `widgets` только при смене набора виджетов или принудительной синхронизации (сохранение). */
export type TeacherTldrawPersistPayload = {
  snapshot: TLEditorSnapshot
  widgets?: Widget[]
}

export type TeacherTldrawBoardHandle = {
  /** Сбросить дебаунс и отправить в родителя (опционально с полной геометрией виджетов из шейпов). */
  flushPersist: (opts?: { syncWidgetsFromShapes?: boolean }) => void
}

export type TeacherTldrawBoardProps = {
  /** Remount when the teacher switches scenes (include `sceneNavGen` so revisiting a scene reloads layout). */
  sceneMountKey: string
  /** Applied only on mount; parent must keep stable while editing the same scene. */
  initialSnapshot: TLEditorSnapshot | undefined
  widgets: Widget[]
  onPersist: (payload: TeacherTldrawPersistPayload) => void
  onWidgetSelect?: (widgetId: number | null) => void
  onEditorReady?: (editor: Editor) => void
}

export const TeacherTldrawBoard = forwardRef<TeacherTldrawBoardHandle, TeacherTldrawBoardProps>(function TeacherTldrawBoard(
  { sceneMountKey, initialSnapshot, widgets, onPersist, onWidgetSelect, onEditorReady },
  ref,
) {
  const editorRef = useRef<Editor | null>(null)
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const widgetsRef = useRef(widgets)
  widgetsRef.current = widgets

  useEffect(() => {
    const line = `${JSON.stringify({
      sessionId: 'ffe9af',
      runId: 'tldraw-mount',
      hypothesisId: 'H2',
      location: 'teacherTldrawBoard.tsx:TeacherTldrawBoard',
      message: 'TeacherTldrawBoard mounted',
      data: {
        sceneMountKey,
        widgetCount: widgets.length,
        hasInitialSnapshot: Boolean(initialSnapshot),
      },
      timestamp: Date.now(),
    })}\n`
    invoke('append_debug_log', { line }).catch(() => {})
  }, [sceneMountKey, widgets.length, initialSnapshot])

  const runFlushPersist = useCallback(
    (opts?: { syncWidgetsFromShapes?: boolean }) => {
    try {
      const editor = editorRef.current
      if (!editor) return

      const shapes = editor.getCurrentPageShapes().filter(isTeachEyeManagedBoardShape)
      const shapeByWidgetId = new Map(
        shapes.map((s) => [(s as unknown as { props: { widgetId: number } }).props.widgetId, s]),
      )
      const baseWidgets = widgetsRef.current
      const nextWidgets = baseWidgets.map((widget, orderIndex) => {
        const shape = shapeByWidgetId.get(widget.id)
        if (!shape) return widget
        return mergeWidgetFromTeachEyeShape(widget, shape as unknown as TeachEyeShapeLike, orderIndex)
      })

      const structureChanged =
        widgetIdsFingerprintFromShapes(shapes as unknown as Array<{ props: { widgetId: number } }>) !==
        widgetIdsFingerprintFromWidgets(baseWidgets)
      const includeWidgets = opts?.syncWidgetsFromShapes === true || structureChanged

      let snapshot: TLEditorSnapshot
      try {
        snapshot = editor.getSnapshot()
      } catch (e) {
        // #region agent log
        fetch('http://127.0.0.1:7711/ingest/ea4dba9c-75d7-4a3b-928e-7c8b2a9adba1', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'ac6ffd' },
          body: JSON.stringify({
            sessionId: 'ac6ffd',
            runId: 'post-fix',
            hypothesisId: 'H1',
            location: 'teacherTldrawBoard.tsx:flushPersist',
            message: 'getSnapshot failed; document-only fallback',
            data: { err: e instanceof Error ? e.message : String(e) },
            timestamp: Date.now(),
          }),
        }).catch(() => {})
        // #endregion
        try {
          snapshot = { document: editor.store.getStoreSnapshot() } as TLEditorSnapshot
        } catch (e2) {
          // #region agent log
          fetch('http://127.0.0.1:7711/ingest/ea4dba9c-75d7-4a3b-928e-7c8b2a9adba1', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'ac6ffd' },
            body: JSON.stringify({
              sessionId: 'ac6ffd',
              runId: 'post-fix',
              hypothesisId: 'H1',
              location: 'teacherTldrawBoard.tsx:flushPersist',
              message: 'getStoreSnapshot fallback also failed; skip persist',
              data: { err: e2 instanceof Error ? e2.message : String(e2) },
              timestamp: Date.now(),
            }),
          }).catch(() => {})
          // #endregion
          return
        }
      }

      const snapshotToSave = snapshotForLessonPersistence(snapshot) as TLEditorSnapshot
      try {
        onPersist(
          includeWidgets ? { snapshot: snapshotToSave, widgets: nextWidgets } : { snapshot: snapshotToSave },
        )
      } catch (e) {
        // #region agent log
        fetch('http://127.0.0.1:7711/ingest/ea4dba9c-75d7-4a3b-928e-7c8b2a9adba1', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'ac6ffd' },
          body: JSON.stringify({
            sessionId: 'ac6ffd',
            runId: 'post-fix',
            hypothesisId: 'H1',
            location: 'teacherTldrawBoard.tsx:flushPersist',
            message: 'onPersist threw',
            data: { err: e instanceof Error ? e.message : String(e) },
            timestamp: Date.now(),
          }),
        }).catch(() => {})
        // #endregion
      }
    } catch (e) {
      // #region agent log
      fetch('http://127.0.0.1:7711/ingest/ea4dba9c-75d7-4a3b-928e-7c8b2a9adba1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'ac6ffd' },
        body: JSON.stringify({
          sessionId: 'ac6ffd',
          runId: 'session-strip-fix',
          hypothesisId: 'H11',
          location: 'teacherTldrawBoard.tsx:flushPersist',
          message: 'flushPersist outer',
          data: { err: e instanceof Error ? e.message : String(e) },
          timestamp: Date.now(),
        }),
      }).catch(() => {})
      // #endregion
    }
  },
  [onPersist],
)

  useImperativeHandle(
    ref,
    () => ({
      flushPersist: (opts) => {
        if (persistTimerRef.current) {
          clearTimeout(persistTimerRef.current)
          persistTimerRef.current = null
        }
        runFlushPersist(opts)
      },
    }),
    [runFlushPersist],
  )

  const schedulePersist = useCallback(() => {
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current)
    persistTimerRef.current = setTimeout(() => {
      persistTimerRef.current = null
      runFlushPersist()
    }, PERSIST_DEBOUNCE_MS)
  }, [runFlushPersist])

  const handleMount = useCallback(
    (editor: Editor) => {
      // #region agent log
      fetch('http://127.0.0.1:7711/ingest/ea4dba9c-75d7-4a3b-928e-7c8b2a9adba1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'ac6ffd' },
        body: JSON.stringify({
          sessionId: 'ac6ffd',
          runId: 'dbg-board',
          hypothesisId: 'H1',
          location: 'teacherTldrawBoard.tsx:handleMount',
          message: 'tldraw onMount enter',
          data: {
            hasInitialSnapshot: Boolean(initialSnapshot),
            widgetCount: widgetsRef.current.length,
          },
          timestamp: Date.now(),
        }),
      }).catch(() => {})
      // #endregion
      editorRef.current = editor
      onEditorReady?.(editor)

      const removeListener = editor.store.listen(
        () => {
          schedulePersist()
        },
        { source: 'user', scope: 'document' },
      )

      try {
        bootstrapWidgetsIfNeeded(editor, widgetsRef.current, initialSnapshot)
      } catch (e) {
        // #region agent log
        fetch('http://127.0.0.1:7711/ingest/ea4dba9c-75d7-4a3b-928e-7c8b2a9adba1', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'ac6ffd' },
          body: JSON.stringify({
            sessionId: 'ac6ffd',
            runId: 'dbg-board',
            hypothesisId: 'H5',
            location: 'teacherTldrawBoard.bootstrapWidgetsIfNeeded',
            message: 'bootstrap error',
            data: { err: e instanceof Error ? e.message : String(e) },
            timestamp: Date.now(),
          }),
        }).catch(() => {})
        // #endregion
      }

      return () => {
        removeListener()
        if (persistTimerRef.current) {
          clearTimeout(persistTimerRef.current)
          persistTimerRef.current = null
        }
        try {
          runFlushPersist({ syncWidgetsFromShapes: true })
        } catch {
          /* logged inside */
        }
        editorRef.current = null
      }
    },
    [initialSnapshot, onEditorReady, runFlushPersist, schedulePersist],
  )

  useEffect(() => {
    return () => {
      editorRef.current = null
    }
  }, [])

  return (
    <div className="teacher-tldraw-root">
      <TldrawBoardErrorBoundary>
        <Tldraw
          key={sceneMountKey}
          shapeUtils={[...TEACH_EYE_BOARD_SHAPE_UTILS]}
          snapshot={initialSnapshot}
          onMount={handleMount}
        >
          <TeachEyeWidgetSync widgets={widgets} />
          {onWidgetSelect ? <TeachEyeSelectionBridge onWidgetSelect={onWidgetSelect} /> : null}
        </Tldraw>
      </TldrawBoardErrorBoundary>
    </div>
  )
})

TeacherTldrawBoard.displayName = 'TeacherTldrawBoard'

function bootstrapWidgetsIfNeeded(
  editor: Editor,
  widgets: Widget[],
  initialSnapshot: TLEditorSnapshot | undefined,
): boolean {
  if (initialSnapshot) return false
  if (!widgets.length) return false
  const existing = editor.getCurrentPageShapes().filter((s) => isTeachEyeManagedShapeType((s as { type: string }).type))
  if (existing.length > 0) return false

  const partials = []
  for (let index = 0; index < widgets.length; index++) {
    partials.push(buildTeachEyeShapePartialFromWidget(widgets[index], index))
  }
  editor.createShapes(partials as never[])
  return true
}

function TeachEyeWidgetSync({ widgets }: { widgets: Widget[] }) {
  const editor = useEditor()
  const widgetsRef = useRef(widgets)
  widgetsRef.current = widgets
  const widgetsKey = widgets.map((w) => w.id).join(',')

  useEffect(() => {
    const list = widgetsRef.current
    // #region agent log
    fetch('http://127.0.0.1:7711/ingest/ea4dba9c-75d7-4a3b-928e-7c8b2a9adba1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'ac6ffd' },
      body: JSON.stringify({
        sessionId: 'ac6ffd',
        runId: 'freeze-fix',
        hypothesisId: 'H17',
        location: 'teacherTldrawBoard.tsx:TeachEyeWidgetSync',
        message: 'widget sync effect (deps: widgetsKey only)',
        data: { widgetsKey, len: list.length },
        timestamp: Date.now(),
      }),
    }).catch(() => {})
    // #endregion
    try {
      editor.run(() => {
        const existingIds = new Set(
          editor
            .getCurrentPageShapes()
            .filter((s) => isTeachEyeManagedShapeType((s as { type: string }).type))
            .map((s) => (s as unknown as { props: { widgetId: number } }).props.widgetId),
        )
        for (let index = 0; index < list.length; index++) {
          const w = list[index]
          if (existingIds.has(w.id)) continue
          const partial = buildTeachEyeShapePartialFromWidget(w, index)
          editor.createShape({
            type: partial.type,
            x: partial.x,
            y: partial.y,
            props: partial.props,
          } as never)
        }
      })
    } catch (e) {
      // #region agent log
      fetch('http://127.0.0.1:7711/ingest/ea4dba9c-75d7-4a3b-928e-7c8b2a9adba1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'ac6ffd' },
        body: JSON.stringify({
          sessionId: 'ac6ffd',
          runId: 'dbg-board',
          hypothesisId: 'H5',
          location: 'teacherTldrawBoard.tsx:TeachEyeWidgetSync',
          message: 'widget sync error',
          data: { err: e instanceof Error ? e.message : String(e) },
          timestamp: Date.now(),
        }),
      }).catch(() => {})
      // #endregion
    }
  }, [editor, widgetsKey])

  return null
}

function TeachEyeSelectionBridge({ onWidgetSelect }: { onWidgetSelect: (widgetId: number | null) => void }) {
  const editor = useEditor()
  const lastEmittedRef = useRef<number | null | undefined>(undefined)
  const onWidgetSelectRef = useRef(onWidgetSelect)
  onWidgetSelectRef.current = onWidgetSelect

  useEffect(() => {
    return editor.store.listen(
      () => {
        try {
          const id = getSelectedTeachEyeWidgetId(editor)
          if (lastEmittedRef.current === id) return
          lastEmittedRef.current = id
          onWidgetSelectRef.current(id)
        } catch (e) {
          // #region agent log
          fetch('http://127.0.0.1:7711/ingest/ea4dba9c-75d7-4a3b-928e-7c8b2a9adba1', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'ac6ffd' },
            body: JSON.stringify({
              sessionId: 'ac6ffd',
              runId: 'freeze-fix',
              hypothesisId: 'H4',
              location: 'teacherTldrawBoard.tsx:TeachEyeSelectionBridge',
              message: 'selection listener error',
              data: { err: e instanceof Error ? e.message : String(e) },
              timestamp: Date.now(),
            }),
          }).catch(() => {})
          // #endregion
        }
      },
      { scope: 'session', source: 'user' },
    )
  }, [editor])

  return null
}
