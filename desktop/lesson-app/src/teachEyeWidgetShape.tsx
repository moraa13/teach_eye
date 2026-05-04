import { type PointerEvent as ReactPointerEvent, type SyntheticEvent, useCallback, useMemo } from 'react'
import { BaseBoxShapeUtil, HTMLContainer, T, toDomPrecision, useEditor, useValue, type TLShape } from 'tldraw'
import { createShapePropsMigrationSequence } from '@tldraw/tlschema'
import type { Scene, Widget } from './lessonRuntimeModels'
import { formatPowerOfTwoNotation, renderBoardWidgetEditorPreview } from './boardWidgets'
import { useTeachEyeShapeAutosize } from './teachEyeShapes/useTeachEyeShapeAutosize'

export const TEACH_EYE_WIDGET_SHAPE_TYPE = 'teach-eye-widget' as const

export type TeachEyeWidgetShapeProps = {
  w: number
  h: number
  widgetId: number
  widgetType: string
  title: string
  configJson: string
}

const teachEyeWidgetProps = {
  w: T.nonZeroNumber,
  h: T.nonZeroNumber,
  widgetId: T.number,
  widgetType: T.string,
  title: T.string,
  configJson: T.string,
}

const teachEyeWidgetMigrations = createShapePropsMigrationSequence({ sequence: [] })

function absorbPointerForTldraw(e: SyntheticEvent) {
  e.stopPropagation()
}

type ShapeViewModel = { id: string; props: TeachEyeWidgetShapeProps }

function absorbPointerOnlyDown(e: ReactPointerEvent) {
  e.stopPropagation()
}

const STUB_SCENE: Scene = {
  id: 0,
  title: '',
  notes_text: '',
  widgets: [],
}

