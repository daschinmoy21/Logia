import type { ILink, ILinkProvider, Terminal } from '@xterm/xterm';

export function safeHttpsUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !!url.hostname && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

/** Match printed HTTPS links, including soft wraps, without interpreting terminal output as HTML. */
export function createHttpsLinkProvider(term: Pick<Terminal, 'buffer'>, open: (uri: string) => void): ILinkProvider {
  return {
    provideLinks(lineNumber, callback) {
      const buffer = term.buffer.active;
      let first = lineNumber - 1;
      while (first > 0 && buffer.getLine(first)?.isWrapped && lineNumber - first <= 128) first--;
      if (lineNumber - first > 128) { callback([]); return; }
      let text = '';
      const positions: Array<{ x: number; y: number }> = [];
      for (let y = first; y < buffer.length && y < first + 128; y++) {
        if (y > first && !buffer.getLine(y)?.isWrapped) break;
        const line = buffer.getLine(y);
        if (!line) break;
        for (let x = 0; x < line.length; x++) {
          const cell = line.getCell(x);
          if (!cell || cell.getWidth() === 0) continue;
          const chars = cell.getChars() || ' ';
          for (let i = 0; i < chars.length; i++) positions.push({ x: x + 1, y: y + 1 });
          text += chars;
          if (text.length > 16 * 1024) { callback([]); return; }
        }
      }
      const links: ILink[] = [];
      for (const match of text.matchAll(/https:\/\/[^\s<>"`]+/giu)) {
        const label = match[0].replace(/[.,;!?]+$/, '');
        const uri = safeHttpsUrl(label);
        const start = positions[match.index!];
        const end = positions[match.index! + label.length - 1];
        if (!uri || !start || !end || lineNumber < start.y || lineNumber > end.y) continue;
        links.push({ text: label, range: { start, end }, activate: () => open(uri) });
      }
      callback(links);
    },
  };
}
