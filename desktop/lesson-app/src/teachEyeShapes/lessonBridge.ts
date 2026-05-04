import type { Widget } from '../lessonRuntimeModels'
import { normalizeWidgetLayout } from '../sceneLayout'
import { TEACH_EYE_WIDGET_SHAPE_TYPE } from '../teachEyeWidgetShape'
import {
  shapeTypeToWidgetRuntimeType,
  TEACH_EYE_BINARY_DEC_TYPE,
  TEACH_EYE_CODE_PUZZLE_TYPE,
  TEACH_EYE_MATCHING_TYPE,
  TEACH_EYE_MULTIPLE_CHOICE_TYPE,
  TEACH_EYE_ORDERING_TYPE,
  widgetRuntimeTypeToShapeType,
} from './constants'

/** Достаточно для merge/конфига; кастомные teach-eye типы не входят в TLShape по умолчанию. */
export type TeachEyeShapeLike = {
  id: string
  type: string
  x: number
  y: number
  props: Record<string, unknown>
}

export function safeParseJsonArray<T>(raw: string, fallback: T[]): T[] {
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) ? (v as T[]) : fallback
  } catch {
    return fallback
  }
}

export function safeParseStringRecord(raw: string, fallback: Record<string, unknown>): Record<string, unknown> {
  try {
    const v = JSON.parse(raw)
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : fallback
  } catch {
    return fallback
  }
}

/** Форма для `editor.createShapes` / частичное обновление. */
export function buildTeachEyeShapePartialFromWidget(
  widget: Widget,
  orderIndex: number,
): { type: string; x: number; y: number; props: Record<string, unknown> } {
  const layout = normalizeWidgetLayout(widget.layout, orderIndex)
  const type = widgetRuntimeTypeToShapeType(widget.widget_type)
  const common = {
    w: layout.w,
    h: layout.h,
    widgetId: widget.id,
    title: widget.title || widget.widget_type,
  }
  const c = widget.config ?? {}

  if (type === TEACH_EYE_MULTIPLE_CHOICE_TYPE) {
    const options = Array.isArray(c.options) ? c.options.map(String) : []
    return {
      type,
      x: layout.x,
      y: layout.y,
      props: {
        ...common,
        question: String(c.question ?? ''),
        optionsJson: JSON.stringify(options),
        correctIndex: typeof c.correct_index === 'number' ? c.correct_index : 0,
        selectedIndex: -1,
        checkState: 'idle',
      },
    }
  }

  if (type === TEACH_EYE_BINARY_DEC_TYPE) {
    const tasks = Array.isArray(c.tasks) ? c.tasks : []
    const task = (tasks[0] as { target_value?: number; bit_count?: number } | undefined) ?? {
      target_value: 5,
      bit_count: 4,
    }
    const n = Math.max(2, Math.min(16, Number(task.bit_count) || 4))
    const weights = Array.from({ length: n }, (_, i) => 2 ** (n - i - 1))
    const bits = Array.from({ length: n }, () => 0 as 0 | 1)
    return {
      type,
      x: layout.x,
      y: layout.y,
      props: {
        ...common,
        targetNumber: Number(task.target_value) || 0,
        weightsJson: JSON.stringify(weights),
        bitsJson: JSON.stringify(bits),
        checkState: 'idle',
      },
    }
  }

  if (type === TEACH_EYE_MATCHING_TYPE) {
    const pairs = Array.isArray(c.pairs) ? (c.pairs as Array<{ left: string; right: string }>) : []
    const leftItems = pairs.map((p) => p.left)
    const rightItems: string[] = []
    for (const p of pairs) {
      if (!rightItems.includes(p.right)) rightItems.push(p.right)
    }
    const correctPairs: [number, number][] = pairs.map((p, i) => {
      const ri = rightItems.indexOf(p.right)
      return [i, ri >= 0 ? ri : 0]
    })
    return {
      type,
      x: layout.x,
      y: layout.y,
      props: {
        ...common,
        leftItemsJson: JSON.stringify(leftItems),
        rightItemsJson: JSON.stringify(rightItems),
        correctPairsJson: JSON.stringify(correctPairs),
        connectionsJson: JSON.stringify([]),
        pendingLeftIndex: -1,
        checkState: 'idle',
      },
    }
  }

  if (type === TEACH_EYE_ORDERING_TYPE) {
    const steps = Array.isArray(c.steps) ? c.steps.map(String) : []
    const items = steps.map((text, i) => ({ id: `s${i}`, text }))
    const correctOrder = items.map((it) => it.id)
    const orderIds = (() => {
      const o = [...correctOrder]
      for (let i = o.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[o[i], o[j]] = [o[j], o[i]]
      }
      return o
    })()
    return {
      type,
      x: layout.x,
      y: layout.y,
      props: {
        ...common,
        itemsJson: JSON.stringify(items),
        orderIdsJson: JSON.stringify(orderIds),
        correctOrderJson: JSON.stringify(correctOrder),
        checkState: 'idle',
      },
    }
  }

  if (type === TEACH_EYE_CODE_PUZZLE_TYPE) {
    const lines = Array.isArray(c.lines) ? c.lines.map(String) : []
    const solution = lines.join('\n')
    return {
      type,
      x: layout.x,
      y: layout.y,
      props: {
        ...common,
        snippetsJson: JSON.stringify([...lines]),
        assemblyJson: JSON.stringify([]),
        solution,
        checkState: 'idle',
      },
    }
  }

  return {
    type: TEACH_EYE_WIDGET_SHAPE_TYPE,
    x: layout.x,
    y: layout.y,
    props: {
      ...common,
      widgetType: widget.widget_type,
      configJson: JSON.stringify(widget.config ?? {}),
    },
  }
}

