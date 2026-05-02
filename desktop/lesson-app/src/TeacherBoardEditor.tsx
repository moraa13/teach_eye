/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { LessonSceneCanvas } from './LessonSceneCanvas'
import type { Scene, Widget } from './lessonRuntimeModels'
import {
  buildSceneLayout,
  createBoardElementId,
  defaultWidgetLayout,
  nextLayer,
  normalizeSceneLayout,
  normalizeWidgetLayout,
  type BoardElement,
  type SceneBoardLayout,
  type WidgetLayout,
} from './sceneLayout'

const DEBUG_BOARD_AGENT_LOGS = false

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

type EditorTool = 'select' | 'pen' | 'highlighter' | 'eraser' | 'text' | 'rectangle' | 'arrow'
type Selection = { kind: 'widget'; id: number } | { kind: 'element'; id: string } | null

type DragState =
  | {
      mode: 'move-widget'
      widgetId: number
      startX: number
      startY: number
      layout: WidgetLayout
    }
  | {
      mode: 'move-element'
      elementId: string
      startX: number
      startY: number
      element: BoardElement
    }
  | {
      mode: 'resize-widget'
      widgetId: number
      startX: number
      startY: number
      layout: WidgetLayout
    }
  | {
      mode: 'resize-element'
      elementId: string
      startX: number
      startY: number
      element: BoardElement
    }
  | {
      mode: 'draw'
      type: 'pen' | 'highlighter'
      originX: number
      originY: number
      points: number[]
    }
  | {
      mode: 'create-shape'
      type: 'rectangle' | 'arrow'
      originX: number
      originY: number
    }
  | {
      mode: 'erase'
      pointerId: number
    }

const TOOL_OPTIONS: Array<{ id: EditorTool; label: string }> = [
  { id: 'select', label: 'Выбор' },
  { id: 'pen', label: 'Перо' },
  { id: 'highlighter', label: 'Маркер' },
  { id: 'eraser', label: 'Ластик' },
  { id: 'text', label: 'Текст' },
  { id: 'rectangle', label: 'Прямоуг.' },
  { id: 'arrow', label: 'Стрелка' },
]

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

function clamp(value: number, min: number, max = Number.POSITIVE_INFINITY) {
  return Math.max(min, Math.min(max, value))
}

function eventPoint(event: PointerEvent | ReactPointerEvent<HTMLElement>, host: HTMLElement) {
  const bounds = host.getBoundingClientRect()
  return {
    x: event.clientX - bounds.left,
    y: event.clientY - bounds.top,
  }
}

function updateElementGeometry(element: BoardElement, patch: Partial<BoardElement>): BoardElement {
  return { ...element, ...patch } as BoardElement
}

function pointToSegmentDistance(pointX: number, pointY: number, startX: number, startY: number, endX: number, endY: number) {
  const deltaX = endX - startX
  const deltaY = endY - startY
  if (deltaX === 0 && deltaY === 0) {
    return Math.hypot(pointX - startX, pointY - startY)
  }
  const projection = ((pointX - startX) * deltaX + (pointY - startY) * deltaY) / (deltaX * deltaX + deltaY * deltaY)
  const t = Math.max(0, Math.min(1, projection))
  const projectedX = startX + deltaX * t
  const projectedY = startY + deltaY * t
  return Math.hypot(pointX - projectedX, pointY - projectedY)
}

function isPointInsideElement(element: BoardElement, point: { x: number; y: number }) {
  return point.x >= element.x && point.x <= element.x + element.w && point.y >= element.y && point.y <= element.y + element.h
}

