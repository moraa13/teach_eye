import { memo, useMemo, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { normalizeSceneLayout, type BoardElement, type WidgetLayout } from './sceneLayout'

export type CanvasWidget = {
  id: number | string
  layout: WidgetLayout
  content: ReactNode
  selected?: boolean
  className?: string
  onPointerDown?: (event: ReactPointerEvent<HTMLDivElement>) => void
  onClick?: () => void
}

function renderArrow(element: Extract<BoardElement, { type: 'arrow' }>) {
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

function renderDrawing(element: Extract<BoardElement, { type: 'pen' | 'highlighter' }>) {
  return (
    <svg width={element.w} height={element.h} viewBox={`0 0 ${element.w} ${element.h}`} preserveAspectRatio="none">
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

const BoardElementNode = memo(function BoardElementNode({
  element,
  selected,
  onClick,
  onDoubleClick,
  onPointerDown,
}: {
  element: BoardElement
  selected?: boolean
  onClick?: () => void
  onDoubleClick?: () => void
  onPointerDown?: (event: ReactPointerEvent<HTMLDivElement>) => void
}) {
  const className = `lesson-scene-element ${selected ? 'selected' : ''} ${element.locked ? 'locked' : ''}`
  if (element.type === 'text') {
    return (
      <div
        className={className}
        style={{
          left: element.x,
          top: element.y,
          width: element.w,
          minHeight: element.h,
          zIndex: element.z,
          color: element.color,
          fontSize: element.fontSize,
          textAlign: element.align,
        }}
        onClick={(event) => {
          event.stopPropagation()
          onClick?.()
        }}
        onDoubleClick={(event) => {
          event.stopPropagation()
          onDoubleClick?.()
        }}
        onPointerDown={(event) => {
          event.stopPropagation()
          onPointerDown?.(event)
        }}
      >
        <div className="lesson-scene-text">{element.text}</div>
      </div>
    )
  }

  return (
    <div
      className={className}
      style={{
        left: element.x,
        top: element.y,
        width: element.w,
        height: element.h,
        zIndex: element.z,
      }}
      onClick={(event) => {
        event.stopPropagation()
        onClick?.()
      }}
      onDoubleClick={(event) => {
        event.stopPropagation()
        onDoubleClick?.()
      }}
      onPointerDown={(event) => {
        event.stopPropagation()
        onPointerDown?.(event)
      }}
    >
      {element.type === 'rectangle' ? (
        <div
          className="lesson-scene-rect"
          style={{
            borderColor: element.color,
            background: element.fill,
            borderWidth: element.strokeWidth,
            borderRadius: element.radius,
          }}
        />
      ) : null}
      {element.type === 'arrow' ? renderArrow(element) : null}
      {element.type === 'pen' || element.type === 'highlighter' ? renderDrawing(element) : null}
    </div>
  )
})

export function LessonSceneCanvas({
  rawLayout,
  widgets,
  mode = 'teacher-live',
  selectedElementId,
  selectedWidgetId,
  onSelectElement,
  onElementDoubleClick,
  onElementPointerDown,
  onCanvasPointerDown,
  onCanvasClick,
  hiddenElementId,
  previewElement,
  previewElementSelected = false,
  overlay,
  className = '',
}: {
  rawLayout: unknown
  widgets: CanvasWidget[]
  mode?: 'teacher-edit' | 'teacher-live' | 'student-interactive' | 'student-spectator'
  selectedElementId?: string | null
  selectedWidgetId?: number | string | null
  onSelectElement?: (elementId: string) => void
  onElementDoubleClick?: (elementId: string) => void
  onElementPointerDown?: (elementId: string, event: ReactPointerEvent<HTMLDivElement>) => void
  onCanvasPointerDown?: (event: ReactPointerEvent<HTMLDivElement>) => void
  onCanvasClick?: () => void
  hiddenElementId?: string | null
  previewElement?: BoardElement | null
  previewElementSelected?: boolean
  overlay?: ReactNode
  className?: string
}) {
  const layout = normalizeSceneLayout(rawLayout)
  const visibleElements = useMemo(
    () => layout.board_elements.filter((element) => element.id !== hiddenElementId),
    [hiddenElementId, layout.board_elements],
  )
  const sortedWidgets = useMemo(
    () => widgets.slice().sort((left, right) => left.layout.z - right.layout.z),
    [widgets],
  )
  return (
    <div className={`lesson-scene-canvas-shell lesson-scene-mode-${mode} ${className}`.trim()} data-canvas-mode={mode}>
      <div
        className="lesson-scene-canvas"
        style={{
          width: layout.viewport.width,
          height: layout.viewport.height,
          background: layout.viewport.background,
          '--scene-grid-size': `${layout.viewport.gridSize}px`,
        } as CSSProperties}
        onPointerDown={onCanvasPointerDown}
        onClick={onCanvasClick}
      >
        {layout.viewport.showGrid ? <div className="lesson-scene-grid" /> : null}
        <div className="lesson-scene-layer lesson-scene-board-layer">
          {visibleElements.map((element) => (
            <BoardElementNode
              key={element.id}
              element={element}
              selected={selectedElementId === element.id}
              onClick={onSelectElement ? () => onSelectElement(element.id) : undefined}
              onDoubleClick={onElementDoubleClick ? () => onElementDoubleClick(element.id) : undefined}
              onPointerDown={onElementPointerDown ? (event) => onElementPointerDown(element.id, event) : undefined}
            />
          ))}
          {previewElement ? (
            <BoardElementNode
              key={`preview-${previewElement.id}`}
              element={previewElement}
              selected={previewElementSelected}
              onClick={previewElement.type !== 'text' ? undefined : onSelectElement ? () => onSelectElement(previewElement.id) : undefined}
              onDoubleClick={
                previewElement.type !== 'text'
                  ? undefined
                  : onElementDoubleClick
                    ? () => onElementDoubleClick(previewElement.id)
                    : undefined
              }
              onPointerDown={
                onElementPointerDown && previewElement.type !== 'text'
                  ? (event) => onElementPointerDown(previewElement.id, event)
                  : undefined
              }
            />
          ) : null}
        </div>
        <div className="lesson-scene-layer lesson-scene-widget-layer">
          {sortedWidgets.map((widget) => (
              <div
                key={widget.id}
                className={`lesson-scene-widget ${widget.selected ? 'selected' : ''} ${widget.className ?? ''}`.trim()}
                style={{
                  left: widget.layout.x,
                  top: widget.layout.y,
                  width: widget.layout.w,
                  height: widget.layout.h,
                  zIndex: widget.layout.z,
                }}
                onPointerDown={(event) => {
                  event.stopPropagation()
                  widget.onPointerDown?.(event)
                }}
                onClick={(event) => {
                  event.stopPropagation()
                  widget.onClick?.()
                }}
              >
                {widget.content}
                {selectedWidgetId === widget.id ? <div className="lesson-scene-selection-frame" /> : null}
              </div>
            ))}
        </div>
        {overlay ? <div className="lesson-scene-layer lesson-scene-overlay-layer">{overlay}</div> : null}
      </div>
    </div>
  )
}
