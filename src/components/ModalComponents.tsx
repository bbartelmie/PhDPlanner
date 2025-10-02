import React, { useState, useEffect, useRef } from 'react';
import { X, FolderOpen } from 'lucide-react';
import { addDays, format, parseISO } from 'date-fns';
import { open } from "@tauri-apps/plugin-dialog";
import { Project, Task, Link } from '../types';
import { createProject, updateProject, createTask, updateTask, getTaskLinks, createLink, deleteLink, setTaskDependencies } from '../lib/database';
import { getProject, getSubProjects } from '../lib/database';
import { invoke } from '@tauri-apps/api/core';

// Primary color palette (ROYGBIV)
export const primaryPalette: Array<{ name: string; hex: string }> = [
  { name: 'Red', hex: '#ef4444' },
  { name: 'Orange', hex: '#f97316' },
  { name: 'Yellow', hex: '#f59e0b' },
  { name: 'Green', hex: '#10b981' },
  { name: 'Blue', hex: '#3b82f6' },
  { name: 'Indigo', hex: '#6366f1' },
  { name: 'Violet', hex: '#a855f7' },
];

function computeShade(hex: string, tone: number) {
  // tone 0..4, 0 = base, higher = lighter
  const h = hex.replace('#','').trim();
  const full = h.length === 3 ? h.split('').map(c=>c+c).join('') : h;
  let r = parseInt(full.slice(0,2),16);
  let g = parseInt(full.slice(2,4),16);
  let b = parseInt(full.slice(4,6),16);
  const ratio = [0, 0.2, 0.35, 0.5, 0.65][Math.min(Math.max(tone,0),4)];
  // mix with white by ratio
  r = Math.round(r + (255 - r) * ratio);
  g = Math.round(g + (255 - g) * ratio);
  b = Math.round(b + (255 - b) * ratio);
  return `rgb(${r}, ${g}, ${b})`;
}

// Project Modal Component
interface ProjectModalProps {
  project?: Project | null;
  onSave: () => void;
  onCancel: () => void;
  parentId?: number | null;
}

