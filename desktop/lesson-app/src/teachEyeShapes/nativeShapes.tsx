/* eslint-disable @typescript-eslint/no-explicit-any */
import type { PointerEvent as ReactPointerEvent } from 'react'
import { BaseBoxShapeUtil, HTMLContainer, T, toDomPrecision, useEditor, useValue } from 'tldraw'
import { createShapePropsMigrationSequence } from '@tldraw/tlschema'
import {
  TEACH_EYE_BINARY_DEC_TYPE,
  TEACH_EYE_CODE_PUZZLE_TYPE,
  TEACH_EYE_MATCHING_TYPE,
  TEACH_EYE_MULTIPLE_CHOICE_TYPE,
  TEACH_EYE_ORDERING_TYPE,
} from './constants'
import { safeParseJsonArray } from './lessonBridge'
import { useTeachEyeShapeAutosize } from './useTeachEyeShapeAutosize'

type CheckState = 'idle' | 'ok' | 'bad'

function blockCanvasPointer(e: ReactPointerEvent) {
  e.stopPropagation()
}

function CheckBar({
  checkState,
  onCheck,
}: {
  checkState: CheckState
  onCheck: () => void
}) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-white/10 pt-2">
      <button
        type="button"
        className="rounded-md bg-sky-600 px-3 py-1.5 text-sm font-semibold text-white shadow hover:bg-sky-500"
        onPointerDown={blockCanvasPointer}
        onClick={(e) => {
          e.stopPropagation()
          onCheck()
        }}
      >
        Проверить
      </button>
      {checkState === 'ok' ? <span className="text-sm font-medium text-emerald-400">Верно</span> : null}
      {checkState === 'bad' ? <span className="text-sm font-medium text-red-400">Неверно</span> : null}
    </div>
  )
}

// --- Multiple choice ---

type McProps = {
  w: number
  h: number
  widgetId: number
  title: string
  question: string
  optionsJson: string
  correctIndex: number
  selectedIndex: number
  checkState: string
}

export class TeachEyeMultipleChoiceShapeUtil extends BaseBoxShapeUtil<any> {
  static override type = TEACH_EYE_MULTIPLE_CHOICE_TYPE
  static override props = {
    w: T.nonZeroNumber,
    h: T.nonZeroNumber,
    widgetId: T.number,
    title: T.string,
    question: T.string,
    optionsJson: T.string,
    correctIndex: T.number,
    selectedIndex: T.number,
    checkState: T.string,
  }
  static override migrations = createShapePropsMigrationSequence({ sequence: [] })

  override isAspectRatioLocked() {
    return false
  }

  override getDefaultProps(): McProps {
    return {
      w: 280,
      h: 140,
      widgetId: 0,
      title: 'Вопрос',
      question: '',
      optionsJson: JSON.stringify(['A', 'B', 'C']),
      correctIndex: 0,
      selectedIndex: -1,
      checkState: 'idle',
    }
  }

  override component(shape: { id: string; props: McProps }) {
    return (
      <HTMLContainer
        style={{ width: shape.props.w, height: shape.props.h, pointerEvents: 'all', overflow: 'visible' }}
      >
        <McInner shapeId={shape.id} />
      </HTMLContainer>
    )
  }

  override indicator(shape: McProps & { w: number; h: number }) {
    return <rect width={toDomPrecision(shape.w)} height={toDomPrecision(shape.h)} rx={8} ry={8} />
  }
}

