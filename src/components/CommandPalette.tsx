import { useState, useEffect } from 'react';
import useUiStore from '../store/UiStore';
import { useNotesStore } from '../store/notesStore';
import LiquidGlass from 'liquid-glass-react';
import './CommandPalette.css';

export const CommandPalette = () => {
  const { searchQuery, setSearchQuery, searchResults, isCommandPaletteOpen, closeCommandPalette } = useUiStore();
  const { notes, selectNote } = useNotesStore();
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    if (isCommandPaletteOpen) {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSelectedIndex((prevIndex) => (prevIndex + 1) % searchResults.length);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSelectedIndex((prevIndex) => (prevIndex - 1 + searchResults.length) % searchResults.length);
        } else if (e.key === 'Enter') {
          e.preventDefault();
          if (searchResults[selectedIndex]) {
            selectNote(searchResults[selectedIndex]);
            closeCommandPalette();
            
            // Focus editor after a short delay to allow component to mount/update
            setTimeout(() => {
              // Try to find the BlockNote editor content editable area
              const editorElement = document.querySelector('.bn-editor') as HTMLElement;
              if (editorElement) {
                editorElement.focus();
              } else {
                // Fallback for other editor types or if class is different
                const contentEditable = document.querySelector('[contenteditable="true"]') as HTMLElement;
                if (contentEditable) {
                  contentEditable.focus();
                }
              }
            }, 100);
          }
        } else if (e.key === 'Escape') {
          e.preventDefault();
          closeCommandPalette();
        }
      };

      window.addEventListener('keydown', handleKeyDown);
      return () => {
        window.removeEventListener('keydown', handleKeyDown);
      };
    }
  }, [isCommandPaletteOpen, searchResults, selectedIndex, selectNote, closeCommandPalette]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [searchResults]);

  if (!isCommandPaletteOpen) {
    return null;
  }

  return (
    <div className="command-palette-overlay" onClick={closeCommandPalette}>
      <div className="command-palette-container" onClick={(e) => e.stopPropagation()}>
        <div className="command-palette-content">
          <input
            type="text"
            placeholder="Search notes (Esc to close)"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value, notes)}
            autoFocus
          />
          <ul>
            {searchResults.map((note, index) => (
              <li
                key={note.id}
                className={index === selectedIndex ? 'selected' : ''}
                onClick={() => {
                  selectNote(note);
                  closeCommandPalette();
                  
                  // Focus editor after a short delay
                  setTimeout(() => {
                    const editorElement = document.querySelector('.bn-editor') as HTMLElement;
                    if (editorElement) {
                      editorElement.focus();
                    } else {
                      const contentEditable = document.querySelector('[contenteditable="true"]') as HTMLElement;
                      if (contentEditable) {
                        contentEditable.focus();
                      }
                    }
                  }, 100);
                }}
              >
                {note.title}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
};
