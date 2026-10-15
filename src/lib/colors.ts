import { COLOR_PALETTE, type SubjectColor } from '../types';

const PREVIOUS_DEFAULT_PALETTE = [
  '#2563EB', '#7C3AED', '#DB2777', '#DC2626', '#EA580C',
  '#CA8A04', '#16A34A', '#0D9488', '#0891B2', '#4F46E5',
  '#9333EA', '#BE185D', '#B45309', '#15803D', '#0369A1',
  '#536B62', '#735D74', '#9A604D', '#806C49', '#536D83',
  '#885960', '#4F715B', '#75634F', '#4F7078', '#655F80',
  '#9A5E43', '#5D7372', '#785866', '#68724C', '#66635E',
  '#455DCE', '#99475E', '#A35E36', '#7057A6', '#286F7B',
  '#66732F', '#315E87', '#8E4779', '#98752C', '#366A58',
  '#65536D', '#8E514B', '#4B698C', '#75613C', '#3F7373',
  '#49677A', '#AD6249', '#738169', '#786A80', '#B2874D',
  '#557C79', '#8A5B48', '#65758A', '#9B7158', '#66734F',
  '#8B6671', '#536D83', '#A17942', '#5F7770', '#8B6255',
  '#455DCE', '#99475E', '#A35E36', '#7057A6', '#286F7B',
  '#66732F', '#315E87', '#8E4779', '#98752C', '#366A58',
  '#65536D', '#8E514B', '#4B698C', '#75613C', '#3F7373',
  '#9E5840', '#BD795C', '#8E4B36',
];

const PREVIOUS_GRAPHITE_PALETTE = [
  '#555B63', '#77736C', '#656D68', '#817B73', '#59636B',
  '#756B63', '#6D746D', '#65636A', '#82786D', '#59696A',
  '#766B69', '#626B75', '#7A7466', '#5F6964', '#756B72',
];

/** Contraste texte auto (YIQ) */
export function textColorForBg(hex: string): '#FFFFFF' | '#26292D' {
  const c = hex.replace('#', '');
  const full = c.length === 3 ? c.split('').map((x) => x + x).join('') : c;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  const luminance = (r * 299 + g * 587 + b * 114) / 1000;
  return luminance >= 155 ? '#26292D' : '#FFFFFF';
}

export function normalizeHex(input: string): string {
  let h = input.trim();
  if (!h.startsWith('#')) h = `#${h}`;
  if (/^#[0-9A-Fa-f]{3}$/.test(h)) {
    h = `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}`;
  }
  if (!/^#[0-9A-Fa-f]{6}$/.test(h)) return '#526F8F';
  return h.toUpperCase();
}

/** Hash stable matière → couleur palette */
export function hashColor(name: string, palette: string[]): string {
  let h = 0;
  const s = name.trim().toLowerCase();
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return palette[Math.abs(h) % palette.length]!;
}

export function subjectColorFor(name: string, subjectColors: SubjectColor[]): string {
  const found = subjectColors.find(
    (subject) => subject.name.trim().toLowerCase() === name.trim().toLowerCase(),
  );
  if (!found) return hashColor(name, COLOR_PALETTE);
  if ([PREVIOUS_DEFAULT_PALETTE, PREVIOUS_GRAPHITE_PALETTE]
    .some((palette) => found.color.toUpperCase() === hashColor(name, palette))) {
    return hashColor(name, COLOR_PALETTE);
  }
  return found.color;
}
