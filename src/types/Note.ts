export interface Folder {
  id: string;
  name: string;
  parent_id?: string;
  created_at: string;
  updated_at: string;
}

export interface Note {
  id: string;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
  note_type?: 'text' | 'canvas';
  folder_id?: string;
  starred?: boolean;
}