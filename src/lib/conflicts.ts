import type { Course, Timetable } from '../types';
import { parseHm } from './time';

export interface Conflict {
  a: Course;
  b: Course;
  reason: 'enseignant' | 'salle';
  detail: string;
}

/** Conflits : même enseignant ou même salle sur le même créneau (jours différents OK) */
export function findConflicts(tt: Timetable): Conflict[] {
  const out: Conflict[] = [];
  const list = tt.courses;
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i]!;
      const b = list[j]!;
      if (a.dayId !== b.dayId) continue;
      const slotA = tt.slots.find((slot) => slot.id === a.slotId);
      const slotB = tt.slots.find((slot) => slot.id === b.slotId);
      if (!slotA || !slotB || slotA.isBreak || slotB.isBreak) continue;
      const overlaps = parseHm(slotA.start) < parseHm(slotB.end)
        && parseHm(slotB.start) < parseHm(slotA.end);
      if (!overlaps) continue;
      const teacherA = a.teacher.trim().toLowerCase();
      const teacherB = b.teacher.trim().toLowerCase();
      if (teacherA && teacherA === teacherB) {
        out.push({
          a,
          b,
          reason: 'enseignant',
          detail: `${a.teacher} : ${a.name} et ${b.name} se chevauchent le même jour`,
        });
      }
      const roomA = a.room.trim().toLowerCase();
      const roomB = b.room.trim().toLowerCase();
      if (roomA && roomA === roomB) {
        out.push({
          a,
          b,
          reason: 'salle',
          detail: `Salle ${a.room} : ${a.name} et ${b.name} se chevauchent le même jour`,
        });
      }
    }
  }
  return out;
}

export function courseHasConflict(courseId: string, conflicts: Conflict[]): boolean {
  return conflicts.some((c) => c.a.id === courseId || c.b.id === courseId);
}
