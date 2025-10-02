// v2 plugin API
import Database from "@tauri-apps/plugin-sql";
import type { Project, Task, Link } from "../types";

let db: Database | null = null;

export async function initDatabase() {
  if (!db) {
    // Align with Tauri v2 plugin; creates file in app data dir.
    db = await Database.load("sqlite:phd_projects.db");

    // Ensure schema exists (idempotent)
    await db.execute("PRAGMA foreign_keys = ON;");

    await db.execute(`
      CREATE TABLE IF NOT EXISTS projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        primary_path TEXT,
        tags TEXT,
        color TEXT,
        position INTEGER,
        archived INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    // Migration: add parent_id to projects if missing (ignore error if exists)
    try {
      await db.execute("ALTER TABLE projects ADD COLUMN parent_id INTEGER REFERENCES projects(id)");
    } catch (_) {}
    // Migration: add color to projects if missing
    try { await db.execute("ALTER TABLE projects ADD COLUMN color TEXT"); } catch (_) {}
    // Migration: add tint (default tone) for subprojects
    try { await db.execute("ALTER TABLE projects ADD COLUMN tint INTEGER"); } catch (_) {}
    try { await db.execute("CREATE INDEX IF NOT EXISTS idx_projects_parent_id ON projects(parent_id)"); } catch (_) {}
    try { await db.execute("CREATE INDEX IF NOT EXISTS idx_projects_position ON projects(position)"); } catch (_) {}
    try { await db.execute("ALTER TABLE projects ADD COLUMN position INTEGER"); } catch (_) {}
    // backfill positions for projects that don't have one
    try {
      const rows = (await db.select<any>('SELECT id FROM projects WHERE position IS NULL ORDER BY created_at ASC, id ASC')) as { id: number }[];
      let pos = 1;
      for (const r of rows) {
        await db.execute('UPDATE projects SET position = $1 WHERE id = $2', [pos++, r.id]);
      }
    } catch (_) {}

    await db.execute(`
      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        notes TEXT,
        priority INTEGER DEFAULT 3,
        due_date TEXT,
        due_time TEXT,
        start_time TEXT,
        end_time TEXT,
        effort_minutes INTEGER,
        type TEXT,
        reminder_at TEXT,
        recurrence_rule TEXT,
        updated_at TEXT,
        color_tone INTEGER,
        status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        completed_at TEXT,
        FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
      );
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        task_id INTEGER,
        label TEXT NOT NULL,
        target TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('file','folder','url')),
        notes TEXT,
        position INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
      );
    `);

    // Helpful indexes
    await db.execute("CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id);");
    await db.execute("CREATE INDEX IF NOT EXISTS idx_tasks_status_due ON tasks(status, due_date);");
    try { await db.execute("CREATE INDEX IF NOT EXISTS idx_tasks_due_time ON tasks(due_date, due_time)"); } catch (_) {}
    try { await db.execute("CREATE INDEX IF NOT EXISTS idx_tasks_start_time ON tasks(due_date, start_time)"); } catch (_) {}
    try { await db.execute("CREATE INDEX IF NOT EXISTS idx_tasks_status_project ON tasks(status, project_id)"); } catch (_) {}
    try { await db.execute("CREATE INDEX IF NOT EXISTS idx_tasks_updated_at ON tasks(updated_at)"); } catch (_) {}
    try { await db.execute("CREATE INDEX IF NOT EXISTS idx_links_project_pos ON links(project_id, position)"); } catch (_) {}
    try { await db.execute("CREATE INDEX IF NOT EXISTS idx_links_task_id ON links(task_id)"); } catch (_) {}

    // Seed initial data on first run (idempotent)
    try {
      const rows = (await db.select<{ count: number }>(
        "SELECT COUNT(*) as count FROM projects"
      )) as unknown as { count: number | string }[];
      const count = rows && rows[0] ? Number(rows[0].count) : 0;
      if (!Number.isNaN(count) && count === 0) {
        const seedResult = await db.execute(
          "INSERT INTO projects (name, description, primary_path, tags, color, archived) VALUES ($1, $2, $3, $4, $5, $6)",
          [
            "Welcome Project",
            "This sample project was created automatically to help you get started.",
            "",
            "getting-started,example",
            "#3b82f6",
            0,
          ]
        );
        const projectId = Number(seedResult.lastInsertId ?? -1);

        if (projectId > 0) {
          await db.execute(
            "INSERT INTO tasks (project_id, title, notes, priority, due_date, status) VALUES ($1,$2,$3,$4,$5,$6)",
            [
              projectId,
              "Create your first real project",
              "Use the + New Project button in the sidebar.",
              3,
              null,
              "open",
            ]
          );
          await db.execute(
            "INSERT INTO tasks (project_id, title, notes, priority, due_date, status) VALUES ($1,$2,$3,$4,$5,$6)",
            [
              projectId,
              "Explore features",
              "Try adding tasks, tags, and links.",
              2,
              null,
              "open",
            ]
          );
          await db.execute(
            "INSERT INTO links (project_id, label, target, kind, notes) VALUES ($1,$2,$3,$4,$5)",
            [
              projectId,
              "Tauri Docs",
              "https://tauri.app",
              "url",
              "Learn more about building desktop apps with Tauri.",
            ]
          );
        }
      }
    } catch (e) {
      console.warn("[DB] Seed step skipped:", e);
    }

    // Migration: add 'position' to links if missing and backfill positions per project
    try { await db.execute("ALTER TABLE links ADD COLUMN position INTEGER"); } catch (_) {}
    try { await db.execute("ALTER TABLE links ADD COLUMN task_id INTEGER REFERENCES tasks(id)"); } catch (_) {}
    try {
      const projectsToFix = (await db.select<{ project_id: number }>(
        "SELECT DISTINCT project_id FROM links WHERE position IS NULL"
      )) as unknown as { project_id: number }[];
      for (const row of projectsToFix) {
        const plist = (await db.select<any>(
          "SELECT id FROM links WHERE project_id = $1 ORDER BY created_at ASC, id ASC",
          [row.project_id]
        )) as unknown as { id: number }[];
        let pos = 1;
        for (const link of plist) {
          await db.execute(
            "UPDATE links SET position = $1 WHERE id = $2",
            [pos++, link.id]
          );
        }
      }
    } catch (e) {
      console.warn('[DB] backfill link positions skipped:', e);
    }

    // Extra migrations for tasks table
    // Migration: add 'due_time' to tasks if missing
    try { await db.execute("ALTER TABLE tasks ADD COLUMN due_time TEXT"); } catch (_) {}
    // Migration: add 'start_time' and 'end_time' to tasks if missing, and backfill from due_time
    try { await db.execute("ALTER TABLE tasks ADD COLUMN start_time TEXT"); } catch (_) {}
    try { await db.execute("ALTER TABLE tasks ADD COLUMN end_time TEXT"); } catch (_) {}
    try {
      await db.execute("UPDATE tasks SET start_time = due_time WHERE start_time IS NULL AND due_time IS NOT NULL");
      await db.execute("UPDATE tasks SET end_time = due_time WHERE end_time IS NULL AND due_time IS NOT NULL");
    } catch (_) {}
    // Migration: add color_tone to tasks (nullable)
    try { await db.execute("ALTER TABLE tasks ADD COLUMN color_tone INTEGER"); } catch (_) {}
    // Outlook sync mapping (optional)
    try { await db.execute("ALTER TABLE tasks ADD COLUMN outlook_event_id TEXT"); } catch (_) {}
    try { await db.execute("CREATE INDEX IF NOT EXISTS idx_tasks_outlook_event_id ON tasks(outlook_event_id)"); } catch (_) {}
    // Migration: add extended fields
    try { await db.execute("ALTER TABLE tasks ADD COLUMN effort_minutes INTEGER"); } catch (_) {}
    try { await db.execute("ALTER TABLE tasks ADD COLUMN type TEXT"); } catch (_) {}
    try { await db.execute("ALTER TABLE tasks ADD COLUMN reminder_at TEXT"); } catch (_) {}
    try { await db.execute("ALTER TABLE tasks ADD COLUMN recurrence_rule TEXT"); } catch (_) {}
    try { await db.execute("ALTER TABLE tasks ADD COLUMN updated_at TEXT"); } catch (_) {}

    // New tables
    await db.execute(`
      CREATE TABLE IF NOT EXISTS milestones (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        due_date TEXT,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','blocked')),
        notes TEXT,
        position INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
      );
    `);
    await db.execute("CREATE INDEX IF NOT EXISTS idx_milestones_project ON milestones(project_id, position)");

    await db.execute(`
      CREATE TABLE IF NOT EXISTS notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT,
        FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
      );
    `);
    await db.execute("CREATE INDEX IF NOT EXISTS idx_notes_project ON notes(project_id)");

    await db.execute(`
      CREATE TABLE IF NOT EXISTS papers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        authors TEXT,
        year INTEGER,
        doi TEXT,
        url TEXT,
        status TEXT DEFAULT 'to_read' CHECK (status IN ('to_read','reading','read')),
        notes TEXT,
        position INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
      );
    `);
    await db.execute("CREATE INDEX IF NOT EXISTS idx_papers_project ON papers(project_id, status)");
    try { await db.execute("ALTER TABLE papers ADD COLUMN position INTEGER"); } catch (_) {}
    try { await db.execute("CREATE INDEX IF NOT EXISTS idx_papers_project_pos ON papers(project_id, position)"); } catch (_) {}
    // backfill paper positions
    try {
      const prows = (await db.select<any>('SELECT DISTINCT project_id FROM papers WHERE position IS NULL')) as { project_id: number }[];
      for (const row of prows) {
        const list = (await db.select<any>('SELECT id FROM papers WHERE project_id = $1 ORDER BY created_at ASC, id ASC', [row.project_id])) as { id: number }[];
        let pos = 1;
        for (const r of list) {
          await db.execute('UPDATE papers SET position = $1 WHERE id = $2', [pos++, r.id]);
        }
      }
    } catch (_) {}

    await db.execute(`
      CREATE TABLE IF NOT EXISTS experiments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        protocol TEXT,
        variables_json TEXT,
        outcomes TEXT,
        status TEXT DEFAULT 'planned' CHECK (status IN ('planned','running','done','blocked')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT,
        FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
      );
    `);
    await db.execute("CREATE INDEX IF NOT EXISTS idx_experiments_project ON experiments(project_id, status)");

    await db.execute(`
      CREATE TABLE IF NOT EXISTS task_dependencies (
        task_id INTEGER NOT NULL,
        depends_on_task_id INTEGER NOT NULL,
        PRIMARY KEY (task_id, depends_on_task_id),
        FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE,
        FOREIGN KEY(depends_on_task_id) REFERENCES tasks(id) ON DELETE CASCADE
      );
    `);
  }
  return db;
}

// Types are sourced from src/types.ts to avoid duplication

// Project CRUD
export async function createProject(project: Omit<Project, 'id' | 'created_at'>): Promise<number> {
  const database = await initDatabase();
  // If this is a subproject and no tint provided, pick a unique tint among siblings (0..4), cycling if needed
  let tintToUse: number | null | undefined = project.tint;
  if ((project.parent_id ?? null) !== null && project.tint === undefined) {
    try {
      const rows = (await database.select<any>(
        'SELECT tint FROM projects WHERE parent_id = $1',
        [project.parent_id]
      )) as unknown as { tint: number | null }[];
      const used = new Set<number>();
      rows.forEach(r => {
        const n = Number(r.tint);
        if (!Number.isNaN(n)) used.add(n);
      });
      let tone = 0;
      while (tone < 5 && used.has(tone)) tone++;
      if (tone >= 5) {
        // cycle through 0..4 until we find the first available (handles >5 subs)
        let tries = 0;
        tone = 0;
        while (used.has(tone) && tries < 10) { tone = (tone + 1) % 5; tries++; }
      }
      tintToUse = tone;
    } catch (_) {
      tintToUse = 0;
    }
  }
  const result = await database.execute(
    'INSERT INTO projects (name, description, primary_path, tags, color, tint, archived, parent_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
    [project.name, project.description || '', project.primary_path || '', project.tags || '', project.color || '#3b82f6', tintToUse ?? null, project.archived || 0, project.parent_id ?? null]
  );
  const insertId = Number(result.lastInsertId ?? -1);
  if (Number.isNaN(insertId) || insertId < 0) {
    throw new Error('Failed to insert project');
  }
  return insertId;
}

export async function getProjects(includeArchived = false): Promise<Project[]> {
  const database = await initDatabase();
  const query = includeArchived 
    ? 'SELECT * FROM projects ORDER BY COALESCE(position, 999999) ASC, created_at DESC'
    : 'SELECT * FROM projects WHERE archived = 0 ORDER BY COALESCE(position, 999999) ASC, created_at DESC';
  return (await database.select(query)) as Project[];
}

export async function getProject(id: number): Promise<Project | null> {
  const database = await initDatabase();
  const results = (await database.select('SELECT * FROM projects WHERE id = $1', [id])) as Project[];
  return results.length > 0 ? results[0] : null;
}

export async function updateProject(id: number, project: Partial<Project>): Promise<void> {
  const database = await initDatabase();
  const fields: string[] = [];
  const values: (string | number | null)[] = [];
  
  if (project.name !== undefined) {
    fields.push('name = ?');
    values.push(project.name);
  }
  if (project.description !== undefined) {
    fields.push('description = ?');
    values.push(project.description);
  }
  if (project.primary_path !== undefined) {
    fields.push('primary_path = ?');
    values.push(project.primary_path);
  }
  if (project.tags !== undefined) {
    fields.push('tags = ?');
    values.push(project.tags);
  }
  if (project.color !== undefined) {
    fields.push('color = ?');
    values.push(project.color);
  }
  if (project.tint !== undefined) {
    fields.push('tint = ?');
    values.push(project.tint);
  }
  if (project.archived !== undefined) {
    fields.push('archived = ?');
    values.push(project.archived);
  }
  if (project.parent_id !== undefined) {
    fields.push('parent_id = ?');
    values.push(project.parent_id);
  }
  if ((project as any).position !== undefined) {
    fields.push('position = ?');
    values.push((project as any).position as any);
  }
  
  if (fields.length > 0) {
    values.push(id);
    // Convert placeholders to $-style for sqlite
    const setClause = fields
      .map((f, idx) => f.replace('?', `$${idx + 1}`))
      .join(', ');
    const sql = `UPDATE projects SET ${setClause} WHERE id = $${fields.length + 1}`;
    await database.execute(sql, values);
  }
}

export async function deleteProject(id: number): Promise<void> {
  const database = await initDatabase();
  await database.execute('DELETE FROM projects WHERE id = $1', [id]);
}

// Task CRUD
export async function createTask(task: Omit<Task, 'id' | 'created_at'>): Promise<number> {
  const database = await initDatabase();
  const result = await database.execute(
    'INSERT INTO tasks (project_id, title, notes, priority, due_date, due_time, start_time, end_time, color_tone, status, effort_minutes, type, reminder_at, recurrence_rule, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, datetime(\'now\'))',
    [
      task.project_id,
      task.title,
      task.notes || '',
      task.priority ?? 3,
      task.due_date ?? null,
      // keep due_time for compatibility; default to start_time
      task.due_time ?? task.start_time ?? null,
      task.start_time ?? null,
      task.end_time ?? task.start_time ?? null,
      task.color_tone ?? null,
      task.status ?? 'open',
      (task as any).effort_minutes ?? null,
      (task as any).type ?? null,
      (task as any).reminder_at ?? null,
      (task as any).recurrence_rule ?? null
    ]
  );
  const insertId = Number(result.lastInsertId ?? -1);
  if (Number.isNaN(insertId) || insertId < 0) {
    throw new Error('Failed to insert task');
  }
  return insertId;
}

export async function getTasks(projectId?: number): Promise<Task[]> {
  const database = await initDatabase();
  if (projectId) {
    return (await database.select(
      'SELECT * FROM tasks WHERE project_id = $1 ORDER BY created_at DESC',
      [projectId]
    )) as Task[];
  }
  return (await database.select('SELECT * FROM tasks ORDER BY created_at DESC')) as Task[];
}

export async function getTasksWithFilters(filters: {
  status?: string;
  dueBefore?: string;
  priority?: number;
  projectId?: number;
}): Promise<(Task & { project_name: string })[]> {
  const database = await initDatabase();
  let query = `
    SELECT t.*, p.name as project_name 
    FROM tasks t 
    JOIN projects p ON t.project_id = p.id 
    WHERE 1=1
  `;
  const params: any[] = [];

  if (filters.status) {
    query += ' AND t.status = $' + (params.length + 1);
    params.push(filters.status);
  }
  
  if (filters.dueBefore) {
    query += ' AND t.due_date IS NOT NULL AND t.due_date <= $' + (params.length + 1);
    params.push(filters.dueBefore);
  }
  
  if (filters.priority) {
    query += ' AND t.priority >= $' + (params.length + 1);
    params.push(filters.priority);
  }
  
  if (filters.projectId) {
    query += ' AND t.project_id = $' + (params.length + 1);
    params.push(filters.projectId);
  }

  query += ' ORDER BY t.due_date ASC, COALESCE(t.start_time, t.due_time) ASC, t.priority DESC, t.created_at DESC';
  
  return (await database.select(query, params)) as (Task & { project_name: string })[];
}

export async function getTasksInRange(
  startDate: string,
  endDate: string,
  options?: { includeDone?: boolean }
): Promise<(Task & { project_name: string; project_color?: string; project_tint?: number })[]> {
  const database = await initDatabase();
  let query = `
    SELECT t.*,
           p.name as project_name,
           COALESCE(pp.color, p.color) as project_color,
           COALESCE(p.tint, t.color_tone, 0) as project_tint
    FROM tasks t
    JOIN projects p ON t.project_id = p.id
    LEFT JOIN projects pp ON p.parent_id = pp.id
    WHERE t.due_date IS NOT NULL
      AND t.due_date >= $1 AND t.due_date <= $2
  `;
  const params: any[] = [startDate, endDate];
  if (!options?.includeDone) {
    query += " AND t.status = 'open'";
  }
  query += ' ORDER BY t.due_date ASC, COALESCE(t.start_time, t.due_time) ASC, t.priority DESC, t.created_at DESC';
  return (await database.select(query, params)) as (Task & { project_name: string; project_color?: string; project_tint?: number })[];
}

export async function updateTask(id: number, task: Partial<Task>): Promise<void> {
  const database = await initDatabase();
  const fields: string[] = [];
  const values: (string | number | null)[] = [];
  
  if (task.project_id !== undefined) {
    fields.push('project_id = ?');
    values.push(task.project_id);
  }
  if (task.title !== undefined) {
    fields.push('title = ?');
    values.push(task.title);
  }
  if (task.notes !== undefined) {
    fields.push('notes = ?');
    values.push(task.notes);
  }
  if (task.priority !== undefined) {
    fields.push('priority = ?');
    values.push(task.priority);
  }
  if (task.due_date !== undefined) {
    fields.push('due_date = ?');
    values.push(task.due_date);
  }
  if (task.due_time !== undefined) {
    fields.push('due_time = ?');
    values.push(task.due_time);
  }
  if (task.start_time !== undefined) {
    fields.push('start_time = ?');
    values.push(task.start_time);
  }
  if (task.end_time !== undefined) {
    fields.push('end_time = ?');
    values.push(task.end_time);
  }
  if (task.color_tone !== undefined) {
    fields.push('color_tone = ?');
    values.push(task.color_tone);
  }
  if ((task as any).effort_minutes !== undefined) {
    fields.push('effort_minutes = ?');
    values.push((task as any).effort_minutes);
  }
  if ((task as any).type !== undefined) {
    fields.push('type = ?');
    values.push((task as any).type as any);
  }
  if ((task as any).reminder_at !== undefined) {
    fields.push('reminder_at = ?');
    values.push((task as any).reminder_at as any);
  }
  if ((task as any).recurrence_rule !== undefined) {
    fields.push('recurrence_rule = ?');
    values.push((task as any).recurrence_rule as any);
  }
  if (task.status !== undefined) {
    fields.push('status = ?');
    values.push(task.status);
    if (task.status === 'done') {
      fields.push('completed_at = ?');
      values.push(new Date().toISOString());
    } else if (task.status === 'open') {
      fields.push('completed_at = ?');
      values.push(null);
    }
  }
  // always update updated_at if any change
  if (fields.length > 0) {
    fields.push('updated_at = ?');
    values.push(new Date().toISOString());
  }
  
  if (fields.length > 0) {
    values.push(id);
    const setClause = fields
      .map((f, idx) => f.replace('?', `$${idx + 1}`))
      .join(', ');
    const sql = `UPDATE tasks SET ${setClause} WHERE id = $${fields.length + 1}`;
    await database.execute(sql, values);
  }
}

export async function deleteTask(id: number): Promise<void> {
  const database = await initDatabase();
  await database.execute('DELETE FROM tasks WHERE id = $1', [id]);
}

// Task dependencies
export async function setTaskDependencies(taskId: number, dependsOn: number[]) {
  const database = await initDatabase();
  await database.execute('DELETE FROM task_dependencies WHERE task_id = $1', [taskId]);
  for (const dep of dependsOn) {
    if (dep === taskId) continue;
    await database.execute('INSERT OR IGNORE INTO task_dependencies (task_id, depends_on_task_id) VALUES ($1,$2)', [taskId, dep]);
  }
}
export async function getTaskDependencies(taskId: number): Promise<number[]> {
  const database = await initDatabase();
  const rows = await database.select('SELECT depends_on_task_id as id FROM task_dependencies WHERE task_id = $1', [taskId]);
  return (rows as any[]).map(r => Number((r as any).id));
}

// Link CRUD
export async function createLink(link: Omit<Link, 'id' | 'created_at'>): Promise<number> {
  const database = await initDatabase();
  // Determine next position within project
  let nextPos = 1;
  try {
    const rows = (await database.select<any>(
      'SELECT COALESCE(MAX(position), 0) as maxp FROM links WHERE project_id = $1',
      [link.project_id]
    )) as unknown as { maxp: number | string }[];
    const maxp = rows && rows[0] ? Number(rows[0].maxp) : 0;
    nextPos = (Number.isNaN(maxp) ? 0 : maxp) + 1;
  } catch {}
  const result = await database.execute(
    'INSERT INTO links (project_id, task_id, label, target, kind, notes, position) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [link.project_id, link.task_id ?? null, link.label, link.target, link.kind, link.notes || '', nextPos]
  );
  const insertId = Number(result.lastInsertId ?? -1);
  if (Number.isNaN(insertId) || insertId < 0) {
    throw new Error('Failed to insert link');
  }
  return insertId;
}

export async function getLinks(projectId: number): Promise<Link[]> {
  const database = await initDatabase();
  return (await database.select(
    'SELECT * FROM links WHERE project_id = $1 AND (task_id IS NULL OR task_id = 0) ORDER BY position ASC, created_at ASC',
    [projectId]
  )) as Link[];
}

export async function getTaskLinks(taskId: number): Promise<Link[]> {
  const database = await initDatabase();
  return (await database.select(
    'SELECT * FROM links WHERE task_id = $1 ORDER BY created_at DESC',
    [taskId]
  )) as Link[];
}

export async function updateLink(id: number, link: Partial<Link>): Promise<void> {
  const database = await initDatabase();
  const fields: string[] = [];
  const values: (string | number | null)[] = [];
  
  if (link.label !== undefined) {
    fields.push('label = ?');
    values.push(link.label);
  }
  if (link.target !== undefined) {
    fields.push('target = ?');
    values.push(link.target);
  }
  if (link.kind !== undefined) {
    fields.push('kind = ?');
    values.push(link.kind);
  }
  if (link.notes !== undefined) {
    fields.push('notes = ?');
    values.push(link.notes);
  }
  if (link.position !== undefined) {
    fields.push('position = ?');
    values.push(link.position);
  }
  
  if (fields.length > 0) {
    values.push(id);
    const setClause = fields
      .map((f, idx) => f.replace('?', `$${idx + 1}`))
      .join(', ');
    const sql = `UPDATE links SET ${setClause} WHERE id = $${fields.length + 1}`;
    await database.execute(sql, values);
  }
}

export async function deleteLink(id: number): Promise<void> {
  const database = await initDatabase();
  await database.execute('DELETE FROM links WHERE id = $1', [id]);
}

// Utility functions
export async function getProjectStats(projectId: number) {
  const database = await initDatabase();
  type ProjectStats = {
    total_tasks: number;
    completed_tasks: number;
    overdue_tasks: number;
    upcoming_tasks: number;
  };
  const stats = (await database.select<ProjectStats>(`
    WITH RECURSIVE proj_tree(id) AS (
      SELECT id FROM projects WHERE id = $1
      UNION ALL
      SELECT p.id FROM projects p JOIN proj_tree pt ON p.parent_id = pt.id
    )
    SELECT 
      COUNT(*) as total_tasks,
      COUNT(CASE WHEN t.status = 'done' THEN 1 END) as completed_tasks,
      COUNT(CASE WHEN t.status = 'open' AND t.due_date IS NOT NULL AND t.due_date < date('now') THEN 1 END) as overdue_tasks,
      COUNT(CASE WHEN t.status = 'open' AND t.due_date IS NOT NULL AND t.due_date <= date('now', '+7 days') THEN 1 END) as upcoming_tasks
    FROM tasks t
    WHERE t.project_id IN (SELECT id FROM proj_tree)
  `, [projectId])) as unknown as ProjectStats[];
  
  return stats[0] || {
    total_tasks: 0,
    completed_tasks: 0,
    overdue_tasks: 0,
    upcoming_tasks: 0
  };
}

export async function searchProjects(query: string): Promise<Project[]> {
  const database = await initDatabase();
  return (await database.select(`
    SELECT * FROM projects 
    WHERE archived = 0 AND (
      name LIKE $1 OR 
      description LIKE $2 OR 
      tags LIKE $3
    )
    ORDER BY created_at DESC
  `, [`%${query}%`, `%${query}%`, `%${query}%`])) as Project[];
}

export async function getSubProjects(parentId: number): Promise<Project[]> {
  const database = await initDatabase();
  return (await database.select('SELECT * FROM projects WHERE parent_id = $1 ORDER BY created_at DESC', [parentId])) as Project[];
}

// Fetch tasks for a project including its direct subprojects, with project names
export async function getTasksForProjectTree(projectId: number): Promise<(Task & { project_name: string })[]> {
  const database = await initDatabase();
  return (await database.select(
    `WITH RECURSIVE proj_tree(id) AS (
       SELECT id FROM projects WHERE id = $1
       UNION ALL
       SELECT p.id FROM projects p JOIN proj_tree pt ON p.parent_id = pt.id
     )
     SELECT t.*, p.name as project_name
     FROM tasks t
     JOIN projects p ON p.id = t.project_id
     WHERE p.id IN (SELECT id FROM proj_tree)
     ORDER BY t.created_at DESC`,
    [projectId]
  )) as (Task & { project_name: string })[];
}

// Set a project's primary color and (optionally) retint all its direct subprojects uniquely
export async function setProjectPrimaryColor(parentId: number, color: string, options?: { retint?: boolean }) {
  const database = await initDatabase();
  await database.execute('UPDATE projects SET color = $1 WHERE id = $2', [color, parentId]);
  if (options?.retint === false) return;
  // Fetch subprojects oldest first for stable assignment
  const subs = (await database.select(
    'SELECT id FROM projects WHERE parent_id = $1 ORDER BY created_at ASC, id ASC',
    [parentId]
  )) as { id: number }[];
  const tones = [0,1,2,3,4];
  let i = 0;
  for (const sp of subs) {
    const tone = tones[i % tones.length];
    i++;
    try { await database.execute('UPDATE projects SET tint = $1 WHERE id = $2', [tone, sp.id]); } catch (_) {}
  }
}

// Milestones CRUD
export async function getMilestones(projectId: number): Promise<import('../types').Milestone[]> {
  const database = await initDatabase();
  return (await database.select('SELECT * FROM milestones WHERE project_id = $1 ORDER BY COALESCE(position, 0) ASC, COALESCE(due_date, "9999-12-31") ASC, id ASC', [projectId])) as any;
}
export async function createMilestone(m: Omit<import('../types').Milestone, 'id' | 'created_at' | 'position'> & { position?: number | null }): Promise<number> {
  const database = await initDatabase();
  const res = await database.execute('INSERT INTO milestones (project_id, title, due_date, status, notes, position) VALUES ($1,$2,$3,$4,$5,$6)', [m.project_id, m.title, m.due_date ?? null, m.status ?? 'pending', m.notes ?? '', m.position ?? null]);
  return Number(res.lastInsertId ?? -1);
}
export async function updateMilestone(id: number, m: Partial<import('../types').Milestone>) {
  const database = await initDatabase();
  const fields: string[] = [];
  const values: (string | number | null)[] = [];
  for (const key of ['title','due_date','status','notes','position'] as const) {
    if ((m as any)[key] !== undefined) { fields.push(`${key} = ?`); values.push((m as any)[key]); }
  }
  if (fields.length) {
    values.push(id);
    const setClause = fields.map((f, idx) => f.replace('?', `$${idx+1}`)).join(', ');
    await database.execute(`UPDATE milestones SET ${setClause} WHERE id = $${fields.length+1}`, values);
  }
}
export async function deleteMilestone(id: number) {
  const database = await initDatabase();
  await database.execute('DELETE FROM milestones WHERE id = $1', [id]);
}

// Notes CRUD (one or multiple notes; we use single note per project ui)
export async function getNotes(projectId: number): Promise<import('../types').Note[]> {
  const database = await initDatabase();
  return (await database.select('SELECT * FROM notes WHERE project_id = $1 ORDER BY updated_at DESC NULLS LAST, created_at DESC', [projectId])) as any;
}
export async function upsertNote(projectId: number, content: string): Promise<number> {
  const database = await initDatabase();
  // Upsert: if exists, update the latest; else insert
  const rows = await database.select('SELECT id FROM notes WHERE project_id = $1 ORDER BY updated_at DESC NULLS LAST, created_at DESC LIMIT 1', [projectId]);
  if ((rows as any[]).length > 0) {
    const id = Number((rows as any[])[0].id);
    await database.execute('UPDATE notes SET content = $1, updated_at = datetime(\'now\') WHERE id = $2', [content, id]);
    return id;
  } else {
    const res = await database.execute('INSERT INTO notes (project_id, content, updated_at) VALUES ($1,$2, datetime(\'now\'))', [projectId, content]);
    return Number(res.lastInsertId ?? -1);
  }
}

// Papers CRUD
export async function getPapers(projectId: number): Promise<import('../types').Paper[]> {
  const database = await initDatabase();
  return (await database.select('SELECT * FROM papers WHERE project_id = $1 ORDER BY COALESCE(position, 0) ASC, created_at DESC', [projectId])) as any;
}
export async function createPaper(p: Omit<import('../types').Paper, 'id' | 'created_at'>): Promise<number> {
  const database = await initDatabase();
  // determine next position within project
  let nextPos = 1;
  try {
    const rows = await database.select('SELECT COALESCE(MAX(position), 0) as maxp FROM papers WHERE project_id = $1', [p.project_id]);
    const maxp = Number((rows as any[])[0]?.maxp ?? 0);
    nextPos = (Number.isNaN(maxp) ? 0 : maxp) + 1;
  } catch {}
  const res = await database.execute('INSERT INTO papers (project_id, title, authors, year, doi, url, status, notes, position) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [p.project_id, p.title, p.authors ?? '', p.year ?? null, p.doi ?? '', p.url ?? '', p.status ?? 'to_read', p.notes ?? '', nextPos]);
  return Number(res.lastInsertId ?? -1);
}
export async function updatePaper(id: number, p: Partial<import('../types').Paper>) {
  const database = await initDatabase();
  const fields: string[] = [];
  const values: (string | number | null)[] = [];
  for (const key of ['title','authors','year','doi','url','status','notes','position'] as const) {
    if ((p as any)[key] !== undefined) { fields.push(`${key} = ?`); values.push((p as any)[key]); }
  }
  if (fields.length) {
    values.push(id);
    const setClause = fields.map((f, idx) => f.replace('?', `$${idx+1}`)).join(', ');
    await database.execute(`UPDATE papers SET ${setClause} WHERE id = $${fields.length+1}`, values);
  }
}
export async function deletePaper(id: number) {
  const database = await initDatabase();
  await database.execute('DELETE FROM papers WHERE id = $1', [id]);
}

// Experiments CRUD
export async function getExperiments(projectId: number): Promise<import('../types').Experiment[]> {
  const database = await initDatabase();
  return (await database.select('SELECT * FROM experiments WHERE project_id = $1 ORDER BY created_at DESC', [projectId])) as any;
}
export async function createExperiment(e: Omit<import('../types').Experiment, 'id' | 'created_at' | 'updated_at'>): Promise<number> {
  const database = await initDatabase();
  const res = await database.execute('INSERT INTO experiments (project_id, name, protocol, variables_json, outcomes, status, updated_at) VALUES ($1,$2,$3,$4,$5,$6, datetime(\'now\'))', [e.project_id, e.name, e.protocol ?? '', e.variables_json ?? '', e.outcomes ?? '', e.status ?? 'planned']);
  return Number(res.lastInsertId ?? -1);
}
export async function updateExperiment(id: number, e: Partial<import('../types').Experiment>) {
  const database = await initDatabase();
  const fields: string[] = [];
  const values: (string | number | null)[] = [];
  for (const key of ['name','protocol','variables_json','outcomes','status'] as const) {
    if ((e as any)[key] !== undefined) { fields.push(`${key} = ?`); values.push((e as any)[key]); }
  }
  if (fields.length) {
    fields.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);
    const setClause = fields.map((f, idx) => f.replace('?', `$${idx+1}`)).join(', ');
    await database.execute(`UPDATE experiments SET ${setClause} WHERE id = $${fields.length+1}`, values);
  }
}
export async function deleteExperiment(id: number) {
  const database = await initDatabase();
  await database.execute('DELETE FROM experiments WHERE id = $1', [id]);
}

// Global search helpers
export async function searchTasks(query: string): Promise<(Task & { project_name: string })[]> {
  const database = await initDatabase();
  return (await database.select(
    `SELECT t.*, p.name as project_name
     FROM tasks t JOIN projects p ON t.project_id = p.id
     WHERE t.title LIKE $1 OR t.notes LIKE $2
     ORDER BY t.created_at DESC`,
    [`%${query}%`, `%${query}%`]
  )) as any;
}
export async function searchLinks(query: string): Promise<Link[]> {
  const database = await initDatabase();
  return (await database.select(
    `SELECT * FROM links WHERE label LIKE $1 OR target LIKE $2 OR notes LIKE $3 ORDER BY created_at DESC`,
    [`%${query}%`, `%${query}%`, `%${query}%`]
  )) as any;
}

// Export / Import
export async function exportAllData() {
  const database = await initDatabase();
  const [projects, tasks, links, milestones, notes, papers, experiments, deps] = await Promise.all([
    database.select('SELECT * FROM projects'),
    database.select('SELECT * FROM tasks'),
    database.select('SELECT * FROM links'),
    database.select('SELECT * FROM milestones'),
    database.select('SELECT * FROM notes'),
    database.select('SELECT * FROM papers'),
    database.select('SELECT * FROM experiments'),
    database.select('SELECT * FROM task_dependencies'),
  ]);
  return { projects, tasks, links, milestones, notes, papers, experiments, task_dependencies: deps };
}
export async function importAllData(data: any) {
  const database = await initDatabase();
  // naive import: append; assumes fresh DB or user expects duplicates
  const tableInserts: Array<Promise<any>> = [];
  const insert = (sql: string, rows: any[], cols: string[]) => {
    for (const row of rows || []) {
      const values = cols.map(c => (row as any)[c] ?? null);
      tableInserts.push(database.execute(sql, values));
    }
  };
  insert('INSERT INTO projects (id,name,description,primary_path,tags,color,archived,created_at,parent_id,tint) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', data.projects, ['id','name','description','primary_path','tags','color','archived','created_at','parent_id','tint']);
  insert('INSERT INTO tasks (id,project_id,title,notes,priority,due_date,due_time,start_time,end_time,effort_minutes,type,reminder_at,recurrence_rule,updated_at,color_tone,status,created_at,completed_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)', data.tasks, ['id','project_id','title','notes','priority','due_date','due_time','start_time','end_time','effort_minutes','type','reminder_at','recurrence_rule','updated_at','color_tone','status','created_at','completed_at']);
  insert('INSERT INTO links (id,project_id,task_id,label,target,kind,notes,position,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', data.links, ['id','project_id','task_id','label','target','kind','notes','position','created_at']);
  insert('INSERT INTO milestones (id,project_id,title,due_date,status,notes,position,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', data.milestones, ['id','project_id','title','due_date','status','notes','position','created_at']);
  insert('INSERT INTO notes (id,project_id,content,created_at,updated_at) VALUES ($1,$2,$3,$4,$5)', data.notes, ['id','project_id','content','created_at','updated_at']);
  insert('INSERT INTO papers (id,project_id,title,authors,year,doi,url,status,notes,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', data.papers, ['id','project_id','title','authors','year','doi','url','status','notes','created_at']);
  insert('INSERT INTO experiments (id,project_id,name,protocol,variables_json,outcomes,status,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', data.experiments, ['id','project_id','name','protocol','variables_json','outcomes','status','created_at','updated_at']);
  insert('INSERT INTO task_dependencies (task_id,depends_on_task_id) VALUES ($1,$2)', data.task_dependencies, ['task_id','depends_on_task_id']);
  await Promise.all(tableInserts);
}
