import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import {
  COLOR_PALETTE,
  DEFAULT_DAYS,
  DEFAULT_SLOTS,
  type Course,
  type CourseType,
  type DayDef,
  type SubjectColor,
  type TimeSlot,
  type Timetable,
} from '../types';
import { hashColor, normalizeHex, subjectColorFor } from '../lib/colors';
import { capacitorStorage } from '../lib/storage';
import { uid } from '../lib/time';

function emptyTimetable(name: string): Timetable {
  return {
    id: uid('tt'),
    name,
    days: DEFAULT_DAYS.map((d) => ({ ...d })),
    slots: DEFAULT_SLOTS.map((s) => ({ ...s })),
    courses: [],
    subjectColors: [],
  };
}

function cloneTt(tt: Timetable): Timetable {
  return structuredClone(tt);
}

function sortSlots(slots: TimeSlot[]): TimeSlot[] {
  return [...slots].sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
}

interface TimetableState {
  timetables: Timetable[];
  activeId: string;
  past: Timetable[];
  future: Timetable[];
  hydrated: boolean;

  active: () => Timetable;
  setHydrated: (v: boolean) => void;

  pushHistory: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  createTimetable: (name?: string) => void;
  renameTimetable: (id: string, name: string) => void;
  duplicateTimetable: (id: string) => void;
  deleteTimetable: (id: string) => void;
  setActive: (id: string) => void;
  replaceActive: (tt: Timetable, withHistory?: boolean) => void;
  importTimetable: (tt: Timetable) => void;

  moveOrSwap: (fromDay: string, fromSlot: string, toDay: string, toSlot: string) => void;
  upsertCourse: (course: Omit<Course, 'id'> & { id?: string }) => void;
  duplicateCourse: (id: string) => void;
  deleteCourse: (id: string) => void;
  setSubjectColor: (name: string, color: string) => void;
  getSubjectColor: (name: string) => string;

  addDay: (name: string, weekday: number) => void;
  removeDay: (id: string) => void;
  renameDay: (id: string, name: string) => void;
  setDayWeekday: (id: string, weekday: number) => void;
  addSlot: (start: string, end: string) => void;
  updateSlot: (id: string, patch: Partial<TimeSlot>) => void;
  removeSlot: (id: string) => void;
}

function patchActive(
  get: () => TimetableState,
  set: (p: Partial<TimetableState> | ((s: TimetableState) => Partial<TimetableState>)) => void,
  mutator: (tt: Timetable) => Timetable,
  withHistory = true,
) {
  if (withHistory) get().pushHistory();
  set((s) => ({
    timetables: s.timetables.map((t) => (t.id === s.activeId ? mutator(cloneTt(t)) : t)),
    future: withHistory ? [] : s.future,
  }));
}

const initial = emptyTimetable('Groupe G1');