/** Только таблица 2ⁿ → число на доске учителя (заголовок шейпа — отдельно). */
function TeachEyePowersOfTwoSimplePreview({ config }: { config: Widget['config'] }) {
  const values = Array.isArray(config.values) ? (config.values as number[]) : [128, 64, 32, 16, 8, 4, 2, 1]
  return (
    <div className="teach-eye-powers-simple">
      <div className="teach-eye-powers-simple-table" role="table" aria-label="Степени двойки">
        <div className="teach-eye-powers-simple-row teach-eye-powers-simple-row-head" role="row">
          <span role="columnheader">Степень</span>
          <span role="columnheader">Значение</span>
        </div>
        {values.map((value, index) => {
          const exp = values.length - index - 1
          return (
            <div className="teach-eye-powers-simple-row" role="row" key={value}>
              <span role="cell" className="teach-eye-powers-simple-pow">
                {formatPowerOfTwoNotation(exp)}
              </span>
              <span role="cell" className="teach-eye-powers-simple-num">
                {value}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function widgetFromShapeProps(props: TeachEyeWidgetShapeProps): { widget: Widget | null; parseError: string | null } {
  try {
    const raw = JSON.parse(props.configJson || '{}')
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      return { widget: null, parseError: 'config должен быть объектом JSON.' }
    }
    return {
      widget: {
        id: props.widgetId,
        widget_type: props.widgetType,
        title: props.title,
        config: raw as Widget['config'],
      },
      parseError: null,
    }
  } catch {
    return { widget: null, parseError: 'Некорректный JSON в config.' }
  }
}

function TeachEyeWidgetShapeView({ shape }: { shape: ShapeViewModel }) {
  const editor = useEditor()
  const rootRef = useTeachEyeShapeAutosize(editor, shape.id, TEACH_EYE_WIDGET_SHAPE_TYPE, { minW: 260, minH: 100 })
  const isEditing = useValue(
    'teach-eye-widget-editing',
    () => editor.getEditingShapeId() === shape.id,
    [editor, shape.id],
  )

  const ensureEditingIfNeeded = useCallback(() => {
    if (editor.getEditingShapeId() === shape.id) return
    const full = editor.getShape(shape.id as TLShape['id'])
    if (!full) return
    if (!editor.canEditShape(full)) return
    editor.setEditingShape(full)
  }, [editor, shape.id])

  const onInteractivePointerDown = useCallback(
    (e: ReactPointerEvent) => {
      absorbPointerForTldraw(e)
      ensureEditingIfNeeded()
    },
    [ensureEditingIfNeeded],
  )

  const { title, widgetType } = shape.props
  const isPowersMinimalChrome = widgetType === 'powers_of_two_picker'

  const preview = useMemo(() => {
    const { widget, parseError } = widgetFromShapeProps(shape.props)
    if (parseError || !widget) {
      return <p className="teach-eye-widget-shape-help teach-eye-widget-shape-preview-error">{parseError || 'Нет данных'}</p>
    }
    if (widget.widget_type === 'powers_of_two_picker') {
      return <TeachEyePowersOfTwoSimplePreview config={widget.config} />
    }
    return renderBoardWidgetEditorPreview(STUB_SCENE, widget)
  }, [shape.props.configJson, shape.props.title, shape.props.widgetId, shape.props.widgetType])

  return (
    <div ref={rootRef} className="teach-eye-widget-shape-card">
      <div className="teach-eye-widget-shape-header">
        <strong className="teach-eye-widget-shape-title">{title || 'Виджет'}</strong>
        <span className="teach-eye-widget-shape-type">{widgetType}</span>
      </div>
      <div className={`teach-eye-widget-shape-body${isPowersMinimalChrome ? ' teach-eye-widget-shape-body--powers-minimal' : ''}`}>
        {!isPowersMinimalChrome ? (
          <p
            className="teach-eye-widget-shape-help"
            onPointerDown={absorbPointerOnlyDown}
            onPointerUp={absorbPointerForTldraw}
          >
            Тащите за заголовок. Клик по превью — вход в режим правки (двойной клик в tldraw). Настройка content — справа или
            через JSON.
          </p>
        ) : null}
        {isEditing ? (
          <div
            className="teach-eye-widget-shape-editing-badge"
            onPointerDown={absorbPointerOnlyDown}
            onPointerUp={absorbPointerForTldraw}
          >
            Режим правки (Esc — выход)
          </div>
        ) : null}
        <div
          className="teach-eye-widget-shape-interactive"
          onPointerDown={onInteractivePointerDown}
          onPointerUp={absorbPointerForTldraw}
          onClick={absorbPointerForTldraw}
        >
          <div className="teach-eye-widget-shape-preview-root">{preview}</div>
        </div>
      </div>
    </div>
  )
}

export class TeachEyeWidgetShapeUtil extends BaseBoxShapeUtil<any> {
  static override type = TEACH_EYE_WIDGET_SHAPE_TYPE
  static override props = teachEyeWidgetProps
  static override migrations = teachEyeWidgetMigrations

  override canEdit() {
    return true
  }

  override isAspectRatioLocked() {
    return false
  }

  override getDefaultProps(): TeachEyeWidgetShapeProps {
    return {
      w: 320,
      h: 160,
      widgetId: 0,
      widgetType: 'unknown',
      title: 'Виджет',
      configJson: '{}',
    }
  }

  override getAriaDescriptor(shape: { props: TeachEyeWidgetShapeProps }) {
    return `${shape.props.title} • ${shape.props.widgetType}`
  }

  override component(shape: ShapeViewModel) {
    const { w, h } = shape.props
    return (
      <HTMLContainer id={shape.id} style={{ width: w, height: h, pointerEvents: 'all', overflow: 'visible' }}>
        <div className="teach-eye-widget-shape-html-surface">
          <TeachEyeWidgetShapeView shape={shape} />
        </div>
      </HTMLContainer>
    )
  }

  override indicator(shape: { props: TeachEyeWidgetShapeProps }) {
    return (
      <rect width={toDomPrecision(shape.props.w)} height={toDomPrecision(shape.props.h)} rx={8} ry={8} />
    )
  }
}
