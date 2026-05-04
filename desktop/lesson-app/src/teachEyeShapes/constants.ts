import { TEACH_EYE_WIDGET_SHAPE_TYPE } from '../teachEyeWidgetShape'

/** Специализированные шейпы (данные в props). Старый `teach-eye-widget` — для powers / прочих. */
export const TEACH_EYE_MULTIPLE_CHOICE_TYPE = 'teach-eye-multiple-choice' as const
export const TEACH_EYE_BINARY_DEC_TYPE = 'teach-eye-binary-dec' as const
export const TEACH_EYE_MATCHING_TYPE = 'teach-eye-matching' as const
export const TEACH_EYE_ORDERING_TYPE = 'teach-eye-ordering' as const
export const TEACH_EYE_CODE_PUZZLE_TYPE = 'teach-eye-code-puzzle' as const

export const TEACH_EYE_NATIVE_SHAPE_TYPES = [
  TEACH_EYE_MULTIPLE_CHOICE_TYPE,
  TEACH_EYE_BINARY_DEC_TYPE,
  TEACH_EYE_MATCHING_TYPE,
  TEACH_EYE_ORDERING_TYPE,
  TEACH_EYE_CODE_PUZZLE_TYPE,
] as const

export type TeachEyeNativeShapeType = (typeof TEACH_EYE_NATIVE_SHAPE_TYPES)[number]

const _managed = new Set<string>([...TEACH_EYE_NATIVE_SHAPE_TYPES, TEACH_EYE_WIDGET_SHAPE_TYPE])

export function isTeachEyeManagedShapeType(type: string): boolean {
  return _managed.has(type)
}

export function widgetRuntimeTypeToShapeType(widgetType: string): string {
  switch (widgetType) {
    case 'multiple_choice':
      return TEACH_EYE_MULTIPLE_CHOICE_TYPE
    case 'binary_decomposition':
      return TEACH_EYE_BINARY_DEC_TYPE
    case 'match_pairs':
      return TEACH_EYE_MATCHING_TYPE
    case 'algorithm_steps':
      return TEACH_EYE_ORDERING_TYPE
    case 'code_puzzle':
      return TEACH_EYE_CODE_PUZZLE_TYPE
    default:
      return TEACH_EYE_WIDGET_SHAPE_TYPE
  }
}

export function shapeTypeToWidgetRuntimeType(shapeType: string, legacyPropsWidgetType?: string): string {
  switch (shapeType) {
    case TEACH_EYE_MULTIPLE_CHOICE_TYPE:
      return 'multiple_choice'
    case TEACH_EYE_BINARY_DEC_TYPE:
      return 'binary_decomposition'
    case TEACH_EYE_MATCHING_TYPE:
      return 'match_pairs'
    case TEACH_EYE_ORDERING_TYPE:
      return 'algorithm_steps'
    case TEACH_EYE_CODE_PUZZLE_TYPE:
      return 'code_puzzle'
    default:
      return legacyPropsWidgetType ?? 'widget'
  }
}
