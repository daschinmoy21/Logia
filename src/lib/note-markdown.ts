import { parseNoteBlocks, type NoteBlock } from './workspace.ts';

function inlineMarkdown(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(inlineMarkdown).join('');
  if (!content || typeof content !== 'object') return '';
  const item = content as Record<string, unknown>;
  if (item.type === 'link') return `[${inlineMarkdown(item.content)}](${String(item.href || '').replace(/\)/g, '%29')})`;
  let text = typeof item.text === 'string' ? item.text : inlineMarkdown(item.content);
  const styles = item.styles as Record<string, unknown> | undefined;
  if (styles?.code) {
    const fence = '`'.repeat(Math.max(1, ...(text.match(/`+/g) || []).map((s) => s.length + 1)));
    return `${fence} ${text} ${fence}`;
  }
  if (styles?.bold) text = `**${text}**`;
  if (styles?.italic) text = `*${text}*`;
  if (styles?.strike) text = `~~${text}~~`;
  return text;
}

function blockMarkdown(block: NoteBlock, depth: number): string {
  const text = inlineMarkdown(block.content);
  const props = block.props || {};
  let own: string;
  switch (block.type) {
    case 'heading': own = `${'#'.repeat(Math.max(1, Math.min(6, Number(props.level) || 1)))} ${text}`; break;
    case 'bulletListItem': own = `- ${text}`; break;
    case 'numberedListItem': own = `1. ${text}`; break;
    case 'checkListItem': own = `- [${props.checked ? 'x' : ' '}] ${text}`; break;
    case 'quote': own = text.split('\n').map((line) => `> ${line}`).join('\n'); break;
    case 'codeBlock': {
      const fence = '`'.repeat(Math.max(3, ...(text.match(/`+/g) || []).map((s) => s.length + 1)));
      own = `${fence}${String(props.language || '').replace(/[^\w+-]/g, '')}\n${text}\n${fence}`;
      break;
    }
    case 'table': {
      const rows = (block.content as { rows?: Array<{ cells: unknown[] }> })?.rows || [];
      const lines = rows.map((row) => `| ${row.cells.map((cell) => inlineMarkdown(cell).replace(/\|/g, '\\|').replace(/\n/g, '<br>')).join(' | ')} |`);
      if (rows.length) lines.splice(1, 0, `| ${rows[0].cells.map(() => '---').join(' | ')} |`);
      own = lines.join('\n');
      break;
    }
    case 'image': own = `![${String(props.caption || props.name || '').replace(/[\[\]]/g, '')}](${String(props.url || '').replace(/\)/g, '%29')})`; break;
    case 'file': case 'audio': case 'video': own = `[${String(props.name || block.type)}](${String(props.url || '').replace(/\)/g, '%29')})`; break;
    default: own = text;
  }
  const indent = '  '.repeat(depth);
  const result = own.split('\n').map((line) => indent + line).join('\n');
  const children = (block.children || []).map((child) => blockMarkdown(child, depth + 1)).join('\n\n');
  return children ? `${result}\n\n${children}` : result;
}

/** Portable, best-effort Markdown. Keep raw JSON alongside snapshots for lossless recovery. */
export function noteToMarkdown(content: string): string {
  const blocks = parseNoteBlocks(content);
  if (!blocks) return content;
  let frontmatter = '';
  // Imported vault metadata is stored visibly as YAML immediately after the title.
  const yaml = blocks[1];
  const body = [...blocks];
  if (blocks[0]?.type === 'heading' && yaml?.type === 'codeBlock' && yaml.props?.language === 'yaml') {
    frontmatter = `---\n${inlineMarkdown(yaml.content)}\n---\n\n`;
    body.splice(1, 1);
  }
  return frontmatter + body.map((block) => blockMarkdown(block, 0)).join('\n\n') + '\n';
}
