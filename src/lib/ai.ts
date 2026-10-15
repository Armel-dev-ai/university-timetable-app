import { createWorker, PSM } from 'tesseract.js';
import type { AiCell, AiParseResult, CourseType, DayDef, TimeSlot } from '../types';
import { COURSE_TYPES } from '../types';

export type AnalyzeErrorKind = 'unsupported' | 'empty' | 'recognition';

export class AnalyzeError extends Error {
  kind: AnalyzeErrorKind;

  constructor(kind: AnalyzeErrorKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

interface OcrLine {
  text: string;
  x: number;
  y: number;
  isDayHeader?: boolean;
  day?: string;
  words?: OcrWord[];
}

interface OcrWord {
  text: string;
  x: number;
  y: number;
  confidence: number;
}

interface OcrBlockWord {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

interface OcrBlockLine {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  words: OcrBlockWord[];
}

interface OcrBlock {
  paragraphs: Array<{ lines: OcrBlockLine[] }>;
}

interface PositionedCell extends AiCell {
  x: number;
  y: number;
}

interface ColoredRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface RegionText {
  text: string;
  x: number;
  y: number;
}

type ProgressCallback = (message: string) => void;

let workerPromise: ReturnType<typeof createWorker> | undefined;
const ENGLISH_DAY_ALIASES: Record<number, string[]> = {
  0: ['sunday', 'sun'],
  1: ['monday', 'mon'],
  2: ['tuesday', 'tue', 'tues'],
  3: ['wednesday', 'wed'],
  4: ['thursday', 'thu', 'thur', 'thurs'],
  5: ['friday', 'fri'],
  6: ['saturday', 'sat'],
};

function getWorker(onProgress: ProgressCallback) {
  workerPromise ??= createWorker('eng+fra', 1, {
    workerPath: '/ocr/worker.min.js',
    corePath: '/ocr/tesseract-core.wasm.js',
    langPath: '/tessdata/',
    gzip: true,
    logger: ({ status, progress }) => {
      if (status === 'loading tesseract core') onProgress('Préparation du moteur OCR…');
      else if (status === 'loading language traineddata') onProgress(`Chargement des modèles OCR… ${Math.round(progress * 100)} %`);
      else if (status === 'initializing tesseract') onProgress('Démarrage du moteur OCR…');
      else if (status === 'recognizing text') {
        onProgress(`Lecture de la photo… ${Math.round(progress * 100)} %`);
      }
    },
  }).catch((error: unknown) => {
    workerPromise = undefined;
    throw error;
  });
  return workerPromise;
}

function extractOcrLines(blocks: OcrBlock[], days: DayDef[]): OcrLine[] {
  return blocks.flatMap((block) =>
    block.paragraphs.flatMap((paragraph) => paragraph.lines.flatMap((line) => [
      {
        text: line.text.trim(),
        x: (line.bbox.x0 + line.bbox.x1) / 2,
        y: (line.bbox.y0 + line.bbox.y1) / 2,
        words: line.words.map((word) => ({
          text: word.text,
          x: (word.bbox.x0 + word.bbox.x1) / 2,
          y: (word.bbox.y0 + word.bbox.y1) / 2,
          confidence: word.confidence,
        })),
      },
      ...line.words
        .filter((word) => Boolean(findDay(word.text, days)))
        .map((word) => ({
          text: word.text,
          x: (word.bbox.x0 + word.bbox.x1) / 2,
          y: (word.bbox.y0 + word.bbox.y1) / 2,
          confidence: word.confidence,
          isDayHeader: true,
        })),
    ])),
  ).filter((line) => line.text.length > 0);
}

async function recognizeColoredRegions(
  worker: Awaited<ReturnType<typeof getWorker>>,
  bitmap: ImageBitmap,
  regions: ColoredRegion[],
  source: { x: number; y: number; scale: number },
  onProgress: ProgressCallback,
): Promise<RegionText[]> {
  const tileWidth = 620;
  const tileHeight = 380;
  const gap = 22;
  const columns = Math.min(3, regions.length);
  const rows = Math.ceil(regions.length / columns);
  const canvas = document.createElement('canvas');
  canvas.width = columns * tileWidth + (columns + 1) * gap;
  canvas.height = rows * tileHeight + (rows + 1) * gap;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Impossible de préparer les zones de cours.');
  context.fillStyle = '#FFFFFF';
  context.fillRect(0, 0, canvas.width, canvas.height);

  const tilePositions = regions.map((region, index) => {
    const padding = Math.max(3, Math.round(Math.min(region.width, region.height) * 0.04));
    const left = Math.max(0, region.x - padding);
    const top = Math.max(0, region.y - padding);
    const right = Math.min(bitmap.width, region.x + region.width + padding);
    const bottom = Math.min(bitmap.height, region.y + region.height + padding);
    const width = right - left;
    const height = bottom - top;
    const scale = Math.min(2.5, (tileWidth - gap * 2) / width, (tileHeight - gap * 2) / height);
    const drawWidth = Math.round(width * scale);
    const drawHeight = Math.round(height * scale);
    const column = index % columns;
    const row = Math.floor(index / columns);
    const tileX = gap + column * (tileWidth + gap);
    const tileY = gap + row * (tileHeight + gap);
    context.drawImage(
      bitmap,
      left,
      top,
      width,
      height,
      tileX + Math.round((tileWidth - drawWidth) / 2),
      tileY + Math.round((tileHeight - drawHeight) / 2),
      drawWidth,
      drawHeight,
    );
    return { region, tileX, tileY, column, row };
  });

  onProgress(`Lecture de ${regions.length} zones de cours…`);
  await worker.setParameters({
    tessedit_pageseg_mode: PSM.SPARSE_TEXT,
    preserve_interword_spaces: '1',
    user_defined_dpi: '300',
  });
  const result = await worker.recognize(canvas, { rotateAuto: false }, { blocks: true });
  const tileLines = new Map<number, Array<{ x: number; y: number; text: string }>>();
  const ocrLines = extractOcrLines(result.data.blocks ?? [], []);
  for (const line of ocrLines) {
    const column = Math.floor((line.x - gap) / (tileWidth + gap));
    const row = Math.floor((line.y - gap) / (tileHeight + gap));
    if (column < 0 || column >= columns || row < 0 || row >= rows) continue;
    const index = row * columns + column;
    if (index >= regions.length) continue;
    const entries = tileLines.get(index) ?? [];
    entries.push({
      x: line.x - (gap + column * (tileWidth + gap)),
      y: line.y - (gap + row * (tileHeight + gap)),
      text: line.text,
    });
    tileLines.set(index, entries);
  }

  return tilePositions.flatMap(({ region }, index) => {
    const text = (tileLines.get(index) ?? [])
      .sort((a, b) => a.y - b.y || a.x - b.x)
      .map((line) => line.text)
      .join('\n')
      .trim();
    if (!text) return [];
    return [{
      text,
      x: (region.x + region.width / 2 - source.x) * source.scale,
      y: (region.y + region.height / 2 - source.y) * source.scale,
    }];
  });
}

function fold(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('fr').trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findDay(text: string, days: DayDef[]): DayDef | undefined {
  const normalizedText = fold(text).replace(/[.,:;()[\]]/g, ' ');
  const directMatch = days.find((day) => {
    const name = fold(day.name);
    const aliases = [name, name.slice(0, 3)];
    return aliases.some((alias) => new RegExp(`(?:^|\\s)${escapeRegExp(alias)}(?:$|\\s)`).test(normalizedText));
  });
  if (directMatch) return directMatch;

  return days.find((day) =>
    (ENGLISH_DAY_ALIASES[day.weekday] ?? []).some((alias) =>
      new RegExp(`(?:^|\\s)${escapeRegExp(alias)}(?:$|\\s)`).test(normalizedText),
    ),
  );
}

function containsOnlyDays(text: string, days: DayDef[]): boolean {
  let remaining = fold(text);
  for (const day of days) {
    const name = escapeRegExp(fold(day.name));
    const shortName = escapeRegExp(fold(day.name).slice(0, 3));
    remaining = remaining.replace(new RegExp(`\\b(?:${name}|${shortName})\\b`, 'g'), ' ');
    for (const alias of ENGLISH_DAY_ALIASES[day.weekday] ?? []) {
      remaining = remaining.replace(new RegExp(`\\b${escapeRegExp(alias)}\\b`, 'g'), ' ');
    }
  }
  return remaining.replace(/[|,;:()[\]]/g, ' ').trim().length === 0;
}

function parseStartTime(text: string): string | undefined {
  const minuteTime = text.match(/\b([01]?\d|2[0-3])\s*[:hH.]\s*([0-5]\d)\b/);
  if (minuteTime) return `${minuteTime[1].padStart(2, '0')}:${minuteTime[2]}`;
  const hourTime = text.match(/\b([01]?\d|2[0-3])\s*h\b/i);
  return hourTime ? `${hourTime[1].padStart(2, '0')}:00` : undefined;
}

function inferAdditionalSlots(lines: OcrLine[], slots: TimeSlot[]): TimeSlot[] {
  const knownRanges = new Set(slots.filter((slot) => !slot.isBreak).map((slot) => `${slot.start}-${slot.end}`));
  const inferred = new Map<string, TimeSlot>();
  for (const line of lines) {
    const ranges = line.text.matchAll(/\b(\d{1,2})\s*[:hH.]\s*(\d{2})\s*[-–—]\s*(\d{1,2})\s*[:hH.]\s*(\d{2})\b/g);
    for (const match of ranges) {
      const start = `${match[1]!.padStart(2, '0')}:${match[2]}`;
      const end = `${match[3]!.padStart(2, '0')}:${match[4]}`;
      const range = `${start}-${end}`;
      if (knownRanges.has(range) || inferred.has(range)) continue;
      const startMinute = Number(start.slice(0, 2)) * 60 + Number(start.slice(3));
      const endMinute = Number(end.slice(0, 2)) * 60 + Number(end.slice(3));
      if (startMinute >= endMinute || endMinute > 24 * 60 - 1) continue;
      inferred.set(range, { id: `ocr-${start.replace(':', '')}`, start, end });
    }
  }
  return [...inferred.values()];
}

function parseCourseType(text: string): CourseType {
  const match = text.match(/\b(CM|COURS|C|TD|TP|EL)\b/i);
  if (!match) return 'Cours';
  const value = match[1].toUpperCase();
  if (value === 'TD' || value === 'TP' || value === 'EL') return value;
  return 'Cours';
}

function cleanCourseName(text: string): { name: string; type: CourseType; teacher: string; room: string } {
  const normalizedText = text.replace(/\b(amphi)\s*[il](?=\b)/gi, '$1 1');
  const type = parseCourseType(normalizedText);
  const roomMatch = normalizedText.match(/(?:[A-Z]*classroom|salle|amphi(?:th[eé]âtre)?|room|lab(?:o)?|b[aâ]t(?:iment)?)\s*[:#-]?\s*([A-Z]?\d+[A-Z]?(?:[-/.]\d+)?)/i);
  const room = roomMatch?.[0].replace(/^[A-Z]*classroom/i, 'Classroom').trim() ?? '';
  const labeledTeacherMatch = normalizedText.match(/\b(?:enseignant(?:e)?|prof(?:esseur)?|teacher)\s*[:#-]?\s*([^,;|]+)/i);
  const lines = normalizedText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const teacherLine = lines.find((line) =>
    /^(?:[A-Z][a-z]+\.?\s*[A-Z](?:[a-z]+)?|[A-Z][a-z]+\s+[A-Za-z][a-z]+|[A-Z][a-z]+[A-Z][a-z]+)$/.test(line),
  );
  const inferredTeacher = normalizedText.match(/\b[A-Z][a-z]+\.?\s*[A-Z]\b|\b[A-Z][a-z]+\s+[A-Za-z][a-z]+\b|\b[A-Z][a-z]+[A-Z][a-z]+\b/)?.[0];
  const teacher = labeledTeacherMatch?.[1]?.trim() ?? teacherLine ?? inferredTeacher ?? '';
  const name = lines
    .filter((line) => line !== teacherLine)
    .join(' ')
    .replace(teacher ? new RegExp(escapeRegExp(teacher), 'i') : /$^/, ' ')
    .replace(/\(?\b(C|CM|COURS|TD|TP|EL)\b\)?/gi, ' ')
    .replace(/[A-Z]*classroom\s*[A-Z]?\d+[A-Z]?(?:[-/.]\d+)?\b/gi, ' ')
    .replace(/\b(?:salle|amphi(?:th[eé]âtre)?|room|lab(?:o)?|b[aâ]t(?:iment)?)\s*[:#-]?\s*[A-Z]?\d+[A-Z]?(?:[-/.]\d+)?\b/gi, ' ')
    .replace(/\b(?:enseignant(?:e)?|prof(?:esseur)?|teacher)\s*[:#-]?\s*[^,;|]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s|:;,-]+|[\s|:;,-]+$/g, '')
    .trim();
  return { name: name || text.trim(), type, teacher, room };
}

function differsByOneCharacter(shorter: string, longer: string): boolean {
  if (longer.length !== shorter.length + 1) return false;
  let shortIndex = 0;
  let skipped = false;
  for (const character of longer) {
    if (character === shorter[shortIndex]) {
      shortIndex += 1;
    } else if (skipped) {
      return false;
    } else {
      skipped = true;
    }
  }
  return true;
}

function findColoredCourseRegions(image: ImageData, scaleToOriginal: number): ColoredRegion[] {
  const { width, height, data } = image;
  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  const regions: ColoredRegion[] = [];

  const isColorFill = (index: number) => {
    const offset = index * 4;
    const red = data[offset]!;
    const green = data[offset + 1]!;
    const blue = data[offset + 2]!;
    return Math.max(red, green, blue) - Math.min(red, green, blue) > 25
      && Math.max(red, green, blue) > 35
      && Math.min(red, green, blue) < 230;
  };

  for (let index = 0; index < visited.length; index += 1) {
    if (visited[index] || !isColorFill(index)) continue;
    let start = 0;
    let end = 0;
    let left = width;
    let top = height;
    let right = 0;
    let bottom = 0;
    queue[end++] = index;
    visited[index] = 1;
    const enqueue = (neighbor: number) => {
      if (neighbor < 0 || visited[neighbor] || !isColorFill(neighbor)) return;
      visited[neighbor] = 1;
      queue[end++] = neighbor;
    };

    while (start < end) {
      const current = queue[start++]!;
      const x = current % width;
      const y = Math.floor(current / width);
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
      const leftNeighbor = x > 0 ? current - 1 : -1;
      const rightNeighbor = x + 1 < width ? current + 1 : -1;
      const topNeighbor = y > 0 ? current - width : -1;
      const bottomNeighbor = y + 1 < height ? current + width : -1;
      enqueue(leftNeighbor);
      enqueue(rightNeighbor);
      enqueue(topNeighbor);
      enqueue(bottomNeighbor);
    }

    const regionWidth = right - left + 1;
    const regionHeight = bottom - top + 1;
    if (end >= 400 && regionWidth >= 32 && regionHeight >= 20) {
      regions.push({
        x: Math.round(left * scaleToOriginal),
        y: Math.round(top * scaleToOriginal),
        width: Math.round(regionWidth * scaleToOriginal),
        height: Math.round(regionHeight * scaleToOriginal),
      });
    }
  }

  return regions
    .sort((a, b) => b.width * b.height - a.width * a.height)
    .slice(0, 18)
    .sort((a, b) => a.y - b.y || a.x - b.x);
}

function isHeaderOrNoise(text: string, days: DayDef[]): boolean {
  if (containsOnlyDays(text, days)) return true;
  const cleaned = text.replace(/\b([01]?\d|2[0-3])\s*[:hH.]\s*[0-5]\d\b/g, '').trim();
  if (!cleaned || parseStartTime(text) && !/[a-zà-ÿ]{2}/i.test(cleaned)) return true;
  return /^(emploi du temps|planning|semaine|semestre|groupe|universit[eé]|licence|master|pause|matin|apr[eè]s-midi)\b/i.test(fold(text));
}

function getCellText(text: string): Omit<AiCell, 'day' | 'slot' | 'rawText'> {
  const parsed = cleanCourseName(text);
  return {
    name: parsed.name,
    type: COURSE_TYPES.includes(parsed.type) ? parsed.type : 'Cours',
    teacher: parsed.teacher,
    room: parsed.room,
  };
}

function mapOcrLines(lines: OcrLine[], days: DayDef[], slots: TimeSlot[], regionTexts: RegionText[] = []): AiCell[] {
  const dayHeaders = lines
    .map((line) => ({ line, day: findDay(line.text, days) }))
    .filter((item): item is { line: OcrLine; day: DayDef } =>
      Boolean(item.day) && (item.line.isDayHeader || (containsOnlyDays(item.line.text, days) && item.line.text.trim().split(/\s+/).length === 1)),
    );
  const dayCoordinates = new Map<string, { x: number; y: number }>();
  dayHeaders.forEach(({ line, day }) => dayCoordinates.set(day.name, { x: line.x, y: line.y }));
  const uniqueDayHeaders = [...dayCoordinates].map(([name, point]) => ({ day: name, ...point }));
  const spread = (values: number[]) => values.length > 1 ? Math.max(...values) - Math.min(...values) : 0;
  const daysAreColumns = spread(uniqueDayHeaders.map((header) => header.x)) >= spread(uniqueDayHeaders.map((header) => header.y));
  let sortedDayHeaders = uniqueDayHeaders.sort((a, b) => daysAreColumns ? a.x - b.x : a.y - b.y);
  if (sortedDayHeaders.length >= 2) {
    const coordinate = (header: typeof sortedDayHeaders[number]) => daysAreColumns ? header.x : header.y;
    const inferred = new Map(sortedDayHeaders.map((header) => [header.day, header]));
    for (let i = 0; i < sortedDayHeaders.length - 1; i += 1) {
      const left = sortedDayHeaders[i]!;
      const right = sortedDayHeaders[i + 1]!;
      const leftIndex = days.findIndex((day) => day.name === left.day);
      const rightIndex = days.findIndex((day) => day.name === right.day);
      const gap = rightIndex - leftIndex;
      if (gap <= 1) continue;
      for (let offset = 1; offset < gap; offset += 1) {
        const day = days[leftIndex + offset];
        if (!day) continue;
        const ratio = offset / gap;
        const axisPoint = coordinate(left) + (coordinate(right) - coordinate(left)) * ratio;
        inferred.set(day.name, {
          day: day.name,
          x: daysAreColumns ? axisPoint : left.x + (right.x - left.x) * ratio,
          y: daysAreColumns ? left.y + (right.y - left.y) * ratio : axisPoint,
        });
      }
    }
    sortedDayHeaders = [...inferred.values()].sort((a, b) => daysAreColumns ? a.x - b.x : a.y - b.y);
  }

  const timeCandidates = lines.flatMap((line) => {
    const words = line.words?.filter((word) => parseStartTime(word.text));
    if (words?.length) {
      return words.flatMap((word) => {
        const start = parseStartTime(word.text);
        const slot = start ? slots.find((candidate) => !candidate.isBreak && candidate.start === start) : undefined;
        return slot ? [{ x: word.x, y: word.y, slot }] : [];
      });
    }
    const start = parseStartTime(line.text);
    const slot = start ? slots.find((candidate) => !candidate.isBreak && candidate.start === start) : undefined;
    return slot ? [{ x: line.x, y: line.y, slot }] : [];
  });
  const uniqueTimeHeaders = new Map<string, { x: number; y: number; slot: TimeSlot }>();
  timeCandidates.forEach((header) => {
    const key = `${header.slot.id}|${Math.round(header.x / 8)}|${Math.round(header.y / 8)}`;
    uniqueTimeHeaders.set(key, header);
  });
  const sortedTimeHeaders = [...uniqueTimeHeaders.values()];

  const coordinateForDay = (point: number): string | undefined => {
    if (sortedDayHeaders.length < 2) return undefined;
    const coordinate = (header: typeof sortedDayHeaders[number]) => daysAreColumns ? header.x : header.y;
    const index = sortedDayHeaders.findIndex((header, i) => {
      const current = coordinate(header);
      const previous = i > 0 ? coordinate(sortedDayHeaders[i - 1]!) : undefined;
      const next = i + 1 < sortedDayHeaders.length ? coordinate(sortedDayHeaders[i + 1]!) : undefined;
      const lower = previous === undefined ? current - (next! - current) / 2 : (previous + current) / 2;
      const upper = next === undefined ? current + (current - previous!) / 2 : (current + next) / 2;
      return point >= lower && point < upper;
    });
    return index >= 0 ? sortedDayHeaders[index]?.day : undefined;
  };

  const coordinateForSlot = (point: number): TimeSlot | undefined => {
    const axisIsVertical = daysAreColumns;
    const coordinate = (header: typeof sortedTimeHeaders[number]) => axisIsVertical ? header.y : header.x;
    const ordered = sortedTimeHeaders.sort((a, b) => coordinate(a) - coordinate(b));
    if (ordered.length < 2) return undefined;
    const index = ordered.findIndex((header, i) => {
      const current = coordinate(header);
      const previous = i > 0 ? coordinate(ordered[i - 1]!) : undefined;
      const next = i + 1 < ordered.length ? coordinate(ordered[i + 1]!) : undefined;
      const lower = previous === undefined ? current - (next! - current) / 2 : (previous + current) / 2;
      const upper = next === undefined ? current + (current - previous!) / 2 : (current + next) / 2;
      return point >= lower && point < upper;
    });
    return index >= 0 ? ordered[index]?.slot : undefined;
  };

  const candidates = lines
    .filter((line) => !line.isDayHeader && !containsOnlyDays(line.text, days))
    .flatMap((line) => {
      const words = line.words?.filter((word) => !parseStartTime(word.text) && !findDay(word.text, days));
      if (!words?.length) return line.words ? [] : [line];
      if (sortedDayHeaders.length < 2) {
        const text = words.map((word) => word.text).join(' ').trim();
        return text ? [{ ...line, text, words: undefined }] : [];
      }
      const columns = new Map<string, OcrWord[]>();
      words.forEach((word) => {
        const dayName = coordinateForDay(daysAreColumns ? word.x : word.y);
        if (!dayName) return;
        const columnWords = columns.get(dayName) ?? [];
        columnWords.push(word);
        columns.set(dayName, columnWords);
      });
      return [...columns].map(([day, columnWords]) => ({
        text: columnWords.map((word) => word.text).join(' '),
        x: columnWords.reduce((total, word) => total + word.x, 0) / columnWords.length,
        y: line.y,
        day,
        words: columnWords,
      }));
    })
    .filter((line) =>
      line.text.replace(/[^a-zà-ÿ]/gi, '').length >= 2
        && !isHeaderOrNoise(line.text, days)
        && !parseStartTime(line.text),
    );

  const positioned: PositionedCell[] = candidates.map((line) => {
    const day = line.day ?? coordinateForDay(daysAreColumns ? line.x : line.y);
    const slot = coordinateForSlot(daysAreColumns ? line.y : line.x);
    const rawText = line.text.trim();
    return {
      ...getCellText(line.text),
      day: day ?? '',
      slot: slot ? `${slot.start}-${slot.end}` : '',
      rawText,
      x: line.x,
      y: line.y,
    };
  });

  const firstLineCounts = new Map<string, { text: string; count: number }>();
  regionTexts.forEach((region) => {
    const firstLine = region.text.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
    if (!firstLine) return;
    const key = firstLine.toLocaleLowerCase().replace(/[^a-z0-9]/g, '');
    if (key.length < 4) return;
    const current = firstLineCounts.get(key);
    firstLineCounts.set(key, { text: firstLine, count: (current?.count ?? 0) + 1 });
  });
  const repeatedPrefix = [...firstLineCounts.values()]
    .filter((entry) => entry.count >= Math.max(3, Math.ceil(regionTexts.length * 0.45)))
    .sort((a, b) => b.count - a.count)[0]?.text;
  const repeatedPrefixKey = repeatedPrefix?.toLocaleLowerCase().replace(/[^a-z0-9]/g, '');
  const cleanRegionTexts = repeatedPrefixKey
    ? regionTexts.map((region) => {
      const lines = region.text.split(/\r?\n/);
      if (lines[0]?.trim().toLocaleLowerCase().replace(/[^a-z0-9]/g, '') !== repeatedPrefixKey) return region;
      return { ...region, text: lines.slice(1).join('\n').trim() };
    })
    : regionTexts;
  const coloredCells: PositionedCell[] = cleanRegionTexts.flatMap((region) => {
    const day = coordinateForDay(daysAreColumns ? region.x : region.y);
    const slot = coordinateForSlot(daysAreColumns ? region.y : region.x);
    if (!day || !slot || region.text.replace(/[^a-zà-ÿ]/gi, '').length < 2) return [];
    return [{
      ...getCellText(region.text),
      day,
      slot: `${slot.start}-${slot.end}`,
      rawText: region.text,
      x: region.x,
      y: region.y,
    }];
  });
  const correctedColoredCells = coloredCells.map((cell) => {
    const nameKey = fold(cell.name).replace(/[^a-z0-9]/g, '');
    if (nameKey.length < 8) return cell;
    const correction = coloredCells.find((candidate) => {
      const candidateKey = fold(candidate.name).replace(/[^a-z0-9]/g, '');
      return candidateKey.length > nameKey.length && differsByOneCharacter(nameKey, candidateKey);
    });
    return correction ? { ...cell, name: correction.name } : cell;
  });
  const cellsToGroup = correctedColoredCells.length >= 2 ? correctedColoredCells : positioned;

  const grouped = new Map<string, PositionedCell>();
  cellsToGroup.forEach((cell, index) => {
    const key = cell.day && cell.slot ? `${cell.day}|${cell.slot}` : `${cell.day}|${cell.slot}|${index}`;
    const previous = grouped.get(key);
    if (!previous) {
      grouped.set(key, cell);
      return;
    }
    const detail = getCellText(`${previous.name} ${cell.name}`);
    grouped.set(key, {
      ...previous,
      ...detail,
      teacher: previous.teacher || cell.teacher,
      room: previous.room || cell.room,
      rawText: [previous.rawText, cell.rawText].filter(Boolean).join(' · '),
    });
  });

  return [...grouped.values()].map(({ x: _x, y: _y, ...cell }) => cell).filter((cell) => cell.name.length > 1);
}

export async function analyzeTimetableFile(
  file: File | Blob,
  days: DayDef[],
  slots: TimeSlot[],
  onProgress: ProgressCallback = () => undefined,
): Promise<AiParseResult> {
  const mime = (file as File).type || '';
  const fileName = (file as File).name?.toLowerCase() ?? '';
  const supportedMime = ['image/jpeg', 'image/png', 'image/webp'].includes(mime);
  if (!supportedMime && !/\.(jpe?g|png|webp)$/.test(fileName)) {
    throw new AnalyzeError('unsupported', 'L’analyse locale accepte les photos JPG, PNG et WebP. Pour un PDF, prenez une capture de la page.');
  }

  let bitmap: ImageBitmap | undefined;
  try {
    onProgress('Premier démarrage : chargement du moteur OCR sur cet appareil…');
    const worker = await getWorker(onProgress);
    onProgress('Préparation de la photo…');
    bitmap = await createImageBitmap(file);
    const scanScale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
    const scanCanvas = document.createElement('canvas');
    scanCanvas.width = Math.round(bitmap.width * scanScale);
    scanCanvas.height = Math.round(bitmap.height * scanScale);
    const scanContext = scanCanvas.getContext('2d');
    if (!scanContext) throw new Error('Impossible d’analyser les couleurs de la photo.');
    scanContext.drawImage(bitmap, 0, 0, scanCanvas.width, scanCanvas.height);
    const coloredRegions = findColoredCourseRegions(
      scanContext.getImageData(0, 0, scanCanvas.width, scanCanvas.height),
      1 / scanScale,
    );

    const sourceX = Math.round(bitmap.width * 0.02);
    const sourceY = Math.round(bitmap.height * 0.02);
    const sourceWidth = Math.round(bitmap.width * 0.96);
    const sourceHeight = Math.round(bitmap.height * 0.92);
    const scale = Math.min(2, 1800 / Math.max(sourceWidth, sourceHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(sourceWidth * scale);
    canvas.height = Math.round(sourceHeight * scale);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Impossible de préparer la photo pour la reconnaissance.');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.SPARSE_TEXT,
      preserve_interword_spaces: '1',
      user_defined_dpi: '300',
    });
    const result = await worker.recognize(canvas, { rotateAuto: false }, { blocks: true });
    const regionTexts: RegionText[] = [];
    if (coloredRegions.length >= 2) {
      regionTexts.push(...await recognizeColoredRegions(
        worker,
        bitmap,
        coloredRegions,
        { x: sourceX, y: sourceY, scale },
        onProgress,
      ));
    }

    const lines = extractOcrLines(result.data.blocks ?? [], days);
    const additionalSlots = inferAdditionalSlots(lines, slots);
    const cells = mapOcrLines(lines, days, [...slots, ...additionalSlots], regionTexts);
    if (!cells.length) {
      throw new AnalyzeError('empty', 'Aucun cours n’a été détecté. Essaie une photo plus nette, cadrée sur le tableau et bien éclairée.');
    }
    const rawText = [
      result.data.text.trim(),
      regionTexts.length ? `Cours lus individuellement :\n${regionTexts.map((region) => region.text).join('\n---\n')}` : '',
    ].filter(Boolean).join('\n\n');
    return { title: 'Planning détecté sur l’appareil', cells, additionalSlots, rawText: rawText.slice(0, 5000) };
  } catch (error) {
    if (error instanceof AnalyzeError) throw error;
    const details = error instanceof Error ? error.message : 'Erreur inconnue';
    throw new AnalyzeError('recognition', `La reconnaissance locale a échoué : ${details}`);
  } finally {
    bitmap?.close();
  }
}
