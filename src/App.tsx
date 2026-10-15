import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragOverEvent,
  type DragEndEvent,
  type DragStartEvent,
  type DragCancelEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { App as CapacitorApp } from '@capacitor/app';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { BottomSheet } from './components/ui/BottomSheet';
import { CourseCell, CourseDragOverlay } from './components/CourseCell';
import { GridCell } from './components/GridCell';
import { ToastHost } from './components/ui/Toast';
import { Select } from './components/ui/Select';
import { COLOR_PALETTE, COURSE_TYPES, type AiParseResult, type Course, type CourseType, type DayDef, type Language, type Timetable, type TimeSlot } from './types';
import { findConflicts, courseHasConflict } from './lib/conflicts';
import { subjectColorFor, textColorForBg } from './lib/colors';
import { hapticLight, hapticMedium } from './lib/haptics';
import { requestReminderPermissions, syncReminders } from './lib/notifications';
import { getNowInfo, parseHm, uid } from './lib/time';
import { localeCode, localizedDay, translate } from './lib/i18n';
import { useSettingsStore } from './store/settingsStore';
import { useTimetableStore } from './store/timetableStore';
import { useToast } from './store/toastStore';

type Panel = 'planning' | 'statistics' | 'settings';
const WEEKDAY_NAMES = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

interface EditorState {
  dayId: string;
  slotId: string;
  courseId?: string;
}

interface ConfirmState {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
}

const scheduleCollisionDetection: CollisionDetection = (args) => {
  if (!args.pointerCoordinates) return closestCenter(args);
  return pointerWithin(args);
};

function normalized(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f\u064b-\u065f\u0670]/g, '').trim().toLocaleLowerCase();
}

function matchDay(days: DayDef[], value: string): DayDef | undefined {
  return days.find((day) => normalized(day.name) === normalized(value));
}

function matchSlot(slots: TimeSlot[], value: string): TimeSlot | undefined {
  const [start, end] = value.split(/[-–—]/).map((part) => part.trim());
  return slots.find((slot) => !slot.isBreak && (slot.start === start || `${slot.start}-${slot.end}` === value.replace(/\s/g, '')))
    ?? slots.find((slot) => !slot.isBreak && slot.start === end);
}

function isValidTimetable(value: unknown): value is Timetable {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<Timetable>;
  const validTime = (time: unknown) => typeof time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
  return typeof candidate.id === 'string'
    && typeof candidate.name === 'string'
    && Array.isArray(candidate.days)
    && candidate.days.length > 0
    && candidate.days.every((day) => typeof day.id === 'string' && typeof day.name === 'string' && Number.isInteger(day.weekday) && day.weekday >= 0 && day.weekday <= 6)
    && Array.isArray(candidate.slots)
    && candidate.slots.length > 0
    && candidate.slots.every((slot) => typeof slot.id === 'string' && validTime(slot.start) && validTime(slot.end))
    && candidate.slots.some((slot) => !slot.isBreak)
    && Array.isArray(candidate.courses)
    && candidate.courses.every((course) => typeof course.id === 'string' && typeof course.name === 'string' && COURSE_TYPES.includes(course.type) && typeof course.teacher === 'string' && typeof course.room === 'string' && typeof course.notes === 'string' && typeof course.dayId === 'string' && typeof course.slotId === 'string')
    && Array.isArray(candidate.subjectColors)
    && candidate.subjectColors.every((color) => typeof color.name === 'string' && typeof color.color === 'string');
}