/** Конфиг урока (без ученического прогресса) из нативного шейпа. */
export function widgetConfigFromManagedShape(shape: TeachEyeShapeLike): Record<string, unknown> | null {
  const p = shape.props as Record<string, unknown>
  switch (shape.type) {
    case TEACH_EYE_MULTIPLE_CHOICE_TYPE:
      return {
        question: String(p.question ?? ''),
        options: safeParseJsonArray<string>(String(p.optionsJson ?? '[]'), []),
        correct_index: typeof p.correctIndex === 'number' ? p.correctIndex : 0,
      }
    case TEACH_EYE_BINARY_DEC_TYPE: {
      const tasks = [
        {
          target_value: typeof p.targetNumber === 'number' ? p.targetNumber : 0,
          bit_count: safeParseJsonArray<number>(String(p.weightsJson ?? '[]'), [8, 4, 2, 1]).length || 4,
        },
      ]
      return { tasks }
    }
    case TEACH_EYE_MATCHING_TYPE: {
      const left = safeParseJsonArray<string>(String(p.leftItemsJson ?? '[]'), [])
      const right = safeParseJsonArray<string>(String(p.rightItemsJson ?? '[]'), [])
      const cp = safeParseJsonArray<[number, number]>(String(p.correctPairsJson ?? '[]'), [])
      const pairs = left.map((l, li) => {
        const found = cp.find((x) => x[0] === li)
        const ri = found ? found[1] : 0
        return { left: l, right: right[ri] ?? '' }
      })
      return { pairs }
    }
    case TEACH_EYE_ORDERING_TYPE: {
      const items = safeParseJsonArray<{ id: string; text: string }>(String(p.itemsJson ?? '[]'), [])
      return { steps: items.map((it) => it.text) }
    }
    case TEACH_EYE_CODE_PUZZLE_TYPE:
      return {
        lines: String(p.solution ?? '')
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean),
      }
    default:
      return null
  }
}

export function mergeWidgetFromTeachEyeShape(widget: Widget, shape: TeachEyeShapeLike, orderIndex: number): Widget {
  const layout = normalizeWidgetLayout(widget.layout, orderIndex)
  const sx = shape.x
  const sy = shape.y
  const sp = shape.props as Record<string, unknown>
  const w = typeof sp.w === 'number' ? sp.w : layout.w
  const h = typeof sp.h === 'number' ? sp.h : layout.h
  const title = typeof sp.title === 'string' ? sp.title : widget.title

  if (shape.type === TEACH_EYE_WIDGET_SHAPE_TYPE) {
    const legacy = sp as { widgetType?: string; configJson?: string }
    return {
      ...widget,
      title,
      widget_type: typeof legacy.widgetType === 'string' ? legacy.widgetType : widget.widget_type,
      layout: { ...layout, x: sx, y: sy, w, h },
      config: safeParseStringRecord(String(legacy.configJson ?? '{}'), widget.config ?? {}) as Widget['config'],
    }
  }

  const cfg = widgetConfigFromManagedShape(shape)
  const wt = shapeTypeToWidgetRuntimeType(shape.type)
  return {
    ...widget,
    title,
    widget_type: wt,
    layout: { ...layout, x: sx, y: sy, w, h },
    config: (cfg ?? widget.config) as Widget['config'],
  }
}

export function mirrorNativeShapeFromWidget(
  widget: Widget,
  orderIndex: number,
  shape: TeachEyeShapeLike,
): { id: string; type: string; x: number; y: number; props: Record<string, unknown> } | null {
  const layout = normalizeWidgetLayout(widget.layout, orderIndex)
  const desired = widgetRuntimeTypeToShapeType(widget.widget_type)
  if (shape.type !== desired) return null
  if (desired === TEACH_EYE_WIDGET_SHAPE_TYPE) return null
  const fresh = buildTeachEyeShapePartialFromWidget(widget, orderIndex)
  return {
    id: shape.id,
    type: fresh.type,
    x: layout.x,
    y: layout.y,
    props: fresh.props,
  }
}
