export type { Lesson, LessonRun, Participant, Scene } from './lessonRuntimeModels'

export type Role = 'teacher' | 'student'

export type StatusKind = 'ok' | 'bad' | 'muted'

export type WindowKind = 'main' | 'teacher-board' | 'teacher-control' | 'student'

export type LessonSummary = {
  id: number
  title: string
  topic: string
}

export type TeacherSurface = 'board' | 'control'
