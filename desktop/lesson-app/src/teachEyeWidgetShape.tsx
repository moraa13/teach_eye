import { BaseBoxShapeUtil, HTMLContainer, T, toDomPrecision } from 'tldraw'
import { createShapePropsMigrationSequence } from '@tldraw/tlschema'

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

export class TeachEyeWidgetShapeUtil extends BaseBoxShapeUtil<any> {
  static override type = TEACH_EYE_WIDGET_SHAPE_TYPE
  static override props = teachEyeWidgetProps
  static override migrations = teachEyeWidgetMigrations

  override isAspectRatioLocked() {
    return false
  }

  override getDefaultProps(): TeachEyeWidgetShapeProps {
    return {
      w: 400,
      h: 220,
      widgetId: 0,
      widgetType: 'unknown',
      title: 'Виджет',
      configJson: '{}',
    }
  }

  override getAriaDescriptor(shape: { props: TeachEyeWidgetShapeProps }) {
    return `${shape.props.title} • ${shape.props.widgetType}`
  }

  override component(shape: { id: string; props: TeachEyeWidgetShapeProps }) {
    const { w, h, title, widgetType } = shape.props
    return (
      <HTMLContainer id={shape.id} style={{ width: w, height: h, pointerEvents: 'all' }}>
        <div
          className="teach-eye-widget-shape-card"
          style={{
            width: '100%',
            height: '100%',
            boxSizing: 'border-box',
            borderRadius: 14,
            padding: 12,
            border: '1px solid rgba(255,255,255,0.12)',
            background: 'rgba(7, 12, 22, 0.88)',
            color: '#e8f0ff',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            overflow: 'hidden',
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
            <strong style={{ fontSize: 14, lineHeight: 1.2 }}>{title || 'Виджет'}</strong>
            <span style={{ fontSize: 11, opacity: 0.75 }}>{widgetType}</span>
          </div>
          <div style={{ fontSize: 12, opacity: 0.72, lineHeight: 1.35 }}>
            Учебный виджет TeachEye (перетаскивается и масштабируется вместе с доской).
          </div>
        </div>
      </HTMLContainer>
    )
  }

  override indicator(shape: { props: TeachEyeWidgetShapeProps }) {
    return (
      <rect width={toDomPrecision(shape.props.w)} height={toDomPrecision(shape.props.h)} rx={14} ry={14} />
    )
  }
}
