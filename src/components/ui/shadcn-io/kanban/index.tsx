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
import { Card } from '@/components/ui/card';
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
        'flex size-full min-h-40 flex-col divide-y overflow-hidden rounded-md border bg-zinc-900 text-zinc-300 shadow-sm ring-2 transition-all border-zinc-700 divide-zinc-600',
        isOver ? 'ring-blue-500' : 'ring-transparent',
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
    <div style={style} ref={setNodeRef}>
      <Card
        className={cn(
          'gap-4 rounded-md p-3 shadow-sm bg-zinc-700 border-zinc-600 text-zinc-300',
          isDragging && 'opacity-50',
          className
        )}
      >
        <div className="flex items-center">
          <div
            className="cursor-grab p-1 hover:bg-zinc-700 rounded"
            {...listeners}
            {...attributes}
          >
            <GripVertical size={14} className="text-zinc-500" />
          </div>
          <div className="flex-1">
            {children ?? <p className="m-0 font-medium text-sm">{name}</p>}
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete?.(id);
            }}
            className="p-1 text-zinc-500 hover:text-red-400 hover:bg-zinc-700 rounded transition-colors"
            title="Delete Task"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </Card>
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
    <ScrollArea className="overflow-hidden">
      <div
        className={cn('flex flex-grow flex-col gap-2 p-2', className)}
      >
        {filteredData.map(children)}
      </div>
      <ScrollBar orientation="vertical" />
    </ScrollArea>
  );
};

export type KanbanHeaderProps = HTMLAttributes<HTMLDivElement>;

export const KanbanHeader = ({ className, ...props }: KanbanHeaderProps) => (
  <div className={cn('m-0 p-2 font-semibold text-sm text-zinc-200', className)} {...props} />
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
    useSensor(MouseSensor),
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
            'grid size-full auto-cols-fr grid-flow-col gap-4',
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
            />
          )}
        </DragOverlay>
      </DndContext>
    </KanbanContext.Provider>
  );
};