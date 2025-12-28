'use client';

import type {
  DragEndEvent,
  DragStartEvent,
} from '@dnd-kit/core';
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
  defaultDropAnimationSideEffects,
  DropAnimation
} from '@dnd-kit/core';
import { arrayMove, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  createContext,
  type HTMLAttributes,
  type ReactNode,
  useContext,
  useState,
} from 'react';
import { GripVertical, Trash2 } from 'lucide-react';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';

type KanbanItemProps = {
  id: string;
  name: string;
  column: string;
} & Record<string, unknown>;

type KanbanColumnProps = {
  id: string;
  name: string;
} & Record<string, unknown>;

type KanbanContextProps<
  T extends KanbanItemProps = KanbanItemProps,
  C extends KanbanColumnProps = KanbanColumnProps,
> = {
  columns: C[];
  data: T[];
  activeCardId: string | null;
};

const KanbanContext = createContext<KanbanContextProps>({
  columns: [],
  data: [],
  activeCardId: null,
});

export type KanbanBoardProps = {
  id: string;
  children: ReactNode;
  className?: string;
};

export const KanbanBoard = ({ id, children, className }: KanbanBoardProps) => {
  const { isOver, setNodeRef } = useDroppable({
    id,
  });

  return (
    <div
      className={cn(
        'flex h-full min-h-[150px] flex-col rounded-lg bg-zinc-900/40 transition-colors duration-200',
        isOver ? 'bg-zinc-900/60 ring-1 ring-zinc-700/50' : '',
        className
      )}
      ref={setNodeRef}
    >
      {children}
    </div>
  );
};

export type KanbanCardProps<T extends KanbanItemProps = KanbanItemProps> = T & {
  children?: ReactNode;
  className?: string;
  onDelete?: (id: string) => void;
  isOverlay?: boolean;
};

export const KanbanCard = <T extends KanbanItemProps = KanbanItemProps>({
  id,
  name,
  column,
  children,
  className,
  onDelete,
  isOverlay,
}: KanbanCardProps<T>) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transition,
    transform,
    isDragging,
  } = useSortable({
    id,
  });

  const style = {
    transition,
    transform: CSS.Translate.toString(transform),
  };

  const isDone = column === 'done';

  if (isOverlay) {
    return (
      <div
        className={cn(
          'relative flex w-full cursor-grabbing items-center gap-2 rounded-md border border-zinc-700 bg-zinc-800 p-2 shadow-xl',
          className
        )}
      >
        <div className="text-zinc-500">
          <GripVertical size={14} />
        </div>
        <div className="flex-1 min-w-0 text-sm font-medium text-zinc-200">
          {children ?? <p className="truncate">{name}</p>}
        </div>
      </div>
    );
  }

  return (
    <motion.div
      layoutId={id}
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      style={style}
      ref={setNodeRef}
      className={cn("relative group mb-1.5 last:mb-0", isDragging ? "opacity-30" : "")}
    >
      <div
        className={cn(
          'relative flex w-full value-list-item items-center gap-2 rounded-md border border-transparent bg-zinc-800/80 p-2 shadow-sm transition-all duration-200',
          'hover:bg-zinc-800 hover:shadow-md hover:border-zinc-700/50',
          isDone && 'opacity-60 hover:opacity-100',
          className
        )}
      >
        <div
          className="cursor-grab p-0.5 text-zinc-600 hover:text-zinc-400 rounded transition-colors"
          {...listeners}
          {...attributes}
        >
          <GripVertical size={14} />
        </div>
        <div className={cn("flex-1 min-w-0 transition-all", isDone && "line-through text-zinc-500")}>
          {children ?? <p className={cn("m-0 text-sm truncate", isDone ? "text-zinc-500" : "text-zinc-300")}>{name}</p>}
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete?.(id);
          }}
          className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-1 text-zinc-500 hover:text-red-400 hover:bg-zinc-700/50 rounded transition-all"
          title="Delete Task"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </motion.div>
  );
};

export type KanbanCardsProps<T extends KanbanItemProps = KanbanItemProps> =
  Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'id'> & {
    children: (item: T) => ReactNode;
    id: string;
  };

