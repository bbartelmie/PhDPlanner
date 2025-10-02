# PhD Project Manager

A local-first desktop application for managing PhD projects, built with Tauri + React + SQLite.

## Features

### Core Functionality
- ✅ **Projects**: Create, edit, archive projects with data folder links and tags
- ✅ **Tasks**: Add, edit, complete tasks with priorities and due dates
- ✅ **Links**: Manage files, folders, and URLs related to projects
- ✅ **Global Task Inbox**: View tasks across all projects with filters
- ✅ **Search & Filter**: Find projects by name, description, or tags
- ✅ **Local SQLite Database**: All data stored locally

### User Experience
- ✅ **Keyboard Shortcuts**: 
  - `⌘N` - New Project
  - `⌘T` - New Task (in project)
  - `⌘⇧T` - Global Quick Task
  - `⌘F` - Search
  - `⌘1/2/3` - Switch tabs (Overview/Tasks/Links)
  - `Space` - Toggle task completion
- ✅ **macOS Integration**: Open folders in Finder, reveal files
- ✅ **Drag & Drop**: Add files/folders from Finder (planned)
- ✅ **Smart Views**: Today, Next 7 Days, Overdue, By Tags

## Project Structure

```
phd-project-manager/
├── src/                     # React frontend
│   ├── components/          # React components
│   │   ├── Sidebar.tsx     # Navigation sidebar
│   │   ├── ProjectList.tsx # Projects grid view
│   │   ├── ProjectDetail.tsx # Project detail view
│   │   ├── SearchBar.tsx   # Search component
│   │   └── modals.tsx      # Modal components
│   ├── lib/
│   │   └── database.ts     # Database operations
│   ├── types/
│   │   └── index.ts        # TypeScript types
│   ├── App.tsx             # Main app component
│   ├── App.css             # Styles
│   └── main.tsx            # React entry point
├── src-tauri/               # Rust backend
│   ├── src/
│   │   └── main.rs         # Tauri main process
│   ├── Cargo.toml          # Rust dependencies
│   └── tauri.conf.json     # Tauri configuration
├── package.json            # Node dependencies
├── vite.config.ts          # Vite configuration
└── README.md
```

## Setup Instructions

### Prerequisites
1. **Install Rust**: https://rustup.rs/
2. **Install Node.js**: https://nodejs.org/ (v16 or later)
3. **Install Tauri CLI**: `cargo install tauri-cli`

### Development Setup

1. **Clone/Create the project directory**:
   ```bash
   mkdir phd-project-manager
   cd phd-project-manager
   ```

2. **Set up the files**: Create all the files shown in the artifacts above in their respective locations.

3. **Install dependencies**:
   ```bash
   npm install
   ```

4. **Initialize Tauri** (if needed):
   ```bash
   npm run tauri init
   ```

5. **Run in development mode**:
   ```bash
   npm run tauri dev
   ```

### Building for Production

```bash
npm run tauri build
```

The built app will be in `src-tauri/target/release/bundle/`.

## Database Schema

The app uses SQLite with these tables:

- **projects**: id, name, description, primary_path, tags, created_at, archived
- **tasks**: id, project_id, title, notes, priority, due_date, status, created_at, completed_at
- **links**: id, project_id, label, target, kind (file/folder/url), notes, created_at
- **settings**: key, value, updated_at

## Usage

### Creating Projects
1. Click "New Project" or press `⌘N`
2. Fill in project details and select a primary folder
3. Add tags separated by commas

### Managing Tasks
- **In Project**: Click "New Task" or press `⌘T`
- **Global Quick Add**: Press `⌘⇧T` from anywhere
- **Filters**: View tasks by Today, Next 7 Days, Overdue
- **Completion**: Click the circle or press `Space`

### Working with Links
- Add files, folders, or URLs to projects
- One-click to open in Finder/browser
- Copy paths to clipboard