function App() {
  const timetables = useTimetableStore((s) => s.timetables);
  const activeId = useTimetableStore((s) => s.activeId);
  const tt = useTimetableStore((s) => s.active());
  const hydrated = useTimetableStore((s) => s.hydrated);
  const moveOrSwap = useTimetableStore((s) => s.moveOrSwap);
  const upsertCourse = useTimetableStore((s) => s.upsertCourse);
  const replaceActive = useTimetableStore((s) => s.replaceActive);
  const duplicateCourse = useTimetableStore((s) => s.duplicateCourse);
  const deleteCourse = useTimetableStore((s) => s.deleteCourse);
  const undo = useTimetableStore((s) => s.undo);
  const redo = useTimetableStore((s) => s.redo);
  const canUndo = useTimetableStore((s) => s.canUndo());
  const canRedo = useTimetableStore((s) => s.canRedo());
  const settings = useSettingsStore();
  const t = (source: string, values?: Record<string, string | number>) => translate(settings.language, source, values);
  const toast = useToast((s) => s.show);
  const [panel, setPanel] = useState<Panel>('planning');
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [dragCourse, setDragCourse] = useState<Course | null>(null);
  const [preview, setPreview] = useState<AiParseResult | null>(null);
  const [analysisBusy, setAnalysisBusy] = useState(false);
  const [analysisStatus, setAnalysisStatus] = useState('Reconnaissance locale…');
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [newGroupName, setNewGroupName] = useState('');
  const [newDayName, setNewDayName] = useState('');
  const [newDayWeekday, setNewDayWeekday] = useState(1);
  const [newSlotStart, setNewSlotStart] = useState('18:10');
  const [newSlotEnd, setNewSlotEnd] = useState('19:40');
  const [dragAnnouncement, setDragAnnouncement] = useState('');
  const [weekNow, setWeekNow] = useState(() => getNowInfo(tt));
  const [today, setToday] = useState(() => new Date());
  const suppressClickUntil = useRef(0);
  const [renameState, setRenameState] = useState({ id: activeId, value: tt.name });
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const restoreRef = useRef<HTMLInputElement>(null);
  const renameValue = renameState.id === activeId ? renameState.value : tt.name;
  const store = useTimetableStore.getState();
  const incompletePreviewCount = preview?.cells.filter((cell) =>
    !cell.name.trim() || !matchDay(tt.days, cell.day) || !matchSlot([...tt.slots, ...(preview.additionalSlots ?? [])], cell.slot),
  ).length ?? 0;
  const conflicts = useMemo(() => findConflicts(tt), [tt]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { delay: 240, tolerance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 280, tolerance: 10 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    const applyTheme = () => {
      const dark = settings.theme === 'dark'
        || (settings.theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.classList.toggle('dark', dark);
      document.documentElement.classList.toggle('capture-mode', settings.captureMode);
      document.documentElement.lang = settings.language;
      document.documentElement.dir = settings.language === 'ar' ? 'rtl' : 'ltr';
      if (Capacitor.isNativePlatform()) {
        void Promise.all([
          StatusBar.setStyle({ style: dark ? Style.Light : Style.Dark }),
          StatusBar.setBackgroundColor({ color: dark ? '#1D1F22' : '#F2F3F4' }),
        ]).catch(() => toast(translate(settings.language, 'Impossible d’actualiser la barre d’état.')));
      }
    };
    applyTheme();
    if (settings.theme !== 'auto') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', applyTheme);
    return () => media.removeEventListener('change', applyTheme);
  }, [settings.theme, settings.captureMode, settings.language, toast]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setWeekNow(getNowInfo(tt));
      setToday(new Date());
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [tt]);

  useEffect(() => {
    if (!hydrated) return;
    void syncReminders(tt, settings.reminderMinutes, settings.remindersEnabled, settings.language).catch(() => {
      toast(translate(settings.language, 'Impossible de mettre à jour les rappels. Vérifiez les autorisations de notification.'));
    });
  }, [hydrated, tt, settings.reminderMinutes, settings.remindersEnabled, settings.language, toast]);

  useEffect(() => {
    if (!hydrated || !Capacitor.isNativePlatform()) return;
    let disposed = false;
    let removeListener: (() => void) | undefined;
    void CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) return;
      const currentSettings = useSettingsStore.getState();
      const currentTimetable = useTimetableStore.getState().active();
      void syncReminders(currentTimetable, currentSettings.reminderMinutes, currentSettings.remindersEnabled, currentSettings.language).catch(() => {
        toast(translate(currentSettings.language, 'Impossible de mettre à jour les rappels. Vérifiez les autorisations de notification.'));
      });
    }).then((listener) => {
      if (disposed) void listener.remove();
      else removeListener = () => { void listener.remove(); };
    }).catch(() => toast(translate(settings.language, 'Impossible de réactiver les rappels au retour dans l’application.')));
    return () => {
      disposed = true;
      removeListener?.();
    };
  }, [hydrated, settings.language, toast]);

  const selectedDay = tt.days.find((day) => day.id === settings.selectedDayId) ?? tt.days[0];
  const visibleDays = settings.viewMode === 'day' && selectedDay ? [selectedDay] : tt.days;
  const activeSearchDayId = settings.viewMode === 'day' ? selectedDay?.id : undefined;
  const nowLabel = weekNow.kind === 'ongoing' && weekNow.course && weekNow.slot
    ? t('En cours · {course} · {room}', { course: weekNow.course.name, room: weekNow.course.room || t('salle non précisée') })
    : weekNow.kind === 'next' && weekNow.course && weekNow.slot
      ? t('Prochain · {course} à {time} · {room}', { course: weekNow.course.name, time: weekNow.slot.start, room: weekNow.course.room || t('salle non précisée') })
      : t(weekNow.label);
  const query = normalized(settings.searchQuery);
  const filteredCourses = useMemo(() => {
    if (!query) return tt.courses;
    return tt.courses.filter((course) => {
      const day = tt.days.find((item) => item.id === course.dayId);
      const slot = tt.slots.find((item) => item.id === course.slotId);
      const searchable = [
        course.name,
        course.teacher,
        course.room,
        course.type,
        translate(settings.language, course.type),
        course.notes,
        day?.name ?? '',
        day ? localizedDay(day, settings.language) : '',
        slot?.start ?? '',
        slot?.end ?? '',
      ];
      return (activeSearchDayId === undefined || course.dayId === activeSearchDayId)
        && searchable.some((value) => normalized(value).includes(query));
    });
  }, [query, tt.courses, tt.days, tt.slots, settings.language, activeSearchDayId]);
  const conflictsForUi = conflicts.length > 0;
  const stats = useMemo(() => {
    const map = new Map<string, number>();
    for (const course of tt.courses) {
      const slot = tt.slots.find((item) => item.id === course.slotId);
      if (slot && !slot.isBreak) map.set(course.name, (map.get(course.name) ?? 0) + Math.max(0, parseHm(slot.end) - parseHm(slot.start)) / 60);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [tt]);

  function onDragStart(event: DragStartEvent) {
    const courseId = String(event.active.data.current?.courseId ?? '');
    const course = tt.courses.find((item) => item.id === courseId) ?? null;
    setDragCourse(course);
    suppressClickUntil.current = Number.POSITIVE_INFINITY;
    setDragAnnouncement(course ? t('Déplacement de {name}. Choisissez une case de destination.', { name: course.name }) : t('Déplacement commencé.'));
    void hapticMedium();
  }

  function onDragOver(event: DragOverEvent) {
    const data = event.over?.data.current;
    if (!data) return;
    const day = tt.days.find((item) => item.id === data.dayId);
    const slot = tt.slots.find((item) => item.id === data.slotId);
    if (!day || !slot) return;
    const occupant = tt.courses.find((course) => course.dayId === day.id && course.slotId === slot.id);
    const announcement = occupant
      ? t('Déposer sur {day}, {start} : échange avec {course}.', { day: localizedDay(day, settings.language), start: slot.start, course: occupant.name })
      : t('Déposer sur {day}, {start} – {end}.', { day: localizedDay(day, settings.language), start: slot.start, end: slot.end });
    setDragAnnouncement((current) => current === announcement ? current : announcement);
  }

  function onDragEnd(event: DragEndEvent) {
    setDragCourse(null);
    suppressClickUntil.current = Date.now() + 500;
    const fromDay = String(event.active.data.current?.dayId ?? '');
    const fromSlot = String(event.active.data.current?.slotId ?? '');
    const over = event.over?.data.current;
    if (!over || !fromDay || !fromSlot) {
      setDragAnnouncement(t('Déplacement annulé. Le cours est resté à sa place.'));
      return;
    }
    const toDay = String(over.dayId ?? '');
    const toSlot = String(over.slotId ?? '');
    if (toDay && toSlot && (fromDay !== toDay || fromSlot !== toSlot)) {
      const targetCourse = tt.courses.find((course) => course.dayId === toDay && course.slotId === toSlot);
      moveOrSwap(fromDay, fromSlot, toDay, toSlot);
      void hapticLight();
      if (targetCourse) {
        setDragAnnouncement(t('{course} échangé avec {target}.', { course: dragCourse?.name ?? t('Cours'), target: targetCourse.name }));
        toast(t('Cours échangés.'));
      } else {
        const day = tt.days.find((item) => item.id === toDay);
        const slot = tt.slots.find((item) => item.id === toSlot);
        setDragAnnouncement(t('{course} déplacé vers {day} à {start}.', { course: dragCourse?.name ?? t('Cours'), day: day ? localizedDay(day, settings.language) : '', start: slot?.start ?? '' }));
        toast(t('Cours déplacé.'));
      }
    } else {
      setDragAnnouncement(t('Le cours est resté à sa place.'));
    }
  }

  function onDragCancel(_event: DragCancelEvent) {
    setDragCourse(null);
    suppressClickUntil.current = Date.now() + 500;
    setDragAnnouncement(t('Déplacement annulé. Le cours est resté à sa place.'));
  }

  function openNewCourse(dayId: string, slotId: string) {
    setEditor({ dayId, slotId });
    void hapticLight();
  }

  function saveTimetableName() {
    const name = renameValue.trim();
    if (!name) {
      setRenameState({ id: activeId, value: tt.name });
      toast(t('Le nom du groupe ne peut pas être vide.'));
      return;
    }
    store.renameTimetable(activeId, name);
    setRenameState({ id: activeId, value: name });
  }

  function createTimetable() {
    const name = newGroupName.trim();
    if (!name) {
      toast(t('Saisissez un nom pour le nouveau groupe.'));
      return;
    }
    store.createTimetable(name);
    setNewGroupName('');
    setRenameState({ id: useTimetableStore.getState().activeId, value: name });
    toast(t('Groupe « {name} » créé.', { name }));
    void hapticLight();
  }

  function addDay() {
    const name = newDayName.trim();
    if (!name) {
      toast(t('Saisissez un nom pour le jour à ajouter.'));
      return;
    }
    const matchingWeekday = WEEKDAY_NAMES.findIndex((weekdayName, index) =>
      [weekdayName, localizedDay({ id: weekdayName, name: weekdayName, weekday: index }, settings.language)]
        .some((candidate) => normalized(candidate) === normalized(name)),
    );
    const storedName = matchingWeekday >= 0 ? WEEKDAY_NAMES[matchingWeekday]! : name;
    if (tt.days.some((day) => normalized(day.name) === normalized(storedName))) {
      toast(t('Ce jour existe déjà dans le planning.'));
      return;
    }
    store.addDay(storedName, matchingWeekday >= 0 ? matchingWeekday : newDayWeekday);
    setNewDayName('');
    toast(t('{name} ajouté au planning.', { name: localizedDay({ id: storedName, name: storedName, weekday: matchingWeekday >= 0 ? matchingWeekday : newDayWeekday }, settings.language) }));
  }

  function addTimeSlot() {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(newSlotStart)
      || !/^([01]\d|2[0-3]):[0-5]\d$/.test(newSlotEnd)
      || parseHm(newSlotEnd) <= parseHm(newSlotStart)) {
      toast(t('Saisissez une plage horaire valide : la fin doit être après le début.'));
      return;
    }
    if (tt.slots.some((slot) => parseHm(newSlotStart) < parseHm(slot.end) && parseHm(slot.start) < parseHm(newSlotEnd))) {
      toast(t('Ce créneau chevauche un horaire déjà présent.'));
      return;
    }
    store.addSlot(newSlotStart, newSlotEnd);
    toast(t('Créneau {start} – {end} ajouté.', { start: newSlotStart, end: newSlotEnd }));
  }

  async function analyzeImage(file: File) {
    setAnalysisStatus(t('Préparation de la reconnaissance locale…'));
    try {
      const ai = await import('./lib/ai');
      try {
        const result = await ai.analyzeTimetableFile(file, tt.days, tt.slots, (status) => setAnalysisStatus(t(status)));
        setPreview(result);
      } catch (error: unknown) {
        toast(error instanceof ai.AnalyzeError ? t(error.message) : t('Impossible de lire ce fichier sur cet appareil.'));
      }
    } catch {
      toast(t('Impossible de charger le module OCR local. Réessayez.'));
    }
  }

  async function onPickFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setAnalysisBusy(true);
    try {
      await analyzeImage(file);
    } finally {
      setAnalysisBusy(false);
      setAnalysisStatus(t('Reconnaissance locale…'));
    }
  }

  async function capturePhoto() {
    if (!Capacitor.isNativePlatform()) {
      cameraRef.current?.click();
      return;
    }
    if (analysisBusy) return;
    setAnalysisBusy(true);
    setAnalysisStatus(t('Ouverture de la caméra…'));
    try {
      const photo = await Camera.getPhoto({
        source: CameraSource.Camera,
        resultType: CameraResultType.DataUrl,
        quality: 90,
        width: 2200,
        height: 2200,
        correctOrientation: true,
      });
      if (!photo.dataUrl) throw new Error('La caméra n’a pas fourni d’image.');
      const response = await fetch(photo.dataUrl);
      const blob = await response.blob();
      const file = new File([blob], `timetable-${Date.now()}.${photo.format}`, { type: blob.type || 'image/jpeg' });
      await analyzeImage(file);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.toLocaleLowerCase().includes('cancel')) {
        toast(t('Impossible d’ouvrir la caméra. Vérifiez son autorisation et réessayez.'));
      }
    } finally {
      setAnalysisBusy(false);
      setAnalysisStatus(t('Reconnaissance locale…'));
    }
  }

  async function setRemindersEnabled(enabled: boolean) {
    if (!enabled) {
      settings.setRemindersEnabled(false);
      return;
    }
    try {
      await requestReminderPermissions();
      settings.setRemindersEnabled(true);
    } catch (error: unknown) {
      toast(t(error instanceof Error ? error.message : 'Impossible d’activer les rappels. Vérifiez les autorisations système.'));
    }
  }

  function applyImport() {
    if (!preview) return;
    const next = structuredClone(tt);
    const additionalSlots = (preview.additionalSlots ?? []).filter((extraSlot) =>
      preview.cells.some((cell) =>
        cell.name.trim()
        && cell.slot === `${extraSlot.start}-${extraSlot.end}`
        && matchDay(next.days, cell.day),
      ),
    );
    next.slots = [...next.slots, ...additionalSlots].sort((a, b) => a.start.localeCompare(b.start));
    let imported = 0;
    for (const cell of preview.cells) {
      const day = matchDay(next.days, cell.day);
      const slot = matchSlot(next.slots, cell.slot);
      if (!day || !slot || !cell.name.trim()) continue;
      const course: Course = {
        id: uid('c'),
        name: cell.name.trim(),
        type: COURSE_TYPES.includes(cell.type as CourseType) ? cell.type as CourseType : 'Cours',
        teacher: cell.teacher.trim(),
        room: cell.room.trim(),
        notes: '',
        dayId: day.id,
        slotId: slot.id,
      };
      next.courses = [...next.courses.filter((item) => item.dayId !== day.id || item.slotId !== slot.id), course];
      imported++;
    }
    if (!imported) {
      toast(t('Aucun cours ne correspond aux jours et créneaux de cet emploi du temps.'));
      return;
    }
    replaceActive(next);
    toast(t('{count} cours importés.', { count: imported }));
    setPreview(null);
  }

  async function onRestore(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const parsed: unknown = JSON.parse(await file.text());
      if (!isValidTimetable(parsed)) throw new Error(t('Format de sauvegarde non reconnu ou incomplet.'));
      useTimetableStore.getState().importTimetable(parsed);
      toast(t('Sauvegarde restaurée dans un nouveau groupe.'));
    } catch (error) {
      toast(error instanceof Error ? t(error.message) : t('Fichier JSON invalide.'));
    }
  }

  async function doExport(kind: 'jpg' | 'scan' | 'pdf' | 'json') {
    try {
      const exporter = await import('./lib/export');
      if (kind === 'jpg') await exporter.exportJpg(tt);
      else if (kind === 'scan') await exporter.exportJpg(tt, true);
      else if (kind === 'pdf') await exporter.exportPdf(tt);
      else await exporter.shareJson(tt);
      toast(t('Export prêt à être partagé.'));
    } catch {
      toast(t('Échec de l’export. Réessayez ou vérifiez l’espace de stockage.'));
    }
  }

  async function toggleCapture() {
    settings.setCaptureMode(!settings.captureMode);
    await hapticLight();
    toast(t(settings.captureMode ? 'Mode capture désactivé.' : 'Mode capture activé.'));
  }

  return (
    <div className="app-shell min-h-full bg-surface text-ink">
      <header className="topbar no-capture safe-pt">
        <div className="topbar-inner">
          <div className="brand-mark" aria-hidden="true">E</div>
          <div className="brand-title">
            <span>{t('MON CAMPUS')}</span>
            <strong>{t('Planning')}</strong>
          </div>
          <Select
            className="group-select"
            ariaLabel={t('Choisir un emploi du temps')}
            value={activeId}
            onChange={(id) => useTimetableStore.getState().setActive(id)}
            options={timetables.map((item) => ({ value: item.id, label: item.name }))}
          />
          <button className="icon-button" type="button" title={t('Annuler')} aria-label={t('Annuler')} disabled={!canUndo} onClick={undo}>↶</button>
          <button className="icon-button" type="button" title={t('Rétablir')} aria-label={t('Rétablir')} disabled={!canRedo} onClick={redo}>↷</button>
          <button className="primary-button new-button" type="button" onClick={() => {
            const day = visibleDays[0] ?? tt.days[0];
            const slot = tt.slots.find((item) => !item.isBreak);
            if (day && slot) openNewCourse(day.id, slot.id);
          }}>＋ <span>{t('Nouveau cours')}</span></button>
        </div>
      </header>

      <main className="page-content">
        <section className="hero-row">
          <div>
            <p className="eyebrow">{new Intl.DateTimeFormat(localeCode(settings.language), { dateStyle: 'full' }).format(today)}</p>
            <div className="title-line">
              <label className="group-name-field">
                <input
                  className="title-input"
                  aria-label={t('Nom de l’emploi du temps')}
                  value={renameValue}
                  maxLength={40}
                  onChange={(event) => setRenameState({ id: activeId, value: event.target.value })}
                  onBlur={saveTimetableName}
                  onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
                />
                <span aria-hidden="true">✎</span>
              </label>
              <button className="subtle-button no-capture" type="button" onClick={() => useTimetableStore.getState().duplicateTimetable(activeId)}>{t('Dupliquer')}</button>
            </div>
            <p className="group-name-hint no-capture">{t('Touchez le nom pour le modifier')}</p>
            <p className="subtitle">{t('{courses} cours · {days} jours · semestre en cours', { courses: tt.courses.length, days: tt.days.length })}</p>
          </div>
          <div className={`now-card ${weekNow.kind === 'ongoing' ? 'now-live' : ''}`}>
            <div className="now-dot" />
            <div><span>{t(weekNow.kind === 'ongoing' ? 'EN CE MOMENT' : 'À VENIR')}</span><strong>{nowLabel}</strong></div>
          </div>
        </section>

        {conflictsForUi && (
          <div className="conflict-banner" role="status">
            <span>⚠</span>
            <span>{t(conflicts.length > 1 ? '{count} conflits détectés : enseignant ou salle en double.' : '{count} conflit détecté : enseignant ou salle en double.', { count: conflicts.length })}</span>
            <button type="button" onClick={() => setPanel('statistics')}>{t('Voir')}</button>
          </div>
        )}

        <div className="toolbar no-capture">
          <div className="view-switch" role="group" aria-label={t('Mode d’affichage')}>
            <button className={settings.viewMode === 'week' ? 'selected' : ''} onClick={() => settings.setViewMode('week')}>{t('Semaine')}</button>
            <button className={settings.viewMode === 'day' ? 'selected' : ''} onClick={() => settings.setViewMode('day')}>{t('Jour')}</button>
          </div>
          <button
            type="button"
            className="today-button"
            disabled={!tt.days.some((day) => day.weekday === today.getDay())}
            onClick={() => {
              const day = tt.days.find((item) => item.weekday === today.getDay());
              if (!day) return;
              settings.setSelectedDayId(day.id);
              settings.setViewMode('day');
              setPanel('planning');
              void hapticLight();
            }}
          >
            {t('Aujourd’hui')}
          </button>
          {settings.viewMode === 'day' && (
            <Select
              ariaLabel={t('Jour affiché')}
              className="day-select"
              value={selectedDay?.id ?? ''}
              onChange={settings.setSelectedDayId}
              options={tt.days.map((day) => ({ value: day.id, label: localizedDay(day, settings.language) }))}
            />
          )}
          <label className="search-box">
            <span aria-hidden="true">⌕</span>
            <input type="search" inputMode="search" autoComplete="off" value={settings.searchQuery} onChange={(event) => settings.setSearchQuery(event.target.value)} placeholder={t('Rechercher un cours…')} aria-label={t('Rechercher une matière, salle ou enseignant')} />
            {settings.searchQuery && <button type="button" aria-label={t('Effacer la recherche')} onClick={() => settings.setSearchQuery('')}>×</button>}
          </label>
          <button type="button" className="subtle-button" disabled={analysisBusy} onClick={() => fileRef.current?.click()}>
            {analysisBusy ? <><span className="spinner" /> {analysisStatus}</> : t('⇧ Importer une photo')}
          </button>
          <button type="button" className="subtle-button camera-button" disabled={analysisBusy} onClick={() => void capturePhoto()}>{t('◎ Photo')}</button>
          <input ref={fileRef} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" onChange={onPickFile} />
          <input ref={cameraRef} className="visually-hidden" type="file" accept="image/jpeg,image/png" capture="environment" onChange={onPickFile} />
        </div>
        {analysisBusy && (
          <div className="analysis-progress" role="status" aria-live="polite" aria-atomic="true">
            <span className="analysis-progress-spinner" aria-hidden="true" />
            <span><strong>{analysisStatus}</strong><small>{t('Tout est traité localement sur votre téléphone ; gardez l’application ouverte.')}</small></span>
          </div>
        )}
        {panel === 'planning' && tt.courses.length > 0 && !query && (
          <p className="drag-hint no-capture">
            <span aria-hidden="true">✥</span>
            {t('Maintenez un cours pour le déplacer. Déposez-le sur un cours pour les échanger.')}
          </p>
        )}
        {panel === 'planning' && query && filteredCourses.length > 0 && (
          <div className="search-summary" role="status" aria-live="polite">
            <span>{t('{count} cours trouvé(s).', { count: filteredCourses.length })}</span>
          </div>
        )}

        <AnimatePresence mode="wait">
          {panel === 'planning' && (
            <motion.section key="planning" className="schedule-card" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.18 }}>
              {!hydrated ? <div className="loading-grid"><div /><div /><div /><div /><div /><div /></div>
                : query && filteredCourses.length === 0 ? (
                  <div className="search-empty-state" role="status">
                    <span className="empty-icon" aria-hidden="true">⌕</span>
                    <strong>{t('Aucun cours ne correspond à votre recherche.')}</strong>
                    <p>{t('Essayez un autre terme ou effacez la recherche.')}</p>
                    <button type="button" className="subtle-button" onClick={() => settings.setSearchQuery('')}>{t('Effacer la recherche')}</button>
                  </div>
                ) : (
                <DndContext
                  sensors={sensors}
                  collisionDetection={scheduleCollisionDetection}
                  onDragStart={onDragStart}
                  onDragOver={onDragOver}
                  onDragEnd={onDragEnd}
                  onDragCancel={onDragCancel}
                  autoScroll
                >
                  <div className="schedule-scroll">
                    <div className={`schedule-grid ${query ? 'search-active' : ''}`} style={{ gridTemplateColumns: `54px repeat(${visibleDays.length}, minmax(98px, 1fr))` }}>
                      <div className="day-heading time-heading">{t('HEURE')}</div>
                      {visibleDays.map((day) => <div className={`day-heading ${day.weekday === today.getDay() ? 'is-current-day' : ''}`} key={day.id}><span>{localizedDay(day, settings.language).slice(0, 3).toUpperCase()}</span><strong>{localizedDay(day, settings.language)}{day.weekday === today.getDay() ? <i>{t('Aujourd’hui')}</i> : null}</strong></div>)}
                      {tt.slots.map((slot) => slot.isBreak ? (
                        <div className="break-row" key={slot.id} style={{ gridColumn: `1 / span ${visibleDays.length + 1}` }}>
                          <span>{t('PAUSE')}</span><i /> <span>{slot.start} — {slot.end}</span>
                        </div>
                      ) : (
                        <div className="slot-row" key={slot.id} style={{ display: 'contents' }}>
                          <div className="time-label"><strong>{slot.start}</strong><span>{slot.end}</span></div>
                          {visibleDays.map((day) => {
                            const course = filteredCourses.find((item) => item.dayId === day.id && item.slotId === slot.id);
                            return (
                              <GridCell
                                key={`${day.id}-${slot.id}`}
                                dayId={day.id}
                                slotId={slot.id}
                                dayName={localizedDay(day, settings.language)}
                                start={slot.start}
                                end={slot.end}
                                onEmptyClick={!query ? () => {
                                  if (Date.now() >= suppressClickUntil.current) openNewCourse(day.id, slot.id);
                                } : undefined}
                              >
                                {course && (
                                  <CourseCell
                                    course={course}
                                    color={useTimetableStore.getState().getSubjectColor(course.name)}
                                    conflict={courseHasConflict(course.id, conflicts)}
                                    onOpen={() => {
                                      if (Date.now() < suppressClickUntil.current) return;
                                      setEditor({ dayId: course.dayId, slotId: course.slotId, courseId: course.id });
                                      void hapticLight();
                                    }}
                                  />
                                )}
                              </GridCell>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  </div>
                  <DragOverlay>{dragCourse ? <CourseDragOverlay course={dragCourse} color={useTimetableStore.getState().getSubjectColor(dragCourse.name)} /> : null}</DragOverlay>
                  <div className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">{dragAnnouncement}</div>
                </DndContext>
              )}
              {tt.courses.length === 0 && (
                <div className="empty-state">
                  <div className="empty-icon">✳</div><strong>{t('Votre semaine commence ici')}</strong>
                  <p>{t('Ajoutez un cours ou importez une photo de votre planning.')}</p>
                  <button className="primary-button" type="button" onClick={() => { const day = visibleDays[0] ?? tt.days[0]; const slot = tt.slots.find((item) => !item.isBreak); if (day && slot) openNewCourse(day.id, slot.id); }}>{t('Ajouter mon premier cours')}</button>
                </div>
              )}
            </motion.section>
          )}
          {panel === 'statistics' && (
            <motion.section key="statistics" className="content-card" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
              <div className="section-heading"><div><p className="eyebrow">{t('VOTRE RYTHME')}</p><h2>{t('Analyse de la semaine')}</h2></div><span className="metric-pill">{t('{hours} h planifiées', { hours: stats.reduce((total, [, hours]) => total + hours, 0).toFixed(1) })}</span></div>
              {stats.length ? <div className="stats-list">{stats.map(([name, hours]) => <div className="stat-row" key={name}><div className="stat-name"><i style={{ background: useTimetableStore.getState().getSubjectColor(name) }} /><span>{name}</span></div><div className="stat-bar"><span style={{ width: `${Math.max(3, hours / Math.max(...stats.map((item) => item[1])) * 100)}%`, background: useTimetableStore.getState().getSubjectColor(name) }} /></div><strong>{hours.toFixed(1)} h</strong></div>)}</div> : <p className="muted-message">{t('Ajoutez des cours pour découvrir la répartition de vos heures.')}</p>}
              <div className="conflict-section"><h3>{t('Vérification des conflits')}</h3>{conflicts.length ? conflicts.map((item, i) => <div className="conflict-item" key={`${item.a.id}-${item.b.id}-${i}`}>⚠ {item.reason === 'enseignant'
                ? t('{teacher} : {a} et {b} se chevauchent le même jour', { teacher: item.a.teacher, a: item.a.name, b: item.b.name })
                : t('Salle {room} : {a} et {b} se chevauchent le même jour', { room: item.a.room, a: item.a.name, b: item.b.name })} ({t(item.reason)})</div>) : <p className="success-message">{t('✓ Aucun conflit d’enseignant ou de salle.')}</p>}</div>
            </motion.section>
          )}
          {panel === 'settings' && (
            <motion.section key="settings" className="content-card settings-content" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
              <div className="settings-header">
                <div><p className="eyebrow">{t('PERSONNALISATION')}</p><h2>{t('Réglages')}</h2><p>{t('Adaptez votre planning à votre façon de travailler.')}</p></div>
                <span className="settings-header-icon" aria-hidden="true">⚙</span>
              </div>
              <section className="setting-section">
                <div className="setting-title"><span className="setting-icon" aria-hidden="true">文</span><div><h3>{t('Langue')}</h3><p>{t('Choisissez la langue de l’application.')}</p></div></div>
                <div className="inline-control"><span>{t('Langue')}</span><Select className="inline-control-select" ariaLabel={t('Langue')} value={settings.language} onChange={(value) => settings.setLanguage(value as Language)} options={[{ value: 'fr', label: 'Français' }, { value: 'en', label: 'English' }, { value: 'ar', label: 'العربية' }]} /></div>
              </section>
              <section className="setting-section">
                <div className="setting-title"><span className="setting-icon" aria-hidden="true">◐</span><div><h3>{t('Apparence')}</h3><p>{t('Choisissez l’apparence de l’application.')}</p></div></div>
                <div className="theme-options" role="group" aria-label={t('Thème de l’application')}>
                  {(['light', 'dark', 'auto'] as const).map((theme) => (
                    <button type="button" key={theme} aria-pressed={settings.theme === theme} className={settings.theme === theme ? 'active' : ''} onClick={() => settings.setTheme(theme)}>
                      <span aria-hidden="true">{theme === 'light' ? '☼' : theme === 'dark' ? '☾' : '◐'}</span>
                      {t(theme === 'light' ? 'Clair' : theme === 'dark' ? 'Sombre' : 'Automatique')}
                    </button>
                  ))}
                </div>
              </section>

              <section className="setting-section">
                <div className="setting-title"><span className="setting-icon" aria-hidden="true">◷</span><div><h3>{t('Rappels de cours')}</h3><p>{t('Recevez un rappel avant chaque cours.')}</p></div></div>
                <label className="setting-control-row">
                  <span><strong>{t('Notifications')}</strong><small>{t(settings.remindersEnabled ? 'Les rappels sont activés' : 'Les rappels sont désactivés')}</small></span>
                  <input className="switch-input" type="checkbox" checked={settings.remindersEnabled} onChange={(event) => void setRemindersEnabled(event.target.checked)} />
                </label>
                <div className={`inline-control ${!settings.remindersEnabled ? 'is-disabled' : ''}`}><span>{t('Me prévenir')}</span><Select className="inline-control-select" ariaLabel={t('Me prévenir')} disabled={!settings.remindersEnabled} value={String(settings.reminderMinutes)} onChange={(value) => settings.setReminderMinutes(Number(value))} options={[5, 10, 15, 30, 60].map((minutes) => ({ value: String(minutes), label: t(minutes === 60 ? '1 heure avant' : `${minutes} minutes avant`) }))} /></div>
                <p className="setting-footnote">{t('Les notifications dépendent également des autorisations système de votre téléphone.')}</p>
              </section>

              <section className="setting-section group-settings">
                <div className="setting-title"><span className="setting-icon" aria-hidden="true">▦</span><div><h3>{t('Groupes et emplois du temps')}</h3><p>{t('Renommez, dupliquez ou gérez vos différents groupes.')}</p></div></div>
                <label className="field-label">{t('Nom du groupe actuel')}
                  <span className="input-action-row"><input className="text-input" maxLength={40} value={renameValue} onChange={(event) => setRenameState({ id: activeId, value: event.target.value })} onKeyDown={(event) => { if (event.key === 'Enter') saveTimetableName(); }} /><button type="button" className="primary-button" onClick={saveTimetableName}>{t('Enregistrer')}</button></span>
                </label>
                <div className="group-actions">
                  <label className="field-label">{t('Créer un groupe')}
                    <span className="input-action-row"><input className="text-input" maxLength={40} value={newGroupName} onChange={(event) => setNewGroupName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') createTimetable(); }} placeholder={t('Ex. Groupe G{number}', { number: timetables.length + 1 })} /><button type="button" className="subtle-button" onClick={createTimetable}>{t('＋ Créer')}</button></span>
                  </label>
                  <div className="button-row">
                    <button type="button" className="subtle-button" onClick={() => { useTimetableStore.getState().duplicateTimetable(activeId); toast(t('Copie du groupe créée.')); }}>{t('⧉ Dupliquer ce groupe')}</button>
                    {timetables.length > 1 && <button type="button" className="danger-button" onClick={() => setConfirmState({ title: t('Supprimer ce groupe ?'), message: t('Le groupe « {name} » et tous ses cours seront supprimés définitivement.', { name: tt.name }), confirmLabel: t('Supprimer le groupe'), onConfirm: () => { useTimetableStore.getState().deleteTimetable(activeId); setConfirmState(null); toast(t('Groupe supprimé.')); } })}>{t('Supprimer ce groupe')}</button>}
                  </div>
                </div>
                <p className="setting-footnote">{t(timetables.length === 1 ? '{count} groupe enregistré sur cet appareil.' : '{count} groupes enregistrés sur cet appareil.', { count: timetables.length })}</p>
              </section>

              <section className="setting-section">
                <div className="section-title-row"><div className="setting-title"><span className="setting-icon" aria-hidden="true">◷</span><div><h3>{t('Jours')}</h3><p>{t('Configurez les jours visibles dans la grille.')}</p></div></div></div>
                <div className="manage-list">{tt.days.map((day) => <DayManagementRow
                  key={`${tt.id}-${day.id}-${day.name}`}
                  day={day}
                  language={settings.language}
                  canDelete={tt.days.length > 1}
                  onRename={(name) => useTimetableStore.getState().renameDay(day.id, name)}
                  onWeekday={(weekday) => useTimetableStore.getState().setDayWeekday(day.id, weekday)}
                  onDelete={() => setConfirmState({ title: t('Supprimer {day} ?', { day: localizedDay(day, settings.language) }), message: t('Les cours associés à ce jour seront également supprimés.'), confirmLabel: t('Supprimer le jour'), onConfirm: () => { useTimetableStore.getState().removeDay(day.id); setConfirmState(null); } })}
                />)}</div>
                <form className="add-row-form" onSubmit={(event) => { event.preventDefault(); addDay(); }}>
                  <input
                    className="text-input"
                    maxLength={24}
                    aria-label={t('Nom du jour à ajouter')}
                    value={newDayName}
                    onChange={(event) => {
                      const value = event.target.value;
                      setNewDayName(value);
                      const weekday = WEEKDAY_NAMES.findIndex((name, index) =>
                        [name, localizedDay({ id: name, name, weekday: index }, settings.language)]
                          .some((candidate) => normalized(candidate) === normalized(value)),
                      );
                      if (weekday >= 0) setNewDayWeekday(weekday);
                    }}
                    placeholder={t('Nom du jour')}
                  />
                  <Select className="text-input" ariaLabel={t('Jour de la semaine')} value={String(newDayWeekday)} onChange={(value) => setNewDayWeekday(Number(value))} options={WEEKDAY_NAMES.map((name, weekday) => ({ value: String(weekday), label: localizedDay({ id: name, name, weekday }, settings.language) }))} />
                  <button type="submit" className="subtle-button">{t('＋ Ajouter')}</button>
                </form>
              </section>

              <section className="setting-section">
                <div className="setting-title"><span className="setting-icon" aria-hidden="true">◴</span><div><h3>{t('Créneaux horaires')}</h3><p>{t('Modifiez les horaires et les pauses de votre journée.')}</p></div></div>
                <div className="manage-list">{tt.slots.map((slot) => <SlotManagementRow
                  key={`${tt.id}-${slot.id}-${slot.start}-${slot.end}`}
                  slot={slot}
                  otherSlots={tt.slots.filter((item) => item.id !== slot.id)}
                  canDelete={slot.isBreak || tt.slots.filter((item) => !item.isBreak).length > 1}
                  language={settings.language}
                  onSave={(patch) => useTimetableStore.getState().updateSlot(slot.id, patch)}
                  onDelete={() => setConfirmState({ title: t('Supprimer ce créneau ?'), message: t('Le créneau {start} – {end} et les cours associés seront supprimés.', { start: slot.start, end: slot.end }), confirmLabel: t('Supprimer le créneau'), onConfirm: () => { useTimetableStore.getState().removeSlot(slot.id); setConfirmState(null); } })}
                  onInvalid={() => toast(t('Horaire invalide : vérifiez que la fin suit le début et évitez les chevauchements.'))}
                />)}</div>
                <form className="add-row-form add-slot-form" onSubmit={(event) => { event.preventDefault(); addTimeSlot(); }}>
                  <label className="field-label">{t('Début')}<input className="text-input" type="time" value={newSlotStart} onChange={(event) => setNewSlotStart(event.target.value)} /></label>
                  <label className="field-label">{t('Fin')}<input className="text-input" type="time" value={newSlotEnd} onChange={(event) => setNewSlotEnd(event.target.value)} /></label>
                  <button type="submit" className="subtle-button">{t('＋ Ajouter')}</button>
                </form>
              </section>

              <section className="setting-section">
                <div className="setting-title"><span className="setting-icon" aria-hidden="true">⇧</span><div><h3>{t('Export et sauvegarde')}</h3><p>{t('Partagez votre emploi du temps ou conservez une copie.')}</p></div></div>
                <div className="button-row export-actions"><button type="button" className="subtle-button" onClick={() => void doExport('jpg')}>{t('▧ Exporter en JPG')}</button><button type="button" className="subtle-button" onClick={() => void doExport('pdf')}>{t('▤ Exporter en PDF')}</button><button type="button" className="subtle-button" onClick={() => void doExport('scan')}>{t('◫ Effet scan')}</button><button type="button" className="subtle-button" onClick={() => void doExport('json')}>{t('↓ Sauvegarder')}</button><button type="button" className="subtle-button" onClick={() => restoreRef.current?.click()}>{t('↑ Restaurer')}</button><input ref={restoreRef} className="visually-hidden" type="file" accept="application/json,.json" onChange={(event) => void onRestore(event)} /></div>
              </section>

              <section className="setting-section">
                <div className="setting-title"><span className="setting-icon" aria-hidden="true">▣</span><div><h3>{t('Mode présentation')}</h3><p>{t('Masquez les commandes avant de capturer votre planning.')}</p></div></div>
                <button type="button" className={`setting-control-row presentation-toggle ${settings.captureMode ? 'selected' : ''}`} aria-pressed={settings.captureMode} onClick={() => void toggleCapture()}><span><strong>{t('Capture d’écran épurée')}</strong><small>{t('Masquer l’interface autour de l’emploi du temps')}</small></span><span className="setting-status">{t(settings.captureMode ? 'Activé' : 'Désactivé')}</span></button>
              </section>

              <section className="setting-section info-section">
                <div className="setting-title"><span className="setting-icon" aria-hidden="true">✳</span><div><h3>{t('Import sans abonnement')}</h3><p>{t('Reconnaissance locale, sans compte ni connexion.')}</p></div></div>
                <p className="setting-help">{t('La lecture des photos de planning se fait directement sur cet appareil avec les modèles français et anglais intégrés. Aucune clé API, aucun abonnement et aucune connexion Internet ne sont nécessaires. Vérifiez les cours détectés avant de les ajouter. Pour un PDF, faites une capture d’écran de la page puis importez-la comme photo.')}</p>
              </section>
            </motion.section>
          )}
        </AnimatePresence>
      </main>

      <nav className="bottom-nav no-capture" aria-label={t('Navigation principale')}>
        <button className={panel === 'planning' ? 'active' : ''} onClick={() => setPanel('planning')}><span>▦</span>{t('Planning')}</button>
        <button className={panel === 'statistics' ? 'active' : ''} onClick={() => setPanel('statistics')}><span>◔</span>{t('Statistiques')}{conflicts.length > 0 && <i className="nav-badge" />}</button>
        <button className={panel === 'settings' ? 'active' : ''} onClick={() => setPanel('settings')}><span>⚙</span>{t('Réglages')}</button>
      </nav>

      <BottomSheet open={Boolean(editor)} onClose={() => setEditor(null)} title={t(editor?.courseId ? 'Modifier le cours' : 'Nouveau cours')} tall>
        {editor && <CourseEditor
          key={`${editor.courseId ?? 'new'}-${editor.dayId}-${editor.slotId}`}
          state={editor}
          timetable={tt}
          onSave={(course) => { upsertCourse(course); setEditor(null); toast(t('Cours enregistré.')); }}
          onDelete={(courseId) => { deleteCourse(courseId); setEditor(null); toast(t('Cours supprimé.')); }}
          onDuplicate={(courseId) => { duplicateCourse(courseId); setEditor(null); toast(t('Cours dupliqué dans la première case libre.')); }}
        />}
      </BottomSheet>

      <BottomSheet open={Boolean(preview)} onClose={() => setPreview(null)} title={t('Vérifier l’import')} tall>
        {preview && <div className="import-preview">
          <p className="setting-help">{t('L’OCR local a détecté {count} cours dans « {title} ». Vérifiez les correspondances avant de les ajouter au planning.', { count: preview.cells.length, title: preview.title })}</p>
          {incompletePreviewCount > 0 && <p className="setting-help">{t(incompletePreviewCount > 1 ? 'Complétez ou retirez les {count} lignes sans matière, jour ou créneau reconnu. L’import restera bloqué tant que ces lignes ne sont pas corrigées.' : 'Complétez ou retirez les {count} ligne sans matière, jour ou créneau reconnu. L’import restera bloqué tant que ces lignes ne sont pas corrigées.', { count: incompletePreviewCount })}</p>}
          {preview.rawText && <details className="preview-ocr-text"><summary>{t('Afficher le texte OCR complet')}</summary><pre>{preview.rawText}</pre></details>}
          <button className="subtle-button" type="button" onClick={() => cameraRef.current?.click()}>{t('Prendre une autre photo')}</button>
          <button className="subtle-button" type="button" onClick={() => setPreview((current) => current ? { ...current, cells: [...current.cells, { name: '', type: 'Cours', teacher: '', room: '', day: '', slot: '' }] } : current)}>{t('＋ Ajouter une ligne manuellement')}</button>
          {preview.cells.map((cell, index) => (
            <div className="preview-row" key={`${cell.name}-${index}`}>
              <div className="preview-fields">
                {cell.rawText && <small className="preview-raw">{t('Texte lu :')} {cell.rawText}</small>}
                <input aria-label={t('Matière importée')} value={cell.name} onChange={(event) => setPreview((current) => current ? { ...current, cells: current.cells.map((item, i) => i === index ? { ...item, name: event.target.value } : item) } : current)} />
                <div className="form-two">
                  <Select ariaLabel={t('Type de cours')} value={COURSE_TYPES.includes(cell.type as CourseType) ? cell.type : 'Cours'} onChange={(value) => setPreview((current) => current ? { ...current, cells: current.cells.map((item, i) => i === index ? { ...item, type: value as CourseType } : item) } : current)} options={COURSE_TYPES.map((type) => ({ value: type, label: t(type) }))} />
                  <input aria-label={t('Enseignant importé')} placeholder={t('Enseignant')} value={cell.teacher} onChange={(event) => setPreview((current) => current ? { ...current, cells: current.cells.map((item, i) => i === index ? { ...item, teacher: event.target.value } : item) } : current)} />
                </div>
                <div className="form-two">
                  <Select ariaLabel={t('Jour importé')} value={matchDay(tt.days, cell.day)?.name ?? ''} onChange={(value) => setPreview((current) => current ? { ...current, cells: current.cells.map((item, i) => i === index ? { ...item, day: value } : item) } : current)} options={[{ value: '', label: t('Choisir un jour') }, ...tt.days.map((day) => ({ value: day.name, label: localizedDay(day, settings.language) }))]} />
                  <Select ariaLabel={t('Créneau importé')} value={matchSlot([...tt.slots, ...(preview.additionalSlots ?? [])], cell.slot)?.id ?? ''} onChange={(value) => { const slot = [...tt.slots, ...(preview.additionalSlots ?? [])].find((item) => item.id === value); if (slot) setPreview((current) => current ? { ...current, cells: current.cells.map((item, i) => i === index ? { ...item, slot: `${slot.start}-${slot.end}` } : item) } : current); }} options={[{ value: '', label: t('Choisir un créneau') }, ...[...tt.slots, ...(preview.additionalSlots ?? [])].filter((slot) => !slot.isBreak).map((slot) => ({ value: slot.id, label: `${slot.start} – ${slot.end}` }))]} />
                </div>
                <input aria-label={t('Salle importée')} placeholder={t('Salle')} value={cell.room} onChange={(event) => setPreview((current) => current ? { ...current, cells: current.cells.map((item, i) => i === index ? { ...item, room: event.target.value } : item) } : current)} />
              </div>
              <button type="button" className="preview-remove" aria-label={t('Retirer {name}', { name: cell.name })} onClick={() => setPreview((current) => current ? { ...current, cells: current.cells.filter((_, i) => i !== index) } : current)}>×</button>
            </div>
          ))}
          <button className="primary-button full-button" disabled={!preview.cells.length || incompletePreviewCount > 0} onClick={applyImport}>{t('Ajouter les cours correspondants')}</button>
        </div>}
      </BottomSheet>
      <BottomSheet open={Boolean(confirmState)} onClose={() => setConfirmState(null)} title={confirmState?.title ?? t('Confirmer')}>
        {confirmState && <div className="confirm-content"><p>{confirmState.message}</p><div className="confirm-actions"><button type="button" className="subtle-button" onClick={() => setConfirmState(null)}>{t('Annuler')}</button><button type="button" className="danger-button" onClick={confirmState.onConfirm}>{confirmState.confirmLabel}</button></div></div>}
      </BottomSheet>
      <ToastHost />
    </div>
  );
}

function DayManagementRow({
  day,
  language,
  canDelete,
  onRename,
  onWeekday,
  onDelete,
}: {
  day: DayDef;
  language: 'fr' | 'en' | 'ar';
  canDelete: boolean;
  onRename: (name: string) => void;
  onWeekday: (weekday: number) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(day.name);
  const t = (source: string) => translate(language, source);
  const changed = name.trim() !== day.name;

  return (
    <div className="manage-row day-manage">
      <input aria-label={t('Nom du jour {day}').replace('{day}', localizedDay(day, language))} maxLength={24} value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} onBlur={() => { if (changed && name.trim()) onRename(name.trim()); }} />
      <Select
        ariaLabel={t('Jour de la semaine pour {day}').replace('{day}', localizedDay(day, language))}
        value={String(day.weekday)}
        onChange={(value) => onWeekday(Number(value))}
        options={WEEKDAY_NAMES.map((weekdayName, weekday) => ({ value: String(weekday), label: localizedDay({ id: weekdayName, name: weekdayName, weekday }, language) }))}
      />
      <button type="button" className="manage-icon-button is-danger" aria-label={t('Supprimer {day}').replace('{day}', localizedDay(day, language))} disabled={!canDelete} onClick={onDelete}>×</button>
    </div>
  );
}

function SlotManagementRow({
  slot,
  language,
  otherSlots,
  canDelete,
  onSave,
  onDelete,
  onInvalid,
}: {
  slot: TimeSlot;
  language: 'fr' | 'en' | 'ar';
  otherSlots: TimeSlot[];
  canDelete: boolean;
  onSave: (patch: Partial<TimeSlot>) => void;
  onDelete: () => void;
  onInvalid: () => void;
}) {
  const t = (source: string) => translate(language, source);
  const [start, setStart] = useState(slot.start);
  const [end, setEnd] = useState(slot.end);
  const changed = start !== slot.start || end !== slot.end;

  function save() {
    if (!changed) return;
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(start)
      || !/^([01]\d|2[0-3]):[0-5]\d$/.test(end)
      || parseHm(end) <= parseHm(start)) {
      onInvalid();
      return;
    }
    if (otherSlots.some((item) => parseHm(start) < parseHm(item.end) && parseHm(item.start) < parseHm(end))) {
      onInvalid();
      return;
    }
    onSave({ start, end });
  }

  return (
    <div className="manage-row slot-manage">
      <label><span className="visually-hidden">{t('Début du créneau')}</span><input type="time" value={start} onChange={(event) => setStart(event.target.value)} onBlur={save} /></label>
      <span className="slot-separator">—</span>
      <label><span className="visually-hidden">{t('Fin du créneau')}</span><input type="time" value={end} onChange={(event) => setEnd(event.target.value)} onBlur={save} /></label>
      {slot.isBreak && <small className="break-badge">{t('Pause')}</small>}
      <button type="button" className="manage-icon-button is-danger" aria-label={`${t('Supprimer le créneau')} ${slot.start}`} disabled={!canDelete} onClick={onDelete}>×</button>
    </div>
  );
}

function CourseEditor({
  state,
  timetable,
  onSave,
  onDelete,
  onDuplicate,
}: {
  state: EditorState;
  timetable: Timetable;
  onSave: (course: Omit<Course, 'id'> & { id?: string }) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
}) {
  const language = useSettingsStore((state) => state.language);
  const t = (source: string) => translate(language, source);
  const displayDay = (day: DayDef) => localizedDay(day, language);
  const original = state.courseId ? timetable.courses.find((course) => course.id === state.courseId) : undefined;
  const [name, setName] = useState(original?.name ?? '');
  const [type, setType] = useState<CourseType>(original?.type ?? 'Cours');
  const [teacher, setTeacher] = useState(original?.teacher ?? '');
  const [room, setRoom] = useState(original?.room ?? '');
  const [notes, setNotes] = useState(original?.notes ?? '');
  const [dayId, setDayId] = useState(original?.dayId ?? state.dayId);
  const [slotId, setSlotId] = useState(original?.slotId ?? state.slotId);
  const [color, setColor] = useState(subjectColorFor(original?.name ?? '', timetable.subjectColors));
  const [colorTouched, setColorTouched] = useState(false);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    if (colorTouched) useTimetableStore.getState().setSubjectColor(name, color);
    onSave({ id: original?.id, name, type, teacher, room, notes, dayId, slotId });
  }

  return (
    <form className="course-form" onSubmit={submit}>
      <label className="field-label">{t('Matière')}<input autoFocus className="text-input" required maxLength={80} value={name} onChange={(event) => { const nextName = event.target.value; setName(nextName); if (!colorTouched) setColor(subjectColorFor(nextName, timetable.subjectColors)); }} placeholder={t('Ex. Mathématiques')} /></label>
      <div className="form-two"><label className="field-label">{t('Type')}<Select className="text-input" ariaLabel={t('Type')} value={type} onChange={(value) => setType(value as CourseType)} options={COURSE_TYPES.map((item) => ({ value: item, label: t(item) }))} /></label><label className="field-label">{t('Salle')}<input className="text-input" maxLength={40} value={room} onChange={(event) => setRoom(event.target.value)} placeholder={t('Amphi A')} /></label></div>
      <label className="field-label">{t('Enseignant')}<input className="text-input" maxLength={80} value={teacher} onChange={(event) => setTeacher(event.target.value)} placeholder={t('Nom de l’enseignant')} /></label>
      <div className="form-two"><label className="field-label">{t('Jour')}<Select className="text-input" ariaLabel={t('Jour')} value={dayId} onChange={setDayId} options={timetable.days.map((day) => ({ value: day.id, label: displayDay(day) }))} /></label><label className="field-label">{t('Créneau')}<Select className="text-input" ariaLabel={t('Créneau')} value={slotId} onChange={setSlotId} options={timetable.slots.filter((slot) => !slot.isBreak).map((slot) => ({ value: slot.id, label: `${slot.start} – ${slot.end}` }))} /></label></div>
      <label className="field-label">{t('Notes')}<textarea className="text-input notes-input" maxLength={300} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder={t('Informations complémentaires…')} /></label>
      <div className="field-label">{t('Couleur de la matière')}<div className="color-row">{COLOR_PALETTE.map((item) => <button type="button" key={item} aria-label={t('Choisir la couleur {color}').replace('{color}', item)} className={`color-swatch ${color === item ? 'chosen' : ''}`} style={{ backgroundColor: item }} onClick={() => { setColor(item); setColorTouched(true); }} />)}<label className="color-custom" title={t('Choisir une couleur personnalisée')}><input type="color" value={color} onChange={(event) => { setColor(event.target.value); setColorTouched(true); }} />＋</label></div><small className="setting-help">{t('Cette couleur sera appliquée à tous les cours de cette matière.')}</small></div>
      <button type="submit" className="primary-button full-button" style={{ background: color, color: textColorForBg(color) }}>{t(original ? 'Enregistrer les modifications' : 'Ajouter au planning')}</button>
      {original && <div className="button-row editor-actions"><button type="button" className="subtle-button" onClick={() => onDuplicate(original.id)}>{t('Dupliquer')}</button><button type="button" className="danger-button" onClick={() => onDelete(original.id)}>{t('Supprimer')}</button></div>}
    </form>
  );
}

export default App;