function splitStrokeAtPoint(
  element: Extract<BoardElement, { type: 'pen' | 'highlighter' }>,
  point: { x: number; y: number },
  radius: number,
): BoardElement[] {
  const strokePoints = []
  for (let index = 0; index < element.points.length; index += 2) {
    strokePoints.push({ x: element.points[index], y: element.points[index + 1] })
  }
  if (strokePoints.length < 2) return [element]

  const localPoint = { x: point.x - element.x, y: point.y - element.y }
  const keptRuns: Array<Array<{ x: number; y: number }>> = []
  let currentRun = [strokePoints[0]]
  let erased = false

  for (let index = 1; index < strokePoints.length; index += 1) {
    const previous = strokePoints[index - 1]
    const current = strokePoints[index]
    const segmentTouched = pointToSegmentDistance(localPoint.x, localPoint.y, previous.x, previous.y, current.x, current.y) <= radius
    if (segmentTouched) {
      erased = true
      if (currentRun.length >= 2) keptRuns.push(currentRun)
      currentRun = [current]
      continue
    }
    currentRun = [...currentRun, current]
  }
  if (currentRun.length >= 2) keptRuns.push(currentRun)
  if (!erased) return [element]

  return keptRuns.flatMap((run) => {
    if (run.length < 2) return []
    const xs = run.map((entry) => entry.x)
    const ys = run.map((entry) => entry.y)
    const minX = Math.min(...xs)
    const minY = Math.min(...ys)
    const maxX = Math.max(...xs)
    const maxY = Math.max(...ys)
    return [
      {
        ...element,
        id: createBoardElementId(element.type),
        x: element.x + minX,
        y: element.y + minY,
        w: Math.max(1, maxX - minX),
        h: Math.max(1, maxY - minY),
        points: run.flatMap((entry) => [entry.x - minX, entry.y - minY]),
      },
    ]
  })
}

