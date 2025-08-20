import useUiStore from '../store/UiStore';
import { useNotesStore } from '../store/notesStore';

export const Search = () => {
  const { searchQuery, setSearchQuery, searchResults } = useUiStore();
  const { notes, selectNote } = useNotesStore();

  return (
    <div>
      <input
        type="text"
        placeholder="Search notes..."
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value, notes)}
      />
      <ul>
        {searchResults.map((note) => (
          <li key={note.id} onClick={() => selectNote(note)}>
            {note.title}
          </li>
        ))}
      </ul>
    </div>
  );
};
