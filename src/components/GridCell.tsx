import { useDroppable } from '@dnd-kit/core';
import type { ReactNode } from 'react';
import { useSettingsStore } from '../store/settingsStore';
import { translate } from '../lib/i18n';

interface Props {
  dayId: string;
  slotId: string;
  dayName: string;
  start: string;
  end: string;
  children?: ReactNode;
  onEmptyClick?: () => void;
}

export function GridCell({ dayId, slotId, dayName, start, end, children, onEmptyClick }: Props) {
  const language = useSettingsStore((state) => state.language);
  const t = (source: string) => translate(language, source);
  const { setNodeRef, isOver } = useDroppable({
    id: `cell:${dayId}:${slotId}`,
    data: { dayId, slotId },
  });

  return (
    <div
      ref={setNodeRef}
      role="group"
      aria-label={`${dayName}, ${start} ${t('à')} ${end}${children ? `, ${t('cours déjà présent')}` : `, ${t('case libre, appuyer pour ajouter un cours')}`}`}
      data-drop-target={isOver ? 'active' : undefined}
      onClick={() => {
        if (!children && onEmptyClick) onEmptyClick();
      }}
      className={`grid-cell relative min-h-[4.5rem] rounded-2xl border border-dashed transition-colors ${
        isOver ? 'is-drop-target' : ''
      } ${!children ? 'is-empty cursor-pointer' : ''}`}
    >
      {children}
      {isOver && (
        <div className="drop-target-label" aria-hidden="true">
          <span>{t(children ? 'Échanger' : 'Déposer ici')}</span>
        </div>
      )}
      {!children && !isOver && <span className="cell-add-indicator" aria-hidden="true">＋</span>}
    </div>
  );
}
