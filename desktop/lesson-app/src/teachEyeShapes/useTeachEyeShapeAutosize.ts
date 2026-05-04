import { useLayoutEffect, useRef } from 'react'
import type { Editor } from 'tldraw'

const EPS = 2

/**
 * Подгоняет props.w / props.h бокс-шейпа под фактический размер DOM (контент «всегда помещается»).
 */
export function useTeachEyeShapeAutosize(
  editor: Editor,
  shapeId: string,
  shapeType: string,
  opts?: { minW?: number; minH?: number },
) {
  const ref = useRef<HTMLDivElement>(null)
  const minW = opts?.minW ?? 200
  const minH = opts?.minH ?? 64

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    let raf = 0

    const measure = () => {
      const rect = el.getBoundingClientRect()
      const nw = Math.max(minW, Math.ceil(rect.width))
      const nh = Math.max(minH, Math.ceil(rect.height))
      const cur = editor.getShape(shapeId as any) as { props: { w: number; h: number } & Record<string, unknown> } | undefined
      if (!cur) return
      const pw = cur.props.w
      const ph = cur.props.h
      if (Math.abs(nw - pw) > EPS || Math.abs(nh - ph) > EPS) {
        editor.updateShape({
          id: shapeId as any,
          type: shapeType as any,
          props: { ...cur.props, w: nw, h: nh },
        } as any)
      }
    }

    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(measure)
    })
    ro.observe(el)
    measure()
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [editor, shapeId, shapeType, minW, minH])

  return ref
}
