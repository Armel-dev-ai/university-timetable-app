import type { Course, DayDef, TimeSlot, Timetable } from '../types';

export function parseHm(hm: string): number {
  const [h, m] = hm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function formatHm(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function slotDurationHours(slot: TimeSlot): number {
  return Math.max(0, (parseHm(slot.end) - parseHm(slot.start)) / 60);
}

export function nowMinutes(): number {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

export function todayWeekday(): number {
  return new Date().getDay();
}

export interface NowInfo {
  kind: 'ongoing' | 'next' | 'none';
  course: Course | null;
  day: DayDef | null;
  slot: TimeSlot | null;
  label: string;
}

export function getNowInfo(tt: Timetable): NowInfo {
  const wd = todayWeekday();
  const day = tt.days.find((d) => d.weekday === wd) ?? null;
  if (!day) {
    return { kind: 'none', course: null, day: null, slot: null, label: 'Pas de cours aujourd’hui' };
  }

  const mins = nowMinutes();
  const teaching = tt.slots.filter((s) => !s.isBreak);

  for (const slot of teaching) {
    const start = parseHm(slot.start);
    const end = parseHm(slot.end);
    if (mins >= start && mins < end) {
      const course = tt.courses.find((c) => c.dayId === day.id && c.slotId === slot.id) ?? null;
      if (course) {
        return {
          kind: 'ongoing',
          course,
          day,
          slot,
          label: `En cours · ${course.name} · ${course.room || 'salle ?'}`,
        };
      }
    }
  }

  for (const slot of teaching) {
    const start = parseHm(slot.start);
    if (start > mins) {
      const course = tt.courses.find((c) => c.dayId === day.id && c.slotId === slot.id) ?? null;
      if (course) {
        return {
          kind: 'next',
          course,
          day,
          slot,
          label: `Prochain · ${course.name} à ${slot.start} · ${course.room || 'salle ?'}`,
        };
      }
    }
  }

  return { kind: 'none', course: null, day, slot: null, label: 'Plus de cours aujourd’hui' };
}

export function uid(prefix = 'id'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}
