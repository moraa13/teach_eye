export type SceneViewport = {
  width: number
  height: number
  gridSize: number
  showGrid: boolean
  background: string
}

export type WidgetLayout = {
  x: number
  y: number
  w: number
  h: number
  z: number
  locked: boolean
}

export type PenBoardElement = {
  id: string
  type: 'pen' | 'highlighter'
  x: number
  y: number
  w: number
  h: number
  z: number
  locked: boolean
  color: string
  strokeWidth: number
  opacity: number
  points: number[]
}

export type TextBoardElement = {
  id: string
  type: 'text'
  x: number
  y: number
  w: number
  h: number
  z: number
  locked: boolean
  text: string
  color: string
  fontSize: number
  align: 'left' | 'center' | 'right'
}

export type RectangleBoardElement = {
  id: string
  type: 'rectangle'
  x: number
  y: number
  w: number
  h: number
  z: number
  locked: boolean
  color: string
  fill: string
  strokeWidth: number
  radius: number
}

export type ArrowBoardElement = {
  id: string
  type: 'arrow'
  x: number
  y: number
  w: number
  h: number
  z: number
  locked: boolean
  color: string
  strokeWidth: number
  flipX?: boolean
  flipY?: boolean
}

export type BoardElement = PenBoardElement | TextBoardElement | RectangleBoardElement | ArrowBoardElement

export type SceneBoardLayout = {
  viewport: SceneViewport
  board_elements: BoardElement[]
  /** Persisted tldraw editor snapshot (see TeacherTldrawBoard). Optional during migration. */
  tldraw_snapshot?: unknown
}

const DEFAULT_VIEWPORT: SceneViewport = {
  width: 1440,
  height: 900,
  gridSize: 24,
  showGrid: true,
  background: 'linear-gradient(180deg, rgba(10, 18, 34, 0.96), rgba(7, 12, 24, 0.98))',
}

function clampNumber(value: unknown, fallback: number, min = 0) {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback
  return Math.max(min, value)
}