function McInner({ shapeId }: { shapeId: string }) {
  const editor = useEditor()
  const rootRef = useTeachEyeShapeAutosize(editor, shapeId, TEACH_EYE_MULTIPLE_CHOICE_TYPE, { minW: 240, minH: 96 })
  const props = useValue(
    `teach-eye-mc-${shapeId}`,
    () => {
      const s = editor.getShape(shapeId as any) as unknown as { type: string; props: McProps } | null
      return s && s.type === TEACH_EYE_MULTIPLE_CHOICE_TYPE ? s.props : null
    },
    [editor, shapeId],
  )
  if (!props) return null
  const options = safeParseJsonArray<string>(props.optionsJson, [])
  const ring = props.checkState === 'ok' ? 'ring-2 ring-emerald-500' : props.checkState === 'bad' ? 'ring-2 ring-red-500' : ''

  const patch = (p: Partial<McProps>) =>
    editor.updateShape({
      id: shapeId as any,
      type: TEACH_EYE_MULTIPLE_CHOICE_TYPE as any,
      props: { ...props, ...p },
    } as any)

  return (
    <div
      ref={rootRef}
      className={`inline-flex min-w-full max-w-full flex-col rounded-lg border border-white/15 bg-slate-900/95 p-3 text-slate-100 shadow-lg ${ring}`}
      onPointerDown={blockCanvasPointer}
    >
      <div className="text-xs font-semibold uppercase tracking-wide text-sky-300/90">{props.title}</div>
      <p className="mt-1 text-sm text-slate-200">{props.question}</p>
      <div className="mt-2 flex flex-col gap-1.5">
        {options.map((opt, i) => (
          <label
            key={i}
            className="flex cursor-pointer items-center gap-2 rounded-md border border-white/10 bg-white/5 px-2 py-1.5 hover:bg-white/10"
          >
            <input
              type="radio"
              name={`mc-${shapeId}`}
              checked={props.selectedIndex === i}
              onChange={() => patch({ selectedIndex: i, checkState: 'idle' })}
              className="accent-sky-500"
            />
            <span className="text-sm">{opt}</span>
          </label>
        ))}
      </div>
      <CheckBar
        checkState={props.checkState as CheckState}
        onCheck={() => {
          const ok = props.selectedIndex === props.correctIndex
          patch({ checkState: ok ? 'ok' : 'bad' })
        }}
      />
    </div>
  )
}

// --- Binary decomposition ---

type BinProps = {
  w: number
  h: number
  widgetId: number
  title: string
  targetNumber: number
  weightsJson: string
  bitsJson: string
  checkState: string
}

export class TeachEyeBinaryDecShapeUtil extends BaseBoxShapeUtil<any> {
  static override type = TEACH_EYE_BINARY_DEC_TYPE
  static override props = {
    w: T.nonZeroNumber,
    h: T.nonZeroNumber,
    widgetId: T.number,
    title: T.string,
    targetNumber: T.number,
    weightsJson: T.string,
    bitsJson: T.string,
    checkState: T.string,
  }
  static override migrations = createShapePropsMigrationSequence({ sequence: [] })

  override isAspectRatioLocked() {
    return false
  }

  override getDefaultProps(): BinProps {
    const weights = [128, 64, 32, 16, 8, 4, 2, 1]
    return {
      w: 360,
      h: 140,
      widgetId: 0,
      title: 'Двоичное разложение',
      targetNumber: 13,
      weightsJson: JSON.stringify(weights),
      bitsJson: JSON.stringify(weights.map(() => 0)),
      checkState: 'idle',
    }
  }

  override component(shape: { id: string; props: BinProps }) {
    return (
      <HTMLContainer
        style={{ width: shape.props.w, height: shape.props.h, pointerEvents: 'all', overflow: 'visible' }}
      >
        <BinInner shapeId={shape.id} />
      </HTMLContainer>
    )
  }

  override indicator(shape: BinProps & { w: number; h: number }) {
    return <rect width={toDomPrecision(shape.w)} height={toDomPrecision(shape.h)} rx={8} ry={8} />
  }
}

function normalizeBinBits(raw: unknown[], len: number): (0 | 1)[] {
  const out: (0 | 1)[] = []
  for (let i = 0; i < len; i++) {
    const v = raw[i]
    out.push(v === 1 ? 1 : 0)
  }
  return out
}

