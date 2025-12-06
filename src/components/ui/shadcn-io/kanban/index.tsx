'use client';

import type {
  DragEndEvent,
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
        'flex h-full min-h-[150px] flex-col rounded-xl border border-zinc-800/50 bg-zinc-950/30 text-zinc-300 transition-all duration-200',
        isOver ? 'bg-zinc-900/80 ring-2 ring-blue-500/20' : '',
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
};

export const KanbanCard = <T extends KanbanItemProps = KanbanItemProps>({
  id,
  name,
  children,
  className,
  onDelete,
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
    transform: CSS.Transform.toString(transform),
  };

  return (
    <div style={style} ref={setNodeRef} className={cn("relative group", isDragging ? "z-50" : "z-0")}>
      <div
        className={cn(
          'relative flex w-full items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900 p-3 shadow-sm transition-all duration-200',
          'hover:border-zinc-700 hover:shadow-md',
          isDragging ? 'cursor-grabbing opacity-90 ring-2 ring-blue-500/30 scale-105 rotate-1 shadow-xl' : 'cursor-grab',
          className
        )}
      >
        <div
          className="cursor-grab p-1.5 text-zinc-600 hover:text-zinc-400 hover:bg-zinc-800 rounded-md transition-colors"
          {...listeners}
          {...attributes}
        >
          <GripVertical size={16} />
        </div>
        <div className="flex-1 min-w-0">
          {children ?? <p className="m-0 font-medium text-sm truncate">{name}</p>}
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete?.(id);
          }}
          className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-1.5 text-zinc-500 hover:text-red-400 hover:bg-zinc-800 rounded-md transition-all"
          title="Delete Task"
        >
          <Trash2 size={15} />
        </button>
      </div>
    </div>
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
        className={cn('flex flex-grow flex-col gap-3 p-3', className)}
      >
        {filteredData.map(children)}
      </div>
      <ScrollBar orientation="vertical" />
    </ScrollArea>
  );
};

export type KanbanHeaderProps = HTMLAttributes<HTMLDivElement>;

export const KanbanHeader = ({ className, ...props }: KanbanHeaderProps) => (
  <div 
    className={cn('flex items-center border-b border-zinc-800/50 p-4 font-semibold text-sm text-zinc-200 bg-zinc-900/20 rounded-t-xl', className)} 
    {...props} 
  />
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

  const handleDragStart = (event: any) => {
    setActiveCardId(event.active.id);
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
            'grid size-full auto-cols-fr grid-flow-col gap-6',
            className
          )}
        >
          {columns.map((column) => children(column))}
        </div>
        <DragOverlay>
          {activeCardId && (
            <KanbanCard
              id={activeCardId}
              name={data.find(d => d.id === activeCardId)?.name || ''}
              column=""
              isDragging
            />
          )}
        </DragOverlay>
      </DndContext>
    </KanbanContext.Provider>
  );
};