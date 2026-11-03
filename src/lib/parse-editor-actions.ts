import type { EditorAction } from './editor-actions.ts';

const actionNames = new Set(['insertText', 'insertCode', 'insertHeading', 'insertParagraph', 'insertTable', 'insertList', 'update', 'delete', 'replace']);

function isAction(value: unknown): value is EditorAction {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return item.type === 'editor_action' && typeof item.action === 'string' && actionNames.has(item.action)
    && typeof item.description === 'string' && !!item.data && typeof item.data === 'object';
}

/** Extract complete actions, respecting JSON strings, escapes, and mixed nesting. */
export function parseEditorActions(content: string): { actions: EditorAction[]; text: string } {
  const actions: EditorAction[] = [];
  let text = '';
  let consumed = 0;
  for (let start = 0; start < content.length; start++) {
    if (content[start] !== '{' && content[start] !== '[') continue;
    const stack: string[] = [];
    let inString = false;
    let escaped = false;
    for (let end = start; end < content.length; end++) {
      const char = content[end];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') inString = true;
      else if (char === '{' || char === '[') stack.push(char);
      else if (char === '}' || char === ']') {
        if (stack.pop() !== (char === '}' ? '{' : '[')) break;
        if (stack.length) continue;
        try {
          const parsed: unknown = JSON.parse(content.slice(start, end + 1));
          const items = Array.isArray(parsed) ? parsed : [parsed];
          if (items.length && items.every(isAction)) {
            actions.push(...items);
            text += content.slice(consumed, start);
            consumed = end + 1;
            start = end;
          }
        } catch { /* Ordinary prose and incomplete JSON stay visible. */ }
        break;
      }
    }
  }
  text += content.slice(consumed);
  return { actions, text: text.replace(/```(?:json)?\s*```/g, '').trim() };
}