function BinInner({ shapeId }: { shapeId: string }) {
  const editor = useEditor()
  const rootRef = useTeachEyeShapeAutosize(editor, shapeId, TEACH_EYE_BINARY_DEC_TYPE, { minW: 300, minH: 120 })
  const props = useValue(
    `teach-eye-bin-${shapeId}`,
    () => {
      const s = editor.getShape(shapeId as any) as unknown as { type: string; props: BinProps } | null
      return s && s.type === TEACH_EYE_BINARY_DEC_TYPE ? s.props : null
    },
    [editor, shapeId],
  )
  if (!props) return null
  const weights = safeParseJsonArray<number>(props.weightsJson, [8, 4, 2, 1])
  const parsed = safeParseJsonArray<unknown>(props.bitsJson, weights.map(() => 0))
  const bits = normalizeBinBits(parsed, weights.length)
  const ring = props.checkState === 'ok' ? 'ring-2 ring-emerald-500' : props.checkState === 'bad' ? 'ring-2 ring-red-500' : ''
  const patch = (p: Partial<BinProps>) =>
    editor.updateShape({
      id: shapeId as any,
      type: TEACH_EYE_BINARY_DEC_TYPE as any,
      props: { ...props, ...p },
    } as any)

  const sum = bits.reduce<number>((acc, b, i) => acc + (b === 1 ? weights[i]! : 0), 0)

  return (
    <div
      ref={rootRef}
      className={`inline-flex min-w-full max-w-full flex-col rounded-lg border border-white/15 bg-slate-900/95 p-3 text-slate-100 shadow-lg ${ring}`}
      onPointerDown={blockCanvasPointer}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-sky-300/90">{props.title}</span>
        <span className="text-xs text-slate-400">
          Цель: <strong className="text-slate-100">{props.targetNumber}</strong> · Сейчас:{' '}
          <strong className="text-slate-100">{sum}</strong>
        </span>
      </div>
      <div className="mt-2 flex w-max max-w-full flex-nowrap gap-1">
        {weights.map((w, i) => (
          <button
            key={i}
            type="button"
            className="flex h-[56px] w-11 shrink-0 flex-col items-center justify-center rounded-md border border-white/15 bg-white/5 px-1 py-1 text-sm hover:bg-white/10"
            onClick={() => {
              const next = [...bits]
              next[i] = next[i] === 1 ? 0 : 1
              patch({ bitsJson: JSON.stringify(next), checkState: 'idle' })
            }}
          >
            <span className="text-lg font-bold leading-none">{bits[i]}</span>
            <span className="mt-0.5 text-[10px] leading-none text-slate-500">{w}</span>
          </button>
        ))}
      </div>
      <CheckBar
        checkState={props.checkState as CheckState}
        onCheck={() => {
          const ok = sum === props.targetNumber
          if (!ok) {
            patch({ checkState: 'bad' })
            return
          }
          const modulus = 2 ** weights.length
          const nextTarget = Math.floor(Math.random() * modulus)
          patch({
            targetNumber: nextTarget,
            bitsJson: JSON.stringify(weights.map(() => 0)),
            checkState: 'idle',
          })
        }}
      />
    </div>
  )
}

// --- Matching ---

type MatProps = {
  w: number
  h: number
  widgetId: number
  title: string
  leftItemsJson: string
  rightItemsJson: string
  correctPairsJson: string
  connectionsJson: string
  pendingLeftIndex: number
  checkState: string
}

export class TeachEyeMatchingShapeUtil extends BaseBoxShapeUtil<any> {
  static override type = TEACH_EYE_MATCHING_TYPE
  static override props = {
    w: T.nonZeroNumber,
    h: T.nonZeroNumber,
    widgetId: T.number,
    title: T.string,
    leftItemsJson: T.string,
    rightItemsJson: T.string,
    correctPairsJson: T.string,
    connectionsJson: T.string,
    pendingLeftIndex: T.number,
    checkState: T.string,
  }
  static override migrations = createShapePropsMigrationSequence({ sequence: [] })

  override isAspectRatioLocked() {
    return false
  }

  override getDefaultProps(): MatProps {
    return {
      w: 360,
      h: 200,
      widgetId: 0,
      title: 'Пары',
      leftItemsJson: JSON.stringify(['A', 'B']),
      rightItemsJson: JSON.stringify(['1', '2']),
      correctPairsJson: JSON.stringify([
        [0, 0],
        [1, 1],
      ]),
      connectionsJson: JSON.stringify([]),
      pendingLeftIndex: -1,
      checkState: 'idle',
    }
  }

  override component(shape: { id: string; props: MatProps }) {
    return (
      <HTMLContainer
        style={{ width: shape.props.w, height: shape.props.h, pointerEvents: 'all', overflow: 'visible' }}
      >
        <MatInner shapeId={shape.id} />
      </HTMLContainer>
    )
  }

  override indicator(shape: MatProps & { w: number; h: number }) {
    return <rect width={toDomPrecision(shape.w)} height={toDomPrecision(shape.h)} rx={8} ry={8} />
  }
}

function samePairs(a: [number, number][], b: [number, number][]) {
  if (a.length !== b.length) return false
  const norm = (p: [number, number][]) => [...p].sort((x, y) => x[0] - y[0] || x[1] - y[1])
  const A = norm(a)
  const B = norm(b)
  return A.every((p, i) => p[0] === B[i]![0] && p[1] === B[i]![1])
}

