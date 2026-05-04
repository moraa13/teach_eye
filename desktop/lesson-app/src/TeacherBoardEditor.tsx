/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import type { Editor, TLEditorSnapshot } from 'tldraw'
import type { Scene, Widget } from './lessonRuntimeModels'
import { layoutSnapshotToTldraw, snapshotForLessonPersistence, TeacherTldrawBoard } from './teacherTldrawBoard'
import { TEACH_EYE_WIDGET_SHAPE_TYPE } from './teachEyeWidgetShape'
import {
  buildSceneLayout,
  defaultWidgetLayout,
  nextLayer,
  normalizeSceneLayout,
  normalizeWidgetLayout,
  type BoardElement,
  type SceneBoardLayout,
  type WidgetLayout,
} from './sceneLayout'

const DEBUG_BOARD_AGENT_LOGS = false

const SCENE_DETAILS_STORAGE_KEY = 'teachereye.editor.scenePanelExpanded'

function readSceneDetailsOpen(): boolean {
  try {
    return localStorage.getItem(SCENE_DETAILS_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

type EditableLesson = {
  id: number
  title: string
  topic: string
  grade_band?: string
  level?: string
  author_name?: string
  summary?: string
  tags?: string[]
  status?: string
  is_template?: boolean
  scenes: Scene[]
}

type Selection = { kind: 'widget'; id: number } | { kind: 'element'; id: string } | null

const WIDGET_LIBRARY: Array<{ type: string; label: string; config: Record<string, any> }> = [
  {
    type: 'multiple_choice',
    label: 'Варианты ответа',
    config: {
      question: 'Новый вопрос',
      options: ['Вариант 1', 'Вариант 2', 'Вариант 3'],
      correct_index: 0,
    },
  },
  {
    type: 'powers_of_two_picker',
    label: 'Степени двойки',
    config: {
      context_title: 'Контекст задачи',
      task_text: 'Собери число из степеней двойки.',
      target_value: 42,
      values: [128, 64, 32, 16, 8, 4, 2, 1],
    },
  },
  {
    type: 'match_pairs',
    label: 'Сопоставь пары',
    config: {
      pairs: [
        { left: 'IP', right: 'Адрес устройства' },
        { left: 'MAC', right: 'Физический адрес' },
      ],
    },
  },
  {
    type: 'algorithm_steps',
    label: 'Порядок шагов',
    config: {
      steps: ['Шаг 1', 'Шаг 2', 'Шаг 3'],
    },
  },
  {
    type: 'code_puzzle',
    label: 'Код-пазл',
    config: {
      lines: ['print("Hello")', 'x = 2', 'print(x)'],
    },
  },
]

function safeParseJson(value: string) {
  try {
    return { ok: true as const, value: JSON.parse(value) }
  } catch (error) {
    return { ok: false as const, error: (error as Error).message }
  }
}

function updateElementGeometry(element: BoardElement, patch: Partial<BoardElement>): BoardElement {
  return { ...element, ...patch } as BoardElement
}

export function TeacherBoardEditor({
  lesson,
  sceneIndex,
  onSceneIndexChange,
  onLessonChange,
  onSave,
  saving,
  dirty,
}: {
  lesson: EditableLesson | null
  sceneIndex: number
  onSceneIndexChange: (sceneIndex: number) => void
  onLessonChange: (lesson: EditableLesson) => void
  onSave: () => void
  saving: boolean
  dirty: boolean
}) {
  const [selected, setSelected] = useState<Selection>(null)
  const [sceneDetailsOpen, setSceneDetailsOpen] = useState(readSceneDetailsOpen)
  const [widgetType, setWidgetType] = useState(WIDGET_LIBRARY[0].type)
  const [widgetConfigDraft, setWidgetConfigDraft] = useState('{}')
  const [widgetConfigError, setWidgetConfigError] = useState<string | null>(null)
  const scene = lesson?.scenes[sceneIndex] ?? null
  const sceneLayout = useMemo(() => normalizeSceneLayout(scene?.layout), [scene?.layout])
  const prevSceneIndexForTldrawRef = useRef(sceneIndex)
  const tldrawSceneNavGenRef = useRef(0)
  const tldrawEditorRef = useRef<Editor | null>(null)
  const tldrawMountCacheRef = useRef<{ key: string; snap: ReturnType<typeof layoutSnapshotToTldraw> }>({
    key: '',
    snap: undefined,
  })
  if (prevSceneIndexForTldrawRef.current !== sceneIndex) {
    tldrawSceneNavGenRef.current += 1
    prevSceneIndexForTldrawRef.current = sceneIndex
  }
  const tldrawSceneMountKey =
    lesson && scene ? `${lesson.id}-${scene.id}-${sceneIndex}-g${tldrawSceneNavGenRef.current}` : 'none'
  if (tldrawMountCacheRef.current.key !== tldrawSceneMountKey) {
    tldrawMountCacheRef.current = {
      key: tldrawSceneMountKey,
      snap: layoutSnapshotToTldraw(sceneLayout.tldraw_snapshot),
    }
  }
  const tldrawInitialSnapshot = lesson && scene ? tldrawMountCacheRef.current.snap : undefined
  const lessonRef = useRef(lesson)
  const sceneRef = useRef(scene)
  const sceneLayoutRef = useRef(sceneLayout)
  const selectedWidget = useMemo(
    () => (selected?.kind === 'widget' ? scene?.widgets.find((widget) => widget.id === selected.id) ?? null : null),
    [scene?.widgets, selected],
  )
  const selectedElement = useMemo(
    () => (selected?.kind === 'element' ? sceneLayout.board_elements.find((element) => element.id === selected.id) ?? null : null),
    [sceneLayout.board_elements, selected],
  )

  useEffect(() => {
    lessonRef.current = lesson
    sceneRef.current = scene
    sceneLayoutRef.current = sceneLayout
  }, [lesson, scene, sceneLayout])

  useEffect(() => {
    if (!DEBUG_BOARD_AGENT_LOGS) return
    // #region agent log
    const line = JSON.stringify({
      sessionId: 'ffe9af',
      runId: 'pre-fix',
      hypothesisId: 'H3',
      location: 'TeacherBoardEditor.tsx:197',
      message: 'TeacherBoardEditor:mount',
      data: {
        lessonId: lesson?.id ?? null,
        sceneIndex,
        sceneId: scene?.id ?? null,
        widgetCount: scene?.widgets.length ?? 0,
        boardElementCount: sceneLayout.board_elements.length,
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
  }, [lesson?.id, scene?.id, scene?.widgets.length, sceneIndex, sceneLayout.board_elements.length])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!selectedWidget) {
        setWidgetConfigDraft('{}')
        setWidgetConfigError(null)
        return
      }
      setWidgetConfigDraft(JSON.stringify(selectedWidget.config ?? {}, null, 2))
      setWidgetConfigError(null)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [selectedWidget])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSelected(null)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [sceneIndex, lesson?.id])

  const patchLessonScenes = useCallback((mutator: (scenes: Scene[]) => Scene[]) => {
    if (!lesson) return
    onLessonChange({
      ...lesson,
      scenes: mutator(lesson.scenes),
    })
  }, [lesson, onLessonChange])

  const patchCurrentScene = useCallback((mutator: (scene: Scene, layout: SceneBoardLayout) => Scene) => {
    if (!lesson || !scene) return
    patchLessonScenes((scenes) =>
      scenes.map((item, index) => {
        if (index !== sceneIndex) return item
        const currentLayout = normalizeSceneLayout(item.layout)
        return mutator(item, currentLayout)
      }),
    )
  }, [lesson, patchLessonScenes, scene, sceneIndex])

  const handleTldrawWidgetSelect = useCallback((widgetId: number | null) => {
    setSelected(widgetId ? { kind: 'widget', id: widgetId } : null)
  }, [])

  const handleTldrawPersist = useCallback(
    (payload: { snapshot: TLEditorSnapshot; widgets: Widget[] }) => {
      patchCurrentScene((currentScene, layout) => ({
        ...currentScene,
        widgets: payload.widgets,
        layout: buildSceneLayout({
          ...layout,
          tldraw_snapshot: snapshotForLessonPersistence(payload.snapshot),
        }),
      }))
    },
    [patchCurrentScene],
  )

  const mirrorWidgetIntoTldraw = useCallback((widget: Widget, orderIndex: number) => {
    const editor = tldrawEditorRef.current
    if (!editor) return
    const layout = normalizeWidgetLayout(widget.layout, orderIndex)
    const targets = editor.getCurrentPageShapes().filter((s) => {
      const sh = s as unknown as { type: string; props: { widgetId: number } }
      return sh.type === TEACH_EYE_WIDGET_SHAPE_TYPE && sh.props.widgetId === widget.id
    })
    for (const shape of targets) {
      editor.updateShapes([
        {
          id: shape.id,
          type: TEACH_EYE_WIDGET_SHAPE_TYPE as never,
          x: layout.x,
          y: layout.y,
          props: {
            ...(shape as unknown as { props: Record<string, unknown> }).props,
            w: layout.w,
            h: layout.h,
            title: widget.title,
            widgetType: widget.widget_type,
            configJson: JSON.stringify(widget.config ?? {}),
          },
        } as never,
      ])
    }
  }, [])

  const patchBoardElements = useCallback((mutator: (elements: BoardElement[], layout: SceneBoardLayout) => BoardElement[]) => {
    patchCurrentScene((currentScene, currentLayout) => ({
      ...currentScene,
      layout: buildSceneLayout({
        ...currentLayout,
        board_elements: mutator(currentLayout.board_elements, currentLayout),
      }),
    }))
  }, [patchCurrentScene])

  const patchWidget = useCallback((
    widgetId: number,
    mutator: (widget: Widget, layout: WidgetLayout, orderIndex: number) => Widget,
  ) => {
    patchCurrentScene((currentScene) => ({
      ...currentScene,
      widgets: currentScene.widgets.map((widget, index) => {
        if (widget.id !== widgetId) return widget
        const layout = normalizeWidgetLayout(widget.layout, index)
        return mutator(widget, layout, index)
      }),
    }))
  }, [patchCurrentScene])

  function addScene() {
    if (!lesson) return
    const nextIndex = lesson.scenes.length
    patchLessonScenes((scenes) => [
      ...scenes,
      {
        id: Date.now(),
        title: `Сцена ${nextIndex + 1}`,
        scene_type: 'board',
        order_index: nextIndex,
        notes_text: '',
        layout: buildSceneLayout(normalizeSceneLayout({})),
        widgets: [],
      },
    ])
    onSceneIndexChange(nextIndex)
  }

  function removeSelected() {
    if (!scene || !selected) return
    if (selected.kind === 'element') {
      patchBoardElements((elements) => elements.filter((element) => element.id !== selected.id))
      setSelected(null)
      return
    }
    const editor = tldrawEditorRef.current
    if (editor) {
      const shapeIds = editor
        .getCurrentPageShapes()
        .filter((s) => {
          const sh = s as unknown as { type: string; props: { widgetId: number } }
          return sh.type === TEACH_EYE_WIDGET_SHAPE_TYPE && sh.props.widgetId === selected.id
        })
        .map((s) => s.id)
      if (shapeIds.length) editor.deleteShapes(shapeIds)
    }
    patchCurrentScene((currentScene) => ({
      ...currentScene,
      widgets: currentScene.widgets.filter((widget) => widget.id !== selected.id).map((widget, index) => ({
        ...widget,
        order_index: index,
      })),
    }))
    setSelected(null)
  }

  function bringSelectionToFront() {
    if (!selected) return
    if (selected.kind === 'element') {
      patchBoardElements((elements) => {
        const top = nextLayer(elements)
        return elements.map((element) => (element.id === selected.id ? { ...element, z: top } : element))
      })
      return
    }
    patchCurrentScene((currentScene) => {
      const top = nextLayer(currentScene.widgets.map((widget, index) => normalizeWidgetLayout(widget.layout, index)))
      return {
        ...currentScene,
        widgets: currentScene.widgets.map((widget, index) =>
          widget.id === selected.id
            ? { ...widget, layout: { ...normalizeWidgetLayout(widget.layout, index), z: top } }
            : widget,
        ),
      }
    })
    const editor = tldrawEditorRef.current
    if (editor) {
      const shapes = editor.getCurrentPageShapes().filter((s) => {
        const sh = s as unknown as { type: string; props: { widgetId: number } }
        return sh.type === TEACH_EYE_WIDGET_SHAPE_TYPE && sh.props.widgetId === selected.id
      })
      if (shapes.length) editor.bringToFront(shapes.map((s) => s.id))
    }
  }

  function addWidget() {
    if (!scene) return
    const template = WIDGET_LIBRARY.find((entry) => entry.type === widgetType) ?? WIDGET_LIBRARY[0]
    const orderIndex = scene.widgets.length
    const widgetId = Date.now()
    patchCurrentScene((currentScene) => ({
      ...currentScene,
      widgets: [
        ...currentScene.widgets,
        {
          id: widgetId,
          title: template.label,
          widget_type: template.type,
          order_index: orderIndex,
          layout: defaultWidgetLayout(orderIndex),
          config: JSON.parse(JSON.stringify(template.config)),
        },
      ],
    }))
    setSelected({ kind: 'widget', id: widgetId })
  }

  function updateSelectedWidgetField(patch: Partial<Widget>) {
    if (!selectedWidget || !scene) return
    const idx = scene.widgets.indexOf(selectedWidget)
    patchWidget(selectedWidget.id, (widget) => ({ ...widget, ...patch }))
    mirrorWidgetIntoTldraw({ ...selectedWidget, ...patch }, idx)
  }

  function updateSelectedWidgetLayout(patch: Partial<WidgetLayout>) {
    if (!selectedWidget || !scene) return
    const idx = scene.widgets.indexOf(selectedWidget)
    const layout = { ...normalizeWidgetLayout(selectedWidget.layout, idx), ...patch }
    patchWidget(selectedWidget.id, (widget, prevLayout) => ({
      ...widget,
      layout: { ...prevLayout, ...patch },
    }))
    mirrorWidgetIntoTldraw({ ...selectedWidget, layout }, idx)
  }

  function updateSelectedElement(patch: Partial<BoardElement>) {
    if (!selectedElement) return
    patchBoardElements((elements) =>
      elements.map((element) => (element.id === selectedElement.id ? updateElementGeometry(element, patch) : element)),
    )
  }

  function applyWidgetConfigDraft() {
    if (!selectedWidget || !scene) return
    const parsed = safeParseJson(widgetConfigDraft)
    if (!parsed.ok || typeof parsed.value !== 'object' || parsed.value === null || Array.isArray(parsed.value)) {
      setWidgetConfigError(parsed.ok ? 'Нужен JSON-объект' : parsed.error)
      return
    }
    const idx = scene.widgets.indexOf(selectedWidget)
    patchWidget(selectedWidget.id, (widget) => ({ ...widget, config: parsed.value as Record<string, any> }))
    mirrorWidgetIntoTldraw({ ...selectedWidget, config: parsed.value as Record<string, any> }, idx)
    setWidgetConfigError(null)
  }

  const selectionSummary = selectedWidget
    ? `Виджет • ${selectedWidget.title || selectedWidget.widget_type}`
    : selectedElement
      ? `Элемент • ${
          selectedElement.type === 'text'
            ? 'Текст'
            : selectedElement.type === 'rectangle'
              ? 'Прямоугольник'
              : selectedElement.type === 'arrow'
                ? 'Стрелка'
                : selectedElement.type === 'highlighter'
                  ? 'Маркер'
                  : 'Линия'
        }`
      : 'Ничего не выбрано'

  if (!lesson || !scene) {
    return <div className="empty-state">Выбери урок из библиотеки, чтобы открыть editor canvas.</div>
  }
  // #region agent log
  fetch('http://127.0.0.1:7711/ingest/ea4dba9c-75d7-4a3b-928e-7c8b2a9adba1', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'ac6ffd' },
    body: JSON.stringify({
      sessionId: 'ac6ffd',
      runId: 'dbg-board',
      hypothesisId: 'H3',
      location: 'TeacherBoardEditor.tsx:render-board',
      message: 'editor render with tldraw',
      data: {
        sceneMountKey: tldrawSceneMountKey,
        hasSnapshot: Boolean(tldrawInitialSnapshot),
        widgetCount: scene.widgets.length,
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {})
  // #endregion
  return (
    <div className="teacher-editor-shell teacher-editor-shell-overlay">
      <div className="teacher-editor-canvas-card teacher-editor-canvas-card-full teacher-editor-canvas-card-overlay">
        <div className="teacher-editor-board-stage teacher-editor-hud-root">
          <TeacherTldrawBoard
            sceneMountKey={tldrawSceneMountKey}
            initialSnapshot={tldrawInitialSnapshot}
            widgets={scene.widgets}
            onPersist={handleTldrawPersist}
            onWidgetSelect={handleTldrawWidgetSelect}
            onEditorReady={(ed) => {
              tldrawEditorRef.current = ed
            }}
          />

          <div className="teacher-editor-floating-stack teacher-editor-floating-top-left">
            <div className="teacher-editor-menu-panel teacher-editor-floating-panel teacher-editor-hud-panel">
              <div className="teacher-editor-panel-label">Навигация</div>
              <div className="teacher-editor-hud-nav-block">
                <h2 className="teacher-editor-hud-title-ellipsis" title={scene.title || `Сцена ${sceneIndex + 1}`}>
                  {scene.title || `Сцена ${sceneIndex + 1}`}
                </h2>
                <div
                  className="teacher-editor-hud-stats-line"
                  title={`${lesson.scenes.length} сцен, ${scene.widgets.length} виджетов`}
                >
                  {lesson.scenes.length} сц · {scene.widgets.length} видж · {sceneLayout.viewport.width}×{sceneLayout.viewport.height}
                  {sceneLayout.board_elements.length > 0 ? ` · leg.${sceneLayout.board_elements.length}` : null}
                </div>
                <div className="teacher-editor-hud-meta-line" title={selectionSummary}>
                  {selectionSummary}
                </div>
              </div>
              <div className="teacher-editor-scene-strip-compact teacher-editor-scene-strip-scroll">
                {lesson.scenes.map((item, index) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`teacher-editor-scene-chip ${index === sceneIndex ? 'current' : ''}`}
                    onClick={() => onSceneIndexChange(index)}
                    title={`${index + 1}. ${item.title}`}
                  >
                    {index + 1}. {item.title}
                  </button>
                ))}
                <button type="button" className="ghost teacher-editor-scene-strip-add" onClick={addScene} aria-label="Добавить новую сцену">
                  +
                </button>
              </div>
              <div className="teacher-editor-floating-actions">
                <button
                  type="button"
                  onClick={onSave}
                  disabled={saving}
                  aria-label={
                    saving
                      ? 'Сохранение урока, подождите'
                      : dirty
                        ? 'Сохранить изменения урока на сервер'
                        : 'Нет несохранённых изменений'
                  }
                >
                  {saving ? 'Сохраняю...' : dirty ? 'Сохранить урок' : 'Сохранено'}
                </button>
              </div>
            </div>

            <div className="teacher-editor-menu-panel teacher-editor-floating-panel teacher-editor-hud-panel">
              <div className="teacher-editor-panel-label">Сцена</div>
              <label className="field teacher-editor-hud-field-tight">
                <span>Название</span>
                <input
                  value={scene.title}
                  onChange={(event) =>
                    patchCurrentScene((currentScene) => ({
                      ...currentScene,
                      title: event.target.value,
                    }))
                  }
                />
              </label>
              <details
                className="teacher-editor-hud-details"
                open={sceneDetailsOpen}
                onToggle={(event) => {
                  const open = event.currentTarget.open
                  setSceneDetailsOpen(open)
                  try {
                    localStorage.setItem(SCENE_DETAILS_STORAGE_KEY, open ? '1' : '0')
                  } catch {
                    /* ignore */
                  }
                }}
              >
                <summary className="teacher-editor-hud-details-summary">Заметки, размер холста и сетка</summary>
                <div className="teacher-editor-inline-form teacher-editor-inline-form-floating teacher-editor-inline-form-hud">
                  <label className="field teacher-editor-field-wide teacher-editor-hud-field-tight">
                    <span>Заметки</span>
                    <textarea
                      value={scene.notes_text || ''}
                      rows={3}
                      onChange={(event) =>
                        patchCurrentScene((currentScene) => ({
                          ...currentScene,
                          notes_text: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <div className="teacher-editor-hud-viewport-row">
                    <label className="field teacher-editor-hud-field-tight">
                      <span>Viewport W</span>
                      <input
                        type="number"
                        value={sceneLayout.viewport.width}
                        onChange={(event) =>
                          patchCurrentScene((currentScene, layout) => ({
                            ...currentScene,
                            layout: buildSceneLayout({
                              ...layout,
                              viewport: { ...layout.viewport, width: Number(event.target.value) || layout.viewport.width },
                            }),
                          }))
                        }
                      />
                    </label>
                    <label className="field teacher-editor-hud-field-tight">
                      <span>Viewport H</span>
                      <input
                        type="number"
                        value={sceneLayout.viewport.height}
                        onChange={(event) =>
                          patchCurrentScene((currentScene, layout) => ({
                            ...currentScene,
                            layout: buildSceneLayout({
                              ...layout,
                              viewport: { ...layout.viewport, height: Number(event.target.value) || layout.viewport.height },
                            }),
                          }))
                        }
                      />
                    </label>
                  </div>
                  <label className="field checkbox-field teacher-editor-field-checkbox teacher-editor-hud-field-tight teacher-editor-hud-checkbox">
                    <input
                      type="checkbox"
                      checked={sceneLayout.viewport.showGrid}
                      onChange={(event) =>
                        patchCurrentScene((currentScene, layout) => ({
                          ...currentScene,
                          layout: buildSceneLayout({
                            ...layout,
                            viewport: { ...layout.viewport, showGrid: event.target.checked },
                          }),
                        }))
                      }
                    />
                    <span>Сетка</span>
                  </label>
                </div>
              </details>
            </div>
          </div>

          <div className="teacher-editor-floating-stack teacher-editor-floating-top-right">
            <div className="teacher-editor-menu-panel teacher-editor-floating-panel teacher-editor-hud-panel">
              <div className="teacher-editor-panel-label">Виджеты</div>
              <div className="teacher-editor-stage-actions teacher-editor-stage-actions-floating teacher-editor-hud-widgets-actions">
                <select value={widgetType} onChange={(event) => setWidgetType(event.target.value)} aria-label="Тип нового виджета">
                  {WIDGET_LIBRARY.map((entry) => (
                    <option key={entry.type} value={entry.type}>
                      {entry.label}
                    </option>
                  ))}
                </select>
                <button type="button" onClick={addWidget}>
                  Добавить виджет
                </button>
                <div className="teacher-editor-hud-action-row">
                  <button
                    type="button"
                    className="ghost"
                    onClick={removeSelected}
                    disabled={!selected}
                    aria-label="Удалить выбранный виджет или элемент доски"
                    title="Удалить выбранное"
                  >
                    Удалить
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={bringSelectionToFront}
                    disabled={!selected}
                    aria-label="Перенести выбранное на передний план"
                    title="На передний план"
                  >
                    Вперёд
                  </button>
                </div>
              </div>
            </div>

            {selectedWidget ? (
              <div className="teacher-editor-menu-panel teacher-editor-floating-panel teacher-editor-floating-panel-selection teacher-editor-hud-panel">
                <div className="teacher-editor-inspector-title">Виджет</div>
                <div className="teacher-editor-inline-form teacher-editor-inline-form-floating teacher-editor-inline-form-hud">
                  <label className="field teacher-editor-hud-field-tight">
                    <span>Заголовок</span>
                    <input
                      value={selectedWidget.title || ''}
                      onChange={(event) => updateSelectedWidgetField({ title: event.target.value })}
                    />
                  </label>
                  <details className="teacher-editor-hud-details teacher-editor-hud-details-nested">
                    <summary className="teacher-editor-hud-details-summary">Позиция и размер</summary>
                    {(['x', 'y', 'w', 'h', 'z'] as const).map((key) => (
                      <label className="field teacher-editor-hud-field-tight" key={key}>
                        <span>{key.toUpperCase()}</span>
                        <input
                          type="number"
                          value={normalizeWidgetLayout(selectedWidget.layout, scene.widgets.indexOf(selectedWidget))[key]}
                          onChange={(event) => updateSelectedWidgetLayout({ [key]: Number(event.target.value) || 0 })}
                        />
                      </label>
                    ))}
                    <label className="field checkbox-field teacher-editor-field-checkbox teacher-editor-hud-field-tight teacher-editor-hud-checkbox">
                      <input
                        type="checkbox"
                        checked={normalizeWidgetLayout(selectedWidget.layout, scene.widgets.indexOf(selectedWidget)).locked}
                        onChange={(event) => updateSelectedWidgetLayout({ locked: event.target.checked })}
                      />
                      <span>Закрепить</span>
                    </label>
                  </details>
                  <details className="teacher-editor-hud-details teacher-editor-hud-details-nested">
                    <summary className="teacher-editor-hud-details-summary">Config JSON</summary>
                    <label className="field teacher-editor-field-wide teacher-editor-hud-field-tight">
                      <textarea
                        rows={4}
                        value={widgetConfigDraft}
                        onChange={(event) => setWidgetConfigDraft(event.target.value)}
                        onBlur={applyWidgetConfigDraft}
                      />
                    </label>
                  </details>
                </div>
                {widgetConfigError ? <div className="info-text error-text">{widgetConfigError}</div> : null}
              </div>
            ) : null}

            {selectedElement ? (
              <div className="teacher-editor-menu-panel teacher-editor-floating-panel teacher-editor-floating-panel-selection teacher-editor-hud-panel">
                <div className="teacher-editor-inspector-title">Элемент (legacy)</div>
                <div className="teacher-editor-inline-form teacher-editor-inline-form-floating teacher-editor-inline-form-hud">
                  {'text' in selectedElement ? (
                    <label className="field teacher-editor-field-wide teacher-editor-hud-field-tight">
                      <span>Текст</span>
                      <textarea
                        rows={2}
                        value={selectedElement.text}
                        onChange={(event) => updateSelectedElement({ text: event.target.value })}
                      />
                    </label>
                  ) : null}
                  <details className="teacher-editor-hud-details teacher-editor-hud-details-nested">
                    <summary className="teacher-editor-hud-details-summary">Позиция и размер</summary>
                    {(['x', 'y', 'w', 'h', 'z'] as const).map((key) => (
                      <label className="field teacher-editor-hud-field-tight" key={key}>
                        <span>{key.toUpperCase()}</span>
                        <input
                          type="number"
                          value={selectedElement[key]}
                          onChange={(event) => updateSelectedElement({ [key]: Number(event.target.value) || 0 } as Partial<BoardElement>)}
                        />
                      </label>
                    ))}
                    <label className="field checkbox-field teacher-editor-field-checkbox teacher-editor-hud-field-tight teacher-editor-hud-checkbox">
                      <input
                        type="checkbox"
                        checked={selectedElement.locked}
                        onChange={(event) => updateSelectedElement({ locked: event.target.checked })}
                      />
                      <span>Закрепить</span>
                    </label>
                  </details>
                  {'color' in selectedElement ||
                  'fontSize' in selectedElement ||
                  'fill' in selectedElement ||
                  'strokeWidth' in selectedElement ? (
                    <details className="teacher-editor-hud-details teacher-editor-hud-details-nested">
                      <summary className="teacher-editor-hud-details-summary">Оформление</summary>
                      {'color' in selectedElement ? (
                        <label className="field teacher-editor-hud-field-tight">
                          <span>Цвет</span>
                          <input value={selectedElement.color} onChange={(event) => updateSelectedElement({ color: event.target.value })} />
                        </label>
                      ) : null}
                      {'fontSize' in selectedElement ? (
                        <label className="field teacher-editor-hud-field-tight">
                          <span>Размер текста</span>
                          <input
                            type="number"
                            value={selectedElement.fontSize}
                            onChange={(event) =>
                              updateSelectedElement({ fontSize: Number(event.target.value) || selectedElement.fontSize })
                            }
                          />
                        </label>
                      ) : null}
                      {'fill' in selectedElement ? (
                        <label className="field teacher-editor-hud-field-tight">
                          <span>Заливка</span>
                          <input value={selectedElement.fill} onChange={(event) => updateSelectedElement({ fill: event.target.value })} />
                        </label>
                      ) : null}
                      {'strokeWidth' in selectedElement ? (
                        <label className="field teacher-editor-hud-field-tight">
                          <span>Толщина</span>
                          <input
                            type="number"
                            value={selectedElement.strokeWidth}
                            onChange={(event) =>
                              updateSelectedElement({
                                strokeWidth: Number(event.target.value) || selectedElement.strokeWidth,
                              })
                            }
                          />
                        </label>
                      ) : null}
                    </details>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
      <div
        className="teacher-editor-footer-note teacher-editor-hud-footer-note info-text"
        title="Сохранение меняет шаблон урока. Уже запущенный live-run продолжит жить на своем snapshot, пока ты не перезапустишь урок."
      >
        Сохранение меняет шаблон урока. Уже запущенный live-run продолжит жить на своем snapshot, пока ты не перезапустишь урок.
      </div>
    </div>
  )
}
