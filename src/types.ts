export interface Project {
  id?: number;
  name: string;
  description?: string;
  primary_path?: string;
  tags?: string;
  color?: string;
  tint?: number | null;
  created_at?: string;
  archived?: number;
  parent_id?: number | null;
  position?: number | null;
}

export interface Task {
  id?: number;
  project_id: number;
  title: string;
  notes?: string;
  priority?: number;
  due_date?: string;
  due_time?: string;
  start_time?: string;
  end_time?: string;
  color_tone?: number;
  status?: 'open' | 'done';
  created_at?: string;
  completed_at?: string;
  // new optional fields
  effort_minutes?: number;
  type?: 'experiment' | 'writing' | 'reading' | 'general';
  updated_at?: string;
  reminder_at?: string;
  recurrence_rule?: string; // simple RRULE-like text
  outlook_event_id?: string | null;
}

export interface Link {
  id?: number;
  project_id: number;
  task_id?: number | null;
  label: string;
  target: string;
  kind: 'file' | 'folder' | 'url';
  notes?: string;
  position?: number;
  created_at?: string;
}

// Milestones per project
export interface Milestone {
  id?: number;
  project_id: number;
  title: string;
  due_date?: string | null;
  status: 'pending' | 'done' | 'blocked';
  notes?: string;
  position?: number;
  created_at?: string;
}

// Project notes (markdown)
export interface Note {
  id?: number;
  project_id: number;
  content: string;
  created_at?: string;
  updated_at?: string;
}

// Reading list / papers
export interface Paper {
  id?: number;
  project_id: number;
  title: string;
  authors?: string;
  year?: number | null;
  doi?: string;
  url?: string;
  status?: 'to_read' | 'reading' | 'read';
  notes?: string;
  created_at?: string;
}

// Experiments
export interface Experiment {
  id?: number;
  project_id: number;
  name: string;
  protocol?: string; // markdown
  variables_json?: string; // JSON string of variables schema
  outcomes?: string; // markdown
  status?: 'planned' | 'running' | 'done' | 'blocked';
  created_at?: string;
  updated_at?: string;
}

export interface ProjectWithStats extends Project {
  total_tasks: number;
  completed_tasks: number;
  overdue_tasks: number;
  upcoming_tasks: number;
}

export interface TaskWithProject extends Task {
  project_name: string;
  project_color?: string;
  project_tint?: number;
}

export type ViewType = 'all' | 'inbox' | 'today' | 'next7days' | 'overdue' | 'archived' | 'calendar';

export type ProjectTab = 'overview' | 'tasks' | 'links' | 'notes' | 'milestones' | 'papers' | 'experiments';

export interface AppState {
  projects: Project[];
  currentProject: Project | null;
  currentTab: ProjectTab;
  currentView: ViewType;
  searchQuery: string;
  selectedTags: string[];
}