export const useTimetableStore = create<TimetableState>()(
  persist(
    (set, get) => ({
      timetables: [initial],
      activeId: initial.id,
      past: [],
      future: [],
      hydrated: false,

      active: () => {
        const s = get();
        return s.timetables.find((t) => t.id === s.activeId) ?? s.timetables[0]!;
      },

      setHydrated: (v) => set({ hydrated: v }),

      pushHistory: () => {
        const cur = get().active();
        set((s) => ({
          past: [...s.past, cloneTt(cur)],
        }));
      },

      undo: () => {
        const s = get();
        if (!s.past.length) return;
        const prev = s.past[s.past.length - 1]!;
        const cur = cloneTt(s.active());
        set({
          past: s.past.slice(0, -1),
          future: [cur, ...s.future],
          timetables: s.timetables.map((t) => (t.id === s.activeId ? { ...prev, id: s.activeId } : t)),
        });
      },

      redo: () => {
        const s = get();
        if (!s.future.length) return;
        const next = s.future[0]!;
        const cur = cloneTt(s.active());
        set({
          future: s.future.slice(1),
          past: [...s.past, cur],
          timetables: s.timetables.map((t) => (t.id === s.activeId ? { ...next, id: s.activeId } : t)),
        });
      },

      canUndo: () => get().past.length > 0,
      canRedo: () => get().future.length > 0,

      createTimetable: (name) => {
        const n = get().timetables.length + 1;
        const tt = emptyTimetable(name ?? `Groupe G${n}`);
        set((s) => ({ timetables: [...s.timetables, tt], activeId: tt.id, past: [], future: [] }));
      },

      renameTimetable: (id, name) => {
        set((s) => ({
          timetables: s.timetables.map((t) => (t.id === id ? { ...t, name: name.trim() || t.name } : t)),
        }));
      },

      duplicateTimetable: (id) => {
        const src = get().timetables.find((t) => t.id === id);
        if (!src) return;
        const copy = cloneTt(src);
        copy.id = uid('tt');
        copy.name = `${src.name} (copie)`;
        copy.courses = copy.courses.map((c) => ({ ...c, id: uid('c') }));
        set((s) => ({ timetables: [...s.timetables, copy], activeId: copy.id, past: [], future: [] }));
      },

      deleteTimetable: (id) => {
        const s = get();
        if (s.timetables.length <= 1) return;
        const next = s.timetables.filter((t) => t.id !== id);
        set({
          timetables: next,
          activeId: s.activeId === id ? next[0]!.id : s.activeId,
          past: [],
          future: [],
        });
      },

      setActive: (id) => set({ activeId: id, past: [], future: [] }),

      replaceActive: (tt, withHistory = true) => {
        patchActive(get, set, () => ({ ...tt, id: get().activeId }), withHistory);
      },

      importTimetable: (tt) => {
        const copy = cloneTt(tt);
        copy.id = uid('tt');
        set((s) => ({ timetables: [...s.timetables, copy], activeId: copy.id, past: [], future: [] }));
      },

      moveOrSwap: (fromDay, fromSlot, toDay, toSlot) => {
        if (fromDay === toDay && fromSlot === toSlot) return;
        patchActive(get, set, (tt) => {
          const from = tt.courses.find((c) => c.dayId === fromDay && c.slotId === fromSlot);
          if (!from) return tt;
          const to = tt.courses.find((c) => c.dayId === toDay && c.slotId === toSlot);
          if (to) {
            return {
              ...tt,
              courses: tt.courses.map((c) => {
                if (c.id === from.id) return { ...c, dayId: toDay, slotId: toSlot };
                if (c.id === to.id) return { ...c, dayId: fromDay, slotId: fromSlot };
                return c;
              }),
            };
          }
          return {
            ...tt,
            courses: tt.courses.map((c) =>
              c.id === from.id ? { ...c, dayId: toDay, slotId: toSlot } : c,
            ),
          };
        });
      },

      upsertCourse: (course) => {
        patchActive(get, set, (tt) => {
          const id = course.id ?? uid('c');
          const next: Course = {
            id,
            name: course.name.trim(),
            type: course.type,
            teacher: course.teacher.trim(),
            room: course.room.trim(),
            notes: course.notes.trim(),
            dayId: course.dayId,
            slotId: course.slotId,
          };
          const exists = tt.courses.some((c) => c.id === id);
          const previous = tt.courses.find((c) => c.id === id);
          const occupying = tt.courses.find(
            (c) => c.id !== id && c.dayId === next.dayId && c.slotId === next.slotId,
          );
          let courses: Course[];
          if (exists && previous) {
            courses = tt.courses.map((c) => {
              if (c.id === id) return next;
              if (occupying && c.id === occupying.id) {
                return { ...c, dayId: previous.dayId, slotId: previous.slotId };
              }
              return c;
            });
          } else {
            courses = [
              ...tt.courses.filter((c) => !(c.dayId === next.dayId && c.slotId === next.slotId)),
              next,
            ];
          }
          // Couleur matière auto
          const subjectColors = ensureColor(tt.subjectColors, next.name);
          return { ...tt, courses, subjectColors };
        });
      },

      duplicateCourse: (id) => {
        patchActive(get, set, (tt) => {
          const src = tt.courses.find((c) => c.id === id);
          if (!src) return tt;
          // Première case vide
          for (const day of tt.days) {
            for (const slot of tt.slots) {
              if (slot.isBreak) continue;
              const busy = tt.courses.some((c) => c.dayId === day.id && c.slotId === slot.id);
              if (!busy) {
                return {
                  ...tt,
                  courses: [
                    ...tt.courses,
                    { ...src, id: uid('c'), dayId: day.id, slotId: slot.id },
                  ],
                };
              }
            }
          }
          return tt;
        });
      },

      deleteCourse: (id) => {
        patchActive(get, set, (tt) => ({
          ...tt,
          courses: tt.courses.filter((c) => c.id !== id),
        }));
      },

      setSubjectColor: (name, color) => {
        const hex = normalizeHex(color);
        patchActive(get, set, (tt) => {
          const key = name.trim().toLowerCase();
          const subjectColors = [...tt.subjectColors];
          const idx = subjectColors.findIndex((s) => s.name.trim().toLowerCase() === key);
          if (idx >= 0) subjectColors[idx] = { name: subjectColors[idx]!.name, color: hex };
          else subjectColors.push({ name: name.trim(), color: hex });
          return { ...tt, subjectColors };
        });
      },

      getSubjectColor: (name) => {
        const tt = get().active();
        return subjectColorFor(name, tt.subjectColors);
      },

      addDay: (name, weekday) => {
        patchActive(get, set, (tt) => ({
          ...tt,
          days: [...tt.days, { id: uid('d'), name: name.trim() || 'Jour', weekday }],
        }));
      },

      removeDay: (id) => {
        patchActive(get, set, (tt) => {
          if (tt.days.length <= 1) return tt;
          return {
            ...tt,
            days: tt.days.filter((d) => d.id !== id),
            courses: tt.courses.filter((c) => c.dayId !== id),
          };
        });
      },

      renameDay: (id, name) => {
        patchActive(get, set, (tt) => ({
          ...tt,
          days: tt.days.map((d) => (d.id === id ? { ...d, name: name.trim() || d.name } : d)),
        }));
      },

      setDayWeekday: (id, weekday) => {
        if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return;
        patchActive(get, set, (tt) => ({
          ...tt,
          days: tt.days.map((day) => (day.id === id ? { ...day, weekday } : day)),
        }));
      },

      addSlot: (start, end) => {
        patchActive(get, set, (tt) => ({
          ...tt,
          slots: sortSlots([...tt.slots, { id: uid('s'), start, end }]),
        }));
      },

      updateSlot: (id, patch) => {
        patchActive(get, set, (tt) => ({
          ...tt,
          slots: sortSlots(tt.slots.map((s) => (s.id === id ? { ...s, ...patch } : s))),
        }));
      },

      removeSlot: (id) => {
        patchActive(get, set, (tt) => {
          const slot = tt.slots.find((s) => s.id === id);
          if (!slot) return tt;
          const teaching = tt.slots.filter((s) => !s.isBreak);
          if (!slot.isBreak && teaching.length <= 1) return tt;
          return {
            ...tt,
            slots: tt.slots.filter((s) => s.id !== id),
            courses: tt.courses.filter((c) => c.slotId !== id),
          };
        });
      },
    }),
    {
      name: 'edt-timetables-v1',
      storage: createJSONStorage(() => capacitorStorage),
      partialize: (s) => ({
        timetables: s.timetables,
        activeId: s.activeId,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHydrated(true);
      },
    },
  ),
);

function ensureColor(list: SubjectColor[], name: string): SubjectColor[] {
  const key = name.trim().toLowerCase();
  if (!key) return list;
  if (list.some((s) => s.name.trim().toLowerCase() === key)) return list;
  return [...list, { name: name.trim(), color: hashColor(name, COLOR_PALETTE) }];
}

export type { Course, CourseType, DayDef, TimeSlot, Timetable };
