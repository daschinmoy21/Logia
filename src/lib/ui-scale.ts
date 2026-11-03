export const MIN_UI_SCALE = 0.5;
export const MAX_UI_SCALE = 2;

export function normalizeUiScale(scale: number): number {
  return Number.isFinite(scale) ? Math.round(Math.min(MAX_UI_SCALE, Math.max(MIN_UI_SCALE, scale)) * 100) / 100 : 1;
}

export function uiScaleAction(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'>): 'in' | 'out' | 'reset' | null {
  if ((!event.ctrlKey && !event.metaKey) || event.altKey) return null;
  if (['+', '=', 'Add'].includes(event.key)) return 'in';
  if (['-', '_', 'Subtract'].includes(event.key)) return 'out';
  return event.key === '0' ? 'reset' : null;
}