export function createBoardElementId(prefix = 'board') {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`
}

export function defaultWidgetLayout(orderIndex = 0): WidgetLayout {
  const column = orderIndex % 2
  const row = Math.floor(orderIndex / 2)
  return {
    x: 48 + column * 460,
    y: 64 + row * 280,
    w: 400,
    h: 220,
    z: orderIndex + 1,
    locked: false,
  }
}

export function normalizeWidgetLayout(rawLayout: unknown, orderIndex = 0): WidgetLayout {
  const layout = rawLayout && typeof rawLayout === 'object' ? (rawLayout as Record<string, unknown>) : {}
  const fallback = defaultWidgetLayout(orderIndex)
  return {
    x: clampNumber(layout.x, fallback.x),
    y: clampNumber(layout.y, fallback.y),
    w: clampNumber(layout.w, fallback.w, 80),
    h: clampNumber(layout.h, fallback.h, 60),
    z: clampNumber(layout.z, fallback.z),
    locked: Boolean(layout.locked),
  }
}

function normalizePenElement(raw: Record<string, unknown>, index: number, type: 'pen' | 'highlighter'): PenBoardElement {
  const x = clampNumber(raw.x, 80)
  const y = clampNumber(raw.y, 80)
  const w = clampNumber(raw.w, 220, 1)
  const h = clampNumber(raw.h, 140, 1)
  const points = Array.isArray(raw.points)
    ? raw.points.filter((value) => typeof value === 'number' && !Number.isNaN(value))
    : [0, 0, w, h]
  return {
    id: typeof raw.id === 'string' ? raw.id : createBoardElementId(type),
    type,
    x,
    y,
    w,
    h,
    z: clampNumber(raw.z, index + 1),
    locked: Boolean(raw.locked),
    color: typeof raw.color === 'string' ? raw.color : type === 'highlighter' ? '#f8e16f' : '#7cc7ff',
    strokeWidth: clampNumber(raw.strokeWidth, type === 'highlighter' ? 18 : 4, 1),
    opacity: clampNumber(raw.opacity, type === 'highlighter' ? 0.35 : 1, 0),
    points: points.length >= 4 ? points : [0, 0, w, h],
  }
}

function normalizeTextElement(raw: Record<string, unknown>, index: number): TextBoardElement {
  return {
    id: typeof raw.id === 'string' ? raw.id : createBoardElementId('text'),
    type: 'text',
    x: clampNumber(raw.x, 120),
    y: clampNumber(raw.y, 120),
    w: clampNumber(raw.w, 260, 80),
    h: clampNumber(raw.h, 120, 48),
    z: clampNumber(raw.z, index + 1),
    locked: Boolean(raw.locked),
    text: typeof raw.text === 'string' ? raw.text : 'Новый текст',
    color: typeof raw.color === 'string' ? raw.color : '#f5f8ff',
    fontSize: clampNumber(raw.fontSize, 28, 10),
    align: raw.align === 'center' || raw.align === 'right' ? raw.align : 'left',
  }
}

function normalizeRectangleElement(raw: Record<string, unknown>, index: number): RectangleBoardElement {
  return {
    id: typeof raw.id === 'string' ? raw.id : createBoardElementId('rect'),
    type: 'rectangle',
    x: clampNumber(raw.x, 160),
    y: clampNumber(raw.y, 160),
    w: clampNumber(raw.w, 280, 20),
    h: clampNumber(raw.h, 180, 20),
    z: clampNumber(raw.z, index + 1),
    locked: Boolean(raw.locked),
    color: typeof raw.color === 'string' ? raw.color : '#8bd0ff',
    fill: typeof raw.fill === 'string' ? raw.fill : 'rgba(82, 148, 255, 0.12)',
    strokeWidth: clampNumber(raw.strokeWidth, 3, 1),
    radius: clampNumber(raw.radius, 18),
  }
}

function normalizeArrowElement(raw: Record<string, unknown>, index: number): ArrowBoardElement {
  return {
    id: typeof raw.id === 'string' ? raw.id : createBoardElementId('arrow'),
    type: 'arrow',
    x: clampNumber(raw.x, 180),
    y: clampNumber(raw.y, 180),
    w: clampNumber(raw.w, 260, 20),
    h: clampNumber(raw.h, 120, 20),
    z: clampNumber(raw.z, index + 1),
    locked: Boolean(raw.locked),
    color: typeof raw.color === 'string' ? raw.color : '#ffc86f',
    strokeWidth: clampNumber(raw.strokeWidth, 4, 1),
    flipX: Boolean(raw.flipX),
    flipY: Boolean(raw.flipY),
  }
}

export function normalizeBoardElement(rawElement: unknown, index: number): BoardElement {
  const raw = rawElement && typeof rawElement === 'object' ? (rawElement as Record<string, unknown>) : {}
  if (raw.type === 'highlighter') return normalizePenElement(raw, index, 'highlighter')
  if (raw.type === 'text') return normalizeTextElement(raw, index)
  if (raw.type === 'rectangle') return normalizeRectangleElement(raw, index)
  if (raw.type === 'arrow') return normalizeArrowElement(raw, index)
  return normalizePenElement(raw, index, 'pen')
}

export function normalizeSceneLayout(rawLayout: unknown): SceneBoardLayout {
  const layout = rawLayout && typeof rawLayout === 'object' ? (rawLayout as Record<string, unknown>) : {}
  const rawViewport =
    layout.viewport && typeof layout.viewport === 'object' ? (layout.viewport as Record<string, unknown>) : {}
  const viewport: SceneViewport = {
    width: clampNumber(rawViewport.width, DEFAULT_VIEWPORT.width, 480),
    height: clampNumber(rawViewport.height, DEFAULT_VIEWPORT.height, 320),
    gridSize: clampNumber(rawViewport.gridSize, DEFAULT_VIEWPORT.gridSize, 8),
    showGrid: rawViewport.showGrid === undefined ? DEFAULT_VIEWPORT.showGrid : Boolean(rawViewport.showGrid),
    background: typeof rawViewport.background === 'string' ? rawViewport.background : DEFAULT_VIEWPORT.background,
  }
  const elements = Array.isArray(layout.board_elements) ? layout.board_elements.map(normalizeBoardElement) : []
  const tldraw_snapshot = 'tldraw_snapshot' in layout ? (layout as Record<string, unknown>).tldraw_snapshot : undefined
  return {
    viewport,
    board_elements: elements.sort((left, right) => left.z - right.z),
    ...(tldraw_snapshot !== undefined ? { tldraw_snapshot } : {}),
  }
}

export function buildSceneLayout(layout: SceneBoardLayout): SceneBoardLayout {
  return {
    viewport: { ...layout.viewport },
    board_elements: layout.board_elements
      .map((element, index) => normalizeBoardElement(element, index))
      .sort((left, right) => left.z - right.z),
    ...(layout.tldraw_snapshot !== undefined ? { tldraw_snapshot: layout.tldraw_snapshot } : {}),
  }
}

export function nextLayer(items: Array<{ z: number }>) {
  return items.reduce((max, item) => Math.max(max, item.z), 0) + 1
}
