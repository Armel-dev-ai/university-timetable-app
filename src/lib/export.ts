import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { jsPDF } from 'jspdf';
import type { Timetable } from '../types';
import { subjectColorFor, textColorForBg } from './colors';

function colorFor(tt: Timetable, name: string): string {
  return subjectColorFor(name, tt.subjectColors);
}

/** Rendu canvas paysage haute résolution */
export function renderTimetableCanvas(
  tt: Timetable,
  opts?: { scan?: boolean; minW?: number; minH?: number },
): HTMLCanvasElement {
  const minW = opts?.minW ?? 1600;
  const minH = opts?.minH ?? 900;
  const days = tt.days;
  const slots = tt.slots.filter((s) => !s.isBreak);
  const pad = 48;
  const headerH = 72;
  const labelW = 140;
  const cellW = Math.max(160, (minW - pad * 2 - labelW) / Math.max(1, days.length));
  const cellH = Math.max(88, (minH - pad * 2 - headerH) / Math.max(1, slots.length));
  const width = Math.max(minW, pad * 2 + labelW + cellW * days.length);
  const height = Math.max(minH, pad * 2 + headerH + cellH * slots.length);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  // Fond
  ctx.fillStyle = '#F2F3F4';
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = '#26292D';
  ctx.font = '600 28px Inter, system-ui, sans-serif';
  ctx.fillText(tt.name, pad, pad + 28);

  ctx.font = '500 16px Inter, system-ui, sans-serif';
  ctx.fillStyle = '#585C61';
  ctx.fillText('Emploi du temps', pad, pad + 52);

  // En-têtes jours
  days.forEach((day, i) => {
    const x = pad + labelW + i * cellW;
    const y = pad + headerH - 28;
    ctx.fillStyle = '#393D42';
    ctx.font = '600 18px Inter, system-ui, sans-serif';
    ctx.fillText(day.name, x + 12, y);
  });

  slots.forEach((slot, si) => {
    const y = pad + headerH + si * cellH;
    ctx.fillStyle = '#585C61';
    ctx.font = '500 14px Inter, system-ui, sans-serif';
    ctx.fillText(`${slot.start}`, pad, y + 28);
    ctx.fillText(`${slot.end}`, pad, y + 48);

    days.forEach((day, di) => {
      const x = pad + labelW + di * cellW;
      const course = tt.courses.find((c) => c.dayId === day.id && c.slotId === slot.id);
      ctx.strokeStyle = '#E1E3E5';
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, cellW - 8, cellH - 8);
      if (course) {
        const bg = colorFor(tt, course.name);
        const radius = 12;
        roundRect(ctx, x + 2, y + 2, cellW - 12, cellH - 12, radius);
        ctx.fillStyle = bg;
        ctx.fill();
        ctx.fillStyle = textColorForBg(bg);
        ctx.font = '600 15px Inter, system-ui, sans-serif';
        ctx.fillText(truncate(ctx, course.name, cellW - 28), x + 14, y + 28);
        ctx.font = '500 12px Inter, system-ui, sans-serif';
        ctx.globalAlpha = 0.9;
        ctx.fillText(`${course.type} · ${course.room || '—'}`, x + 14, y + 48);
        if (course.teacher) ctx.fillText(course.teacher, x + 14, y + 66);
        ctx.globalAlpha = 1;
      }
    });
  });

  if (opts?.scan) applyScanEffect(ctx, width, height);
  return canvas;
}

function truncate(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function applyScanEffect(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const g = 0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!;
    const noise = (Math.random() - 0.5) * 28;
    const v = Math.max(0, Math.min(255, g + noise));
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  // Légère rotation + vignette simulée via redraw
  const tmp = document.createElement('canvas');
  tmp.width = w;
  tmp.height = h;
  const tctx = tmp.getContext('2d')!;
  tctx.fillStyle = '#E1E3E5';
  tctx.fillRect(0, 0, w, h);
  tctx.save();
  tctx.translate(w / 2, h / 2);
  tctx.rotate((-1.2 * Math.PI) / 180);
  tctx.drawImage(ctx.canvas, -w / 2, -h / 2);
  tctx.restore();
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(tmp, 0, 0);
}

async function shareBlob(blob: Blob, filename: string, title: string) {
  if (Capacitor.isNativePlatform()) {
    const base64 = await blobToBase64(blob);
    const path = filename;
    await Filesystem.writeFile({
      path,
      data: base64,
      directory: Directory.Cache,
    });
    const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache });
    await Share.share({ title, url: uri, dialogTitle: title });
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const s = String(reader.result ?? '');
      resolve(s.split(',')[1] ?? '');
    };
    reader.onerror = () => reject(new Error('Lecture fichier impossible'));
    reader.readAsDataURL(blob);
  });
}

export async function exportJpg(tt: Timetable, scan = false) {
  const canvas = renderTimetableCanvas(tt, { scan });
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Export JPG échoué'))), 'image/jpeg', 0.92);
  });
  const name = `${slug(tt.name)}${scan ? '-scan' : ''}.jpg`;
  await shareBlob(blob, name, scan ? 'Effet scan' : 'Export JPG');
}

export async function exportPdf(tt: Timetable) {
  const canvas = renderTimetableCanvas(tt);
  const img = canvas.toDataURL('image/jpeg', 0.92);
  const pdf = new jsPDF({
    orientation: 'landscape',
    unit: 'px',
    format: [canvas.width, canvas.height],
  });
  pdf.addImage(img, 'JPEG', 0, 0, canvas.width, canvas.height);
  const blob = pdf.output('blob');
  await shareBlob(blob, `${slug(tt.name)}.pdf`, 'Export PDF');
}

export function exportJson(tt: Timetable): string {
  return JSON.stringify(tt, null, 2);
}

export async function shareJson(tt: Timetable) {
  const blob = new Blob([exportJson(tt)], { type: 'application/json' });
  await shareBlob(blob, `${slug(tt.name)}.json`, 'Sauvegarde JSON');
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'emploi-du-temps';
}