function MatInner({ shapeId }: { shapeId: string }) {
  const editor = useEditor()
  const rootRef = useTeachEyeShapeAutosize(editor, shapeId, TEACH_EYE_MATCHING_TYPE, { minW: 280, minH: 120 })
  const props = useValue(
    `teach-eye-mat-${shapeId}`,
    () => {
      const s = editor.getShape(shapeId as any) as unknown as { type: string; props: MatProps } | null
      return s && s.type === TEACH_EYE_MATCHING_TYPE ? s.props : null
    },
    [editor, shapeId],
  )
  if (!props) return null
  const left = safeParseJsonArray<string>(props.leftItemsJson, [])
  const right = safeParseJsonArray<string>(props.rightItemsJson, [])
  const correct = safeParseJsonArray<[number, number]>(props.correctPairsJson, [])
  const connections = safeParseJsonArray<[number, number]>(props.connectionsJson, [])
  const ring = props.checkState === 'ok' ? 'ring-2 ring-emerald-500' : props.checkState === 'bad' ? 'ring-2 ring-red-500' : ''
  const patch = (p: Partial<MatProps>) =>
    editor.updateShape({
      id: shapeId as any,
      type: TEACH_EYE_MATCHING_TYPE as any,
      props: { ...props, ...p },
    } as any)

  const nL = Math.max(1, left.length)
  const nR = Math.max(1, right.length)

  return (
    <div
      ref={rootRef}
      className={`relative inline-flex min-w-full max-w-full flex-col rounded-lg border border-white/15 bg-slate-900/95 p-2 text-slate-100 shadow-lg ${ring}`}
      onPointerDown={blockCanvasPointer}
    >
      <div className="text-xs font-semibold uppercase tracking-wide text-sky-300/90">{props.title}</div>
      <div className="relative z-0 mt-1 inline-flex w-max max-w-full gap-6">
        <svg
          className="pointer-events-none absolute inset-0 z-0 h-full w-full"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden
        >
          {connections.map(([li, ri], idx) => (
            <line
              key={idx}
              x1={36}
              y1={((li + 0.5) / nL) * 100}
              x2={64}
              y2={((ri + 0.5) / nR) * 100}
              stroke="rgb(56, 189, 248)"
              strokeWidth={1.2}
              vectorEffect="non-scaling-stroke"
              opacity={0.9}
            />
          ))}
        </svg>
        <div className="relative z-10 flex min-w-0 gap-4">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            {left.map((t, i) => (
              <button
                key={i}
                type="button"
                className={`rounded-md border px-2 py-1 text-left text-sm ${
                  props.pendingLeftIndex === i ? 'border-sky-400 bg-sky-500/20' : 'border-white/10 bg-white/5 hover:bg-white/10'
                }`}
                onClick={() => patch({ pendingLeftIndex: i, checkState: 'idle' })}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            {right.map((t, i) => (
              <button
                key={i}
                type="button"
                className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-left text-sm hover:bg-white/10"
                onClick={() => {
                  if (props.pendingLeftIndex < 0) return
                  const next = connections.filter((c) => c[0] !== props.pendingLeftIndex)
                  next.push([props.pendingLeftIndex, i])
                  patch({ connectionsJson: JSON.stringify(next), pendingLeftIndex: -1, checkState: 'idle' })
                }}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      </div>
      <CheckBar
        checkState={props.checkState as CheckState}
        onCheck={() => patch({ checkState: samePairs(connections, correct) ? 'ok' : 'bad' })}
      />
    </div>
  )
}

// --- Ordering ---

type OrdProps = {
  w: number
  h: number
  widgetId: number
  title: string
  itemsJson: string
  orderIdsJson: string
  correctOrderJson: string
  checkState: string
}

export class TeachEyeOrderingShapeUtil extends BaseBoxShapeUtil<any> {
  static override type = TEACH_EYE_ORDERING_TYPE
  static override props = {
    w: T.nonZeroNumber,
    h: T.nonZeroNumber,
    widgetId: T.number,
    title: T.string,
    itemsJson: T.string,
    orderIdsJson: T.string,
    correctOrderJson: T.string,
    checkState: T.string,
  }
  static override migrations = createShapePropsMigrationSequence({ sequence: [] })

  override isAspectRatioLocked() {
    return false
  }

  override getDefaultProps(): OrdProps {
    return {
      w: 300,
      h: 160,
      widgetId: 0,
      title: 'Порядок',
      itemsJson: JSON.stringify([
        { id: 'a', text: 'Шаг 1' },
        { id: 'b', text: 'Шаг 2' },
      ]),
      orderIdsJson: JSON.stringify(['b', 'a']),
      correctOrderJson: JSON.stringify(['a', 'b']),
      checkState: 'idle',
    }
  }

  override component(shape: { id: string; props: OrdProps }) {
    return (
      <HTMLContainer
        style={{ width: shape.props.w, height: shape.props.h, pointerEvents: 'all', overflow: 'visible' }}
      >
        <OrdInner shapeId={shape.id} />
      </HTMLContainer>
    )
  }

  override indicator(shape: OrdProps & { w: number; h: number }) {
    return <rect width={toDomPrecision(shape.w)} height={toDomPrecision(shape.h)} rx={8} ry={8} />
  }
}

function OrdInner({ shapeId }: { shapeId: string }) {
  const editor = useEditor()
  const rootRef = useTeachEyeShapeAutosize(editor, shapeId, TEACH_EYE_ORDERING_TYPE, { minW: 260, minH: 120 })
  const props = useValue(
    `teach-eye-ord-${shapeId}`,
    () => {
      const s = editor.getShape(shapeId as any) as unknown as { type: string; props: OrdProps } | null
      return s && s.type === TEACH_EYE_ORDERING_TYPE ? s.props : null
    },
    [editor, shapeId],
  )
  if (!props) return null
  const items = safeParseJsonArray<{ id: string; text: string }>(props.itemsJson, [])
  const byId = new Map(items.map((it) => [it.id, it]))
  let order = safeParseJsonArray<string>(props.orderIdsJson, [])
  order = order.filter((id) => byId.has(id))
  const correct = safeParseJsonArray<string>(props.correctOrderJson, [])
  const ring = props.checkState === 'ok' ? 'ring-2 ring-emerald-500' : props.checkState === 'bad' ? 'ring-2 ring-red-500' : ''
  const patch = (p: Partial<OrdProps>) =>
    editor.updateShape({
      id: shapeId as any,
      type: TEACH_EYE_ORDERING_TYPE as any,
      props: { ...props, ...p },
    } as any)

  const move = (idx: number, dir: -1 | 1) => {
    const j = idx + dir
    if (j < 0 || j >= order.length) return
    const next = [...order]
    ;[next[idx], next[j]] = [next[j]!, next[idx]!]
    patch({ orderIdsJson: JSON.stringify(next), checkState: 'idle' })
  }

  const orderedItems = order.map((id) => byId.get(id)).filter(Boolean) as { id: string; text: string }[]

  return (
    <div
      ref={rootRef}
      className={`inline-flex min-w-full max-w-full flex-col rounded-lg border border-white/15 bg-slate-900/95 p-3 text-slate-100 shadow-lg ${ring}`}
      onPointerDown={blockCanvasPointer}
    >
      <div className="text-xs font-semibold uppercase tracking-wide text-sky-300/90">{props.title}</div>
      <div className="mt-2 flex flex-col gap-1">
        {orderedItems.map((it, idx) => (
          <div key={it.id} className="flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-1">
            <div className="flex flex-1 flex-col gap-0.5">
              <span className="text-[10px] text-slate-500">{idx + 1}</span>
              <span className="text-sm">{it.text}</span>
            </div>
            <button
              type="button"
              className="rounded bg-white/10 px-1.5 py-0.5 text-xs hover:bg-white/20"
              onClick={() => move(idx, -1)}
            >
              ↑
            </button>
            <button
              type="button"
              className="rounded bg-white/10 px-1.5 py-0.5 text-xs hover:bg-white/20"
              onClick={() => move(idx, 1)}
            >
              ↓
            </button>
          </div>
        ))}
      </div>
      <CheckBar
        checkState={props.checkState as CheckState}
        onCheck={() =>
          patch({
            checkState: order.length === correct.length && order.every((id, i) => id === correct[i]) ? 'ok' : 'bad',
          })
        }
      />
    </div>
  )
}

// --- Code puzzle ---

type CpProps = {
  w: number
  h: number
  widgetId: number
  title: string
  snippetsJson: string
  assemblyJson: string
  solution: string
  checkState: string
}

export class TeachEyeCodePuzzleShapeUtil extends BaseBoxShapeUtil<any> {
  static override type = TEACH_EYE_CODE_PUZZLE_TYPE
  static override props = {
    w: T.nonZeroNumber,
    h: T.nonZeroNumber,
    widgetId: T.number,
    title: T.string,
    snippetsJson: T.string,
    assemblyJson: T.string,
    solution: T.string,
    checkState: T.string,
  }
  static override migrations = createShapePropsMigrationSequence({ sequence: [] })

  override isAspectRatioLocked() {
    return false
  }

  override getDefaultProps(): CpProps {
    return {
      w: 360,
      h: 200,
      widgetId: 0,
      title: 'Код',
      snippetsJson: JSON.stringify(['a()', 'b()']),
      assemblyJson: JSON.stringify([]),
      solution: 'a()\nb()',
      checkState: 'idle',
    }
  }

  override component(shape: { id: string; props: CpProps }) {
    return (
      <HTMLContainer
        style={{ width: shape.props.w, height: shape.props.h, pointerEvents: 'all', overflow: 'visible' }}
      >
        <CpInner shapeId={shape.id} />
      </HTMLContainer>
    )
  }

  override indicator(shape: CpProps & { w: number; h: number }) {
    return <rect width={toDomPrecision(shape.w)} height={toDomPrecision(shape.h)} rx={8} ry={8} />
  }
}

function CpInner({ shapeId }: { shapeId: string }) {
  const editor = useEditor()
  const rootRef = useTeachEyeShapeAutosize(editor, shapeId, TEACH_EYE_CODE_PUZZLE_TYPE, { minW: 280, minH: 120 })
  const props = useValue(
    `teach-eye-cp-${shapeId}`,
    () => {
      const s = editor.getShape(shapeId as any) as unknown as { type: string; props: CpProps } | null
      return s && s.type === TEACH_EYE_CODE_PUZZLE_TYPE ? s.props : null
    },
    [editor, shapeId],
  )
  if (!props) return null
  const snippets = safeParseJsonArray<string>(props.snippetsJson, [])
  const assembly = safeParseJsonArray<string>(props.assemblyJson, [])
  const ring = props.checkState === 'ok' ? 'ring-2 ring-emerald-500' : props.checkState === 'bad' ? 'ring-2 ring-red-500' : ''
  const patch = (p: Partial<CpProps>) =>
    editor.updateShape({
      id: shapeId as any,
      type: TEACH_EYE_CODE_PUZZLE_TYPE as any,
      props: { ...props, ...p },
    } as any)
  const inBank = snippets.filter((s) => !assembly.includes(s))

  return (
    <div
      ref={rootRef}
      className={`inline-flex min-w-full max-w-full flex-col gap-2 rounded-lg border border-white/15 bg-slate-900/95 p-3 text-slate-100 shadow-lg ${ring}`}
      onPointerDown={blockCanvasPointer}
    >
      <div className="text-xs font-semibold uppercase tracking-wide text-sky-300/90">{props.title}</div>
      <div>
        <div className="text-[10px] uppercase text-slate-500">Банк</div>
        <div className="mt-1 flex flex-wrap gap-1">
          {inBank.map((s, i) => (
            <button
              key={`${s}-${i}`}
              type="button"
              className="rounded border border-violet-400/40 bg-violet-500/15 px-2 py-0.5 font-mono text-xs hover:bg-violet-500/25"
              onClick={() => patch({ assemblyJson: JSON.stringify([...assembly, s]), checkState: 'idle' })}
            >
              {s}
            </button>
          ))}
        </div>
      </div>
      <div className="rounded border border-white/10 bg-black/30 p-2">
        <div className="text-[10px] uppercase text-slate-500">Сборка</div>
        <ul className="mt-1 space-y-1 font-mono text-xs">
          {assembly.map((line, idx) => (
            <li key={idx} className="flex items-start justify-between gap-2 text-emerald-100/90">
              <span>{line}</span>
              <button
                type="button"
                className="shrink-0 text-red-400 hover:text-red-300"
                onClick={() => {
                  const next = assembly.filter((_, j) => j !== idx)
                  patch({ assemblyJson: JSON.stringify(next), checkState: 'idle' })
                }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      </div>
      <CheckBar
        checkState={props.checkState as CheckState}
        onCheck={() => {
          const built = assembly.join('\n').trim()
          const want = props.solution.trim()
          patch({ checkState: built === want ? 'ok' : 'bad' })
        }}
      />
    </div>
  )
}

export const TEACH_EYE_NATIVE_SHAPE_UTILS = [
  TeachEyeMultipleChoiceShapeUtil,
  TeachEyeBinaryDecShapeUtil,
  TeachEyeMatchingShapeUtil,
  TeachEyeOrderingShapeUtil,
  TeachEyeCodePuzzleShapeUtil,
] as const