export const KanbanCards = <T extends KanbanItemProps = KanbanItemProps>({
  children,
  className,
  id,
}: KanbanCardsProps<T>) => {
  const { data } = useContext(KanbanContext) as KanbanContextProps<T>;
  const filteredData = data.filter((item) => item.column === id);

  return (
    <ScrollArea className="flex-1">
      <div
        className={cn('flex flex-grow flex-col p-2', className)}
      >
        {filteredData.length > 0 ? (
          filteredData.map(children)
        ) : (
          <div className="flex h-16 items-center justify-center rounded-md border border-dashed border-zinc-800/50 bg-zinc-900/5 hover:bg-zinc-900/10 transition-colors">
            <span className="text-xs text-zinc-600 font-medium">Empty</span>
          </div>
        )}
      </div>
      <ScrollBar orientation="vertical" />
    </ScrollArea>
  );
};

export type KanbanHeaderProps = HTMLAttributes<HTMLDivElement> & {
  count?: number;
};

export const KanbanHeader = ({ className, children, ...props }: KanbanHeaderProps) => (
  <div
    className={cn(
      'flex items-center justify-between p-3 font-semibold text-xs text-zinc-400 uppercase tracking-wider',
      className
    )}
    {...props}
  >
    {children}
  </div>
);

export type KanbanProviderProps<
  T extends KanbanItemProps = KanbanItemProps,
  C extends KanbanColumnProps = KanbanColumnProps,
> = {
  children: (column: C) => ReactNode;
  className?: string;
  columns: C[];
  data: T[];
  onDataChange?: (data: T[]) => void;
  renderOverlayCard?: (item: T) => ReactNode;
};

const dropAnimation: DropAnimation = {
  sideEffects: defaultDropAnimationSideEffects({
    styles: {
      active: {
        opacity: '0.5',
      },
    },
  }),
};

export const KanbanProvider = <
  T extends KanbanItemProps = KanbanItemProps,
  C extends KanbanColumnProps = KanbanColumnProps,
>({
  children,
  className,
  columns,
  data,
  onDataChange,
  renderOverlayCard,
}: KanbanProviderProps<T, C>) => {
  const [activeCardId, setActiveCardId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: {
        distance: 10,
      },
    }),
    useSensor(TouchSensor),
    useSensor(KeyboardSensor)
  );

  const handleDragStart = (event: DragStartEvent) => {
    setActiveCardId(event.active.id as string);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveCardId(null);
    const { active, over } = event;

    if (!over) return;

    const activeItem = data.find((item) => item.id === active.id);
    if (!activeItem) return;

    const overItem = data.find((item) => item.id === over.id);
    const overColumn = overItem ? overItem.column : columns.find(col => col.id === over.id)?.id;

    if (!overColumn) return;

    let newData = [...data];

    if (activeItem.column === overColumn) {
      // reorder within column
      const columnItems = newData.filter(item => item.column === overColumn);
      const oldIndex = columnItems.findIndex(item => item.id === active.id);
      const newIndex = overItem ? columnItems.findIndex(item => item.id === over.id) : columnItems.length;
      const reordered = arrayMove(columnItems, oldIndex, newIndex);
      newData = newData.map(item => item.column === overColumn ? reordered.find(r => r.id === item.id) || item : item);
    } else {
      // move to different column
      activeItem.column = overColumn;
      const columnItems = newData.filter(item => item.column === overColumn);
      const insertIndex = overItem ? columnItems.findIndex(item => item.id === over.id) + 1 : columnItems.length;
      const activeIndex = newData.findIndex(item => item.id === active.id);
      newData.splice(activeIndex, 1);
      const insertGlobalIndex = newData.findIndex(item => item.column === overColumn && columnItems[insertIndex - 1]?.id === item.id) + 1;
      newData.splice(insertGlobalIndex, 0, activeItem);
    }

    onDataChange?.(newData);
  };

  return (
    <KanbanContext.Provider value={{ columns, data, activeCardId }}>
      <DndContext
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        sensors={sensors}
      >
        <div
          className={cn(
            'grid size-full auto-cols-fr grid-flow-col gap-4 p-2',
            className
          )}
        >
          {columns.map((column) => children(column))}
        </div>
        <DragOverlay dropAnimation={dropAnimation}>
          {activeCardId && (
            renderOverlayCard ? (
              renderOverlayCard(data.find(d => d.id === activeCardId)!)
            ) : (
              <KanbanCard
                id={activeCardId}
                name={data.find(d => d.id === activeCardId)?.name || ''}
                column={data.find(d => d.id === activeCardId)?.column || ''}
                isOverlay
              />
            )
          )}
        </DragOverlay>
      </DndContext>
    </KanbanContext.Provider>
  );
};