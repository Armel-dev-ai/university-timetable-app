import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import type { Language, Timetable } from '../types';
import { translate } from './i18n';
import { parseHm } from './time';

const REMINDER_CHANNEL_ID = 'class-reminders';
let syncQueue: Promise<void> = Promise.resolve();

export async function requestReminderPermissions(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  const permission = await LocalNotifications.requestPermissions();
  if (permission.display !== 'granted') {
    throw new Error('Autorisez les notifications dans les réglages système pour activer les rappels.');
  }

  if (Capacitor.getPlatform() === 'android') {
    const exact = await LocalNotifications.checkExactNotificationSetting();
    if (exact.exact_alarm !== 'granted') {
      const requested = await LocalNotifications.changeExactNotificationSetting();
      if (requested.exact_alarm !== 'granted') {
        throw new Error('Autorisez les alarmes exactes dans les réglages système pour recevoir les rappels à l’heure.');
      }
    }
  }
}

/** Serializes cancellation and scheduling so rapid edits cannot leave stale reminders. */
export function syncReminders(
  tt: Timetable,
  minutesBefore: number,
  enabled: boolean,
  language: Language = 'fr',
): Promise<void> {
  const task = syncQueue.then(() => syncRemindersNow(tt, minutesBefore, enabled, language));
  syncQueue = task.then(() => undefined, () => undefined);
  return task;
}

async function syncRemindersNow(
  tt: Timetable,
  minutesBefore: number,
  enabled: boolean,
  language: Language,
): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  const pending = await LocalNotifications.getPending();
  if (pending.notifications.length) {
    await LocalNotifications.cancel({ notifications: pending.notifications });
  }
  if (!enabled || minutesBefore < 0) return;
  const permission = await LocalNotifications.checkPermissions();
  if (permission.display !== 'granted') {
    throw new Error('Autorisez les notifications dans les réglages système pour activer les rappels.');
  }
  if (Capacitor.getPlatform() === 'android') {
    await LocalNotifications.createChannel({
      id: REMINDER_CHANNEL_ID,
      name: translate(language, 'Rappels de cours'),
      description: translate(language, 'Recevez un rappel avant chaque cours.'),
      importance: 4,
      vibration: true,
    });
  }

  const now = Date.now();
  const notifications = [];

  // 14 jours de rappels
  for (let d = 0; d < 14; d++) {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + d);
    const weekday = date.getDay();
    const day = tt.days.find((x) => x.weekday === weekday);
    if (!day) continue;

    for (const course of tt.courses.filter((c) => c.dayId === day.id)) {
      const slot = tt.slots.find((s) => s.id === course.slotId && !s.isBreak);
      if (!slot) continue;
      const startMins = parseHm(slot.start);
      const fire = new Date(date);
      fire.setHours(Math.floor(startMins / 60), startMins % 60, 0, 0);
      fire.setMinutes(fire.getMinutes() - minutesBefore);
      if (fire.getTime() <= now) continue;

      const id = hashId(`${course.id}-${fire.toISOString()}`);
      notifications.push({
        id,
        title: translate(language, 'Cours dans {minutes} min', { minutes: minutesBefore }),
        body: `${course.name} · ${course.room || translate(language, 'salle non précisée')} · ${slot.start}`,
        schedule: { at: fire, allowWhileIdle: true },
        ...(Capacitor.getPlatform() === 'android' ? { channelId: REMINDER_CHANNEL_ID } : {}),
      });
    }
  }

  notifications.sort((a, b) => a.schedule.at.getTime() - b.schedule.at.getTime());
  const batch = notifications.slice(0, 450);
  if (batch.length) {
    await LocalNotifications.schedule({ notifications: batch });
  }
}

function hashId(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) % 2_000_000_000 || 1;
}