export function ProjectModal({ project, onSave, onCancel, parentId = null }: ProjectModalProps) {
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    primary_path: '',
    tags: '',
    color: '#3b82f6'
  });

  useEffect(() => {
    if (project) {
      setFormData({
        name: project.name || '',
        description: project.description || '',
        primary_path: project.primary_path || '',
        tags: project.tags || '',
        color: project.color || '#3b82f6'
      });
    }
  }, [project]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) return;

    try {
      if (project?.id) {
        await updateProject(project.id, formData);
      } else {
        await createProject({ ...formData, parent_id: parentId } as any);
      }
      onSave();
    } catch (error) {
      console.error('Failed to save project:', error);
    }
  };

  const handleSelectFolder = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Select Project Folder'
      });
      
      if (selected && typeof selected === 'string') {
        setFormData(prev => ({ ...prev, primary_path: selected }));
      }
    } catch (error) {
      console.error('Failed to select folder:', error);
    }
  };

  return (
    <div className="modal-overlay" onDoubleClick={onCancel}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{project?.id ? 'Edit Project' : 'New Project'}</h2>
          <button onClick={onCancel} className="close-btn">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="modal-form">
          <div className="form-group">
            <label htmlFor="name">Name *</label>
            <input
              id="name"
              type="text"
              value={formData.name}
              onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
              placeholder="Project name"
              required
              autoFocus
            />
          </div>

          <div className="form-group">
            <label htmlFor="description">Description</label>
            <textarea
              id="description"
              value={formData.description}
              onChange={e => setFormData(prev => ({ ...prev, description: e.target.value }))}
              placeholder="Brief description of the project"
              rows={3}
            />
          </div>

          <div className="form-group">
            <label htmlFor="primary_path">Primary Folder</label>
            <div className="path-input-group">
              <input
                id="primary_path"
                type="text"
                value={formData.primary_path}
                onChange={e => setFormData(prev => ({ ...prev, primary_path: e.target.value }))}
                placeholder="/path/to/project/folder"
              />
              <button
                type="button"
                onClick={handleSelectFolder}
                className="select-folder-btn"
                title="Browse for folder"
              >
                <FolderOpen size={16} />
              </button>
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="tags">Tags</label>
            <input
              id="tags"
              type="text"
              value={formData.tags}
              onChange={e => setFormData(prev => ({ ...prev, tags: e.target.value }))}
              placeholder="tag1, tag2, tag3"
            />
            <small>Separate tags with commas</small>
          </div>

          <div className="form-group">
            <label htmlFor="color">Project Color</label>
            <input
              id="color"
              type="color"
              value={formData.color}
              onChange={e => setFormData(prev => ({ ...prev, color: e.target.value }))}
            />
            <small>Used to color tasks in the calendar</small>
          </div>

          <div className="modal-actions">
            <button type="button" onClick={onCancel} className="btn-secondary">
              Cancel
            </button>
            <button type="submit" className="btn-primary">
              {project?.id ? 'Update Project' : 'Create Project'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Task Modal Component
interface TaskModalProps {
  task?: Task | null;
  projectId: number;
  onSave: () => void;
  onCancel: () => void;
}

export function TaskModal({ task, projectId, onSave, onCancel }: TaskModalProps) {
  const [formData, setFormData] = useState({
    title: '',
    notes: '',
    priority: 3,
    due_date: '',
    due_time: '',
    start_time: '',
    end_time: '',
    status: 'open' as 'open' | 'done',
    type: 'general' as 'experiment' | 'writing' | 'reading' | 'general',
    reminder_at: '',
    effort_minutes: 0,
    recurrence_every_days: 0,
    recurrence_count: 0
  });
  const [timeEnabled, setTimeEnabled] = useState<boolean>(false);
  const [availableProjects, setAvailableProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<number>(projectId);
  const [followUpEnabled, setFollowUpEnabled] = useState<boolean>(false);
  const [followUpDays, setFollowUpDays] = useState<number>(7);
  const [followUpTitle, setFollowUpTitle] = useState<string>('follow-up');
  // Dynamic multi follow-ups (optional). If enabled, we ignore the single row above
  const [followUpsEnabled, setFollowUpsEnabled] = useState<boolean>(false);
  const [followUps, setFollowUps] = useState<Array<{ days: number; title: string }>>([
    { days: 7, title: 'follow-up' },
  ]);
  const [followUp2, setFollowUp2] = useState<boolean>(false);
  const [followUp2Days, setFollowUp2Days] = useState<number>(7);
  const [followUp2Title, setFollowUp2Title] = useState<string>('follow-up');
  const [followUp3, setFollowUp3] = useState<boolean>(false);
  const [followUp3Days, setFollowUp3Days] = useState<number>(7);
  const [followUp3Title, setFollowUp3Title] = useState<string>('follow-up');
  const [taskLinks, setTaskLinks] = useState<Link[]>([]);
  const [showTaskLinkMenu, setShowTaskLinkMenu] = useState(false);
  const taskLinkMenuRef = useRef<HTMLDivElement | null>(null);
  const taskLinkBtnRef = useRef<HTMLButtonElement | null>(null);
  const [allProjectTasks, setAllProjectTasks] = useState<Task[]>([]);
  const [dependsOn, setDependsOn] = useState<number[]>([]);

  useEffect(() => {
    if (task) {
      setFormData({
        title: task.title || '',
        notes: task.notes || '',
        priority: task.priority || 3,
        due_date: task.due_date || '',
        due_time: task.due_time || '',
        start_time: task.start_time || task.due_time || '',
        end_time: task.end_time || task.due_time || '',
        status: task.status || 'open',
        type: (task as any).type || 'general',
        reminder_at: (task as any).reminder_at || '',
        effort_minutes: (task as any).effort_minutes || 0,
        recurrence_every_days: 0,
        recurrence_count: 0
      });
      setTimeEnabled(Boolean(task.start_time || task.due_time));
      setSelectedProjectId(task.project_id);
      (async () => {
        try {
          if (task.id) {
            const l = await getTaskLinks(task.id);
            setTaskLinks(l);
            try { const { getTaskDependencies } = await import('../lib/database'); const deps = await getTaskDependencies(task.id); setDependsOn(deps); } catch {}
          }
        } catch (e) {
          console.warn('[TaskModal] failed to load task links', e);
        }
      })();
    }
  }, [task]);

  // Load current project + its subprojects for assignment
  useEffect(() => {
    (async () => {
      try {
        const current = await getProject(projectId);
        const subs = await getSubProjects(projectId);
        const list: Project[] = [];
        if (current) list.push(current);
        list.push(...subs);
        setAvailableProjects(list);
        // load tasks for dependency selector (from current project only)
        try {
          const { getTasks } = await import('../lib/database');
          const t = await getTasks(projectId);
          setAllProjectTasks(t);
        } catch {}
        // Ensure selection defaults if not editing
        if (!task) setSelectedProjectId(projectId);
      } catch (e) {
        console.warn('[TaskModal] failed loading project options:', e);
      }
    })();
  }, [projectId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.title.trim()) return;

    try {
      const taskData = {
        ...formData,
        project_id: selectedProjectId,
        due_date: formData.due_date || undefined,
        // Ensure due_time, start_time, end_time are string or undefined (never null)
        due_time: timeEnabled ? (formData.start_time || formData.due_time || undefined) : undefined,
        start_time: timeEnabled ? (formData.start_time || undefined) : undefined,
        end_time: timeEnabled ? (formData.end_time || formData.start_time || undefined) : undefined,
        // Assign color tone based on selected project's tint (if any)
        color_tone: (availableProjects.find(p => p.id === selectedProjectId)?.tint ?? 0)
      };

      let createdId: number | void = undefined;
      if (task?.id) {
        await updateTask(task.id, taskData);
      } else {
        createdId = await createTask(taskData);
      }

      // set dependencies
      try {
        const tid = (task?.id || createdId)!;
        await setTaskDependencies(tid, dependsOn);
      } catch(e) { console.warn('[TaskModal] set deps failed', e); }

      // If follow-up(s) enabled, create them after saving/creating the main task
      const baseForFollowUps = formData.due_date ? parseISO(formData.due_date) : new Date();
      let toCreate: Array<{days:number; title:string}> = [];
      if (followUpsEnabled) {
        toCreate = followUps.map((fu) => ({ days: fu.days || 7, title: (fu.title || 'follow-up').trim() }));
      } else {
        if (followUpEnabled) {
          toCreate.push({ days: followUpDays || 7, title: (followUpTitle || 'follow-up').trim() });
        }
        if (followUp2) {
          toCreate.push({ days: followUp2Days || 7, title: (followUp2Title || 'follow-up').trim() });
        }
        if (followUp3) {
          toCreate.push({ days: followUp3Days || 7, title: (followUp3Title || 'follow-up').trim() });
        }
      }
      for (const fu of toCreate) {
        const due = format(addDays(baseForFollowUps, fu.days), 'yyyy-MM-dd');
        await createTask({
          project_id: selectedProjectId,
          title: fu.title,
          notes: '',
          priority: formData.priority ?? 3,
          due_date: due,
          due_time: timeEnabled ? (formData.start_time || formData.due_time || undefined) : undefined,
          start_time: timeEnabled ? (formData.start_time || undefined) : undefined,
          end_time: timeEnabled ? (formData.end_time || formData.start_time || undefined) : undefined,
          color_tone: (availableProjects.find(p => p.id === selectedProjectId)?.tint ?? 0),
          status: 'open'
        });
      }

      // simple recurrence: every N days, count M
      if (formData.recurrence_every_days > 0 && formData.recurrence_count > 0) {
        const base = formData.due_date ? parseISO(formData.due_date) : new Date();
        for (let i = 1; i <= formData.recurrence_count; i++) {
          const due = format(addDays(base, i * formData.recurrence_every_days), 'yyyy-MM-dd');
          await createTask({
            project_id: selectedProjectId,
            title: formData.title,
            notes: formData.notes,
            priority: formData.priority,
            due_date: due,
            due_time: timeEnabled ? (formData.start_time || formData.due_time || undefined) : undefined,
            start_time: timeEnabled ? (formData.start_time || undefined) : undefined,
            end_time: timeEnabled ? (formData.end_time || formData.start_time || undefined) : undefined,
            color_tone: (availableProjects.find(p => p.id === selectedProjectId)?.tint ?? 0),
            status: 'open'
          });
        }
      }

      onSave();
    } catch (error) {
      console.error('Failed to save task:', error);
    }
  };

  // Task quick links helpers
  const addTaskLinkUrl = async () => {
    try {
      if (!task?.id) return;
      const url = window.prompt('Enter URL (https://...)');
      if (!url) return;
      let label = '';
      try { const u = new URL(url); label = `${u.hostname}${u.pathname !== '/' ? u.pathname : ''}`; } catch { label = url; }
      const maybeLabel = window.prompt('Label (optional):', label) || label;
      const notes = window.prompt('Notes (optional):', '') || '';
      await createLink({ project_id: selectedProjectId, task_id: task.id, label: maybeLabel, target: url, kind: 'url', notes });
      setTaskLinks(await getTaskLinks(task.id));
    } finally { setShowTaskLinkMenu(false); }
  };
  const addTaskLinkFile = async () => {
    try {
      if (!task?.id) return;
      const selected = await open({ multiple: false, directory: false, title: 'Select File' });
      if (selected && typeof selected === 'string') {
        const base = selected.split(/[/\\\\]/).pop() || selected;
        const notes = window.prompt('Notes (optional):', '') || '';
        await createLink({ project_id: selectedProjectId, task_id: task.id, label: base, target: selected, kind: 'file', notes });
        setTaskLinks(await getTaskLinks(task.id));
      }
    } finally { setShowTaskLinkMenu(false); }
  };
  const addTaskLinkFolder = async () => {
    try {
      if (!task?.id) return;
      const selected = await open({ multiple: false, directory: true, title: 'Select Folder' });
      if (selected && typeof selected === 'string') {
        const base = selected.split(/[/\\\\]/).pop() || selected;
        const notes = window.prompt('Notes (optional):', '') || '';
        await createLink({ project_id: selectedProjectId, task_id: task.id, label: base, target: selected, kind: 'folder', notes });
        setTaskLinks(await getTaskLinks(task.id));
      }
    } finally { setShowTaskLinkMenu(false); }
  };
  const openTaskLink = async (link: Link) => {
    try {
      switch (link.kind) {
        case 'url':
          await invoke('open_url', { url: link.target });
          break;
        case 'folder':
          await invoke('open_folder', { path: link.target });
          break;
        case 'file':
          await invoke('reveal_in_finder', { path: link.target });
          break;
      }
    } catch (e) { console.error(e); }
  };

  // Close quick-link menu when clicking outside
  useEffect(() => {
    if (!showTaskLinkMenu) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (
        taskLinkMenuRef.current &&
        !taskLinkMenuRef.current.contains(t) &&
        taskLinkBtnRef.current &&
        !taskLinkBtnRef.current.contains(t)
      ) {
        setShowTaskLinkMenu(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [showTaskLinkMenu]);

  return (
    <div className="modal-overlay" onDoubleClick={onCancel}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{task ? 'Edit Task' : 'New Task'}</h2>
          <button onClick={onCancel} className="close-btn">
            <X size={20} />
          </button>
        </div>

        {/* Quick Links moved to bottom */}

        <form onSubmit={handleSubmit} className="modal-form">
          <div className="form-group">
            <label htmlFor="assign_project">Assign to</label>
            <select
              id="assign_project"
              value={selectedProjectId}
              onChange={(e) => setSelectedProjectId(parseInt(e.target.value))}
            >
              {availableProjects.map((p, idx) => (
                <option key={p.id} value={p.id}>
                  {idx === 0 ? p.name : `— ${p.name}`}
                </option>
              ))}
            </select>
          </div>
          {/* Color selection is handled at project/subproject level (dot menus). */}
          <div className="form-group">
            <label htmlFor="title">Title *</label>
            <input
              id="title"
              type="text"
              value={formData.title}
              onChange={e => setFormData(prev => ({ ...prev, title: e.target.value }))}
              placeholder="Task title"
              required
              autoFocus
            />
          </div>

          <div className="form-group">
            <label htmlFor="notes">Notes</label>
            <textarea
              id="notes"
              value={formData.notes}
              onChange={e => setFormData(prev => ({ ...prev, notes: e.target.value }))}
              placeholder="Additional details or notes"
              rows={3}
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="priority">Priority</label>
              <select
                id="priority"
                value={formData.priority}
                onChange={e => setFormData(prev => ({ ...prev, priority: parseInt(e.target.value) }))}
              >
                <option value={1}>P1 - Urgent</option>
                <option value={2}>P2 - High</option>
                <option value={3}>P3 - Normal</option>
                <option value={4}>P4 - Low</option>
                <option value={5}>P5 - Someday</option>
              </select>
            </div>

          <div className="form-group">
            <label htmlFor="due_date">Due Date</label>
            <input
              id="due_date"
              type="date"
              value={formData.due_date}
              onChange={e => setFormData(prev => ({ ...prev, due_date: e.target.value }))}
            />
          </div>
          <div className="form-group">
            <label>
              <input
                type="checkbox"
                checked={timeEnabled}
                onChange={(e) => setTimeEnabled(e.target.checked)}
                style={{ marginRight: 8 }}
              />
              Schedule time
            </label>
          </div>
          {timeEnabled && (
            <>
              <div className="form-group">
                <label htmlFor="start_time">Start Time</label>
                <input
                  id="start_time"
                  type="time"
                  value={formData.start_time}
                  onChange={e => setFormData(prev => ({ ...prev, start_time: e.target.value }))}
                />
              </div>
              <div className="form-group">
                <label htmlFor="end_time">End Time</label>
                <input
                  id="end_time"
                  type="time"
                  value={formData.end_time}
                  onChange={e => setFormData(prev => ({ ...prev, end_time: e.target.value }))}
                />
              </div>
            </>
          )}
        </div>

        <div className="form-row">
          <div className="form-group">
            <label htmlFor="type">Type</label>
            <select id="type" value={formData.type} onChange={(e)=> setFormData(prev => ({ ...prev, type: e.target.value as any }))}>
              <option value="general">General</option>
              <option value="experiment">Experiment</option>
              <option value="writing">Writing</option>
              <option value="reading">Reading</option>
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="reminder">Reminder</label>
            <input id="reminder" type="datetime-local" value={formData.reminder_at}
              onChange={(e)=> setFormData(prev => ({ ...prev, reminder_at: e.target.value }))} />
          </div>
          <div className="form-group">
            <label>Recurrence</label>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span>Every</span>
              <input type="number" min={0} style={{ width: 80 }} value={formData.recurrence_every_days} onChange={(e)=> setFormData(prev => ({ ...prev, recurrence_every_days: parseInt(e.target.value||'0',10)||0 }))} />
              <span>days ×</span>
              <input type="number" min={0} style={{ width: 80 }} value={formData.recurrence_count} onChange={(e)=> setFormData(prev => ({ ...prev, recurrence_count: parseInt(e.target.value||'0',10)||0 }))} />
            </div>
          </div>
        </div>

        <div className="form-group">
          <label>Blocked by (dependencies)</label>
          <div style={{ maxHeight: 120, overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: 6, padding: 8 }}>
            {allProjectTasks.length === 0 ? (
              <div style={{ color: '#6b7280', fontSize: 13 }}>No tasks in this project</div>
            ) : (
              allProjectTasks.map(t => (
                <label key={t.id} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
                  <input type="checkbox" checked={dependsOn.includes(t.id!)} disabled={task?.id === t.id}
                    onChange={(e)=> setDependsOn(prev => e.target.checked ? [...prev, t.id!] : prev.filter(x => x !== t.id))} />
                  <span>{t.title}</span>
                </label>
              ))
            )}
          </div>
        </div>

          {task && (
            <div className="form-group">
              <label htmlFor="status">Status</label>
              <select
                id="status"
                value={formData.status}
                onChange={e => setFormData(prev => ({ ...prev, status: e.target.value as 'open' | 'done' }))}
              >
                <option value="open">Open</option>
                <option value="done">Done</option>
              </select>
            </div>
          )}
          <div className="form-row">
            <div className="form-group">
              <label>
                <input
                  type="checkbox"
                  checked={followUpEnabled}
                  onChange={(e) => setFollowUpEnabled(e.target.checked)}
                  style={{ marginRight: 8 }}
                />
                Also create follow-up
              </label>
            </div>
            {followUpEnabled && (
              <>
                <div className="form-group">
                  <label htmlFor="followUpDays">Follow-up in (days)</label>
                  <input
                    id="followUpDays"
                    type="number"
                    min={1}
                    value={followUpDays}
                    onChange={e => setFollowUpDays(parseInt(e.target.value || '0', 10) || 0)}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="followUpTitle">Follow-up title</label>
                  <input
                    id="followUpTitle"
                    type="text"
                    value={followUpTitle}
                    onChange={e => setFollowUpTitle(e.target.value)}
                    placeholder="follow-up"
                  />
                </div>
              </>
            )}
          </div>

          {followUpEnabled && !followUpsEnabled && (
            <div className="form-row">
              <div className="form-group">
                <label>&nbsp;</label>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setFollowUpsEnabled(true);
                    setFollowUps([{ days: followUpDays || 7, title: followUpTitle || 'follow-up' }]);
                  }}
                >
                  Add another follow-up
                </button>
              </div>
            </div>
          )}

          {followUpsEnabled && (
            <>
              {followUps.map((fu, idx) => (
                <div className="form-row" key={`fu-row-${idx}`}>
                  <div className="form-group">
                    <label htmlFor={`fu-days-${idx}`}>Follow-up {idx + 1} in (days)</label>
                    <input
                      id={`fu-days-${idx}`}
                      type="number"
                      min={1}
                      value={fu.days}
                      onChange={(e) => {
                        const v = parseInt(e.target.value || '0', 10) || 0;
                        setFollowUps((prev) => prev.map((x, i) => (i === idx ? { ...x, days: v } : x)));
                      }}
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor={`fu-title-${idx}`}>Follow-up {idx + 1} title</label>
                    <input
                      id={`fu-title-${idx}`}
                      type="text"
                      value={fu.title}
                      onChange={(e) => {
                        const v = e.target.value;
                        setFollowUps((prev) => prev.map((x, i) => (i === idx ? { ...x, title: v } : x)));
                      }}
                      placeholder="follow-up"
                    />
                  </div>
                  <div className="form-group">
                    <label>&nbsp;</label>
                    <button type="button" className="btn-secondary" onClick={() => setFollowUps((prev) => prev.filter((_, i) => i !== idx))}>
                      Remove
                    </button>
                  </div>
                </div>
              ))}
              <div className="form-row">
                <div className="form-group">
                  <label>&nbsp;</label>
                  <button type="button" className="btn-secondary" onClick={() => setFollowUps((prev) => [...prev, { days: 7, title: 'follow-up' }])}>
                    Add another follow-up
                  </button>
                </div>
              </div>
            </>
          )}

          {task?.id && (
            <div className="form-group" style={{ marginTop: 12 }}>
              <div className="section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label style={{ margin: 0 }}>Quick Links</label>
                <div style={{ position: 'relative' }}>
                  <button type="button" ref={taskLinkBtnRef} className="btn-secondary" onClick={() => setShowTaskLinkMenu(v=>!v)}>Add Link</button>
                  {showTaskLinkMenu && (
                    <div ref={taskLinkMenuRef} className="dropdown-menu" style={{ position: 'absolute', right: 0, top: 34 }}>
                      <button type="button" onClick={addTaskLinkUrl}>Add URL</button>
                      <button type="button" onClick={addTaskLinkFile}>Add File</button>
                      <button type="button" onClick={addTaskLinkFolder}>Add Folder</button>
                    </div>
                  )}
                </div>
              </div>
              {taskLinks.length === 0 ? (
                <div className="empty-state" style={{ padding: 10 }}>No links</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {taskLinks.map((lnk) => (
                    <div key={lnk.id} style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1px solid #e5e7eb', borderRadius: 6, padding: '6px 8px' }}>
                      <span style={{ fontWeight: 500 }}>{lnk.label}</span>
                      <span style={{ color: '#6b7280', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis' }}>{lnk.target}</span>
                      <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                        <button type="button" className="action-btn" title="Open" onClick={() => openTaskLink(lnk)}>Open</button>
                        <button type="button" className="action-btn" title="Delete" onClick={async()=>{ try { await deleteLink(lnk.id!); if (task?.id) setTaskLinks(await getTaskLinks(task.id)); } catch(e){ console.error(e);} }}>Delete</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="modal-actions">
            <button type="button" onClick={onCancel} className="btn-secondary">
              Cancel
            </button>
            <button type="submit" className="btn-primary">
              {task ? 'Update Task' : 'Create Task'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Quick Task Modal Component
interface QuickTaskModalProps {
  projects: Project[];
  onSave: () => void;
  onCancel: () => void;
  initial?: Partial<Task>;
}

export function QuickTaskModal({ projects, onSave, onCancel, initial }: QuickTaskModalProps) {
  const [formData, setFormData] = useState({
    title: '',
    notes: '',
    priority: 3,
    due_date: '',
    due_time: '',
    start_time: '',
    end_time: '',
    project_id: projects[0]?.id || 0
  });
  const [timeEnabled, setTimeEnabled] = useState<boolean>(false);
  const [followUpsEnabled, setFollowUpsEnabled] = useState<boolean>(false);
  const [followUps, setFollowUps] = useState<Array<{ days: number; title: string }>>([
    { days: 7, title: 'follow-up' },
  ]);

  useEffect(() => {
    if (!initial) return;
    setFormData(prev => ({
      ...prev,
      due_date: (initial.due_date as string) || prev.due_date,
      start_time: (initial.start_time as string) || prev.start_time,
      end_time: (initial.end_time as string) || prev.end_time,
    }));
    setTimeEnabled(Boolean(initial.start_time));
  }, [initial]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.title.trim() || !formData.project_id) return;

    try {
      const tone = (projects.find(p => p.id === formData.project_id) as any)?.tint ?? 0;
      await createTask({
        ...formData,
        due_date: formData.due_date || undefined,
        due_time: timeEnabled ? (formData.start_time || formData.due_time || undefined) : undefined,
        start_time: timeEnabled ? (formData.start_time || undefined) : undefined,
        end_time: timeEnabled ? (formData.end_time || formData.start_time || undefined) : undefined,
        color_tone: tone
      });
      if (followUpsEnabled) {
        const base = formData.due_date ? parseISO(formData.due_date) : new Date();
        for (const fu of followUps) {
          const dueStr = format(addDays(base, fu.days || 7), 'yyyy-MM-dd');
          await createTask({
            project_id: formData.project_id,
            title: (fu.title || 'follow-up').trim(),
            notes: '',
            priority: formData.priority,
            due_date: dueStr,
            due_time: formData.due_time || undefined,
            color_tone: tone,
            status: 'open'
          });
        }
      }
      onSave();
    } catch (error) {
      console.error('Failed to create quick task:', error);
    }
  };

  return (
    <div className="modal-overlay" onDoubleClick={onCancel}>
      <div className="modal quick-task-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Quick Add Task</h2>
          <button onClick={onCancel} className="close-btn">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="modal-form">
          <div className="form-group">
            <label htmlFor="quick-title">Task *</label>
            <input
              id="quick-title"
              type="text"
              value={formData.title}
              onChange={e => setFormData(prev => ({ ...prev, title: e.target.value }))}
              placeholder="What needs to be done?"
              required
              autoFocus
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="quick-project">Project *</label>
              <select
                id="quick-project"
                value={formData.project_id}
                onChange={e => setFormData(prev => ({ ...prev, project_id: parseInt(e.target.value) }))}
                required
              >
                <option value="">Select project</option>
                {projects.filter(p => p.archived !== 1).map(project => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="quick-priority">Priority</label>
              <select
                id="quick-priority"
                value={formData.priority}
                onChange={e => setFormData(prev => ({ ...prev, priority: parseInt(e.target.value) }))}
              >
                <option value={1}>P1</option>
                <option value={2}>P2</option>
                <option value={3}>P3</option>
                <option value={4}>P4</option>
                <option value={5}>P5</option>
              </select>
            </div>

          <div className="form-group">
            <label htmlFor="quick-due">Due Date</label>
            <input
              id="quick-due"
              type="date"
              value={formData.due_date}
              onChange={e => setFormData(prev => ({ ...prev, due_date: e.target.value }))}
            />
          </div>
          <div className="form-group">
            <label>
              <input
                type="checkbox"
                checked={timeEnabled}
                onChange={(e) => setTimeEnabled(e.target.checked)}
                style={{ marginRight: 8 }}
              />
              Schedule time
            </label>
          </div>
          {timeEnabled && (
            <>
              <div className="form-group">
                <label htmlFor="quick-start">Start Time</label>
                <input
                  id="quick-start"
                  type="time"
                  value={formData.start_time}
                  onChange={e => setFormData(prev => ({ ...prev, start_time: e.target.value }))}
                />
              </div>
              <div className="form-group">
                <label htmlFor="quick-end">End Time</label>
                <input
                  id="quick-end"
                  type="time"
                  value={formData.end_time}
                  onChange={e => setFormData(prev => ({ ...prev, end_time: e.target.value }))}
                />
              </div>
            </>
          )}
        </div>

          <div className="form-row">
            <div className="form-group">
              <label>
                <input
                  type="checkbox"
                  checked={followUpsEnabled}
                  onChange={e => setFollowUpsEnabled(e.target.checked)}
                  style={{ marginRight: 8 }}
                />
                Also create follow-up(s)
              </label>
            </div>
          </div>

          {followUpsEnabled && (
            <>
              {followUps.map((fu, idx) => (
                <div className="form-row" key={`qfu-${idx}`}>
                  <div className="form-group">
                    <label htmlFor={`qfu-days-${idx}`}>Follow-up {idx + 1} in (days)</label>
                    <input id={`qfu-days-${idx}`} type="number" min={1} value={fu.days} onChange={e => {
                      const v = parseInt(e.target.value || '0', 10) || 0;
                      setFollowUps(prev => prev.map((x,i) => i===idx ? { ...x, days: v } : x));
                    }} />
                  </div>
                  <div className="form-group">
                    <label htmlFor={`qfu-title-${idx}`}>Follow-up {idx + 1} title</label>
                    <input id={`qfu-title-${idx}`} type="text" value={fu.title} onChange={e => {
                      const v = e.target.value;
                      setFollowUps(prev => prev.map((x,i) => i===idx ? { ...x, title: v } : x));
                    }} placeholder="follow-up" />
                  </div>
                  <div className="form-group">
                    <label>&nbsp;</label>
                    <button type="button" className="btn-secondary" onClick={() => setFollowUps(prev => prev.filter((_,i)=> i!==idx))}>Remove</button>
                  </div>
                </div>
              ))}
              <div className="form-row">
                <div className="form-group">
                  <label>&nbsp;</label>
                  <button type="button" className="btn-secondary" onClick={() => setFollowUps(prev => [...prev, { days: 7, title: 'follow-up' }])}>Add another follow-up</button>
                </div>
              </div>
            </>
          )}

          <div className="modal-actions">
            <button type="button" onClick={onCancel} className="btn-secondary">
              Cancel
            </button>
            <button type="submit" className="btn-primary">
              Add Task
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
