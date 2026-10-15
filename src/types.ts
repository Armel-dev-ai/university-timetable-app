export type CourseType = 'Cours' | 'TD' | 'TP' | 'EL';

export type ThemeMode = 'light' | 'dark' | 'auto';
export type Language = 'fr' | 'en' | 'ar';

export type ViewMode = 'week' | 'day';

export interface TimeSlot {
  id: string;
  start: string; // HH:mm
  end: string;
  isBreak?: boolean;
}

export interface DayDef {
  id: string;
  name: string;
  /** 0=Dim … 6=Sam (JS getDay), pour rappels */
  weekday: number;
}

export interface Course {
  id: string;
  name: string;
  type: CourseType;
  teacher: string;
  room: string;
  notes: string;
  dayId: string;
  slotId: string;
}

export interface SubjectColor {
  name: string;
  color: string;
}

export interface Timetable {
  id: string;
  name: string;
  days: DayDef[];
  slots: TimeSlot[];
  courses: Course[];
  subjectColors: SubjectColor[];
}

export interface AiCell {
  day: string;
  slot: string;
  name: string;
  type: CourseType | string;
  teacher: string;
  room: string;
  rawText?: string;
}

export interface AiParseResult {
  title: string;
  cells: AiCell[];
  additionalSlots?: TimeSlot[];
  rawText?: string;
}

export interface AppSettings {
  theme: ThemeMode;
  language: Language;
  reminderMinutes: number;
  remindersEnabled: boolean;
  captureMode: boolean;
  searchQuery: string;
  viewMode: ViewMode;
  selectedDayId: string | null;
}

export const DEFAULT_DAYS: DayDef[] = [
  { id: 'sam', name: 'Samedi', weekday: 6 },
  { id: 'dim', name: 'Dimanche', weekday: 0 },
  { id: 'lun', name: 'Lundi', weekday: 1 },
  { id: 'mar', name: 'Mardi', weekday: 2 },
  { id: 'mer', name: 'Mercredi', weekday: 3 },
  { id: 'jeu', name: 'Jeudi', weekday: 4 },
];

export const DEFAULT_SLOTS: TimeSlot[] = [
  { id: 's1', start: '08:00', end: '09:30' },
  { id: 's2', start: '09:40', end: '11:10' },
  { id: 's3', start: '11:20', end: '12:50' },
  { id: 'break', start: '12:50', end: '13:10', isBreak: true },
  { id: 's4', start: '13:10', end: '14:40' },
  { id: 's5', start: '14:50', end: '16:20' },
  { id: 's6', start: '16:30', end: '18:00' },
];

export const COURSE_TYPES: CourseType[] = ['Cours', 'TD', 'TP', 'EL'];

export const COLOR_PALETTE = [
  '#526F8F', '#607D6C', '#80708F', '#9B665A', '#4F7E80',
  '#8A744C', '#626F91', '#956A76', '#4F7468', '#8B6750',
  '#607B8D', '#79647F', '#79764D', '#8B5F5A', '#4F6980',
];
