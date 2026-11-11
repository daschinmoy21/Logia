/**
 * Obsidian-flavoured Markdown → BlockNote blocks, in two passes around BlockNote's own parser.
 *
 * Before parsing, syntax the Markdown parser would mangle is swapped for inert tokens:
 * wikilinks (so `[[a_b_c]]` isn't read as emphasis) and attachment embeds (so they can become
 * image blocks). Comments, callout markers and block ids are rewritten or dropped.
 * After parsing, tokens are restored, images inserted, and `==highlights==` styled.
 * Fenced and inline code are never touched.
 */

export type ImportBlock = {
  id?: string;
  type: string;
  props?: Record<string, unknown>;
  content?: unknown;
  children?: ImportBlock[];
};

export interface ImageRef {
  /** The path or name as written in the note. */
  target: string;
  /** Pixel width from `![[img.png|300]]` or `![alt|300](img.png)`. */
  width?: number;
  /** Exactly what the note said, put back if the file can't be found. */
  original: string;
}

export interface Prepared {
  markdown: string;
  links: string[];
  images: ImageRef[];
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;
const TOKEN = /LOGIA(WL|IMG)(\d+)Z/g;
const CODE_SLOT = /(\d+)/g;

export const isImagePath = (path: string) => IMAGE_EXT.test(path);

export function splitFrontmatter(source: string): { yaml: string | null; body: string } {
  const text = source.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const match = text.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  return match ? { yaml: match[1], body: text.slice(match[0].length) } : { yaml: null, body: text };
}

/** `300` or `300x200` after a pipe. */
function parseWidth(value: string | undefined): number | undefined {
  const width = value?.trim().match(/^(\d+)(?:x\d+)?$/)?.[1];
  return width ? Number(width) : undefined;
}

function transformProse(text: string, out: Prepared): string {
  const code: string[] = [];
  let result = text
    // Inline code is literal: park it so no rule below sees inside it.
    .replace(/(`+)[^`\n]*?\1/g, (span) => `${code.push(span) - 1}`)
    .replace(/%%[\s\S]*?%%/g, '')
    // `> [!note]- Title` → a bold first line in the quote.
    .replace(/^((?:[ \t]*>[ \t]?)+)\[!([\w-]+)\][+-]?[ \t]*(.*)$/gm, (_m, quote: string, kind: string, title: string) => {
      const label = title.trim() || kind.charAt(0).toUpperCase() + kind.slice(1).toLowerCase();
      return `${quote}**${label}**`;
    })
    // Block ids: `text ^abc123` and lines that are only `^abc123`.
    .replace(/[ \t]+\^[A-Za-z0-9-]+[ \t]*$/gm, '')
    .replace(/^\^[A-Za-z0-9-]+[ \t]*$/gm, '')
    .replace(/!\[\[([^\]\n]+)\]\]/g, (original, inner: string) => {
      const [destination, ...rest] = inner.split('|');
      const target = destination.split('#')[0].trim();
      if (!isImagePath(target)) return `[[${inner}]]`; // Note and file embeds become plain links.
      return `LOGIAIMG${out.images.push({ target, width: parseWidth(rest[0]), original }) - 1}Z`;
    })
    .replace(/!\[([^\]\n]*)\]\(([^)\n]+)\)/g, (original, alt: string, rawUrl: string) => {
      const url = rawUrl.trim().replace(/^<|>$/g, '').replace(/\s+"[^"]*"$/, '');
      if (/^(https?:|data:)/i.test(url)) return original;
      let target = url;
      try { target = decodeURI(url); } catch { /* keep it as written */ }
      if (!isImagePath(target)) return original;
      return `LOGIAIMG${out.images.push({ target, width: parseWidth(alt.split('|')[1]), original }) - 1}Z`;
    })
    .replace(/\[\[([^\]\n]+)\]\]/g, (_m, inner: string) => `LOGIAWL${out.links.push(inner) - 1}Z`);
  result = result.replace(CODE_SLOT, (_m, index: string) => code[Number(index)]);
  return result;
}

