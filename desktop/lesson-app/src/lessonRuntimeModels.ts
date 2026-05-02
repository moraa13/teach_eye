/* eslint-disable @typescript-eslint/no-explicit-any */
export type Widget = {
  id: number
  widget_type: string
  title: string
  order_index?: number
  layout?: Record<string, unknown>
  config: Record<string, any>
}

export type Scene = {
  id: number
  title: string
  scene_type?: string
  order_index?: number
  layout?: Record<string, unknown>
  notes_text: string
  widgets: Widget[]
}

export type Lesson = {
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

export type Participant = {
  session_id: number
  student_name: string
  class_name: string
  current_scene_index: number
  highest_unlocked_scene_index: number
  stars_tenths: number
  activity_points: number
  preview: Record<string, string>
  progress: Record<string, Record<string, any>>
  progress_version?: number
}

export type LessonRun = {
  id: number
  class_name: string
  current_scene_index: number
  highest_unlocked_scene_index: number
  participants: Participant[]
}

export type CodeRun = {
  id: number
  scene_id: number | null
  scene_title: string
  source_code: string
  status: string
  exit_code: number | null
  stdout_text: string
  stderr_text: string
  friendly_error: string
  duration_ms: number | null
  created_at: string | null
}

export type ParticipantInspection = {
  participant: Participant
  scene: Scene
  lesson: { id: number; title: string }
  code_runs: CodeRun[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function asNumber(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function asString(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

function asStringMap(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {}
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, typeof entry === 'string' ? entry : String(entry ?? '')]))
}

function asProgressMap(value: unknown): Record<string, Record<string, any>> {
  if (!isRecord(value)) return {}
  return Object.fromEntries(
    Object.entries(value).map(([sceneId, sceneValue]) => {
      if (!isRecord(sceneValue)) return [sceneId, {}]
      return [
        sceneId,
        Object.fromEntries(
          Object.entries(sceneValue).map(([widgetId, widgetValue]) => [widgetId, isRecord(widgetValue) ? { ...widgetValue } : {}]),
        ),
      ]
    }),
  )
}

function nextEntityId(index: number) {
  return -(index + 1)
}

export function normalizeWidget(rawWidget: unknown, index = 0): Widget {
  const widget = isRecord(rawWidget) ? rawWidget : {}
  return {
    id: asNumber(widget.id, nextEntityId(index)),
    widget_type: asString(widget.widget_type, 'widget'),
    title: asString(widget.title, ''),
    order_index: asNumber(widget.order_index, index),
    layout: isRecord(widget.layout) ? { ...widget.layout } : {},
    config: isRecord(widget.config) ? { ...widget.config } : {},
  }
}

export function normalizeScene(rawScene: unknown, index = 0): Scene {
  const scene = isRecord(rawScene) ? rawScene : {}
  const widgets = Array.isArray(scene.widgets) ? scene.widgets.map((widget, widgetIndex) => normalizeWidget(widget, widgetIndex)) : []
  return {
    id: asNumber(scene.id, nextEntityId(index)),
    title: asString(scene.title, `Сцена ${index + 1}`),
    scene_type: asString(scene.scene_type, 'board'),
    order_index: asNumber(scene.order_index, index),
    layout: isRecord(scene.layout) ? { ...scene.layout } : {},
    notes_text: asString(scene.notes_text, ''),
    widgets,
  }
}

export function normalizeLesson(rawLesson: unknown): Lesson {
  const lesson = isRecord(rawLesson) ? rawLesson : {}
  const scenes = Array.isArray(lesson.scenes) ? lesson.scenes.map((scene, index) => normalizeScene(scene, index)) : []
  return {
    id: asNumber(lesson.id, 0),
    title: asString(lesson.title, 'Без названия'),
    topic: asString(lesson.topic, ''),
    grade_band: asString(lesson.grade_band, ''),
    level: asString(lesson.level, ''),
    author_name: asString(lesson.author_name, ''),
    summary: asString(lesson.summary, ''),
    tags: Array.isArray(lesson.tags) ? lesson.tags.filter((value): value is string => typeof value === 'string') : [],
    status: asString(lesson.status, 'draft'),
    is_template: typeof lesson.is_template === 'boolean' ? lesson.is_template : false,
    scenes,
  }
}

export function normalizeParticipant(rawParticipant: unknown, index = 0): Participant {
  const participant = isRecord(rawParticipant) ? rawParticipant : {}
  return {
    session_id: asNumber(participant.session_id, nextEntityId(index)),
    student_name: asString(participant.student_name, 'Ученик'),
    class_name: asString(participant.class_name, ''),
    current_scene_index: asNumber(participant.current_scene_index, 0),
    highest_unlocked_scene_index: asNumber(participant.highest_unlocked_scene_index, 0),
    stars_tenths: asNumber(participant.stars_tenths, 0),
    activity_points: asNumber(participant.activity_points, 0),
    preview: asStringMap(participant.preview),
    progress: asProgressMap(participant.progress),
    progress_version: asNumber(participant.progress_version, 0),
  }
}

export function normalizeLessonRun(rawRun: unknown): LessonRun {
  const run = isRecord(rawRun) ? rawRun : {}
  const participants = Array.isArray(run.participants)
    ? run.participants.map((participant, index) => normalizeParticipant(participant, index))
    : []
  return {
    id: asNumber(run.id, 0),
    class_name: asString(run.class_name, ''),
    current_scene_index: asNumber(run.current_scene_index, 0),
    highest_unlocked_scene_index: asNumber(run.highest_unlocked_scene_index, 0),
    participants,
  }
}

export function normalizeCodeRun(rawCodeRun: unknown, index = 0): CodeRun {
  const codeRun = isRecord(rawCodeRun) ? rawCodeRun : {}
  return {
    id: asNumber(codeRun.id, nextEntityId(index)),
    scene_id: typeof codeRun.scene_id === 'number' ? codeRun.scene_id : null,
    scene_title: asString(codeRun.scene_title, ''),
    source_code: asString(codeRun.source_code, ''),
    status: asString(codeRun.status, 'ok'),
    exit_code: typeof codeRun.exit_code === 'number' ? codeRun.exit_code : null,
    stdout_text: asString(codeRun.stdout_text, ''),
    stderr_text: asString(codeRun.stderr_text, ''),
    friendly_error: asString(codeRun.friendly_error, ''),
    duration_ms: typeof codeRun.duration_ms === 'number' ? codeRun.duration_ms : null,
    created_at: typeof codeRun.created_at === 'string' ? codeRun.created_at : null,
  }
}

export function normalizeParticipantInspection(rawInspection: unknown): ParticipantInspection {
  const inspection = isRecord(rawInspection) ? rawInspection : {}
  const lesson = isRecord(inspection.lesson) ? inspection.lesson : {}
  return {
    participant: normalizeParticipant(inspection.participant),
    scene: normalizeScene(inspection.scene),
    lesson: {
      id: asNumber(lesson.id, 0),
      title: asString(lesson.title, ''),
    },
    code_runs: Array.isArray(inspection.code_runs)
      ? inspection.code_runs.map((codeRun, index) => normalizeCodeRun(codeRun, index))
      : [],
  }
}