function renderTempElement(element: BoardElement) {
  if (element.type === 'text') {
    return <div className="lesson-scene-text">{element.text}</div>
  }
  if (element.type === 'rectangle') {
    return (
      <div
        className="lesson-scene-rect"
        style={{
          borderColor: element.color,
          background: element.fill,
          borderWidth: element.strokeWidth,
          borderRadius: element.radius,
        }}
      />
    )
  }
  if (element.type === 'arrow') {
    const startX = element.flipX ? element.w : 0
    const startY = element.flipY ? element.h : 0
    const endX = element.flipX ? 0 : element.w
    const endY = element.flipY ? 0 : element.h
    const headSize = Math.max(10, element.strokeWidth * 3)
    const directionX = endX >= startX ? -1 : 1
    const directionY = endY >= startY ? -1 : 1
    return (
      <svg width={element.w} height={element.h} viewBox={`0 0 ${element.w} ${element.h}`} preserveAspectRatio="none">
        <line
          x1={startX}
          y1={startY}
          x2={endX}
          y2={endY}
          stroke={element.color}
          strokeWidth={element.strokeWidth}
          strokeLinecap="round"
        />
        <polygon
          points={`${endX},${endY} ${endX + directionX * headSize},${endY + directionY * (headSize / 2)} ${endX + directionX * (headSize / 2)},${endY + directionY * headSize}`}
          fill={element.color}
        />
      </svg>
    )
  }
  return (
    <svg width={element.w} height={element.h} viewBox={`0 0 ${element.w} ${element.h}`}>
      <polyline
        fill="none"
        points={element.points.join(' ')}
        stroke={element.color}
        strokeWidth={element.strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={element.opacity}
      />
    </svg>
  )
}

function renderEditorWidgetPreview(widget: Widget) {
  return (
    <div className="board-widget-card">
      <div className="card-title">{widget.title || widget.widget_type}</div>
      <div className="info-text">{widget.widget_type}</div>
    </div>
  )
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
  const [tool, setTool] = useState<EditorTool>('select')
  const [selected, setSelected] = useState<Selection>(null)
  const [widgetType, setWidgetType] = useState(WIDGET_LIBRARY[0].type)
  const [widgetConfigDraft, setWidgetConfigDraft] = useState('{}')
  const [widgetConfigError, setWidgetConfigError] = useState<string | null>(null)
  const [tempDrawElement, setTempDrawElement] = useState<BoardElement | null>(null)
  const [editingTextElementId, setEditingTextElementId] = useState<string | null>(null)
  const [editingTextDraft, setEditingTextDraft] = useState('')
  const scene = lesson?.scenes[sceneIndex] ?? null
  const sceneLayout = useMemo(() => normalizeSceneLayout(scene?.layout), [scene?.layout])
  const dragStateRef = useRef<DragState | null>(null)
  const canvasHostRef = useRef<HTMLElement | null>(null)
  const lessonRef = useRef(lesson)
  const sceneRef = useRef(scene)
  const sceneLayoutRef = useRef(sceneLayout)
  const tempDrawElementRef = useRef<BoardElement | null>(null)
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
    tempDrawElementRef.current = tempDrawElement
  }, [lesson, scene, sceneLayout, tempDrawElement])

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
      setEditingTextElementId(null)
      setEditingTextDraft('')
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

  const eraseAtPoint = useCallback((point: { x: number; y: number }) => {
    patchBoardElements((elements) =>
      elements.flatMap((element) => {
        if (element.type === 'pen' || element.type === 'highlighter') {
          return splitStrokeAtPoint(element, point, 18)
        }
        return isPointInsideElement(element, point) ? [] : [element]
      }),
    )
  }, [patchBoardElements])

  const commitTextEditing = useCallback(() => {
    if (!editingTextElementId) return
    const nextText = editingTextDraft.trim() ? editingTextDraft : 'Новый текст'
    patchBoardElements((elements) =>
      elements.map((element) =>
        element.id === editingTextElementId && element.type === 'text'
          ? { ...element, text: nextText }
          : element,
      ),
    )
    setEditingTextElementId(null)
    setEditingTextDraft('')
  }, [editingTextDraft, editingTextElementId, patchBoardElements])

  const cancelTextEditing = useCallback(() => {
    setEditingTextElementId(null)
    setEditingTextDraft('')
  }, [])

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
      if (editingTextElementId === selected.id) cancelTextEditing()
      setSelected(null)
      return
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
  }

  function handleCanvasPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    canvasHostRef.current = event.currentTarget
    event.currentTarget.setPointerCapture?.(event.pointerId)
    if (!lesson || !scene) return
    const point = eventPoint(event, event.currentTarget)

    if (tool === 'select') {
      if (editingTextElementId) commitTextEditing()
      setSelected(null)
      return
    }

    if (tool === 'eraser') {
      dragStateRef.current = { mode: 'erase', pointerId: event.pointerId }
      eraseAtPoint(point)
      setSelected(null)
      return
    }

    if (tool === 'text') {
      const layout = normalizeSceneLayout(scene.layout)
      const element: BoardElement = {
        id: createBoardElementId('text'),
        type: 'text',
        x: point.x,
        y: point.y,
        w: 320,
        h: 120,
        z: nextLayer(layout.board_elements),
        locked: false,
        text: 'Новый текст',
        color: '#f5f8ff',
        fontSize: 30,
        align: 'left',
      }
      patchBoardElements((elements) => [...elements, element])
      setSelected({ kind: 'element', id: element.id })
      setEditingTextElementId(element.id)
      setEditingTextDraft(element.text)
      setTool('select')
      return
    }

    if (tool === 'rectangle' || tool === 'arrow') {
      dragStateRef.current = {
        mode: 'create-shape',
        type: tool,
        originX: point.x,
        originY: point.y,
      }
      const layer = nextLayer(sceneLayout.board_elements)
      const element: BoardElement = tool === 'rectangle'
        ? {
            id: createBoardElementId('rect'),
            type: 'rectangle',
            x: point.x,
            y: point.y,
            w: 1,
            h: 1,
            z: layer,
            locked: false,
            color: '#76acff',
            fill: 'rgba(118, 172, 255, 0.14)',
            strokeWidth: 3,
            radius: 18,
          }
        : {
            id: createBoardElementId('arrow'),
            type: 'arrow',
            x: point.x,
            y: point.y,
            w: 1,
            h: 1,
            z: layer,
            locked: false,
            color: '#ffc86f',
            strokeWidth: 4,
          }
      setTempDrawElement(element)
      return
    }

    if (tool === 'pen' || tool === 'highlighter') {
      dragStateRef.current = {
        mode: 'draw',
        type: tool,
        originX: point.x,
        originY: point.y,
        points: [0, 0],
      }
      const element: BoardElement = {
        id: createBoardElementId(tool),
        type: tool,
        x: point.x,
        y: point.y,
        w: 1,
        h: 1,
        z: nextLayer(sceneLayout.board_elements),
        locked: false,
        color: tool === 'highlighter' ? '#f7e588' : '#7bc6ff',
        strokeWidth: tool === 'highlighter' ? 18 : 4,
        opacity: tool === 'highlighter' ? 0.35 : 1,
        points: [0, 0],
      }
      setTempDrawElement(element)
    }
  }

  function handleWidgetPointerDown(widgetId: number, event: ReactPointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture?.(event.pointerId)
    if (tool === 'eraser') {
      setSelected({ kind: 'widget', id: widgetId })
      removeSelected()
      return
    }
    if (tool !== 'select' || !scene) return
    const widget = scene.widgets.find((item) => item.id === widgetId)
    if (!widget) return
    const layout = normalizeWidgetLayout(widget.layout, scene.widgets.indexOf(widget))
    if (layout.locked) {
      setSelected({ kind: 'widget', id: widgetId })
      return
    }
    canvasHostRef.current = event.currentTarget.closest('.lesson-scene-canvas') as HTMLElement | null
    dragStateRef.current = {
      mode: 'move-widget',
      widgetId,
      startX: event.clientX,
      startY: event.clientY,
      layout,
    }
    setSelected({ kind: 'widget', id: widgetId })
  }

  function handleElementPointerDown(elementId: string, event: ReactPointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture?.(event.pointerId)
    if (!scene) return
    const element = sceneLayout.board_elements.find((item) => item.id === elementId)
    if (!element) return
    if (tool === 'eraser') {
      const point = eventPoint(event, (event.currentTarget.closest('.lesson-scene-canvas') as HTMLElement | null) ?? event.currentTarget)
      dragStateRef.current = { mode: 'erase', pointerId: event.pointerId }
      eraseAtPoint(point)
      setSelected(null)
      return
    }
    if (tool !== 'select' || element.locked) {
      setSelected({ kind: 'element', id: elementId })
      return
    }
    canvasHostRef.current = event.currentTarget.closest('.lesson-scene-canvas') as HTMLElement | null
    dragStateRef.current = {
      mode: 'move-element',
      elementId,
      startX: event.clientX,
      startY: event.clientY,
      element,
    }
    setSelected({ kind: 'element', id: elementId })
  }

  function beginResizeSelection(event: ReactPointerEvent<HTMLButtonElement>) {
    event.stopPropagation()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    if (!selected || !scene) return
    const canvas = (event.currentTarget.closest('.lesson-scene-canvas') as HTMLElement | null) ?? canvasHostRef.current
    canvasHostRef.current = canvas
    if (selected.kind === 'widget') {
      const widget = scene.widgets.find((item) => item.id === selected.id)
      if (!widget) return
      dragStateRef.current = {
        mode: 'resize-widget',
        widgetId: selected.id,
        startX: event.clientX,
        startY: event.clientY,
        layout: normalizeWidgetLayout(widget.layout, scene.widgets.indexOf(widget)),
      }
      return
    }
    if (!selectedElement) return
    dragStateRef.current = {
      mode: 'resize-element',
      elementId: selected.id,
      startX: event.clientX,
      startY: event.clientY,
      element: selectedElement,
    }
  }

  useEffect(() => {
    function onPointerMove(event: PointerEvent) {
      const drag = dragStateRef.current
      const activeLesson = lessonRef.current
      const activeScene = sceneRef.current
      const activeLayout = sceneLayoutRef.current
      if (!drag || !activeLesson || !activeScene) return
      if (drag.mode === 'move-widget') {
        const deltaX = event.clientX - drag.startX
        const deltaY = event.clientY - drag.startY
        patchWidget(drag.widgetId, (widget, layout) => ({
          ...widget,
          layout: {
            ...layout,
            x: clamp(drag.layout.x + deltaX, 0),
            y: clamp(drag.layout.y + deltaY, 0),
          },
        }))
        return
      }
      if (drag.mode === 'move-element') {
        const deltaX = event.clientX - drag.startX
        const deltaY = event.clientY - drag.startY
        patchBoardElements((elements) =>
          elements.map((element) =>
            element.id === drag.elementId
              ? updateElementGeometry(element, {
                  x: clamp(drag.element.x + deltaX, 0),
                  y: clamp(drag.element.y + deltaY, 0),
                })
              : element,
          ),
        )
        return
      }
      if (drag.mode === 'resize-widget') {
        const deltaX = event.clientX - drag.startX
        const deltaY = event.clientY - drag.startY
        patchWidget(drag.widgetId, (widget, layout) => ({
          ...widget,
          layout: {
            ...layout,
            w: clamp(drag.layout.w + deltaX, 180),
            h: clamp(drag.layout.h + deltaY, 120),
          },
        }))
        return
      }
      if (drag.mode === 'resize-element') {
        const deltaX = event.clientX - drag.startX
        const deltaY = event.clientY - drag.startY
        patchBoardElements((elements) =>
          elements.map((element) =>
            element.id === drag.elementId
              ? updateElementGeometry(element, {
                  w: clamp(drag.element.w + deltaX, 24),
                  h: clamp(drag.element.h + deltaY, 24),
                })
              : element,
          ),
        )
        return
      }
      if (drag.mode === 'erase') {
        const canvas = canvasHostRef.current
        if (!canvas) return
        eraseAtPoint(eventPoint(event, canvas))
        return
      }
      if (drag.mode === 'create-shape') {
        const canvas = canvasHostRef.current
        if (!canvas) return
        const point = eventPoint(event, canvas)
        const minX = Math.min(drag.originX, point.x)
        const minY = Math.min(drag.originY, point.y)
        const width = Math.max(1, Math.abs(point.x - drag.originX))
        const height = Math.max(1, Math.abs(point.y - drag.originY))
        const element: BoardElement = drag.type === 'rectangle'
          ? {
              id: tempDrawElementRef.current?.id ?? createBoardElementId('rect'),
              type: 'rectangle',
              x: minX,
              y: minY,
              w: width,
              h: height,
              z: tempDrawElementRef.current?.z ?? nextLayer(activeLayout.board_elements),
              locked: false,
              color: '#76acff',
              fill: 'rgba(118, 172, 255, 0.14)',
              strokeWidth: 3,
              radius: 18,
            }
          : {
              id: tempDrawElementRef.current?.id ?? createBoardElementId('arrow'),
              type: 'arrow',
              x: minX,
              y: minY,
              w: width,
              h: height,
              z: tempDrawElementRef.current?.z ?? nextLayer(activeLayout.board_elements),
              locked: false,
              color: '#ffc86f',
              strokeWidth: 4,
              flipX: point.x < drag.originX,
              flipY: point.y < drag.originY,
            }
        tempDrawElementRef.current = element
        setTempDrawElement(element)
        return
      }
      if (drag.mode === 'draw') {
        const canvas = canvasHostRef.current
        if (!canvas) return
        const point = eventPoint(event, canvas)
        const absolutePoints = [...drag.points, point.x - drag.originX, point.y - drag.originY]
        const xs = absolutePoints.filter((_, index) => index % 2 === 0)
        const ys = absolutePoints.filter((_, index) => index % 2 === 1)
        const minX = Math.min(...xs, 0)
        const minY = Math.min(...ys, 0)
        const maxX = Math.max(...xs, 1)
        const maxY = Math.max(...ys, 1)
        const normalizedPoints = absolutePoints.flatMap((value, index) =>
          index % 2 === 0 ? [value - minX] : [value - minY],
        )
        const element: BoardElement = {
          id: tempDrawElementRef.current?.id ?? createBoardElementId(drag.type),
          type: drag.type,
          x: drag.originX + minX,
          y: drag.originY + minY,
          w: maxX - minX || 1,
          h: maxY - minY || 1,
          z: tempDrawElementRef.current?.z ?? nextLayer(activeLayout.board_elements),
          locked: false,
          color: drag.type === 'highlighter' ? '#f7e588' : '#7bc6ff',
          strokeWidth: drag.type === 'highlighter' ? 18 : 4,
          opacity: drag.type === 'highlighter' ? 0.35 : 1,
          points: normalizedPoints,
        }
        dragStateRef.current = { ...drag, points: absolutePoints }
        tempDrawElementRef.current = element
        setTempDrawElement(element)
      }
    }

    function onPointerUp() {
      const drag = dragStateRef.current
      const nextElement = tempDrawElementRef.current
      if ((drag?.mode === 'draw' || drag?.mode === 'create-shape') && nextElement) {
        patchBoardElements((elements) => [...elements, nextElement])
        setSelected({ kind: 'element', id: nextElement.id })
        if (drag.mode === 'create-shape') setTool('select')
      }
      dragStateRef.current = null
      tempDrawElementRef.current = null
      setTempDrawElement(null)
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
    }
  }, [eraseAtPoint, patchBoardElements, patchWidget])

  const selectionBox = useMemo(() => {
    if (!selected) return null
    if (selected.kind === 'widget' && selectedWidget) {
      return normalizeWidgetLayout(selectedWidget.layout, scene?.widgets.indexOf(selectedWidget) ?? 0)
    }
    if (selected.kind === 'element' && selectedElement) {
      return selectedElement
    }
    return null
  }, [scene?.widgets, selected, selectedElement, selectedWidget])

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
    if (!selectedWidget) return
    patchWidget(selectedWidget.id, (widget) => ({ ...widget, ...patch }))
  }

  function updateSelectedWidgetLayout(patch: Partial<WidgetLayout>) {
    if (!selectedWidget || !scene) return
    patchWidget(selectedWidget.id, (widget, layout) => ({
      ...widget,
      layout: { ...layout, ...patch },
    }))
  }

  function updateSelectedElement(patch: Partial<BoardElement>) {
    if (!selectedElement) return
    patchBoardElements((elements) =>
      elements.map((element) => (element.id === selectedElement.id ? updateElementGeometry(element, patch) : element)),
    )
  }

  function beginTextEditing(elementId: string) {
    const element = sceneLayout.board_elements.find((entry) => entry.id === elementId)
    if (!element || element.type !== 'text') return
    setSelected({ kind: 'element', id: elementId })
    setEditingTextElementId(elementId)
    setEditingTextDraft(element.text)
  }

  function applyWidgetConfigDraft() {
    if (!selectedWidget) return
    const parsed = safeParseJson(widgetConfigDraft)
    if (!parsed.ok || typeof parsed.value !== 'object' || parsed.value === null || Array.isArray(parsed.value)) {
      setWidgetConfigError(parsed.ok ? 'Нужен JSON-объект' : parsed.error)
      return
    }
    patchWidget(selectedWidget.id, (widget) => ({ ...widget, config: parsed.value as Record<string, any> }))
    setWidgetConfigError(null)
  }

  if (!lesson || !scene) {
    return <div className="empty-state">Выбери урок из библиотеки, чтобы открыть editor canvas.</div>
  }

  const previewWidgets = scene.widgets.map((widget, index) => ({
    id: widget.id,
    layout: normalizeWidgetLayout(widget.layout, index),
    selected: selected?.kind === 'widget' && selected.id === widget.id,
    className: 'teacher-editor-widget',
    onClick: () => setSelected({ kind: 'widget', id: widget.id }),
    onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => handleWidgetPointerDown(widget.id, event),
    content: renderEditorWidgetPreview(widget),
  }))

  const overlay = (
    <>
      {editingTextElementId && selectedElement?.type === 'text' ? (
        <div
          className="teacher-editor-text-edit"
          style={{
            left: selectedElement.x,
            top: selectedElement.y,
            width: selectedElement.w,
            minHeight: selectedElement.h,
            zIndex: selectedElement.z + 120,
          }}
        >
          <textarea
            autoFocus
            value={editingTextDraft}
            onChange={(event) => setEditingTextDraft(event.target.value)}
            onBlur={commitTextEditing}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                cancelTextEditing()
              }
              if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                event.preventDefault()
                commitTextEditing()
              }
            }}
          />
        </div>
      ) : null}
      {tempDrawElement ? (
        <div
          className="lesson-scene-element selected"
          style={{
            left: tempDrawElement.x,
            top: tempDrawElement.y,
            width: tempDrawElement.w,
            height: tempDrawElement.h,
            zIndex: tempDrawElement.z,
          }}
        >
          {renderTempElement(tempDrawElement)}
        </div>
      ) : null}
      {selectionBox ? (
        <div
          className="teacher-editor-selection"
          style={{
            left: selectionBox.x,
            top: selectionBox.y,
            width: selectionBox.w,
            height: selectionBox.h,
            zIndex: selectionBox.z + 100,
          }}
        >
          <button className="teacher-editor-resize-handle" onPointerDown={beginResizeSelection} />
        </div>
      ) : null}
    </>
  )

  return (
    <div className="teacher-editor-shell">
      <div className="teacher-editor-toolbar">
        <div className="teacher-editor-tool-group">
          {TOOL_OPTIONS.map((option) => (
            <button
              key={option.id}
              className={tool === option.id ? 'active' : 'ghost'}
              onClick={() => setTool(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="teacher-editor-tool-group">
          <select value={widgetType} onChange={(event) => setWidgetType(event.target.value)}>
            {WIDGET_LIBRARY.map((entry) => (
              <option key={entry.type} value={entry.type}>
                {entry.label}
              </option>
            ))}
          </select>
          <button className="ghost" onClick={addWidget}>
            Добавить виджет
          </button>
          <button className="ghost" onClick={removeSelected} disabled={!selected}>
            Удалить
          </button>
          <button className="ghost" onClick={bringSelectionToFront} disabled={!selected}>
            На передний план
          </button>
        </div>
        <div className="teacher-editor-tool-group">
          <button onClick={onSave} disabled={saving}>
            {saving ? 'Сохраняю...' : dirty ? 'Сохранить урок' : 'Сохранено'}
          </button>
        </div>
      </div>

      <div className="teacher-editor-meta">
        <div className="teacher-editor-scene-strip">
          {lesson.scenes.map((item, index) => (
            <button
              key={item.id}
              className={`scene-chip ${index === sceneIndex ? 'current' : ''}`}
              onClick={() => onSceneIndexChange(index)}
            >
              {index + 1}. {item.title}
            </button>
          ))}
          <button className="ghost" onClick={addScene}>
            + сцена
          </button>
        </div>
        <div className="info-text">
          Сохранение меняет шаблон урока. Уже запущенный live-run продолжит жить на своем snapshot, пока ты не перезапустишь урок.
        </div>
      </div>

      <div className="teacher-editor-grid">
        <div className="teacher-editor-canvas-card">
          <LessonSceneCanvas
            rawLayout={scene.layout}
            mode="teacher-edit"
            widgets={previewWidgets}
            selectedElementId={selected?.kind === 'element' ? selected.id : null}
            selectedWidgetId={selected?.kind === 'widget' ? selected.id : null}
            onSelectElement={(elementId) => setSelected({ kind: 'element', id: elementId })}
            onElementDoubleClick={beginTextEditing}
            onElementPointerDown={handleElementPointerDown}
            onCanvasPointerDown={handleCanvasPointerDown}
            onCanvasClick={() => {
              if (editingTextElementId) commitTextEditing()
              if (tool === 'select') setSelected(null)
            }}
            overlay={overlay}
            className="teacher-editor-canvas-surface"
          />
        </div>

        <div className="teacher-editor-inspector">
          <div className="card-title">Inspector</div>
          <label className="field">
            <span>Название сцены</span>
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
          <label className="field">
            <span>Заметки сцены</span>
            <textarea
              value={scene.notes_text || ''}
              rows={4}
              onChange={(event) =>
                patchCurrentScene((currentScene) => ({
                  ...currentScene,
                  notes_text: event.target.value,
                }))
              }
            />
          </label>
          <div className="teacher-editor-mini-grid">
            <label className="field">
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
            <label className="field">
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
          <label className="field checkbox-field">
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
            <span>Показывать сетку</span>
          </label>

          {selectedWidget ? (
            <>
              <div className="teacher-editor-inspector-title">Виджет</div>
              <label className="field">
                <span>Заголовок</span>
                <input value={selectedWidget.title || ''} onChange={(event) => updateSelectedWidgetField({ title: event.target.value })} />
              </label>
              <div className="teacher-editor-mini-grid">
                {(['x', 'y', 'w', 'h', 'z'] as const).map((key) => (
                  <label className="field" key={key}>
                    <span>{key.toUpperCase()}</span>
                    <input
                      type="number"
                      value={normalizeWidgetLayout(selectedWidget.layout, scene.widgets.indexOf(selectedWidget))[key]}
                      onChange={(event) => updateSelectedWidgetLayout({ [key]: Number(event.target.value) || 0 })}
                    />
                  </label>
                ))}
              </div>
              <label className="field checkbox-field">
                <input
                  type="checkbox"
                  checked={normalizeWidgetLayout(selectedWidget.layout, scene.widgets.indexOf(selectedWidget)).locked}
                  onChange={(event) => updateSelectedWidgetLayout({ locked: event.target.checked })}
                />
                <span>Locked</span>
              </label>
              <label className="field">
                <span>Config JSON</span>
                <textarea
                  rows={12}
                  value={widgetConfigDraft}
                  onChange={(event) => setWidgetConfigDraft(event.target.value)}
                  onBlur={applyWidgetConfigDraft}
                />
              </label>
              {widgetConfigError ? <div className="info-text error-text">{widgetConfigError}</div> : null}
            </>
          ) : null}

          {selectedElement ? (
            <>
              <div className="teacher-editor-inspector-title">Board element</div>
              {'text' in selectedElement ? (
                <label className="field">
                  <span>Текст</span>
                  <textarea
                    rows={4}
                    value={selectedElement.text}
                    onChange={(event) => updateSelectedElement({ text: event.target.value })}
                  />
                </label>
              ) : null}
              <div className="teacher-editor-mini-grid">
                {(['x', 'y', 'w', 'h', 'z'] as const).map((key) => (
                  <label className="field" key={key}>
                    <span>{key.toUpperCase()}</span>
                    <input
                      type="number"
                      value={selectedElement[key]}
                      onChange={(event) => updateSelectedElement({ [key]: Number(event.target.value) || 0 } as Partial<BoardElement>)}
                    />
                  </label>
                ))}
              </div>
              <label className="field checkbox-field">
                <input
                  type="checkbox"
                  checked={selectedElement.locked}
                  onChange={(event) => updateSelectedElement({ locked: event.target.checked })}
                />
                <span>Locked</span>
              </label>
              {'color' in selectedElement ? (
                <label className="field">
                  <span>Цвет</span>
                  <input value={selectedElement.color} onChange={(event) => updateSelectedElement({ color: event.target.value })} />
                </label>
              ) : null}
              {'fontSize' in selectedElement ? (
                <label className="field">
                  <span>Размер текста</span>
                  <input
                    type="number"
                    value={selectedElement.fontSize}
                    onChange={(event) => updateSelectedElement({ fontSize: Number(event.target.value) || selectedElement.fontSize })}
                  />
                </label>
              ) : null}
              {'fill' in selectedElement ? (
                <label className="field">
                  <span>Заливка</span>
                  <input value={selectedElement.fill} onChange={(event) => updateSelectedElement({ fill: event.target.value })} />
                </label>
              ) : null}
              {'strokeWidth' in selectedElement ? (
                <label className="field">
                  <span>Толщина</span>
                  <input
                    type="number"
                    value={selectedElement.strokeWidth}
                    onChange={(event) => updateSelectedElement({ strokeWidth: Number(event.target.value) || selectedElement.strokeWidth })}
                  />
                </label>
              ) : null}
            </>
          ) : null}

          {!selectedWidget && !selectedElement ? (
            <div className="empty-state">Выбери виджет или board element, чтобы редактировать свойства.</div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