export function prepareObsidianMarkdown(body: string): Prepared {
  const out: Prepared = { markdown: '', links: [], images: [] };
  const lines = body.split('\n');
  const parts: string[] = [];
  let prose: string[] = [];
  let fence: string | null = null;
  const flush = () => {
    if (prose.length) parts.push(transformProse(prose.join('\n'), out));
    prose = [];
  };
  for (const line of lines) {
    const marker = line.match(/^[ \t]*(`{3,}|~{3,})/)?.[1];
    if (fence) {
      parts.push(line);
      if (marker && marker[0] === fence[0] && marker.length >= fence.length && line.trim() === marker) fence = null;
    } else if (marker) {
      flush();
      parts.push(line);
      fence = marker;
    } else {
      prose.push(line);
    }
  }
  flush();
  out.markdown = parts.join('\n');
  return out;
}

type Inline = { type: string; text?: string; styles?: Record<string, unknown>; content?: Inline[]; href?: string };

/** Restore tokens in one inline array; image tokens are removed and reported by index. */
function restoreInline(items: Inline[], links: string[], images: (string | null)[], refs: ImageRef[], found: number[]): Inline[] {
  const out: Inline[] = [];
  for (const item of items) {
    if (item.type === 'link' && Array.isArray(item.content)) {
      out.push({ ...item, content: restoreInline(item.content, links, images, refs, found) });
      continue;
    }
    if (item.type !== 'text' || typeof item.text !== 'string') {
      out.push(item);
      continue;
    }
    const text = item.text.replace(TOKEN, (_m, kind: string, index: string) => {
      const i = Number(index);
      if (kind === 'WL') return `[[${links[i]}]]`;
      if (images[i]) {
        found.push(i);
        return '';
      }
      return refs[i]?.original ?? '';
    });
    // ==highlight== → yellow background, unless already code.
    const pieces = item.styles?.code ? [text] : text.split(/(==[^=\n]+==)/);
    for (const piece of pieces) {
      if (!piece) continue;
      const highlighted = /^==[^=\n]+==$/.test(piece) && !item.styles?.code;
      out.push({
        ...item,
        text: highlighted ? piece.slice(2, -2) : piece,
        styles: highlighted ? { ...item.styles, backgroundColor: 'yellow' } : item.styles,
      });
    }
  }
  return out;
}

const onlyWhitespace = (items: Inline[]) => items.every((item) => item.type === 'text' && !item.text?.trim());

/**
 * Put tokens back after BlockNote has parsed the Markdown. `images[i]` is the resolved URL
 * for `refs[i]`, or null when the file wasn't found (the original syntax is kept as text).
 */
export function finishObsidianBlocks(
  blocks: ImportBlock[],
  links: string[],
  refs: ImageRef[],
  images: (string | null)[],
  newId: () => string,
): ImportBlock[] {
  const imageBlock = (index: number): ImportBlock => {
    const ref = refs[index];
    const name = ref.target.split('/').pop() || ref.target;
    return {
      id: newId(),
      type: 'image',
      props: { url: images[index], name, caption: '', ...(ref.width ? { previewWidth: ref.width } : {}) },
      children: [],
    };
  };

  const walk = (list: ImportBlock[]): ImportBlock[] => {
    const out: ImportBlock[] = [];
    for (const block of list) {
      const found: number[] = [];
      let content = block.content;
      if (Array.isArray(content)) {
        content = restoreInline(content as Inline[], links, images, refs, found);
      } else if (content && typeof content === 'object' && (content as { type?: string }).type === 'tableContent') {
        const table = content as { rows: Array<{ cells: unknown[] }> };
        content = {
          ...table,
          rows: table.rows.map((row) => ({
            ...row,
            cells: row.cells.map((cell) => {
              if (Array.isArray(cell)) return restoreInline(cell as Inline[], links, images, refs, found);
              const tableCell = cell as { content?: Inline[] };
              return Array.isArray(tableCell.content)
                ? { ...tableCell, content: restoreInline(tableCell.content, links, images, refs, found) }
                : cell;
            }),
          })),
        };
      }
      const children = block.children?.length ? walk(block.children) : block.children;
      const imageOnly = found.length > 0 && block.type === 'paragraph' && Array.isArray(content) && onlyWhitespace(content as Inline[]) && !children?.length;
      if (!imageOnly) out.push({ ...block, content, children });
      out.push(...found.map(imageBlock));
    }
    return out;
  };
  return walk(blocks);
}

const blockText = (block: ImportBlock | undefined) =>
  Array.isArray(block?.content) ? (block.content as Inline[]).map((item) => item.text ?? '').join('') : '';

/**
 * Obsidian names a note after its file, and links resolve by that name. Keep a leading H1 that
 * already says the same, otherwise add the filename as the title heading.
 */
export function withFilenameTitle(blocks: ImportBlock[], filename: string, newId: () => string): ImportBlock[] {
  const first = blocks[0];
  const same = first?.type === 'heading' && first.props?.level === 1 && blockText(first).trim().toLowerCase() === filename.trim().toLowerCase();
  if (same) return blocks;
  return [{ id: newId(), type: 'heading', props: { level: 1 }, content: [{ type: 'text', text: filename, styles: {} }], children: [] }, ...blocks];
}

const normalizePath = (path: string) => {
  const parts: string[] = [];
  for (const part of path.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return parts.join('/');
};

/**
 * Find an attachment the way Obsidian does: relative to the note, then from the vault root,
 * then by file name anywhere in the vault (shortest path wins).
 */
export function resolveAttachment(target: string, notePath: string, attachments: string[]): string | null {
  const byLower = new Map(attachments.map((path) => [path.toLowerCase(), path]));
  const noteDir = notePath.split('/').slice(0, -1).join('/');
  for (const candidate of [normalizePath(`${noteDir}/${target}`), normalizePath(target)]) {
    const hit = byLower.get(candidate.toLowerCase());
    if (hit) return hit;
  }
  const name = normalizePath(target).split('/').pop()?.toLowerCase();
  if (!name) return null;
  const matches = attachments.filter((path) => path.split('/').pop()?.toLowerCase() === name);
  return matches.sort((a, b) => a.split('/').length - b.split('/').length || a.length - b.length)[0] ?? null;
}