### Views & Navigation
- **All Projects**: Default project grid
- **Task Inbox**: All open tasks across projects
- **Smart Filters**: Today, upcoming, overdue tasks
- **Tags**: Filter projects by tags
- **Search**: Find projects by name, description, or tags

## Development Notes

### Key Features Implemented
- ✅ Complete CRUD operations for projects, tasks, and links
- ✅ SQLite database with migrations
- ✅ Native file system integration (open folders, select paths)
- ✅ Global keyboard shortcuts and menu integration
- ✅ Responsive design with modern UI
- ✅ Task filtering and sorting
- ✅ Project statistics and progress tracking

### Architecture Highlights
- **Frontend**: React with TypeScript, modern hooks-based components
- **Backend**: Rust with Tauri for native desktop integration
- **Database**: SQLite with structured migrations
- **State Management**: React state with custom hooks
- ✅ **No external dependencies**: Everything runs locally

### Styling
- Custom CSS with modern design system
- macOS-inspired interface elements
- Responsive grid layouts
- Smooth transitions and hover effects
- Color-coded priority system
- Progress bars and status indicators

## Next Steps (Planned Features)

### Phase 2 - Enhanced Functionality
- [ ] **Drag & Drop**: Add files from Finder by dragging
- [ ] **Link Management Modal**: Better UI for adding/editing links
- [ ] **Export/Import**: JSON export/import functionality
- [ ] **Auto-backup**: Nightly JSON backups
- [ ] **Project Templates**: Mouse experiment, LNP study, manuscript templates
- [ ] **File Validation**: Check if linked files/folders still exist

### Phase 3 - Advanced Features
- [ ] **Calendar View**: Visual timeline of deadlines
- [ ] **Markdown Notes**: Rich text notes per project
- [ ] **Progress Charts**: Visual progress tracking
- [ ] **Local Notifications**: Deadline reminders
- [ ] **External Drive Detection**: Badge when project folder is disconnected
- [ ] **Sync Options**: iCloud/Dropbox/Git integration

## Troubleshooting

### Common Issues

**Build Fails on macOS**:
```bash
# Install Xcode command line tools
xcode-select --install
```

**Database Connection Issues**:
- The SQLite database is created automatically on first run
- Location: `~/.local/share/phd-project-manager/phd_projects.db`

**Folder Opening Doesn't Work**:
- Ensure the path exists and is accessible
- Check that the app has proper file system permissions

**Global Shortcuts Don't Work**:
- Restart the app if shortcuts stop responding
- Check for conflicts with other apps

### Development Tips

**Hot Reload**: 
- Frontend changes hot-reload automatically
- Rust changes require restart (`npm run tauri dev`)

**Database Inspection**:
```bash
# View database directly
sqlite3 ~/.local/share/phd-project-manager/phd_projects.db
.tables
.schema projects
SELECT * FROM projects;
```

**Debug Logging**:
```bash
# Run with debug output
RUST_LOG=debug npm run tauri dev
```

## Contributing

### Code Style
- **React**: Functional components with hooks
- **TypeScript**: Strict typing, explicit interfaces
- **CSS**: BEM-inspired naming, mobile-first responsive
- **Rust**: Standard Rust conventions with clippy lints

### Adding New Features
1. Update database schema in `main.rs` migrations
2. Add database functions in `database.ts`
3. Create/update React components
4. Add corresponding styles in `App.css`
5. Test thoroughly on macOS

### Testing
```bash
# Frontend type checking
npm run build

# Rust compilation check
cd src-tauri && cargo check

# Full build test
npm run tauri build
```

## License

MIT License - feel free to modify and distribute.

## Acknowledgments

Built with:
- [Tauri](https://tauri.app/) - Rust-based desktop app framework
- [React](https://react.dev/) - UI library
- [SQLite](https://sqlite.org/) - Local database
- [Lucide React](https://lucide.dev/) - Icon library
- [date-fns](https://date-fns.org/) - Date utilities

Perfect for PhD students and researchers who need a reliable, local-first project management solution!