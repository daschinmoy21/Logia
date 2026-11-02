import { isTauri } from '@tauri-apps/api/core';
import { useNotesStore } from '../store/notesStore';
import toast from 'react-hot-toast';
import { getNoteText } from './workspace';

let importing = false;

/** Copy Markdown into Logia; never modify the source files or load vault plugins. */
export async function importMarkdownFiles(files: File[]): Promise<{ imported: number; failed: Array<{ name: string; error: string }> }> {
  if (importing) throw new Error('A Markdown import is already running');
  importing = true;
  const failed: Array<{ name: string; error: string }> = [];
  let imported = 0;
  try {
    const [{ BlockNoteEditor }, { codeBlock }] = await Promise.all([
      import('@blocknote/core'), import('@blocknote/code-block'),
    ]);
    const parser = BlockNoteEditor.create({ codeBlock });
    for (const file of files) {
      try {
        if (!/\.(md|markdown)$/i.test(file.name)) throw new Error('Choose a Markdown file (.md or .markdown)');
        if (file.size > 10 * 1024 * 1024) throw new Error('File exceeds the 10 MB import limit');
        const source = (await file.text()).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
        const frontmatter = source.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
        const body = frontmatter ? source.slice(frontmatter[0].length) : source;
        const blocks = await parser.tryParseMarkdownToBlocks(body);
        const filename = file.name.replace(/\.(md|markdown)$/i, '') || 'Untitled';
        // Keep the first block as the title, matching the editor's title convention.
        if (blocks[0]?.type !== 'heading' || blocks[0]?.props.level !== 1) {
          blocks.unshift(...await parser.tryParseMarkdownToBlocks(`# ${filename.replace(/[\n\r]/g, ' ')}\n`));
        }
        const title = getNoteText(JSON.stringify([blocks[0]])).trim() || filename;
        if (frontmatter) {
          // Preserve unsupported YAML instead of silently discarding vault metadata.
          blocks.splice(1, 0, {
            id: crypto.randomUUID(), type: 'codeBlock', props: { language: 'yaml' },
            content: [{ type: 'text', text: frontmatter[1], styles: {} }], children: [],
          });
        }
        await useNotesStore.getState().createNote('text', undefined, { title, content: JSON.stringify(blocks) });
        imported += 1;
      } catch (error) {
        failed.push({ name: file.name, error: String(error) });
      }
    }
  } finally {
    importing = false;
  }
  return { imported, failed };
}

async function importAndNotify(files: File[]) {
  const result = await importMarkdownFiles(files);
  if (result.imported) toast.success(`Imported ${result.imported} ${result.imported === 1 ? 'note' : 'notes'}`);
  if (result.failed.length) toast.error(`${result.failed.length} not imported: ${result.failed[0].name} — ${result.failed[0].error}`);
}

export async function chooseMarkdownFiles(): Promise<void> {
  try {
    if (isTauri()) {
      const [{ open }, { readTextFile }] = await Promise.all([
        import('@tauri-apps/plugin-dialog'), import('@tauri-apps/plugin-fs'),
      ]);
      const paths = await open({ multiple: true, filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }] });
      if (!paths) return;
      const files: File[] = [];
      for (const path of Array.isArray(paths) ? paths : [paths]) {
        files.push(new File([await readTextFile(path)], path.split(/[\\/]/).pop() || 'Untitled.md', { type: 'text/markdown' }));
      }
      await importAndNotify(files);
    } else {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.md,.markdown,text/markdown';
      input.multiple = true;
      input.addEventListener('change', () => {
        void importAndNotify(Array.from(input.files || [])).catch((error) => toast.error(String(error)));
      }, { once: true });
      input.click();
    }
  } catch (error) {
    toast.error(`Import failed: ${String(error)}`);
  }
}
