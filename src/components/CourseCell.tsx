import { useEffect, useRef } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { motion } from 'framer-motion';
import type { Course } from '../types';
import { textColorForBg } from '../lib/colors';
import { useSettingsStore } from '../store/settingsStore';
import { translate } from '../lib/i18n';

interface Props {
  course: Course;
  color: string;
  conflict?: boolean;
  dimmed?: boolean;
  onOpen: () => void;
}

export function CourseCell({ course, color, conflict, dimmed, onOpen }: Props) {
  const language = useSettingsStore((state) => state.language);
  const t = (source: string) => translate(language, source);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `course:${course.dayId}:${course.slotId}`,
    data: { dayId: course.dayId, slotId: course.slotId, courseId: course.id, courseName: course.name },
  });
  const wasDragging = useRef(false);
  const resetDragTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (isDragging) {
      wasDragging.current = true;
      window.clearTimeout(resetDragTimer.current);
    } else if (wasDragging.current) {
      resetDragTimer.current = window.setTimeout(() => {
        wasDragging.current = false;
      }, 500);
    }
    return () => window.clearTimeout(resetDragTimer.current);
  }, [isDragging]);

  const style = {
    transform: CSS.Translate.toString(transform),
    backgroundColor: color,
    color: textColorForBg(color),
    opacity: isDragging ? 0.35 : dimmed ? 0.35 : 1,
    zIndex: isDragging ? 50 : 1,
  };

  return (
    <motion.button
      type="button"
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      onClick={(e) => {
        e.stopPropagation();
        if (isDragging || wasDragging.current) {
          wasDragging.current = false;
          window.clearTimeout(resetDragTimer.current);
          return;
        }
        onOpen();
      }}
      whileTap={isDragging ? undefined : { scale: 0.97 }}
      aria-label={`${t(course.type)} ${course.name}, ${course.room || t('salle non précisée')}${course.teacher ? `, ${course.teacher}` : ''}. ${t('Maintenir pour déplacer.')}`}
      aria-roledescription={t('cours déplaçable')}
      className={`course-card w-full h-full min-h-[3.5rem] rounded-xl p-1.5 text-left shadow-card touch-none select-none ${
        conflict ? 'ring-2 ring-danger ring-offset-1 ring-offset-surface' : ''
      }`}
    >
      <div className="course-card-top">
        <span className="course-type">{t(course.type)}</span>
        <span className="course-grip" aria-hidden="true">⠿</span>
      </div>
      <div className="course-name line-clamp-2">{course.name}</div>
      <div className="course-meta line-clamp-2">
        {course.room || t('Salle à définir')}
        {course.teacher ? ` · ${course.teacher}` : ''}
      </div>
    </motion.button>
  );
}

export function CourseDragOverlay({
  course,
  color,
}: {
  course: Course;
  color: string;
}) {
  const language = useSettingsStore((state) => state.language);
  const t = (source: string) => translate(language, source);
  return (
    <div
      className="course-drag-overlay pointer-events-none"
      style={{ backgroundColor: color, color: textColorForBg(color) }}
    >
      <span className="course-type">{t(course.type)}</span>
      <strong>{course.name}</strong>
      <small>{course.room || t('Salle à définir')}</small>
    </div>
  );
}
