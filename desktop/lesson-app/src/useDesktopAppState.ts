import { useCallback, useEffect, useMemo, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { buildBinaryValue, buildPowerModel, getInitialOrdering, getOrderingItems, type StudentWidgetCallbacks } from './boardWidgets'
import { buildSceneLayout, createBoardElementId } from './sceneLayout'
import type { Lesson, LessonRun, LessonSummary, Role, TeacherSurface, StatusKind, WindowKind } from './appTypes'
import {
  normalizeLesson,
  normalizeLessonRun,
  normalizeParticipant,
  normalizeParticipantInspection,
  type Participant,
  type ParticipantInspection,
  type Widget,
} from './lessonRuntimeModels'

const DEBUG_APP_LOGS = false

type LoginResponse = {
  session_id: number
  session_display_code: string
}

export const DEFAULT_API_BASE = 'http://127.0.0.1:8000'

const API_BASE_STORAGE_KEY = 'teachereye.desktop.apiBase'
const RUN_STORAGE_KEY = 'teachereye.desktop.currentRunId'
const SESSION_STORAGE_KEY = 'teachereye.desktop.currentSessionId'
const TEACHER_CONTEXT_STORAGE_KEY = 'teachereye.desktop.teacherContext'
const TEACHER_EDITOR_DRAFT_STORAGE_KEY = 'teachereye.desktop.teacherEditorDraft'
const STUDENT_CONTEXT_STORAGE_KEY = 'teachereye.desktop.studentContext'
const DEFAULT_LAN_API_BASE = 'http://192.168.0.10:8000'

declare global {
  interface Window {
    __TEACHEYE_WINDOW_PARAMS__?: {
      role?: string
      surface?: string
    }
  }
}

function getWindowParams() {
  const injectedParams = window.__TEACHEYE_WINDOW_PARAMS__
  // Extra windows use hash (#role=...&surface=...): `index.html?query` breaks Tauri App protocol path resolution
  // and can yield a white webview. Search still supported for dev/main.
  const fromSearch = new URLSearchParams(window.location.search)
  const fromHash =
    window.location.hash.length > 1
      ? new URLSearchParams(window.location.hash.slice(1))
      : new URLSearchParams()

  let role = injectedParams?.role ?? fromSearch.get('role') ?? fromHash.get('role')
  let surface = injectedParams?.surface ?? fromSearch.get('surface') ?? fromHash.get('surface')

  /** When initialization_script does not run, URL has no ?/# — still resolve via Tauri window label. */
  let winLabel: string | null = null
  try {
    winLabel = getCurrentWindow().label
    if (winLabel === 'teacher-board') {
      role = 'teacher'
      surface = 'board'
    } else if (winLabel === 'teacher-control') {
      role = 'teacher'
      surface = 'control'
    } else if (winLabel === 'student') {
      role = 'student'
      surface = surface ?? 'control'
    }
  } catch {
    winLabel = null
  }

  let windowKind: WindowKind = 'main'
  if (role === 'student') {
    windowKind = 'student'
  } else if (surface === 'board') {
    windowKind = 'teacher-board'
  } else if (surface === 'control') {
    windowKind = 'teacher-control'
  }

  // #region agent log
  fetch('http://127.0.0.1:7711/ingest/ea4dba9c-75d7-4a3b-928e-7c8b2a9adba1',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d405cf'},body:JSON.stringify({sessionId:'d405cf',runId:'pre-fix',hypothesisId:'H2',location:'useDesktopAppState.ts:54',message:'window_params_parsed',data:{injectedRole:injectedParams?.role??null,injectedSurface:injectedParams?.surface??null,winLabel,search:window.location.search,hash:window.location.hash,resolvedRole:role,resolvedSurface:surface,windowKind},timestamp:Date.now()})}).catch(()=>{});
  // #endregion

  return {
    role: role === 'student' ? 'student' : 'teacher',
    surface: surface === 'board' ? 'board' : 'control',
    windowKind,
  } as const
}

function readStoredTeacherContext(): {
  selectedLessonId: number | null
  teacherClassName: string
  teacherWorkspaceMode: 'runtime' | 'editor'
} | null {
  try {
    const raw = localStorage.getItem(TEACHER_CONTEXT_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as {
      selectedLessonId?: number | null
      teacherClassName?: string
      teacherWorkspaceMode?: 'runtime' | 'editor'
    }
    return {
      selectedLessonId:
        typeof parsed.selectedLessonId === 'number' && Number.isFinite(parsed.selectedLessonId)
          ? parsed.selectedLessonId
          : null,
      teacherClassName: parsed.teacherClassName ?? '8А',
      teacherWorkspaceMode: parsed.teacherWorkspaceMode === 'runtime' ? 'runtime' : 'editor',
    }
  } catch {
    return null
  }
}

function readStoredStudentContext(): {
  studentName: string
  studentClassName: string
  studentSessionCode: string
} | null {
  try {
    const raw = localStorage.getItem(STUDENT_CONTEXT_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as {
      studentName?: string
      studentClassName?: string
      studentSessionCode?: string
    }
    return {
      studentName: parsed.studentName ?? 'Иванов Иван',
      studentClassName: parsed.studentClassName ?? '8А',
      studentSessionCode: parsed.studentSessionCode ?? '',
    }
  } catch {
    return null
  }
}

function readStoredTeacherEditorDraft(): {
  lesson: Lesson | null
  sceneIndex: number
  dirty: boolean
} | null {
  try {
    const raw = localStorage.getItem(TEACHER_EDITOR_DRAFT_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as {
      lesson?: Lesson | null
      sceneIndex?: number
      dirty?: boolean
    }
    return {
      lesson: parsed.lesson && typeof parsed.lesson === 'object' ? parsed.lesson : null,
      sceneIndex: typeof parsed.sceneIndex === 'number' && Number.isFinite(parsed.sceneIndex) ? parsed.sceneIndex : 0,
      dirty: Boolean(parsed.dirty),
    }
  } catch {
    return null
  }
}

function writeTeacherContext(context: {
  selectedLessonId: number | null
  teacherClassName: string
  teacherWorkspaceMode: 'runtime' | 'editor'
}) {
  // Avoid cross-window localStorage echo storms (each window re-writes the same value → storage event loop → freeze).
  const next = JSON.stringify(context)
  if (localStorage.getItem(TEACHER_CONTEXT_STORAGE_KEY) === next) return
  localStorage.setItem(TEACHER_CONTEXT_STORAGE_KEY, next)
}

function writeStudentContext(context: {
  studentName: string
  studentClassName: string
  studentSessionCode: string
}) {
  const next = JSON.stringify(context)
  if (localStorage.getItem(STUDENT_CONTEXT_STORAGE_KEY) === next) return
  localStorage.setItem(STUDENT_CONTEXT_STORAGE_KEY, next)
}

function writeTeacherEditorDraft(draft: {
  lesson: Lesson | null
  sceneIndex: number
  dirty: boolean
} | null) {
  if (!draft?.lesson) {
    if (!localStorage.getItem(TEACHER_EDITOR_DRAFT_STORAGE_KEY)) return
    localStorage.removeItem(TEACHER_EDITOR_DRAFT_STORAGE_KEY)
    return
  }
  const next = JSON.stringify(draft)
  if (localStorage.getItem(TEACHER_EDITOR_DRAFT_STORAGE_KEY) === next) return
  localStorage.setItem(TEACHER_EDITOR_DRAFT_STORAGE_KEY, next)
}

function normalizeApiBase(value: string) {
  const trimmed = value.trim()
  return (trimmed || DEFAULT_API_BASE).replace(/\/+$/, '')
}

function debugAppLog(
  runId: string,
  hypothesisId: string,
  location: string,
  message: string,
  data: Record<string, unknown>,
) {
  if (!DEBUG_APP_LOGS) return
  const payload = { sessionId: 'ffe9af', runId, hypothesisId, location, message, data, timestamp: Date.now() }
  fetch('http://127.0.0.1:7711/ingest/ea4dba9c-75d7-4a3b-928e-7c8b2a9adba1', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'ffe9af' },
    body: JSON.stringify(payload),
  }).catch(() => {})
  invoke('append_debug_log', { line: `${JSON.stringify(payload)}\n` }).catch(() => {})
}

async function requestApi<T>(apiBase: string, path: string, options?: RequestInit): Promise<T> {
  debugAppLog('pre-fix', 'H1', 'useDesktopAppState.ts:72', 'requestApi:start', {
    apiBase,
    path,
    method: options?.method ?? 'GET',
    online: typeof navigator !== 'undefined' ? navigator.onLine : 'unknown',
    origin: typeof window !== 'undefined' ? window.location.origin : 'unknown',
  })
  let response: Response
  try {
    response = await fetch(`${apiBase}${path}`, {
      headers: {
        'Content-Type': 'application/json',
        ...(options?.headers ?? {}),
      },
      ...options,
    })
  } catch (error) {
    debugAppLog('pre-fix', 'H1', 'useDesktopAppState.ts:90', 'requestApi:error', {
      apiBase,
      path,
      method: options?.method ?? 'GET',
      errorName: error instanceof Error ? error.name : 'unknown',
      errorMessage: error instanceof Error ? error.message : String(error),
      origin: typeof window !== 'undefined' ? window.location.origin : 'unknown',
    })
    throw error
  }

  debugAppLog('pre-fix', 'H1', 'useDesktopAppState.ts:102', 'requestApi:response', {
    apiBase,
    path,
    status: response.status,
    ok: response.ok,
    redirected: response.redirected,
    responseType: response.type,
  })

  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`
    try {
      const body = await response.json()
      detail = body.detail ?? JSON.stringify(body)
    } catch {
      // Ignore parse failures.
    }
    throw new Error(detail)
  }

  return response.json()
}

async function probeApiBase(targetApiBase: string) {
  await requestApi<{ status: string }>(targetApiBase, '/health')
  return targetApiBase
}

function describeApiError(error: Error, apiBase: string) {
  const message = error.message || ''
  if (
    message === 'Failed to fetch' ||
    message.includes('NetworkError') ||
    message.includes('Load failed') ||
    message.includes('fetch')
  ) {
    return `Не удалось подключиться к ${apiBase}. Проверь, что сервер запущен и адрес указан правильно.`
  }
  return message
}

function computeBinaryString(selectedValues: number[], values: number[]) {
  const active = new Set(selectedValues)
  return values.map((value) => (active.has(value) ? '1' : '0')).join('')
}

function cloneLesson(lesson: Lesson) {
  return JSON.parse(JSON.stringify(lesson)) as Lesson
}

function normalizeLessonSummary(rawLesson: unknown, index: number): LessonSummary {
  if (!rawLesson || typeof rawLesson !== 'object') {
    return { id: -(index + 1), title: 'Без названия', topic: '' }
  }
  const lesson = rawLesson as Record<string, unknown>
  return {
    id: typeof lesson.id === 'number' && Number.isFinite(lesson.id) ? lesson.id : -(index + 1),
    title: typeof lesson.title === 'string' ? lesson.title : 'Без названия',
    topic: typeof lesson.topic === 'string' ? lesson.topic : '',
  }
}

function buildLessonSavePayload(lesson: Lesson) {
  return {
    title: lesson.title,
    grade_band: lesson.grade_band ?? '',
    topic: lesson.topic ?? '',
    level: lesson.level ?? '',
    author_name: lesson.author_name ?? '',
    summary: lesson.summary ?? '',
    tags: Array.isArray(lesson.tags) ? lesson.tags : [],
    status: lesson.status ?? 'draft',
    is_template: lesson.is_template ?? true,
    scenes: lesson.scenes.map((scene, sceneIndex) => ({
      title: scene.title,
      scene_type: scene.scene_type ?? 'board',
      order_index: scene.order_index ?? sceneIndex,
      layout: scene.layout ?? {},
      notes_text: scene.notes_text ?? '',
      widgets: scene.widgets.map((widget, widgetIndex) => ({
        widget_type: widget.widget_type,
        title: widget.title ?? '',
        order_index: widget.order_index ?? widgetIndex,
        layout: widget.layout ?? {},
        config: widget.config ?? {},
      })),
    })),
  }
}

function buildStarterBoardLessonPayload() {
  const sceneLayout = buildSceneLayout({
    viewport: {
      width: 1600,
      height: 920,
      gridSize: 24,
      showGrid: true,
      background: 'linear-gradient(180deg, rgba(10, 18, 34, 0.98), rgba(6, 11, 24, 0.98))',
    },
    board_elements: [
      {
        id: createBoardElementId('rect'),
        type: 'rectangle',
        x: 48,
        y: 44,
        w: 1460,
        h: 112,
        z: 1,
        locked: false,
        color: '#6fa7ff',
        fill: 'rgba(100, 130, 255, 0.16)',
        strokeWidth: 2,
        radius: 26,
      },
      {
        id: createBoardElementId('text'),
        type: 'text',
        x: 84,
        y: 70,
        w: 760,
        h: 60,
        z: 2,
        locked: false,
        text: 'Главная доска урока',
        color: '#f7f9ff',
        fontSize: 42,
        align: 'left',
      },
      {
        id: createBoardElementId('text'),
        type: 'text',
        x: 88,
        y: 126,
        w: 860,
        h: 40,
        z: 3,
        locked: false,
        text: 'Здесь учитель ведет сцену, дает контекст, двигает класс и показывает ключевые виджеты.',
        color: '#d8e5ff',
        fontSize: 20,
        align: 'left',
      },
      {
        id: createBoardElementId('rect'),
        type: 'rectangle',
        x: 56,
        y: 188,
        w: 760,
        h: 650,
        z: 4,
        locked: false,
        color: '#6cc6ff',
        fill: 'rgba(42, 82, 140, 0.12)',
        strokeWidth: 2,
        radius: 28,
      },
      {
        id: createBoardElementId('text'),
        type: 'text',
        x: 92,
        y: 220,
        w: 460,
        h: 48,
        z: 5,
        locked: false,
        text: 'Рабочая зона учителя',
        color: '#f7f9ff',
        fontSize: 28,
        align: 'left',
      },
      {
        id: createBoardElementId('text'),
        type: 'text',
        x: 92,
        y: 272,
        w: 560,
        h: 84,
        z: 6,
        locked: false,
        text: 'Используй эту область для схем, заметок, стрелок и пояснений перед классом.',
        color: '#b6c8e8',
        fontSize: 20,
        align: 'left',
      },
      {
        id: createBoardElementId('arrow'),
        type: 'arrow',
        x: 684,
        y: 382,
        w: 160,
        h: 32,
        z: 7,
        locked: false,
        color: '#ffc86f',
        strokeWidth: 5,
      },
      {
        id: createBoardElementId('text'),
        type: 'text',
        x: 1140,
        y: 76,
        w: 300,
        h: 40,
        z: 8,
        locked: false,
        text: 'Starter board',
        color: '#cfd8ff',
        fontSize: 18,
        align: 'right',
      },
    ],
  })

  return {
    title: 'Board Lesson - Первый запуск',
    grade_band: '7-11',
    topic: 'Teacher board launch',
    level: 'core',
    author_name: 'TeachEye',
    summary: 'Стартовый урок-доска с главной сценой, рабочей зоной и двумя базовыми виджетами.',
    tags: ['board', 'starter', 'desktop'],
    status: 'draft',
    is_template: true,
    scenes: [
      {
        title: 'Главная сцена',
        scene_type: 'board',
        order_index: 0,
        layout: sceneLayout,
        notes_text:
          'Это первая teacher-доска: короткий контекст сверху, свободная рабочая зона слева и два стартовых виджета справа.',
        widgets: [
          {
            widget_type: 'multiple_choice',
            title: 'Быстрый вход в тему',
            order_index: 0,
            layout: {
              x: 868,
              y: 204,
              w: 620,
              h: 250,
              z: 20,
              locked: false,
            },
            config: {
              question: 'С чего начнем урок?',
              options: ['Короткий опрос', 'Разбор схемы', 'Практика на доске'],
              correct_index: 1,
            },
          },
          {
            widget_type: 'code_puzzle',
            title: 'Стартовая практика',
            order_index: 1,
            layout: {
              x: 868,
              y: 486,
              w: 620,
              h: 260,
              z: 21,
              locked: false,
            },
            config: {
              lines: ['result = 2 + 2', 'print("Старт урока")', 'print(result)'],
              initial_order: ['print(result)', 'result = 2 + 2', 'print("Старт урока")'],
            },
          },
        ],
      },
    ],
  }
}

function buildEmptyBoardLessonDraft(): Lesson {
  return {
    id: -1,
    title: 'Пустая доска',
    topic: 'offline board draft',
    grade_band: '',
    level: 'draft',
    author_name: 'TeachEye',
    summary: 'Локальный черновик доски без backend.',
    tags: ['board', 'offline', 'draft'],
    status: 'draft',
    is_template: true,
    scenes: [
      {
        id: -1,
        title: 'Новая сцена',
        scene_type: 'board',
        order_index: 0,
        layout: buildSceneLayout({
          viewport: {
            width: 1600,
            height: 920,
            gridSize: 24,
            showGrid: true,
            background: 'linear-gradient(180deg, rgba(10, 18, 34, 0.98), rgba(6, 11, 24, 0.98))',
          },
          board_elements: [
            {
              id: createBoardElementId('rect'),
              type: 'rectangle',
              x: 48,
              y: 44,
              w: 1504,
              h: 120,
              z: 1,
              locked: false,
              color: '#6fa7ff',
              fill: 'rgba(100, 130, 255, 0.14)',
              strokeWidth: 2,
              radius: 28,
            },
            {
              id: createBoardElementId('text'),
              type: 'text',
              x: 84,
              y: 74,
              w: 720,
              h: 54,
              z: 2,
              locked: false,
              text: 'Пустая доска',
              color: '#f7f9ff',
              fontSize: 40,
              align: 'left',
            },
            {
              id: createBoardElementId('text'),
              type: 'text',
              x: 88,
              y: 126,
              w: 920,
              h: 40,
              z: 3,
              locked: false,
              text: 'Это локальный draft. Здесь можно сразу рисовать, ставить текст, фигуры и виджеты даже без backend.',
              color: '#d8e5ff',
              fontSize: 20,
              align: 'left',
            },
            {
              id: createBoardElementId('rect'),
              type: 'rectangle',
              x: 64,
              y: 204,
              w: 1488,
              h: 652,
              z: 4,
              locked: false,
              color: '#6cc6ff',
              fill: 'rgba(42, 82, 140, 0.08)',
              strokeWidth: 2,
              radius: 28,
            },
          ],
        }),
        notes_text: 'Локальная сцена для быстрого старта. Когда backend дочиним, можно будет сохранить ее как обычный урок.',
        widgets: [],
      },
    ],
  }
}

export function useDesktopAppState() {
  const windowParams = getWindowParams()
  const storedTeacherContext = readStoredTeacherContext()
  const storedTeacherEditorDraft = readStoredTeacherEditorDraft()
  const storedStudentContext = readStoredStudentContext()

  const [role, setRole] = useState<Role>(windowParams.role)
  const [status, setStatus] = useState('Подключение к API...')
  const [statusKind, setStatusKind] = useState<StatusKind>('muted')
  const [apiBase, setApiBase] = useState(() => normalizeApiBase(localStorage.getItem(API_BASE_STORAGE_KEY) ?? DEFAULT_API_BASE))
  const [apiBaseInput, setApiBaseInput] = useState(() => normalizeApiBase(localStorage.getItem(API_BASE_STORAGE_KEY) ?? DEFAULT_API_BASE))

  const [lessons, setLessons] = useState<LessonSummary[]>([])
  const [selectedLessonId, setSelectedLessonId] = useState<number | null>(storedTeacherContext?.selectedLessonId ?? null)
  const [teacherClassName, setTeacherClassName] = useState(storedTeacherContext?.teacherClassName ?? '8А')
  const [teacherRun, setTeacherRun] = useState<LessonRun | null>(null)
  const [teacherLesson, setTeacherLesson] = useState<Lesson | null>(null)
  const [teacherSurface, setTeacherSurface] = useState<TeacherSurface>(windowParams.surface)
  const [teacherWorkspaceMode, setTeacherWorkspaceMode] = useState<'runtime' | 'editor'>(
    storedTeacherContext?.teacherWorkspaceMode ?? 'editor',
  )
  const [teacherSceneAnimKey, setTeacherSceneAnimKey] = useState(0)
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null)
  const [selectedInspection, setSelectedInspection] = useState<ParticipantInspection | null>(null)
  const [projectedSessionId, setProjectedSessionId] = useState<number | null>(null)
  const [editorLesson, setEditorLesson] = useState<Lesson | null>(() =>
    storedTeacherEditorDraft?.lesson ? cloneLesson(storedTeacherEditorDraft.lesson) : null,
  )
  const [editorSceneIndex, setEditorSceneIndex] = useState(storedTeacherEditorDraft?.sceneIndex ?? 0)
  const [editorDirty, setEditorDirty] = useState(storedTeacherEditorDraft?.dirty ?? false)
  const [isSavingLesson, setIsSavingLesson] = useState(false)

  const [studentName, setStudentName] = useState(storedStudentContext?.studentName ?? 'Иванов Иван')
  const [studentClassName, setStudentClassName] = useState(storedStudentContext?.studentClassName ?? '8А')
  const [studentSessionId, setStudentSessionId] = useState<number | null>(() => {
    const storedSessionId = localStorage.getItem(SESSION_STORAGE_KEY)
    return storedSessionId ? Number(storedSessionId) : null
  })
  const [studentSessionCode, setStudentSessionCode] = useState<string>(storedStudentContext?.studentSessionCode ?? '')
  const [studentRunIdInput, setStudentRunIdInput] = useState(() => localStorage.getItem(RUN_STORAGE_KEY) ?? '')
  const [studentRun, setStudentRun] = useState<LessonRun | null>(null)
  const [studentLesson, setStudentLesson] = useState<Lesson | null>(null)
  const [studentParticipant, setStudentParticipant] = useState<Participant | null>(null)
  const [studentSceneAnimKey, setStudentSceneAnimKey] = useState(0)
  const [studentCanvasMode] = useState<'student-interactive' | 'student-spectator'>('student-interactive')
  const [code, setCode] = useState('print("Привет, TeachEye")')
  const [codeOutput, setCodeOutput] = useState('Пока нет вывода.')

  useEffect(() => {
    // #region agent log
    debugAppLog('pre-fix', 'H2', 'useDesktopAppState.ts:430', 'window:init', {
      href: typeof window !== 'undefined' ? window.location.href : 'unknown',
      origin: typeof window !== 'undefined' ? window.location.origin : 'unknown',
      windowKind: windowParams.windowKind,
      role: windowParams.role,
      surface: windowParams.surface,
      winLabel: (() => {
        try {
          return getCurrentWindow().label
        } catch {
          return null
        }
      })(),
      storedTeacherContext,
    })
    // #endregion

    const onError = (event: ErrorEvent) => {
      // #region agent log
      debugAppLog('pre-fix', 'H1', 'useDesktopAppState.ts:441', 'window:error', {
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      })
      // #endregion
    }

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      // #region agent log
      debugAppLog('pre-fix', 'H1', 'useDesktopAppState.ts:453', 'window:unhandledrejection', {
        reason:
          event.reason instanceof Error
            ? { name: event.reason.name, message: event.reason.message }
            : String(event.reason),
      })
      // #endregion
    }

    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onUnhandledRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onUnhandledRejection)
    }
  }, [storedTeacherContext, windowParams.role, windowParams.surface, windowParams.windowKind])

  const currentTeacherScene = useMemo(() => {
    if (!teacherLesson || !teacherRun) return null
    return teacherLesson.scenes[teacherRun.current_scene_index] ?? null
  }, [teacherLesson, teacherRun])

  const currentEditorScene = useMemo(() => {
    if (!editorLesson) return null
    return editorLesson.scenes[editorSceneIndex] ?? null
  }, [editorLesson, editorSceneIndex])

  const selectedLessonSummary = useMemo(() => {
    if (!selectedLessonId) return null
    return lessons.find((lesson) => lesson.id === selectedLessonId) ?? null
  }, [lessons, selectedLessonId])

  const currentLessonLabel = useMemo(() => {
    return selectedLessonSummary?.title || editorLesson?.title || null
  }, [editorLesson?.title, selectedLessonSummary?.title])

  const teacherSceneList = useMemo(
    () => (teacherWorkspaceMode === 'editor' ? editorLesson?.scenes ?? [] : teacherLesson?.scenes ?? []),
    [editorLesson?.scenes, teacherLesson?.scenes, teacherWorkspaceMode],
  )

  const projectedStudentName = useMemo(() => {
    if (!selectedInspection || projectedSessionId !== selectedInspection.participant.session_id) return null
    return selectedInspection.participant.student_name
  }, [projectedSessionId, selectedInspection])

  const currentScene = useMemo(() => {
    if (!studentLesson || !studentParticipant) return null
    return studentLesson.scenes[studentParticipant.current_scene_index] ?? null
  }, [studentLesson, studentParticipant])

  const currentPowerWidget = useMemo(() => {
    return currentScene?.widgets.find((widget) => widget.widget_type === 'powers_of_two_picker') ?? null
  }, [currentScene])

  const currentPowerProgress = useMemo(() => {
    if (!currentScene || !currentPowerWidget || !studentParticipant) return null
    return (
      studentParticipant.progress?.[String(currentScene.id)]?.[String(currentPowerWidget.id)] ?? {
        selected_values: [],
        completed: false,
      }
    )
  }, [currentScene, currentPowerWidget, studentParticipant])

  const powerModel = useMemo(() => {
    if (!currentScene || !currentPowerWidget || !currentPowerProgress) return null
    const values = currentPowerWidget.config.values ?? [128, 64, 32, 16, 8, 4, 2, 1]
    const selectedValues = currentPowerProgress.selected_values ?? []
    const selectedSum = selectedValues.reduce((sum: number, value: number) => sum + value, 0)
    const binaryString = computeBinaryString(selectedValues, values)
    return {
      values,
      selectedValues,
      selectedSum,
      binaryString,
      targetValue: currentPowerWidget.config.target_value ?? 0,
      expression: selectedValues.length ? `${selectedValues.join(' + ')} = ${selectedSum}` : `0 = ${selectedSum}`,
      taskText: currentPowerWidget.config.task_text,
      contextTitle: currentPowerWidget.config.context_title,
      nodeAddress: currentPowerWidget.config.node_address,
      maskAddress: currentPowerWidget.config.mask_address,
      answerLabel: currentPowerWidget.config.answer_label,
      teacherBoardText: currentPowerWidget.config.teacher_board_text ?? currentScene.notes_text,
      completed: !!currentPowerProgress.completed,
    }
  }, [currentScene, currentPowerProgress, currentPowerWidget])

  useEffect(() => {
    const next = teacherRun ? String(teacherRun.id) : ''
    if (localStorage.getItem(RUN_STORAGE_KEY) === next) return
    localStorage.setItem(RUN_STORAGE_KEY, next)
  }, [teacherRun])

  useEffect(() => {
    const next = studentSessionId ? String(studentSessionId) : ''
    if (localStorage.getItem(SESSION_STORAGE_KEY) === next) return
    localStorage.setItem(SESSION_STORAGE_KEY, next)
  }, [studentSessionId])

  useEffect(() => {
    if (localStorage.getItem(API_BASE_STORAGE_KEY) === apiBase) return
    localStorage.setItem(API_BASE_STORAGE_KEY, apiBase)
  }, [apiBase])

  useEffect(() => {
    writeTeacherContext({
      selectedLessonId,
      teacherClassName,
      teacherWorkspaceMode,
    })
  }, [selectedLessonId, teacherClassName, teacherWorkspaceMode])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      writeTeacherEditorDraft(
        editorLesson
          ? {
              lesson: editorLesson,
              sceneIndex: editorSceneIndex,
              dirty: editorDirty,
            }
          : null,
      )
    }, 220)
    return () => window.clearTimeout(timer)
  }, [editorDirty, editorLesson, editorSceneIndex])

  useEffect(() => {
    writeStudentContext({
      studentName,
      studentClassName,
      studentSessionCode,
    })
  }, [studentClassName, studentName, studentSessionCode])

  const apiCall = useCallback(<T,>(path: string, options?: RequestInit) => requestApi<T>(apiBase, path, options), [apiBase])

  const syncTeacherRun = useCallback(async (runId = teacherRun?.id, showStatus = true) => {
    if (!runId) return
    const response = await apiCall<{ run: LessonRun; lesson: Lesson }>(`/lesson-runs/${runId}`)
    const normalizedRun = normalizeLessonRun(response.run)
    const normalizedLesson = normalizeLesson(response.lesson)
    const sceneChanged = normalizedRun.current_scene_index !== teacherRun?.current_scene_index
    setTeacherRun(normalizedRun)
    setTeacherLesson(normalizedLesson)
    if (selectedSessionId) {
      try {
        const inspection = await apiCall<ParticipantInspection>(
          `/lesson-runs/${runId}/participants/${selectedSessionId}/inspect`,
        )
        setSelectedInspection(normalizeParticipantInspection(inspection))
      } catch {
        setSelectedInspection(null)
        setSelectedSessionId(null)
      }
    }
    if (sceneChanged) {
      setTeacherSceneAnimKey((value) => value + 1)
    }
    if (showStatus) {
      setStatus('Панель учителя обновлена')
      setStatusKind('ok')
    }
  }, [apiCall, selectedSessionId, teacherRun?.current_scene_index, teacherRun?.id])

  useEffect(() => {
    if (!teacherRun?.id) return
    const runId = teacherRun.id
    const timer = window.setInterval(() => {
      void syncTeacherRun(runId, false)
    }, 2500)
    return () => window.clearInterval(timer)
  }, [syncTeacherRun, teacherRun?.id])

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === TEACHER_CONTEXT_STORAGE_KEY && event.newValue) {
        try {
          const nextContext = JSON.parse(event.newValue) as {
            selectedLessonId?: number | null
            teacherClassName?: string
            teacherWorkspaceMode?: 'runtime' | 'editor'
          }
          setSelectedLessonId(
            typeof nextContext.selectedLessonId === 'number' && Number.isFinite(nextContext.selectedLessonId)
              ? nextContext.selectedLessonId
              : null,
          )
          setTeacherClassName(nextContext.teacherClassName ?? '8А')
          setTeacherWorkspaceMode(nextContext.teacherWorkspaceMode === 'runtime' ? 'runtime' : 'editor')
        } catch {
          // Ignore malformed teacher context payloads.
        }
      }

      if (event.key === API_BASE_STORAGE_KEY && event.newValue) {
        const nextApiBase = normalizeApiBase(event.newValue)
        setApiBase(nextApiBase)
        setApiBaseInput(nextApiBase)
      }

      if (event.key === TEACHER_EDITOR_DRAFT_STORAGE_KEY) {
        if (!event.newValue) {
          setEditorLesson(null)
          setEditorSceneIndex(0)
          setEditorDirty(false)
          return
        }
        try {
          const nextDraft = JSON.parse(event.newValue) as {
            lesson?: Lesson | null
            sceneIndex?: number
            dirty?: boolean
          }
          setEditorLesson(nextDraft.lesson && typeof nextDraft.lesson === 'object' ? cloneLesson(nextDraft.lesson) : null)
          setEditorSceneIndex(
            typeof nextDraft.sceneIndex === 'number' && Number.isFinite(nextDraft.sceneIndex) ? nextDraft.sceneIndex : 0,
          )
          setEditorDirty(Boolean(nextDraft.dirty))
        } catch {
          // Ignore malformed editor draft payloads.
        }
      }

      if (event.key === STUDENT_CONTEXT_STORAGE_KEY && event.newValue) {
        try {
          const nextContext = JSON.parse(event.newValue) as {
            studentName?: string
            studentClassName?: string
            studentSessionCode?: string
          }
          setStudentName(nextContext.studentName ?? 'Иванов Иван')
          setStudentClassName(nextContext.studentClassName ?? '8А')
          setStudentSessionCode(nextContext.studentSessionCode ?? '')
        } catch {
          // Ignore malformed student context payloads.
        }
      }

      if (event.key === RUN_STORAGE_KEY) {
        const nextRunId = Number(event.newValue)
        setStudentRunIdInput(nextRunId ? String(nextRunId) : '')
        if (nextRunId) {
          void syncTeacherRun(nextRunId, false)
        } else {
          setTeacherRun(null)
          setTeacherLesson(null)
          setStudentRun(null)
          setStudentLesson(null)
        }
      }

      if (event.key === SESSION_STORAGE_KEY) {
        const nextSessionId = Number(event.newValue)
        if (nextSessionId) {
          setStudentSessionId(nextSessionId)
        } else {
          setStudentSessionId(null)
          setStudentParticipant(null)
        }
      }
    }

    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [syncTeacherRun])

  useEffect(() => {
    const storedRunId = Number(localStorage.getItem(RUN_STORAGE_KEY))
    if (!storedRunId || teacherRun) return
    const timer = window.setTimeout(() => {
      void syncTeacherRun(storedRunId, false)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [syncTeacherRun, teacherRun])

  const fallbackToLocalApi = useCallback(async (failedApiBase: string) => {
    debugAppLog('pre-fix', 'H2', 'useDesktopAppState.ts:584', 'fallback:begin', {
      failedApiBase,
      defaultApiBase: DEFAULT_API_BASE,
    })
    if (normalizeApiBase(failedApiBase) === DEFAULT_API_BASE) return null
    try {
      await probeApiBase(DEFAULT_API_BASE)
      setApiBase(DEFAULT_API_BASE)
      setApiBaseInput(DEFAULT_API_BASE)
      debugAppLog('pre-fix', 'H2', 'useDesktopAppState.ts:593', 'fallback:success', {
        failedApiBase,
        switchedTo: DEFAULT_API_BASE,
      })
      return DEFAULT_API_BASE
    } catch {
      debugAppLog('pre-fix', 'H4', 'useDesktopAppState.ts:599', 'fallback:failed', {
        failedApiBase,
        attemptedApiBase: DEFAULT_API_BASE,
      })
      return null
    }
  }, [])

  const checkHealth = useCallback(async (targetApiBase = apiBase) => {
    debugAppLog('pre-fix', 'H3', 'useDesktopAppState.ts:606', 'checkHealth:begin', {
      targetApiBase,
      apiBase,
    })
    try {
      await probeApiBase(targetApiBase)
      setStatus(`API: сервер на связи (${targetApiBase})`)
      setStatusKind('ok')
      return targetApiBase
    } catch (error) {
      const fallbackApiBase = await fallbackToLocalApi(targetApiBase)
      if (fallbackApiBase) {
        setStatus(`API: сервер на связи (${fallbackApiBase})`)
        setStatusKind('ok')
        return fallbackApiBase
      }
      // #region agent log
      debugAppLog('pre-fix', 'H1', 'useDesktopAppState.ts:620', 'checkHealth:failed', {
        targetApiBase,
        apiBase,
        errorName: error instanceof Error ? error.name : 'unknown',
        errorMessage: error instanceof Error ? error.message : String(error),
        origin: typeof window !== 'undefined' ? window.location.origin : 'unknown',
      })
      // #endregion
      setStatus(describeApiError(error as Error, targetApiBase))
      setStatusKind('bad')
      return null
    }
  }, [apiBase, fallbackToLocalApi])

  const loadLessonLibrary = useCallback(async (selectNewest = false, targetApiBase = apiBase) => {
    debugAppLog('pre-fix', 'H3', 'useDesktopAppState.ts:629', 'loadLessonLibrary:begin', {
      targetApiBase,
      selectNewest,
      apiBase,
    })
    try {
      const data = (await requestApi<LessonSummary[]>(targetApiBase, '/lessons')).map(normalizeLessonSummary)
      setLessons(data)
      debugAppLog('pre-fix', 'H3', 'useDesktopAppState.ts:638', 'loadLessonLibrary:success', {
        targetApiBase,
        lessonCount: data.length,
        firstLessonId: data[0]?.id ?? null,
      })
      if (selectNewest && data.length > 0) {
        // Do not clobber a lesson already selected from localStorage (multi-window: hub + board).
        setSelectedLessonId((prev) => (prev == null ? data[0].id : prev))
      }
      return targetApiBase
    } catch (error) {
      const fallbackApiBase = await fallbackToLocalApi(targetApiBase)
      if (fallbackApiBase) {
        const data = (await requestApi<LessonSummary[]>(fallbackApiBase, '/lessons')).map(normalizeLessonSummary)
        setLessons(data)
        if (selectNewest && data.length > 0) {
          setSelectedLessonId((prev) => (prev == null ? data[0].id : prev))
        }
        setStatus(`Уроки загружены через локальный backend (${fallbackApiBase})`)
        setStatusKind('ok')
        return fallbackApiBase
      }
      // #region agent log
      debugAppLog('pre-fix', 'H4', 'useDesktopAppState.ts:661', 'loadLessonLibrary:failed', {
        targetApiBase,
        apiBase,
        selectNewest,
        errorName: error instanceof Error ? error.name : 'unknown',
        errorMessage: error instanceof Error ? error.message : String(error),
      })
      // #endregion
      setStatus(`Не удалось загрузить уроки: ${describeApiError(error as Error, targetApiBase)}`)
      setStatusKind('bad')
      return null
    }
  }, [apiBase, fallbackToLocalApi])

  const loadLessonDetail = useCallback(async (lessonId = selectedLessonId, showStatus = false) => {
    if (!lessonId) return
    try {
      const lesson = normalizeLesson(await apiCall<Lesson>(`/lessons/${lessonId}`))
      setEditorLesson(cloneLesson(lesson))
      setEditorSceneIndex((current) => {
        const maxIndex = Math.max(0, lesson.scenes.length - 1)
        return Math.min(current, maxIndex)
      })
      setEditorDirty(false)
      if (showStatus) {
        setStatus(`Открыт редактор урока: ${lesson.title}`)
        setStatusKind('ok')
      }
    } catch (error) {
      setStatus(`Не удалось открыть урок: ${describeApiError(error as Error, apiBase)}`)
      setStatusKind('bad')
    }
  }, [apiBase, apiCall, selectedLessonId])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      debugAppLog('pre-fix', 'H2', 'useDesktopAppState.ts:692', 'startup:begin', {
        apiBase,
        apiBaseInput,
        storedApiBase: localStorage.getItem(API_BASE_STORAGE_KEY),
      })
      void (async () => {
        const activeApiBase = (await checkHealth()) ?? apiBase
        debugAppLog('pre-fix', 'H2', 'useDesktopAppState.ts:699', 'startup:resolvedApiBase', {
          requestedApiBase: apiBase,
          resolvedApiBase: activeApiBase,
        })
        await loadLessonLibrary(true, activeApiBase)
      })()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [apiBase, apiBaseInput, checkHealth, loadLessonLibrary])

  useEffect(() => {
    if (!selectedLessonId) {
      if (editorLesson && editorLesson.id <= 0) return
      const timer = window.setTimeout(() => {
        setEditorLesson(null)
        setEditorSceneIndex(0)
        setEditorDirty(false)
      }, 0)
      return () => window.clearTimeout(timer)
    }
    if (editorLesson?.id === selectedLessonId) {
      return
    }
    const timer = window.setTimeout(() => {
      void loadLessonDetail(selectedLessonId)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [editorLesson?.id, editorLesson, loadLessonDetail, selectedLessonId])

  useEffect(() => {
    if (selectedLessonId || lessons.length === 0 || (editorLesson && editorLesson.id <= 0)) return
    const timer = window.setTimeout(() => {
      setSelectedLessonId(lessons[0].id)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [editorLesson, lessons, selectedLessonId])

  const ensureDemoLesson = useCallback(async () => {
    const lesson = normalizeLesson(await apiCall<Lesson>('/lessons/demo/ip-powers', { method: 'POST' }))
    await loadLessonLibrary(true)
    setSelectedLessonId(lesson.id)
    setEditorLesson(cloneLesson(lesson))
    setEditorSceneIndex(0)
    setEditorDirty(false)
    setStatus('Demo-урок готов')
    setStatusKind('ok')
  }, [apiCall, loadLessonLibrary])

  const openSurfaceWindow = useCallback(async (windowRole: Role, surface: TeacherSurface | 'student') => {
    const label = windowRole === 'student' ? 'student' : `teacher-${surface}`
    // #region agent log
    debugAppLog('pre-fix', 'H1', 'useDesktopAppState.ts:819', 'openSurfaceWindow:begin', {
      label,
      windowRole,
      surface,
      currentHref: typeof window !== 'undefined' ? window.location.href : 'unknown',
    })
    // #endregion
    await invoke('open_surface_window', { label, role: windowRole, surface })
    // #region agent log
    debugAppLog('pre-fix', 'H1', 'useDesktopAppState.ts:827', 'openSurfaceWindow:resolved', {
      label,
      windowRole,
      surface,
    })
    // #endregion
  }, [])

  const createStarterBoardLesson = useCallback(async () => {
    const lesson = normalizeLesson(await apiCall<Lesson>('/lessons', {
      method: 'POST',
      body: JSON.stringify(buildStarterBoardLessonPayload()),
    }))
    await loadLessonLibrary(true)
    setSelectedLessonId(lesson.id)
    setEditorLesson(cloneLesson(lesson))
    setEditorSceneIndex(0)
    setEditorDirty(false)
    setTeacherWorkspaceMode('editor')
    writeTeacherContext({
      selectedLessonId: lesson.id,
      teacherClassName,
      teacherWorkspaceMode: 'editor',
    })
    await openSurfaceWindow('teacher', 'board')
    setStatus('Создан стартовый board-урок')
    setStatusKind('ok')
  }, [apiCall, loadLessonLibrary, openSurfaceWindow, teacherClassName])

  const createEmptyBoardDraft = useCallback(() => {
    setSelectedLessonId(null)
    setEditorLesson(buildEmptyBoardLessonDraft())
    setEditorSceneIndex(0)
    setEditorDirty(false)
    setTeacherWorkspaceMode('editor')
    writeTeacherContext({
      selectedLessonId: null,
      teacherClassName,
      teacherWorkspaceMode: 'editor',
    })
    void openSurfaceWindow('teacher', 'board')
    setStatus('Локальная пустая доска готова')
    setStatusKind('ok')
  }, [openSurfaceWindow, teacherClassName])

  const applyApiBase = useCallback(async () => {
    const normalizedApiBase = normalizeApiBase(apiBaseInput)
    // #region agent log
    debugAppLog('pre-fix', 'H3', 'useDesktopAppState.ts:737', 'applyApiBase:begin', {
      apiBaseInput,
      normalizedApiBase,
      previousApiBase: apiBase,
      origin: typeof window !== 'undefined' ? window.location.origin : 'unknown',
    })
    // #endregion
    setApiBase(normalizedApiBase)
    setApiBaseInput(normalizedApiBase)
    const activeApiBase = (await checkHealth(normalizedApiBase)) ?? normalizedApiBase
    await loadLessonLibrary(true, activeApiBase)
  }, [apiBase, apiBaseInput, checkHealth, loadLessonLibrary])

  const startTeacherRun = useCallback(async () => {
    if (!selectedLessonId) {
      if (editorLesson && editorLesson.id <= 0) {
        setStatus('Это локальная пустая доска. С ней уже можно работать в editor, а live-запуск подключим после фикса backend.')
        setStatusKind('muted')
        return
      }
      setStatus('Сначала выбери урок')
      setStatusKind('bad')
      return
    }

    const response = await apiCall<{ run: LessonRun; lesson: Lesson }>('/lesson-runs', {
      method: 'POST',
      body: JSON.stringify({
        lesson_id: selectedLessonId,
        class_name: teacherClassName.trim().toUpperCase(),
      }),
    })
    const normalizedRun = normalizeLessonRun(response.run)
    const normalizedLesson = normalizeLesson(response.lesson)

    setTeacherRun(normalizedRun)
    setTeacherLesson(normalizedLesson)
    setEditorLesson((current) => current ?? cloneLesson(normalizedLesson))
    setStudentRunIdInput(String(response.run.id))
    setTeacherSceneAnimKey((value) => value + 1)
    setTeacherWorkspaceMode('runtime')
    localStorage.setItem(RUN_STORAGE_KEY, String(normalizedRun.id))
    writeTeacherContext({
      selectedLessonId,
      teacherClassName,
      teacherWorkspaceMode: 'runtime',
    })
    await openSurfaceWindow('teacher', 'board')
    setStatus('Урок запущен')
    setStatusKind('ok')
  }, [apiCall, editorLesson, openSurfaceWindow, selectedLessonId, teacherClassName])

  const saveEditedLesson = useCallback(async () => {
    if (!editorLesson) {
      setStatus('Сначала выбери урок для редактирования')
      setStatusKind('bad')
      return
    }
    setIsSavingLesson(true)
    try {
      const savedLesson = normalizeLesson(
        editorLesson.id <= 0
          ? await apiCall<Lesson>('/lessons', {
              method: 'POST',
              body: JSON.stringify(buildLessonSavePayload(editorLesson)),
            })
          : await apiCall<Lesson>(`/lessons/${editorLesson.id}`, {
              method: 'PUT',
              body: JSON.stringify(buildLessonSavePayload(editorLesson)),
            }),
      )
      setEditorLesson(cloneLesson(savedLesson))
      setSelectedLessonId(savedLesson.id)
      setEditorSceneIndex((current) => Math.min(current, Math.max(0, savedLesson.scenes.length - 1)))
      setEditorDirty(false)
      if (!teacherRun) {
        setTeacherLesson(savedLesson)
      }
      await loadLessonLibrary(false)
      setStatus('Шаблон урока сохранен')
      setStatusKind('ok')
    } catch (error) {
      setStatus(`Не удалось сохранить урок: ${describeApiError(error as Error, apiBase)}`)
      setStatusKind('bad')
    } finally {
      setIsSavingLesson(false)
    }
  }, [apiBase, apiCall, editorLesson, loadLessonLibrary, teacherRun])

  const openTeacherScene = useCallback(async (sceneIndex?: number) => {
    if (!teacherRun) return
    const run = normalizeLessonRun(await apiCall<LessonRun>(`/lesson-runs/${teacherRun.id}/advance`, {
      method: 'POST',
      body: JSON.stringify({ scene_index: sceneIndex ?? null }),
    }))
    setTeacherRun(run)
    setTeacherSceneAnimKey((value) => value + 1)
    setStatus(sceneIndex == null ? 'Открыта следующая сцена' : `Открыта сцена ${sceneIndex + 1}`)
    setStatusKind('ok')
  }, [apiCall, teacherRun])

  const awardStar = useCallback(async (sessionId: number) => {
    if (!teacherRun) return
    await apiCall(`/lesson-runs/${teacherRun.id}/participants/${sessionId}/stars`, {
      method: 'POST',
      body: JSON.stringify({ delta_tenths: 1 }),
    })
    await syncTeacherRun(teacherRun.id, false)
    setStatus('Учитель выдал +0.1 звезды')
    setStatusKind('ok')
  }, [apiCall, syncTeacherRun, teacherRun])

  const inspectStudent = useCallback(async (sessionId: number, showStatus = true) => {
    if (!teacherRun) return
    const inspection = normalizeParticipantInspection(await apiCall<ParticipantInspection>(
      `/lesson-runs/${teacherRun.id}/participants/${sessionId}/inspect`,
    ))
    setSelectedSessionId(sessionId)
    setSelectedInspection(inspection)
    if (showStatus) {
      setStatus(`Открыт фокус ученика: ${inspection.participant.student_name}`)
      setStatusKind('ok')
    }
  }, [apiCall, teacherRun])

  const toggleProjectedStudent = useCallback((sessionId: number) => {
    setProjectedSessionId((current) => (current === sessionId ? null : sessionId))
  }, [])

  const loginStudent = useCallback(async () => {
    const response = await apiCall<LoginResponse>('/login', {
      method: 'POST',
      body: JSON.stringify({
        student_name: studentName.trim(),
        class_name: studentClassName.trim().toUpperCase(),
      }),
    })
    setStudentSessionId(response.session_id)
    setStudentSessionCode(response.session_display_code)
    localStorage.setItem(SESSION_STORAGE_KEY, String(response.session_id))
    writeStudentContext({
      studentName: studentName.trim(),
      studentClassName: studentClassName.trim().toUpperCase(),
      studentSessionCode: response.session_display_code,
    })
    setStatus('Ученик вошел в систему')
    setStatusKind('ok')
    return response
  }, [apiCall, studentClassName, studentName])

  const syncStudentState = useCallback(async (
    runId = Number(studentRunIdInput),
    sessionId = studentSessionId,
    showStatus = true,
  ) => {
    if (!runId || !sessionId) return
    const [runResponse, participant] = await Promise.all([
      apiCall<{ run: LessonRun; lesson: Lesson }>(`/lesson-runs/${runId}`),
      apiCall<Participant>(`/lesson-runs/${runId}/participants/${sessionId}`),
    ])
    const normalizedRun = normalizeLessonRun(runResponse.run)
    const normalizedLesson = normalizeLesson(runResponse.lesson)
    const normalizedParticipant = normalizeParticipant(participant)
    const sceneChanged = normalizedParticipant.current_scene_index !== studentParticipant?.current_scene_index
    setStudentRun(normalizedRun)
    setStudentLesson(normalizedLesson)
    setStudentParticipant(normalizedParticipant)
    if (sceneChanged) {
      setStudentSceneAnimKey((value) => value + 1)
    }
    if (showStatus) {
      setStatus('Экран ученика синхронизирован')
      setStatusKind('ok')
    }
  }, [apiCall, studentParticipant?.current_scene_index, studentRunIdInput, studentSessionId])

  const joinStudentRun = useCallback(async () => {
    if (!studentSessionId) {
      setStatus('Сначала войди в сессию')
      setStatusKind('bad')
      return
    }
    const runId = Number(studentRunIdInput)
    if (!runId) {
      setStatus('Введи ID урока')
      setStatusKind('bad')
      return
    }

    await apiCall(`/lesson-runs/${runId}/join`, {
      method: 'POST',
      body: JSON.stringify({ session_id: studentSessionId }),
    })
    localStorage.setItem(RUN_STORAGE_KEY, String(runId))
    await syncStudentState(runId, studentSessionId, true)
  }, [apiCall, studentRunIdInput, studentSessionId, syncStudentState])

  const resumeStudentSession = useCallback(async (
    runId = Number(studentRunIdInput),
    sessionId = studentSessionId,
  ) => {
    if (!runId || !sessionId) return false
    try {
      await syncStudentState(runId, sessionId, false)
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
      const looksLikeMissingParticipant =
        message.includes('participant') || message.includes('session not found') || message.includes('404')
      if (!looksLikeMissingParticipant) {
        throw error
      }
    }

    await apiCall(`/lesson-runs/${runId}/join`, {
      method: 'POST',
      body: JSON.stringify({ session_id: sessionId }),
    })
    localStorage.setItem(RUN_STORAGE_KEY, String(runId))
    await syncStudentState(runId, sessionId, false)
    return true
  }, [apiCall, studentRunIdInput, studentSessionId, syncStudentState])

  useEffect(() => {
    if (!studentSessionId || !studentRunIdInput) return
    const runId = Number(studentRunIdInput)
    if (!runId) return
    const sessionId = studentSessionId
    const timer = window.setInterval(() => {
      void syncStudentState(runId, sessionId, false)
    }, 2500)
    return () => window.clearInterval(timer)
  }, [studentRunIdInput, studentSessionId, syncStudentState])

  useEffect(() => {
    if (windowParams.windowKind !== 'student') return
    if (!studentSessionId || !studentRunIdInput) return
    const runId = Number(studentRunIdInput)
    if (!runId) return
    const sessionId = studentSessionId
    const timer = window.setTimeout(() => {
      void resumeStudentSession(runId, sessionId)
        .then((restored) => {
          if (!restored) return
          setStatus('Сессия ученика восстановлена')
          setStatusKind('ok')
        })
        .catch((error) => {
          setStatus(`Не удалось восстановить сессию: ${describeApiError(error as Error, apiBase)}`)
          setStatusKind('bad')
        })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [apiBase, resumeStudentSession, studentRunIdInput, studentSessionId, windowParams.windowKind])

  const navigateStudent = useCallback(async (delta: -1 | 1) => {
    if (!studentRun || !studentParticipant || !studentSessionId) return
    const targetSceneIndex = studentParticipant.current_scene_index + delta
    await apiCall(`/lesson-runs/${studentRun.id}/participants/${studentSessionId}/navigate`, {
      method: 'POST',
      body: JSON.stringify({ scene_index: targetSceneIndex }),
    })
    await syncStudentState(studentRun.id, studentSessionId, false)
  }, [apiCall, studentParticipant, studentRun, studentSessionId, syncStudentState])

  const updateStudentWidgetState = useCallback(async (
    widgetId: number,
    state: Record<string, unknown>,
    preview: Record<string, unknown> | null,
    activityDelta = 1,
    scene = currentScene,
  ) => {
    if (!scene || !studentRun || !studentSessionId) return
    await apiCall(`/lesson-runs/${studentRun.id}/participants/${studentSessionId}/widget-state`, {
      method: 'POST',
      body: JSON.stringify({
        scene_id: scene.id,
        widget_id: widgetId,
        state,
        preview,
        activity_delta: activityDelta,
        expected_progress_version: studentParticipant?.progress_version ?? 0,
      }),
    })
    await syncStudentState(studentRun.id, studentSessionId, false)
  }, [apiCall, currentScene, studentParticipant?.progress_version, studentRun, studentSessionId, syncStudentState])

  const selectMultipleChoice = useCallback(async (widgetId: number, selectedIndex: number) => {
    if (!currentScene) return
    const widget = currentScene.widgets.find((item) => item.id === widgetId)
    if (!widget) return
    const correctIndex = typeof widget.config.correct_index === 'number' ? widget.config.correct_index : -1
    const completed = selectedIndex === correctIndex
    await updateStudentWidgetState(
      widgetId,
      { selected_index: selectedIndex, completed },
      {
        summary: widget.title || 'Вопрос',
        metric: `вариант ${selectedIndex + 1}`,
        value: completed ? 'верно' : 'в работе',
      },
      1,
      currentScene,
    )
  }, [currentScene, updateStudentWidgetState])

  const togglePowerValue = useCallback(async (widgetId: number, value: number) => {
    if (!currentScene) return
    const widget = currentScene.widgets.find((item) => item.id === widgetId)
    if (!widget) return
    const progress = studentParticipant?.progress?.[String(currentScene.id)]?.[String(widgetId)] || {}
    const model = buildPowerModel(widget, progress, currentScene)
    const selectedValues = [...model.selectedValues]
    const index = selectedValues.indexOf(value)
    if (index >= 0) selectedValues.splice(index, 1)
    else selectedValues.push(value)
    selectedValues.sort((a, b) => b - a)
    const sum = selectedValues.reduce((acc, item) => acc + item, 0)
    const binaryString = computeBinaryString(selectedValues, model.values)
    const completed = sum === model.targetValue

    await updateStudentWidgetState(
      widgetId,
      {
        selected_values: selectedValues,
        sum,
        binary_string: binaryString,
        completed,
      },
      {
        summary: 'Битовый калькулятор',
        metric: binaryString,
        value: `${sum} / ${model.targetValue}`,
      },
      1,
      currentScene,
    )
  }, [currentScene, studentParticipant?.progress, updateStudentWidgetState])

  const toggleBinaryBit = useCallback(async (widgetId: number, rowIndex: number, bitIndex: number) => {
    if (!currentScene) return
    const widget = currentScene.widgets.find((item) => item.id === widgetId)
    if (!widget) return
    const progress = studentParticipant?.progress?.[String(currentScene.id)]?.[String(widgetId)] || {}
    const tasks = Array.isArray(widget.config.tasks)
      ? (widget.config.tasks as Array<{ target_value?: number; bit_count?: number }>)
      : []
    const rows = Array.isArray(progress.rows) ? progress.rows.map((row: unknown) => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) return { bits: [] as number[] }
      const record = row as Record<string, unknown>
      return {
        bits: Array.isArray(record.bits) ? record.bits.map((bit) => (bit ? 1 : 0)) : [],
      }
    }) : []
    while (rows.length <= rowIndex) {
      const task = tasks[rows.length]
      rows.push({ bits: Array(task?.bit_count || 8).fill(0) })
    }
    const task = tasks[rowIndex]
    const bitCount = Number(task?.bit_count || rows[rowIndex].bits.length || 8)
    const bits = [...rows[rowIndex].bits]
    while (bits.length < bitCount) bits.push(0)
    bits[bitIndex] = bits[bitIndex] ? 0 : 1
    rows[rowIndex] = { bits }
    const completed = tasks.every((entry, index: number) => {
      const row = rows[index]
      return row ? buildBinaryValue(row.bits) === Number(entry?.target_value) : false
    })
    const solvedRows = tasks.filter((entry, index: number) => {
      const row = rows[index]
      return row ? buildBinaryValue(row.bits) === Number(entry?.target_value) : false
    }).length
    await updateStudentWidgetState(
      widgetId,
      { rows, completed },
      {
        summary: widget.title || 'Двоичное разложение',
        metric: `${solvedRows}/${tasks.length}`,
        value: completed ? 'готово' : 'в работе',
      },
      1,
      currentScene,
    )
  }, [currentScene, studentParticipant?.progress, updateStudentWidgetState])

  const setMatchPair = useCallback(async (widgetId: number, pairIndex: number, value: string) => {
    if (!currentScene) return
    const widget = currentScene.widgets.find((item) => item.id === widgetId)
    if (!widget) return
    const progress = studentParticipant?.progress?.[String(currentScene.id)]?.[String(widgetId)] || {}
    const matches = { ...(progress.matches || {}), [String(pairIndex)]: value }
    const pairs = Array.isArray(widget.config.pairs)
      ? (widget.config.pairs as Array<{ left?: string; right?: string }>)
      : []
    const matchedCount = pairs.filter((pair, index: number) => matches[String(index)] === pair?.right).length
    const completed = pairs.length > 0 && matchedCount === pairs.length
    await updateStudentWidgetState(
      widgetId,
      { matches, matched_count: matchedCount, completed },
      {
        summary: widget.title || 'Сопоставление',
        metric: `${matchedCount}/${pairs.length}`,
        value: completed ? 'готово' : 'собирает пары',
      },
      1,
      currentScene,
    )
  }, [currentScene, studentParticipant?.progress, updateStudentWidgetState])

  const moveOrderingItem = useCallback(async (widgetId: number, itemIndex: number, direction: -1 | 1) => {
    if (!currentScene) return
    const widget = currentScene.widgets.find((item) => item.id === widgetId)
    if (!widget) return
    const progress = studentParticipant?.progress?.[String(currentScene.id)]?.[String(widgetId)] || {}
    const baseOrder = Array.isArray(progress.order) && progress.order.length > 0
      ? [...progress.order]
      : getInitialOrdering(widget)
    const targetIndex = itemIndex + direction
    if (targetIndex < 0 || targetIndex >= baseOrder.length) return
    ;[baseOrder[itemIndex], baseOrder[targetIndex]] = [baseOrder[targetIndex], baseOrder[itemIndex]]
    const expectedOrder = getOrderingItems(widget)
    const completed =
      expectedOrder.length > 0 &&
      expectedOrder.length === baseOrder.length &&
      expectedOrder.every((item, index) => item === baseOrder[index])
    await updateStudentWidgetState(
      widgetId,
      { order: baseOrder, completed },
      {
        summary: widget.title || 'Порядок шагов',
        metric: `${baseOrder.length} шагов`,
        value: completed ? 'готово' : 'переставляет шаги',
      },
      1,
      currentScene,
    )
  }, [currentScene, studentParticipant?.progress, updateStudentWidgetState])

  const runCode = useCallback(async () => {
    if (!studentRun || !studentSessionId) {
      setStatus('Сначала подключись к уроку')
      setStatusKind('bad')
      return
    }

    const result = await apiCall<{
      status: string
      duration_ms: number
      stdout_text: string
      stderr_text: string
      friendly_error: string | null
    }>('/lesson-mode/code-runs', {
      method: 'POST',
      body: JSON.stringify({
        lesson_run_id: studentRun.id,
        session_id: studentSessionId,
        scene_id: currentScene?.id ?? null,
        source_code: code,
      }),
    })

    setCodeOutput(
      [
        result.stdout_text ? `ВЫВОД:\n${result.stdout_text}` : '',
        result.stderr_text ? `ОШИБКА:\n${result.stderr_text}` : '',
        result.friendly_error ? `ПОДСКАЗКА:\n${result.friendly_error}` : '',
      ]
        .filter(Boolean)
        .join('\n\n') || 'Пока нет вывода.',
    )
    setStatus(`Код выполнен • ${result.duration_ms} мс`)
    setStatusKind(result.status === 'ok' ? 'ok' : 'bad')
  }, [apiCall, code, currentScene?.id, studentRun, studentSessionId])

  const useCurrentRun = useCallback(() => {
    setStudentRunIdInput(localStorage.getItem(RUN_STORAGE_KEY) ?? '')
  }, [])

  const selectLesson = useCallback((lessonId: number) => {
    setSelectedLessonId(lessonId)
    setTeacherWorkspaceMode('editor')
    writeTeacherContext({
      selectedLessonId: lessonId,
      teacherClassName,
      teacherWorkspaceMode: 'editor',
    })
    void loadLessonDetail(lessonId, true)
  }, [loadLessonDetail, teacherClassName])

  const openBoardEditor = useCallback(() => {
    if (!selectedLessonId && !editorLesson) {
      createEmptyBoardDraft()
      return
    }
    setTeacherWorkspaceMode('editor')
    writeTeacherContext({
      selectedLessonId,
      teacherClassName,
      teacherWorkspaceMode: 'editor',
    })
    if (selectedLessonId) {
      void loadLessonDetail(selectedLessonId, true)
    }
    void openSurfaceWindow('teacher', 'board')
  }, [createEmptyBoardDraft, editorLesson, loadLessonDetail, openSurfaceWindow, selectedLessonId, teacherClassName])

  const loginAndOpenStudentWindow = useCallback(async () => {
    if (!studentSessionId) {
      await loginStudent()
    } else {
      localStorage.setItem(SESSION_STORAGE_KEY, String(studentSessionId))
      writeStudentContext({
        studentName: studentName.trim(),
        studentClassName: studentClassName.trim().toUpperCase(),
        studentSessionCode,
      })
    }
    await openSurfaceWindow('student', 'student')
  }, [loginStudent, openSurfaceWindow, studentClassName, studentName, studentSessionCode, studentSessionId])

  const changeEditorLesson = useCallback((lesson: Lesson) => {
    setEditorLesson(lesson)
    setEditorDirty(true)
  }, [])

  const widgetCallbacks: StudentWidgetCallbacks = {
    onSelectMultipleChoice: (widget: Widget, index: number) => void selectMultipleChoice(widget.id, index),
    onTogglePowerValue: (widget: Widget, value: number) => void togglePowerValue(widget.id, value),
    onToggleBinaryBit: (widget: Widget, rowIndex: number, bitIndex: number) => void toggleBinaryBit(widget.id, rowIndex, bitIndex),
    onSetMatchPair: (widget: Widget, pairIndex: number, value: string) => void setMatchPair(widget.id, pairIndex, value),
    onMoveOrderingItem: (widget: Widget, itemIndex: number, direction: -1 | 1) => void moveOrderingItem(widget.id, itemIndex, direction),
  }

  return {
    shell: {
      windowKind: windowParams.windowKind,
      role,
      setRole,
      status,
      statusKind,
      currentLessonLabel,
      projectedStudentName,
    },
    api: {
      apiBase,
      apiBaseInput,
      setApiBaseInput,
      defaultApiBase: DEFAULT_API_BASE,
      lanApiBase: DEFAULT_LAN_API_BASE,
      applyApiBase,
      checkHealth,
      openSurfaceWindow,
    },
    teacher: {
      lessons,
      selectedLessonId,
      teacherClassName,
      setTeacherClassName,
      teacherRun,
      teacherLesson,
      teacherSurface,
      setTeacherSurface,
      teacherWorkspaceMode,
      setTeacherWorkspaceMode,
      teacherSceneAnimKey,
      selectedSessionId,
      selectedInspection,
      projectedSessionId,
      editorLesson,
      editorSceneIndex,
      setEditorSceneIndex,
      editorDirty,
      isSavingLesson,
      currentTeacherScene,
      currentEditorScene,
      teacherSceneList,
      ensureDemoLesson,
      createStarterBoardLesson,
      createEmptyBoardDraft,
      loadLessonLibrary,
      selectLesson,
      openBoardEditor,
      startTeacherRun,
      saveEditedLesson,
      syncTeacherRun,
      openTeacherScene,
      inspectStudent,
      awardStar,
      toggleProjectedStudent,
      changeEditorLesson,
    },
    student: {
      studentName,
      setStudentName,
      studentClassName,
      setStudentClassName,
      studentSessionId,
      studentSessionCode,
      studentRunIdInput,
      setStudentRunIdInput,
      studentRun,
      studentParticipant,
      studentCurrentScene: currentScene,
      studentSceneAnimKey,
      studentCanvasMode,
      powerModel,
      code,
      setCode,
      codeOutput,
      loginStudent,
      loginAndOpenStudentWindow,
      joinStudentRun,
      resumeStudentSession,
      syncStudentState,
      navigateStudent,
      togglePowerValue,
      selectMultipleChoice,
      toggleBinaryBit,
      setMatchPair,
      moveOrderingItem,
      runCode,
      useCurrentRun,
      widgetCallbacks,
    },
  }
}
