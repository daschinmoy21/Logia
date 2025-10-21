# Kortex

A powerful, AI-enhanced notes application built with Tauri and React, designed for technical content creators and knowledge workers.

## Features

- **AI-Powered Assistance**: Integrated with OpenAI, Groq, and Google AI for intelligent note generation and editing
- **Rich Text Editing**: Full-featured editor with BlockNote for structured content creation
- **Visual Note-Taking**: Built-in Excalidraw integration for diagrams and sketches
- **Audio Recording & Transcription**: Record and transcribe audio content directly in your notes
- **File Management**: Hierarchical file tree with drag-and-drop organization
- **Search & Discovery**: Fast, fuzzy search across all your notes
- **Kanban Boards**: Organize your thoughts with visual task management
- **Cross-Platform**: Native desktop app for Windows, macOS, and Linux
- **Markdown Support**: Full markdown rendering with GitHub Flavored Markdown

## Installation

### Prerequisites

- [Bun](https://bun.com/)
- [Rust](https://rustup.rs/) (latest stable)
- [Tauri CLI](https://tauri.app/v1/guides/getting-started/prerequisites)

### Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/daschinmoy21/Kortex.git
   cd kortex
   ```

2. Install dependencies:
   ```bash
   bun install
   ```

3. Run in development mode:
   ```bash
   bun run tauri dev
   ```

4. Build for production:
   ```bash
   bun run tauri build
   ```

## Usage

- **Creating Notes**: Use the file tree sidebar to create new notes or organize existing ones
- **AI Assistance**: Access AI features through the AI sidebar for content generation and editing
- **Drawing**: Click the drawing tool to open Excalidraw for visual notes
- **Recording**: Use the recording feature to capture audio and automatically transcribe it
- **Search**: Press `Ctrl+K` to open the command palette and search across all content

## Configuration

Create a `.env` file in the root directory with your API keys:

```env
OPENAI_API_KEY=your_openai_key
GROQ_API_KEY=your_groq_key
GOOGLE_GENRATIVE_AI_API_KEY=your_google_key
```

## Development

### Project Structure

- `src/` - React frontend application
- `src-tauri/` - Tauri backend and Rust code
- `src/components/` - Reusable UI components
- `src/store/` - State management with Zustand

### Available Scripts

- `bun run dev` - Start the Vite development server
- `bun run build` - Build the frontend for production
- `bun run tauri dev` - Start Tauri development mode
- `bun run tauri build` - Build the native application

## Contributing
DO NOT MAKE SPAM PRs

## License

This project is licensed under the MIT License - see the LICENSE file for details. 


