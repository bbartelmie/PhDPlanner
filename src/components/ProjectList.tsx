import React, { useState, useEffect } from 'react';
import { 
  FolderOpen, 
  Edit3, 
  Archive, 
  Trash2,
  MoreVertical,
  Calendar,
  CheckCircle2,
  Circle,
  AlertTriangle
} from 'lucide-react';
import { format, parse } from 'date-fns';
import { Project, TaskWithProject, ViewType } from '../types';
import { 
  searchProjects, 
  getProjects, 
  updateProject, 
  getTasksWithFilters,
  getProjectStats,
  deleteProject,
  setProjectPrimaryColor
} from '../lib/database';
import { updateTask } from '../lib/database';
import { invoke } from '@tauri-apps/api/core';

interface ProjectListProps {
  projects: Project[];
  currentView: ViewType;
  searchQuery: string;
  selectedTags: string[];
  onProjectSelect: (project: Project) => void;
  onProjectEdit: (project: Project) => void;
  onRefresh: () => void;
}

interface ProjectCard {
  project: Project;
  stats: {
    total_tasks: number;
    completed_tasks: number;
    overdue_tasks: number;
    upcoming_tasks: number;
  };
}

export function ProjectList({
  projects,
  currentView,
  searchQuery,
  selectedTags,
  onProjectSelect,
  onProjectEdit,
  onRefresh
}: ProjectListProps) {
  const [projectCards, setProjectCards] = useState<ProjectCard[]>([]);
  const [isReordering, setIsReordering] = useState(false);
  const [dragId, setDragId] = useState<number | null>(null);

  useEffect(() => {
    const onUp = async () => {
      if (!isReordering || dragId == null) { setDragId(null); return; }
      setDragId(null);
      const updates = projectCards.map((pc, i) => updateProject(pc.project.id!, { position: i + 1 } as any));
      try { await Promise.all(updates); } catch (e) { console.error('persist order failed', e); }
      onRefresh();
    };
    window.addEventListener('mouseup', onUp);
    return () => window.removeEventListener('mouseup', onUp);
  }, [isReordering, dragId, projectCards]);
  const [tasks, setTasks] = useState<TaskWithProject[]>([]);
  const [dropdownOpen, setDropdownOpen] = useState<number | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<number>>(new Set());
  const toggleSelect = (id: number) => setSelectedTaskIds(prev => { const s = new Set(prev); if (s.has(id)) s.delete(id); else s.add(id); return s; });
  const clearSelection = () => { setSelectedTaskIds(new Set()); setSelectMode(false); };

  useEffect(() => {
    loadData();
  }, [currentView, searchQuery, selectedTags, projects]);

  const loadData = async () => {
    if (currentView === 'all' || currentView === 'archived') {
      await loadProjectCards();
    } else {
      await loadTasks();
    }
  };

  const loadProjectCards = async () => {
    try {
      let filteredProjects = projects;

      // Filter by archived status and show only top-level projects (no parent)
      if (currentView === 'archived') {
        filteredProjects = projects.filter(p => Number(p.archived) === 1 && (p as any).parent_id == null);
      } else {
        filteredProjects = projects.filter(p => Number(p.archived) !== 1 && (p as any).parent_id == null);
      }

      // Apply search
      if (searchQuery) {
        const searchResults = await searchProjects(searchQuery);
        filteredProjects = filteredProjects.filter(p => 
          searchResults.some(sr => sr.id === p.id)
        );
      }

      // Apply tag filters
      if (selectedTags.length > 0) {
        filteredProjects = filteredProjects.filter(p => 
          p.tags && selectedTags.some(tag => 
            p.tags!.split(',').map(t => t.trim()).includes(tag)
          )
        );
      }

      // Load stats for each project
      const cards = await Promise.all(
        filteredProjects.map(async (project) => {
          const stats = await getProjectStats(project.id!);
          return { project, stats };
        })
      );

      setProjectCards(cards);
    } catch (error) {
      console.error('Failed to load project cards:', error);
    }
  };

  const loadTasks = async () => {
    try {
      const today = format(new Date(), 'yyyy-MM-dd');
      const next7Days = format(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), 'yyyy-MM-dd');

      let filters: any = { status: 'open' };

      switch (currentView) {
        case 'today':
          filters.dueBefore = today;
          break;
        case 'next7days':
          filters.dueBefore = next7Days;
          break;
        case 'overdue':
          filters.dueBefore = format(new Date(Date.now() - 24 * 60 * 60 * 1000), 'yyyy-MM-dd');
          break;
        case 'inbox':
          // All open tasks
          break;
      }

      let tasksData = await getTasksWithFilters(filters);
      if (searchQuery && searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        tasksData = tasksData.filter(t => t.title.toLowerCase().includes(q) || (t.notes || '').toLowerCase().includes(q) || t.project_name.toLowerCase().includes(q));
      }
      setTasks(tasksData);
    } catch (error) {
      console.error('Failed to load tasks:', error);
    }
  };

  const handleToggleTask = async (task: TaskWithProject) => {
    try {
      const newStatus = task.status === 'done' ? 'open' : 'done';
      await updateTask(task.id!, { status: newStatus });
      await loadTasks();
    } catch (error) {
      console.error('Failed to toggle task:', error);
    }
  };

  const batchMark = async (status: 'open' | 'done') => {
    const ids = Array.from(selectedTaskIds);
    await Promise.all(ids.map(id => updateTask(id, { status })));
    clearSelection();
    await loadTasks();
  };
  const batchDueDate = async () => {
    const val = prompt('Set due date (YYYY-MM-DD), empty to clear');
    if (val === null) return;
    const due = val.trim() === '' ? null : val.trim();
    const ids = Array.from(selectedTaskIds);
    await Promise.all(ids.map(id => updateTask(id, { due_date: due as any })));
    clearSelection();
    await loadTasks();
  };
  const batchPriority = async () => {
    const val = prompt('Set priority 1..5');
    if (!val) return;
    const pr = Math.max(1, Math.min(5, parseInt(val, 10) || 3));
    const ids = Array.from(selectedTaskIds);
    await Promise.all(ids.map(id => updateTask(id, { priority: pr })));
    clearSelection();
    await loadTasks();
  };

  // follow-up creation removed per request; use modal or quick add instead

  const handleOpenFolder = async (path: string) => {
    if (path) {
      try {
        await invoke('open_folder', { path });
      } catch (error) {
        console.error('Failed to open folder:', error);
      }
    }
  };

  const handleArchiveProject = async (project: Project) => {
    try {
      await updateProject(project.id!, { archived: project.archived ? 0 : 1 });
      onRefresh();
    } catch (error) {
      console.error('Failed to archive project:', error);
    }
  };

  const handleDeleteProject = async (project: Project) => {
    if (!confirm(`Delete project "${project.name}"? This cannot be undone.`)) return;
    try {
      await deleteProject(project.id!);
      onRefresh();
    } catch (error) {
      console.error('Failed to delete project:', error);
    }
  };

  const getTagsArray = (tags?: string) => {
    if (!tags) return [];
    return tags.split(',').map(t => t.trim()).filter(t => t.length > 0);
  };

  const getProgressPercentage = (completed: number, total: number) => {
    return total === 0 ? 100 : Math.round((completed / total) * 100);
  };

  if (currentView === 'inbox' || currentView === 'today' || currentView === 'next7days' || currentView === 'overdue') {
    return (
      <div className="project-list">
        <div className="list-header">
          <h2>
            {currentView === 'inbox' && 'Task Inbox'}
            {currentView === 'today' && 'Due Today'}
            {currentView === 'next7days' && 'Next 7 Days'}
            {currentView === 'overdue' && 'Overdue Tasks'}
          </h2>
          <span className="task-count">{tasks.length} tasks</span>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <button className="btn-secondary" onClick={()=> setSelectMode(v => !v)}>{selectMode ? 'Cancel Select' : 'Select Tasks'}</button>
          {selectMode && selectedTaskIds.size > 0 && (
            <>
              <span style={{ color: '#6b7280' }}>{selectedTaskIds.size} selected</span>
              <button className="btn-secondary" onClick={()=> batchMark('done')}>Mark Done</button>
              <button className="btn-secondary" onClick={()=> batchMark('open')}>Mark Open</button>
              <button className="btn-secondary" onClick={batchDueDate}>Set Due Date</button>
              <button className="btn-secondary" onClick={batchPriority}>Set Priority</button>
              <button className="btn-secondary" onClick={clearSelection}>Clear</button>
            </>
          )}
        </div>

        <div className="task-list">
          {tasks.length === 0 ? (
            <div className="empty-state">
              <Calendar size={48} />
              <h3>No tasks found</h3>
              <p>
                {currentView === 'today' && "No tasks due today"}
                {currentView === 'next7days' && "No tasks due in the next 7 days"}
                {currentView === 'overdue' && "No overdue tasks"}
                {currentView === 'inbox' && "No open tasks"}
              </p>
            </div>
          ) : (
            tasks.map((task) => {
              const project = projects.find((p) => p.id === task.project_id);
              return (
                <div key={task.id} className="task-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    {selectMode && (
                      <input type="checkbox" checked={selectedTaskIds.has(task.id!)} onChange={()=> toggleSelect(task.id!)} />
                    )}
                    <button
                      onClick={() => handleToggleTask(task)}
                      className="task-checkbox"
                      title="Toggle completion"
                      style={{ background: 'none', border: 'none', cursor: 'pointer' }}
                    >
                      {task.status === 'done' ? <CheckCircle2 size={20} className="completed" /> : <Circle size={20} />}
                    </button>
                    <div className="task-main">
                      <h4 className={task.status === 'done' ? 'completed' : ''}>{task.title}</h4>
                      <p
                        className="task-project"
                        style={{ cursor: project ? 'pointer' : 'default', textDecoration: project ? 'underline' : 'none' }}
                        onClick={() => project && onProjectSelect(project)}
                      >
                        in {task.project_name}
                      </p>
                      {task.notes && <p className="task-notes">{task.notes}</p>}
                    </div>
                  </div>
                  <div className="task-meta">
                    {task.due_date && (() => {
                      const due = parse(task.due_date!, 'yyyy-MM-dd', new Date());
                      const isOverdue = due < new Date() && task.status === 'open';
                      return (
                        <span className={`task-due ${isOverdue ? 'overdue' : ''}`}>
                          {format(due, 'MMM d')}
                        </span>
                      );
                    })()}
                    <span className={`task-priority priority-${task.priority}`}>P{task.priority}</span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="project-list">
      <div className="list-header">
        <h2>
          {currentView === 'archived' ? 'Archived Projects' : 'Projects'}
        </h2>
        <span className="project-count">{projectCards.length} projects</span>
        <div style={{ marginLeft: 'auto' }}>
          <button className="btn-secondary" onClick={()=> setIsReordering(v => !v)}>{isReordering ? 'Done' : 'Reorder'}</button>
        </div>
      </div>

      <div className="project-grid">
        {projectCards.length === 0 ? (
          <div className="empty-state">
            <FolderOpen size={48} />
            <h3>No projects found</h3>
            <p>
              {searchQuery || selectedTags.length > 0
                ? "Try adjusting your search or filters"
                : currentView === 'archived'
                ? "No archived projects"
                : "Create your first project to get started"
              }
            </p>
          </div>
        ) : (
          projectCards.map(({ project, stats }, idx) => (
            <div
              key={project.id}
              className="project-card"
              onClick={() => { if (!isReordering) onProjectSelect(project); }}
              style={{ cursor: 'pointer', opacity: isReordering ? 0.95 : 1, borderStyle: dragId === project.id ? 'dashed' : undefined }}
              draggable={isReordering}
              onDragStart={(e)=>{ if (!isReordering) return; setDragId(project.id!); e.dataTransfer.effectAllowed='move'; }}
              onDragOver={(e)=>{ if (!isReordering) return; e.preventDefault(); e.dataTransfer.dropEffect='move'; }}
              onMouseDown={() => { if (isReordering) setDragId(project.id!); }}
              onMouseEnter={() => {
                if (!isReordering || dragId == null || dragId === project.id) return;
                const fromIdx = projectCards.findIndex(c => c.project.id === dragId);
                const toIdx = idx;
                if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return;
                const reordered = [...projectCards];
                const [moved] = reordered.splice(fromIdx, 1);
                reordered.splice(toIdx, 0, moved);
                setProjectCards(reordered);
              }}
            >
              <div className="card-header">
                <h3 className="project-title">
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, position: 'relative' }}>
                    <button
                      onClick={(e) => { e.stopPropagation(); setDropdownOpen(-project.id!); }}
                      title="Change color"
                      style={{ width: 12, height: 12, borderRadius: 12, background: (project as any).color || '#3b82f6', border: '1px solid #d1d5db', cursor: 'pointer' }}
                    />
                    {/* Color popover anchored to the dot */}
                    {dropdownOpen === -project.id! && (
                      <div className="dropdown-menu" style={{ position: 'absolute', left: 0, top: 18, minWidth: 280, padding: 10 }} onClick={(e)=>e.stopPropagation()}>
                        <div style={{ display: 'flex', gap: 10 }}>
                          {['#ef4444','#f97316','#f59e0b','#10b981','#3b82f6','#6366f1','#a855f7'].map((hex) => (
                            <button key={hex} className="action-btn" onClick={async () => { try { await setProjectPrimaryColor(project.id!, hex, { retint: true }); setDropdownOpen(null); onRefresh(); } catch (e) { console.error(e); } }}>
                              <span style={{ width: 18, height: 18, borderRadius: 18, background: hex, display: 'inline-block' }} />
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {project.name}
                  </span>
                </h3>
                <div className="card-actions">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setDropdownOpen(dropdownOpen === project.id ? null : project.id!);
                    }}
                    className="action-btn"
                  >
                    <MoreVertical size={16} />
                  </button>
                  
                  {dropdownOpen === project.id && (
                    <div className="dropdown-menu">
                      <button onClick={(e) => { e.stopPropagation(); onProjectEdit(project); }}>
                        <Edit3 size={14} />
                        Edit
                      </button>
                      {project.primary_path && (
                        <button onClick={(e) => { e.stopPropagation(); handleOpenFolder(project.primary_path!); }}>
                          <FolderOpen size={14} />
                          Open Folder
                        </button>
                      )}
                      <button onClick={(e) => { e.stopPropagation(); handleArchiveProject(project); }}>
                        <Archive size={14} />
                        {project.archived ? 'Unarchive' : 'Archive'}
                      </button>
                      <div style={{ height: 1, background: '#e5e7eb', margin: '4px 0' }} />
                      <div style={{ padding: '4px 12px', fontSize: 12, color: '#6b7280' }}>Set Color</div>
                      <div style={{ display: 'flex', gap: 6, padding: '4px 12px' }}>
                        {['#ef4444','#f97316','#f59e0b','#10b981','#3b82f6','#6366f1','#a855f7'].map((hex) => (
                          <button key={hex} className="action-btn" title="Set project color" onClick={async (e) => { e.stopPropagation(); try { await updateProject(project.id!, { color: hex }); onRefresh(); } catch (e) { console.error(e); } }}>
                            <span style={{ width: 14, height: 14, borderRadius: 14, background: hex, display: 'inline-block' }} />
                          </button>
                        ))}
                      </div>
                      <button onClick={(e) => { e.stopPropagation(); handleDeleteProject(project); }}>
                        <Trash2 size={14} />
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {project.description && (
                <p className="project-description">{project.description}</p>
              )}

              {getTagsArray(project.tags).length > 0 && (
                <div className="project-tags">
                  {getTagsArray(project.tags).map((tag) => (
                    <span key={tag} className="tag">
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              <div className="project-stats">
                <div className="stat">
                  <CheckCircle2 size={16} />
                  <span>
                    {stats.completed_tasks}/{stats.total_tasks} tasks
                  </span>
                  <div className="progress-bar">
                    <div 
                      className="progress-fill" 
                      style={{ 
                        width: `${getProgressPercentage(stats.completed_tasks, stats.total_tasks)}%` 
                      }}
                    />
                  </div>
                </div>

                {stats.overdue_tasks > 0 && (
                  <div className="stat overdue">
                    <AlertTriangle size={16} />
                    <span>{stats.overdue_tasks} overdue</span>
                  </div>
                )}

                {stats.upcoming_tasks > 0 && (
                  <div className="stat upcoming">
                    <Calendar size={16} />
                    <span>{stats.upcoming_tasks} upcoming</span>
                  </div>
                )}
              </div>

              {project.created_at && (
                <div className="project-date">
                  Created {format(new Date(project.created_at), 'MMM d, yyyy')}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
