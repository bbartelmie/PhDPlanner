import React, { useState, useEffect } from 'react';
import { 
  ArrowLeft, 
  FolderOpen, 
  Edit3, 
  Plus,
  Calendar,
  CheckCircle2,
  Circle,
  ExternalLink,
  File,
  Folder,
  Link as LinkIcon,
  Copy,
  Trash2
} from 'lucide-react';
import { format, parse } from 'date-fns';
import { Project, Task, Link, ProjectTab, TaskWithProject, Milestone, Note, Paper, Experiment } from '../types';
import { 
  getTasks, 
  createTask,
  getLinks, 
  updateTask, 
  deleteTask, 
  deleteLink, 
  getProjectStats, 
  createLink,
  updateLink,
  updateProject,
  deleteProject,
  getProject,
  getTasksForProjectTree,
  setProjectPrimaryColor,
  getMilestones,
  createMilestone,
  updateMilestone,
  deleteMilestone,
  getNotes,
  upsertNote,
  getPapers,
  createPaper,
  updatePaper,
  deletePaper,
  getExperiments,
  createExperiment,
  updateExperiment,
  deleteExperiment
} from '../lib/database';
import { getSubProjects } from '../lib/database';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open as openDialog } from '@tauri-apps/plugin-dialog';

interface ProjectDetailProps {
  project: Project;
  refreshTick?: number;
  currentTab: ProjectTab;
  onTabChange: (tab: ProjectTab) => void;
  onEditProject: (project: Project) => void;
  onNewTask: () => void;
  onEditTask: (task: Task) => void;
  onProjectDeleted?: () => void;
  onOpenProject?: (project: Project) => void;
  onBackToAll?: () => void;
}

export function ProjectDetail({
  project,
  refreshTick,
  currentTab,
  onTabChange,
  onEditProject,
  onNewTask,
  onEditTask,
  onProjectDeleted,
  onOpenProject,
  onBackToAll
}: ProjectDetailProps) {
  const [tasks, setTasks] = useState<TaskWithProject[]>([]);
  const [links, setLinks] = useState<Link[]>([]);
  const [subprojects, setSubprojects] = useState<Project[]>([]);
  const [subTasksByProject, setSubTasksByProject] = useState<Record<number, Task[]>>({});
  const [parentProject, setParentProject] = useState<Project | null>(null);
  const [projColor, setProjColor] = useState<string>(project.color || '#3b82f6');
  const [projTint, setProjTint] = useState<number>((project as any).tint ?? 0);
  const [showColorMenu, setShowColorMenu] = useState(false);
  const [stats, setStats] = useState({
    total_tasks: 0,
    completed_tasks: 0,
    overdue_tasks: 0,
    upcoming_tasks: 0
  });
  const [taskFilter, setTaskFilter] = useState<'all' | 'open' | 'done'>('all');
  const [taskSort, setTaskSort] = useState<'created' | 'due' | 'priority'>('created');
  const [includeSubs, setIncludeSubs] = useState<boolean>(!project.parent_id);
  const [isDropActive, setIsDropActive] = useState(false);
  const [showAddLinkMenu, setShowAddLinkMenu] = useState(false);
  const [editingLinkId, setEditingLinkId] = useState<number | null>(null);
  const [editLinkForm, setEditLinkForm] = useState<{ label: string; notes: string }>({ label: '', notes: '' });
  const [missingLinkIds, setMissingLinkIds] = useState<Set<number>>(new Set());
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [notes, setNotes] = useState<string>('');
  const [papers, setPapers] = useState<Paper[]>([]);
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [pathExists, setPathExists] = useState<boolean | null>(null);
  const [activeTimer, setActiveTimer] = useState<{ taskId: number; endsAt: number } | null>(null);

  useEffect(() => {
    loadProjectData();
    // sync local color/tint when project changes
    setProjColor(project.color || '#3b82f6');
    setProjTint((project as any).tint ?? 0);
  }, [project.id, refreshTick]);

  const loadProjectData = async () => {
    try {
      const [tasksDataRaw, linksData, statsData, subs, parent, ms, ns, ps, es] = await Promise.all([
        project.parent_id || !includeSubs ? getTasks(project.id!) : getTasksForProjectTree(project.id!),
        getLinks(project.id!),
        getProjectStats(project.id!),
        getSubProjects(project.id!),
        project.parent_id ? getProject(project.parent_id) : Promise.resolve(null),
        getMilestones(project.id!),
        getNotes(project.id!),
        getPapers(project.id!),
        getExperiments(project.id!)
      ]);
      
      const tasksData: TaskWithProject[] = ((project.parent_id || !includeSubs)
        ? (tasksDataRaw as Task[]).map((t) => ({ ...t, project_name: project.name }))
        : (tasksDataRaw as TaskWithProject[])
      );
      setTasks(tasksData);
      setLinks(linksData);
      setStats(statsData);
      setSubprojects(subs);
      setParentProject(parent as any);
      setMilestones(ms as any);
      setNotes(((ns as any)[0]?.content) || '');
      setPapers(ps as any);
      setExperiments(es as any);
      try {
        if (project.primary_path) {
          await invoke('path_kind', { path: project.primary_path });
          setPathExists(true);
        } else {
          setPathExists(null);
        }
      } catch { setPathExists(false); }
      // Load tasks for subprojects to support grouped upcoming view
      if (subs.length > 0) {
        const entries = await Promise.all(
          subs.map(async (sp) => [sp.id!, await getTasks(sp.id!)] as const)
        );
        const map: Record<number, Task[]> = {};
        for (const [pid, list] of entries) map[pid] = list;
        setSubTasksByProject(map);
      } else {
        setSubTasksByProject({});
      }
    } catch (error) {
      console.error('Failed to load project data:', error);
    }
  };

  const palette = ['#ef4444','#f97316','#f59e0b','#10b981','#3b82f6','#6366f1','#a855f7'];
  const shadeFromTone = (hex: string, tone: number) => {
    const h = hex.replace('#','');
    const full = h.length===3? h.split('').map(c=>c+c).join('') : h;
    let r = parseInt(full.slice(0,2),16);
    let g = parseInt(full.slice(2,4),16);
    let b = parseInt(full.slice(4,6),16);
    const ratios = [0,0.2,0.35,0.5,0.65];
    const ratio = ratios[Math.min(Math.max(tone,0),4)];
    r = Math.round(r + (255-r)*ratio);
    g = Math.round(g + (255-g)*ratio);
    b = Math.round(b + (255-b)*ratio);
    return `rgb(${r},${g},${b})`;
  };

  const handleTaskToggle = async (task: Task) => {
    try {
      const newStatus = task.status === 'done' ? 'open' : 'done';
      await updateTask(task.id!, { status: newStatus });
      await loadProjectData();
    } catch (error) {
      console.error('Failed to toggle task:', error);
    }
  };

  const handleTaskDelete = async (taskId: number) => {
    if (confirm('Are you sure you want to delete this task?')) {
      try {
        await deleteTask(taskId);
        await loadProjectData();
      } catch (error) {
        console.error('Failed to delete task:', error);
      }
    }
  };

  // follow-up quick button removed per request; use modal or quick add instead

  const handleLinkDelete = async (linkId: number) => {
    if (confirm('Are you sure you want to delete this link?')) {
      try {
        await deleteLink(linkId);
        await loadProjectData();
      } catch (error) {
        console.error('Failed to delete link:', error);
      }
    }
  };

  const handleProjectDelete = async () => {
    if (!confirm(`Delete project "${project.name}"? This cannot be undone.`)) return;
    try {
      await deleteProject(project.id!);
      onProjectDeleted?.();
    } catch (error) {
      console.error('Failed to delete project:', error);
    }
  };

  // Drag & Drop for adding links
  useEffect(() => {
    let unsubs: Array<() => void> = [];
    const setup = async () => {
      try {
        const offHover = await listen<string[] | { paths: string[] }>('tauri://file-drop-hover', () => setIsDropActive(true));
        const offCancel = await listen('tauri://file-drop-cancelled', () => setIsDropActive(false));
        const offDrop = await listen<string[] | { paths: string[] }>('tauri://file-drop', async (event) => {
          setIsDropActive(false);
          const payload: any = event.payload as any;
          const paths: string[] = Array.isArray(payload) ? payload : payload?.paths ?? [];
          if (!paths || paths.length === 0) return;
          try {
            await Promise.all(paths.map(async (p) => {
              const base = p.split(/[/\\\\]/).pop() || p;
              let kind: 'file' | 'folder' = 'file';
              try {
                const k = await invoke<string>('path_kind', { path: p });
                if (k === 'folder') kind = 'folder';
              } catch {}
              await createLink({ project_id: project.id!, label: base, target: p, kind });
            }));
            await loadProjectData();
          } catch (e) {
            console.error('Failed to add dropped links:', e);
          }
        });
        unsubs = [offHover, offCancel, offDrop];
      } catch (e) {
        console.warn('[ProjectDetail] file-drop not available:', e);
      }
    };
    setup();
    return () => {
      unsubs.forEach((off) => {
        try { off(); } catch {}
      });
    };
  }, [project.id]);

  const handleOpenLink = async (link: Link) => {
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
    } catch (error) {
      console.error('Failed to open link:', error);
    }
  };

  const handleCopyPath = async (path: string) => {
    try {
      await navigator.clipboard.writeText(path);
    } catch (error) {
      console.error('Failed to copy path:', error);
    }
  };

  const getFilteredTasks = () => {
    let filtered = tasks;
    
    if (taskFilter !== 'all') {
      filtered = filtered.filter(t => t.status === taskFilter);
    }
    
    return filtered.sort((a, b) => {
      switch (taskSort) {
        case 'due':
          if (!a.due_date && !b.due_date) return 0;
          if (!a.due_date) return 1;
          if (!b.due_date) return -1;
          const ad = a.due_date ? parse(a.due_date, 'yyyy-MM-dd', new Date()) : null;
          const bd = b.due_date ? parse(b.due_date, 'yyyy-MM-dd', new Date()) : null;
          if (!ad && !bd) return 0;
          if (!ad) return 1;
          if (!bd) return -1;
          return ad.getTime() - bd.getTime();
        case 'priority':
          return (b.priority || 3) - (a.priority || 3);
        case 'created':
        default:
          return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
      }
    });
  };

  const getUpcomingTasks = () => {
    const today = new Date();
    const nextWeek = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
    
    return tasks
      .filter(t => t.status === 'open' && t.due_date)
      .filter(t => {
        const dueDate = parse(t.due_date!, 'yyyy-MM-dd', new Date());
        return dueDate >= today && dueDate <= nextWeek;
      })
      .sort((a, b) => parse(a.due_date!, 'yyyy-MM-dd', new Date()).getTime() - parse(b.due_date!, 'yyyy-MM-dd', new Date()).getTime())
      .slice(0, 5);
  };

  const getUpcomingByProject = () => {
    const today = new Date();
    const nextWeek = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
    const collect = (list: Task[]) =>
      list
        .filter((t) => t.status === 'open' && t.due_date)
        .filter((t) => {
          const dueDate = parse(t.due_date!, 'yyyy-MM-dd', new Date());
          return dueDate >= today && dueDate <= nextWeek;
        })
        .sort(
          (a, b) =>
            parse(a.due_date!, 'yyyy-MM-dd', new Date()).getTime() -
            parse(b.due_date!, 'yyyy-MM-dd', new Date()).getTime()
        )
        .slice(0, 5);

    const groups: Array<{ project: Project; tasks: Task[] }> = [];
    // Only include tasks created in the parent project itself for "This Project" section
    const parentOnly = (tasks as Task[]).filter((t) => t.project_id === project.id);
    groups.push({ project, tasks: collect(parentOnly) });
    for (const sp of subprojects) {
      const list = subTasksByProject[sp.id!] || [];
      groups.push({ project: sp, tasks: collect(list) });
    }
    return groups;
  };

  const getPinnedLinks = () => {
    return links.slice(0, 5); // Show first 5 links as "pinned"
  };

  const tabsDefault = [
    { id: 'overview', label: 'Overview', shortcut: '⌘1' },
    { id: 'tasks', label: 'Tasks', shortcut: '⌘2' },
    { id: 'links', label: 'Links', shortcut: '⌘3' },
    { id: 'notes', label: 'Notes', shortcut: '⌘4' },
    { id: 'milestones', label: 'Milestones', shortcut: '⌘5' },
    { id: 'papers', label: 'Papers', shortcut: '⌘6' },
    { id: 'experiments', label: 'Experiments', shortcut: '⌘7' }
  ] as const;
  const [tabsOrder, setTabsOrder] = useState<string[]>(() => {
    try { const saved = localStorage.getItem('detailTabsOrder'); if (saved) return JSON.parse(saved); } catch {}
    return tabsDefault.map(t => t.id);
  });
  const [reorderTabs, setReorderTabs] = useState(false);
  useEffect(()=> { try { localStorage.setItem('detailTabsOrder', JSON.stringify(tabsOrder)); } catch {} }, [tabsOrder]);
  const moveTab = (id: string, dir: -1 | 1) => {
    setTabsOrder(prev => {
      const idx = prev.indexOf(id); if (idx < 0) return prev; const j = idx + dir; if (j < 0 || j >= prev.length) return prev; const arr = [...prev]; const tmp = arr[idx]; arr[idx] = arr[j]; arr[j] = tmp; return arr;
    });
  };
  const tabs = tabsOrder.map(id => tabsDefault.find(t => t.id === id)!).filter(Boolean) as typeof tabsDefault;

  const handleBack = async () => {
    if (project.parent_id) {
      try {
        const parent = await getProject(project.parent_id);
        if (parent) {
          onOpenProject?.(parent);
          return;
        }
      } catch {}
    }
    onBackToAll?.();
    if (!onBackToAll) window.history.back();
  };

  const addLinkUrl = async () => {
    try {
      const url = window.prompt('Enter URL (https://...)');
      if (!url) return;
      let label = '';
      try {
        const u = new URL(url);
        label = `${u.hostname}${u.pathname !== '/' ? u.pathname : ''}`;
      } catch {
        label = url;
      }
      const maybeLabel = window.prompt('Label (optional):', label);
      const notes = window.prompt('Notes (optional):', '') || '';
      await createLink({ project_id: project.id!, label: maybeLabel || label || url, target: url, kind: 'url', notes });
      await loadProjectData();
    } finally {
      setShowAddLinkMenu(false);
    }
  };

  const addLinkFile = async () => {
    try {
      const selected = await openDialog({ multiple: false, directory: false, title: 'Select File' });
      if (selected && typeof selected === 'string') {
        const base = selected.split(/[/\\\\]/).pop() || selected;
        const notes = window.prompt('Notes (optional):', '') || '';
        await createLink({ project_id: project.id!, label: base, target: selected, kind: 'file', notes });
        await loadProjectData();
      }
    } finally {
      setShowAddLinkMenu(false);
    }
  };

  const addLinkFolder = async () => {
    try {
      const selected = await openDialog({ multiple: false, directory: true, title: 'Select Folder' });
      if (selected && typeof selected === 'string') {
        const base = selected.split(/[/\\\\]/).pop() || selected;
        const notes = window.prompt('Notes (optional):', '') || '';
        await createLink({ project_id: project.id!, label: base, target: selected, kind: 'folder', notes });
        await loadProjectData();
      }
    } finally {
      setShowAddLinkMenu(false);
    }
  };

  return (
    <div className="project-detail">
      <header className="detail-header">
        <button 
          onClick={handleBack} 
          className="back-btn"
          title="Back"
        >
          <ArrowLeft size={20} />
        </button>
        
        <div className="project-info" style={{ display: 'flex', flexDirection: 'column', gap: 6, position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, position: 'relative' }}>
            <button
              className="action-btn"
              title={project.parent_id ? 'Change tint' : 'Change color'}
              onClick={() => setShowColorMenu(v => !v)}
              style={{ width: 14, height: 14, borderRadius: 14, background: project.parent_id && parentProject?.color ? shadeFromTone(parentProject.color, projTint) : projColor, border: '1px solid #d1d5db' }}
            />
            <h1 style={{ margin: 0 }}>{project.name}</h1>
            {pathExists === false && (
              <span title="Primary folder is unavailable" style={{ marginLeft: 8, color: '#b91c1c', fontSize: 12, fontWeight: 600 }}>OFFLINE</span>
            )}
            {showColorMenu && (
              <div className="dropdown-menu" style={{ position: 'absolute', top: 24, left: 0 }} onClick={(e)=>e.stopPropagation()}>
                {!project.parent_id ? (
                  <div style={{ display: 'flex', gap: 6, padding: '8px 10px' }}>
                    {palette.map(hex => (
                      <button key={hex} className="action-btn" onClick={async ()=>{ try { await setProjectPrimaryColor(project.id!, hex, { retint: true }); setProjColor(hex); setShowColorMenu(false); await loadProjectData(); } catch(e){ console.error(e);} }}>
                        <span style={{ width: 16, height: 16, borderRadius: 16, background: hex, display: 'inline-block' }} />
                      </button>
                    ))}
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 6, padding: '8px 10px' }}>
                    {[0,1,2,3,4].map(tone => (
                      <button key={tone} className="action-btn" onClick={async ()=>{ try { await updateProject(project.id!, { tint: tone }); setProjTint(tone); setShowColorMenu(false); await loadProjectData(); } catch(e){ console.error(e);} }}>
                        <span style={{ width: 16, height: 16, borderRadius: 16, background: shadeFromTone(parentProject?.color || '#3b82f6', tone), display: 'inline-block', border: '1px solid #e5e7eb' }} />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          {project.description && <p style={{ margin: 0 }}>{project.description}</p>}
        </div>
        
        <div className="header-actions">
          <button
            onClick={async ()=>{
              try {
                const { save } = await import('@tauri-apps/plugin-dialog');
                const { invoke } = await import('@tauri-apps/api/core');
                const md = `# Project Report: ${project.name}\n\n## Stats\n\n- Total tasks: ${stats.total_tasks}\n- Completed: ${stats.completed_tasks}\n- Overdue: ${stats.overdue_tasks}\n\n## Upcoming (7 days)\n\n${getUpcomingTasks().map(t => `- ${t.title}${t.due_date?` (due ${format(new Date(t.due_date), 'MMM d')})`:''}`).join('\n')}\n\n## Milestones\n\n${milestones.map(m=>`- [${m.status==='done'?'x':' '}] ${m.title}${m.due_date?` (due ${m.due_date})`:''}`).join('\n') || '(none)'}\n\n## Notes (excerpt)\n\n${(notes || '').split(/\r?\n/).slice(0, 20).join('\n')}\n`;
                const path = await save({ title: 'Save Project Report', defaultPath: `${project.name.replace(/[^a-z0-9_-]+/ig, '_')}-report.md` });
                if (typeof path === 'string') await invoke('save_text_file', { path, contents: md });
              } catch(e) { console.error(e); }
            }}
            className="action-btn"
            title="Export Progress Report"
          >
            📄
          </button>
          <button 
            onClick={async () => {
              try {
                if (project.primary_path) {
                  await invoke('open_folder', { path: project.primary_path! });
                } else {
                  const selected = await openDialog({ multiple: false, directory: true, title: 'Select Project Folder' });
                  if (selected && typeof selected === 'string') {
                    await updateProject(project.id!, { primary_path: selected });
                    await loadProjectData();
                  }
                }
              } catch (e) { console.error(e); }
            }}
            className="action-btn"
            title={project.primary_path ? 'Open Folder' : 'Set Folder'}
          >
            <FolderOpen size={18} />
          </button>
          <button 
            onClick={() => onEditProject(project)}
            className="action-btn"
            title="Edit Project"
          >
            <Edit3 size={18} />
          </button>
          <button
            onClick={handleProjectDelete}
            className="action-btn"
            title="Delete Project"
          >
            <Trash2 size={18} />
          </button>
        </div>
      </header>

      <nav className="detail-nav" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id as ProjectTab)}
            className={`nav-tab ${currentTab === tab.id ? 'active' : ''}`}
            title={tab.shortcut}
          >
            {tab.label}
            {reorderTabs && (
              <span style={{ marginLeft: 8, display: 'inline-flex', gap: 4 }}>
                <button type="button" className="action-btn" onClick={(e)=>{ e.stopPropagation(); moveTab(tab.id, -1); }}>◀</button>
                <button type="button" className="action-btn" onClick={(e)=>{ e.stopPropagation(); moveTab(tab.id, 1); }}>▶</button>
              </span>
            )}
          </button>
        ))}
        <button className="btn-secondary" style={{ marginLeft: 'auto' }} title="Rearrange tabs" onClick={()=> setReorderTabs(v => !v)}>{reorderTabs ? 'Done' : 'Rearrange'}</button>
      </nav>

      <div className="detail-content">
        {currentTab === 'overview' && (
          <div className="overview-tab">
            <div className="overview-grid">
              <div className="overview-section">
                <div className="section-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <h3>Subprojects</h3>
                  {!project.parent_id && (
                    <button
                      className="new-task-btn"
                      onClick={() => onEditProject?.({ id: undefined, name: '', description: '', parent_id: project.id } as any)}
                    >
                      <Plus size={16} /> New Subproject
                    </button>
                  )}
                </div>
                <div className="project-tags" style={{ gap: 10 }}>
                  {subprojects.map((sp) => (
                    <div key={sp.id} className="tag" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      {parentProject?.color && (
                        <span style={{ width: 8, height: 8, borderRadius: 8, display: 'inline-block', background: shadeFromTone(parentProject.color, (sp as any).tint ?? 0) }} />
                      )}
                      <button className="linklike" onClick={() => onOpenProject?.(sp)} title="Open subproject" style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                        {sp.name}
                      </button>
                      <button className="action-btn" title={sp.primary_path ? 'Open subproject folder' : 'Set subproject folder'} onClick={async () => {
                        try {
                          if (sp.primary_path) {
                            await invoke('open_folder', { path: sp.primary_path! });
                          } else {
                            const selected = await openDialog({ multiple: false, directory: true, title: 'Select Folder for ' + sp.name });
                            if (selected && typeof selected === 'string') {
                              await updateProject(sp.id!, { primary_path: selected });
                              await loadProjectData();
                            }
                          }
                        } catch(e) { console.error(e); }
                      }}>
                        <FolderOpen size={14} />
                      </button>
                    </div>
                  ))}
                  {subprojects.length === 0 && (
                    <div style={{ color: '#64748b', fontSize: 14 }}>No subprojects</div>
                  )}
                </div>
              </div>
              <div className="overview-section">
                <div className="section-header">
                  <h3>Project Stats</h3>
                </div>
                <div className="stats-grid">
                  <div className="stat-card">
                    <div className="stat-number">{stats.total_tasks}</div>
                    <div className="stat-label">Total Tasks</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-number">{stats.completed_tasks}</div>
                    <div className="stat-label">Completed</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-number">{stats.overdue_tasks}</div>
                    <div className="stat-label">Overdue</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-number">
                      {stats.total_tasks === 0 ? 0 : Math.round((stats.completed_tasks / stats.total_tasks) * 100)}%
                    </div>
                    <div className="stat-label">Progress</div>
                  </div>
                </div>
              </div>

              <div className="overview-section">
                <div className="section-header">
                  <h3>Upcoming Tasks</h3>
                  <button onClick={() => onTabChange('tasks')} className="see-all-btn">
                    See All
                  </button>
                </div>
                <div className="upcoming-tasks" style={{ height: 260, overflowY: 'auto', paddingRight: 6 }}>
                  {(!project.parent_id ? getUpcomingByProject().every(g => g.tasks.length === 0) : getUpcomingTasks().length === 0) ? (
                    <p className="empty-message">No upcoming tasks</p>
                  ) : !project.parent_id ? (
                    // Parent project: show groups by subproject (including parent)
                    getUpcomingByProject().map((group) => (
                      <div key={group.project.id} style={{ marginBottom: 10 }}>
                        <div style={{ fontWeight: 800, fontSize: 18, color: '#111827', marginBottom: 8 }}>
                          <button
                            className="linklike"
                            onClick={() => group.project.id !== project.id ? onOpenProject?.(group.project) : onTabChange('tasks')}
                            title={group.project.id === project.id ? 'View tasks' : 'Open subproject'}
                            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: '#2563eb' }}
                          >
                            {group.project.id === project.id ? 'This Project' : group.project.name}
                          </button>
                        </div>
                        {group.tasks.length === 0 ? (
                          <div style={{ color: '#9ca3af', fontSize: 12 }}>No upcoming</div>
                        ) : (
                          group.tasks.map((task) => (
                            <div key={task.id} className="upcoming-task" onClick={() => onEditTask(task)} style={{ cursor: 'pointer' }}>
                              <button onClick={() => handleTaskToggle(task)} className="task-toggle">
                                <Circle size={16} />
                              </button>
                              <div className="task-info">
                                <span className="task-title">{task.title}</span>
                                {task.due_date && (
                                  <span className="task-due">{format(new Date(task.due_date), 'MMM d')}</span>
                                )}
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    ))
                  ) : (
                    // Subproject: show its own upcoming tasks
                    getUpcomingTasks().map((task) => (
                      <div key={task.id} className="upcoming-task" onClick={() => onEditTask(task)} style={{ cursor: 'pointer' }}>
                        <button onClick={() => handleTaskToggle(task)} className="task-toggle">
                          <Circle size={16} />
                        </button>
                        <div className="task-info">
                          <span className="task-title">{task.title}</span>
                          {task.due_date && (
                            <span className="task-due">{format(new Date(task.due_date), 'MMM d')}</span>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="overview-section">
                <div className="section-header">
                  <h3>Quick Links</h3>
                  <button onClick={() => onTabChange('links')} className="see-all-btn">
                    See All
                  </button>
                </div>
                <div className="pinned-links">
                  {getPinnedLinks().length === 0 ? (
                    <p className="empty-message">No links added</p>
                  ) : (
                    getPinnedLinks().map(link => (
                      <button
                        key={link.id}
                        onClick={() => handleOpenLink(link)}
                        className="pinned-link"
                      >
                        {link.kind === 'url' && <ExternalLink size={16} />}
                        {link.kind === 'file' && <File size={16} />}
                        {link.kind === 'folder' && <Folder size={16} />}
                        <span>{link.label}</span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {currentTab === 'tasks' && (
          <div className="tasks-tab">
            <div className="tasks-header">
              <div className="tasks-filters">
                <select 
                  value={taskFilter} 
                  onChange={(e) => setTaskFilter(e.target.value as 'all' | 'open' | 'done')}
                >
                  <option value="all">All Tasks</option>
                  <option value="open">Open</option>
                  <option value="done">Completed</option>
                </select>
                
                <select 
                  value={taskSort} 
                  onChange={(e) => setTaskSort(e.target.value as 'created' | 'due' | 'priority')}
                >
                  <option value="created">Sort by Created</option>
                  <option value="due">Sort by Due Date</option>
                  <option value="priority">Sort by Priority</option>
                </select>
                {!project.parent_id && (
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 8 }}>
                    <input type="checkbox" checked={includeSubs} onChange={(e)=>{ setIncludeSubs(e.target.checked); setTimeout(() => loadProjectData(), 0); }} />
                    Include subprojects
                  </label>
                )}
              </div>
              
              <button onClick={onNewTask} className="new-task-btn" title="New Task (⌘T)">
                <Plus size={16} />
                New Task
              </button>
            </div>

            <div className="tasks-list">
              {getFilteredTasks().length === 0 ? (
                <div className="empty-state">
                  <CheckCircle2 size={48} />
                  <h3>No tasks found</h3>
                  <p>Create your first task to get started</p>
                </div>
              ) : (
                getFilteredTasks().map(task => (
                  <div key={task.id} className={`task-item ${task.status}`}>
                    <button
                      onClick={() => handleTaskToggle(task)}
                      className="task-checkbox"
                      title="Toggle task completion (Space)"
                    >
                      {task.status === 'done' ? (
                        <CheckCircle2 size={20} className="completed" />
                      ) : (
                        <Circle size={20} />
                      )}
                    </button>

                    <div className="task-content" onClick={() => onEditTask(task)}>
                      <div className="task-main">
                        <h4 className={task.status === 'done' ? 'completed' : ''}>
                          {task.title}
                        </h4>
                        {!project.parent_id && task.project_id !== project.id && (
                          <p className="task-project" style={{ color: '#6b7280', fontSize: 12 }}>
                            in {task.project_name}
                          </p>
                        )}
                        {task.notes && <p className="task-notes">{task.notes}</p>}
                      </div>

                      <div className="task-meta">
                        {task.due_date && (() => {
                          const due = parse(task.due_date!, 'yyyy-MM-dd', new Date());
                          const isOverdue = due < new Date() && task.status === 'open';
                          return (
                            <span className={`task-due ${isOverdue ? 'overdue' : ''}`}>
                              <Calendar size={14} />
                              {format(due, 'MMM d, yyyy')}
                            </span>
                          );
                        })()}
                        
                        <span className={`task-priority priority-${task.priority}`}>
                          P{task.priority}
                        </span>

                        {task.completed_at && (
                          <span className="task-completed">
                            Completed {format(new Date(task.completed_at), 'MMM d')}
                          </span>
                        )}
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <button
                        type="button"
                        className="btn-secondary"
                        title={activeTimer?.taskId === task.id ? 'Timer running' : 'Start 25m Focus'}
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (activeTimer?.taskId === task.id) return;
                          const endsAt = Date.now() + 25 * 60 * 1000;
                          setActiveTimer({ taskId: task.id!, endsAt });
                          const id = task.id!;
                          const interval = setInterval(async () => {
                            const now = Date.now();
                            const at = activeTimer?.taskId === id ? activeTimer!.endsAt : endsAt;
                            if (now >= at) {
                              clearInterval(interval as any);
                              setActiveTimer(null);
                              const inc = (task as any).effort_minutes || 0;
                              await updateTask(id, { effort_minutes: inc + 25 } as any);
                              await loadProjectData();
                            }
                          }, 1000);
                        }}
                      >
                        {activeTimer?.taskId === task.id ? '⏳ Running' : '▶ Focus 25m'}
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); handleTaskDelete(task.id!); }}
                        className="delete-btn"
                        title="Delete task"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {currentTab === 'links' && (
          <div className="links-tab" onDragOver={(e) => e.preventDefault()} onDrop={(e) => e.preventDefault()}>
            <div className="links-header" style={{ position: 'relative' }}>
              <h3>Project Links</h3>
              <button className="new-link-btn" onClick={() => setShowAddLinkMenu((v) => !v)}>
                <Plus size={16} />
                Add Link
              </button>
              {showAddLinkMenu && (
                <div
                  className="dropdown-menu"
                  style={{ position: 'absolute', right: 0, top: 36, zIndex: 10 }}
                >
                  <button onClick={addLinkUrl}>Add URL</button>
                  <button onClick={addLinkFile}>Add File</button>
                  <button onClick={addLinkFolder}>Add Folder</button>
                </div>
              )}
            </div>

            {isDropActive && (
              <div style={{
                margin: '12px 0',
                padding: '16px',
                border: '2px dashed #3b82f6',
                borderRadius: 8,
                background: '#eff6ff',
                color: '#1d4ed8',
                textAlign: 'center',
                fontWeight: 500
              }}>
                Drop files or folders here to add links
              </div>
            )}

            <div className="links-list">
              {links.length === 0 ? (
                <div className="empty-state">
                  <LinkIcon size={48} />
                  <h3>No links added</h3>
                  <p>Add files, folders, or URLs related to this project</p>
                </div>
              ) : (
                links.map(link => (
                  <div key={link.id} className="link-item">
                    <div className="link-icon">
                      {link.kind === 'url' && <ExternalLink size={18} />}
                      {link.kind === 'file' && <File size={18} />}
                      {link.kind === 'folder' && <Folder size={18} />}
                    </div>

                    <div className="link-content">
                      {editingLinkId === link.id ? (
                        <div className="link-main" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          <input
                            type="text"
                            value={editLinkForm.label}
                            onChange={(e) => setEditLinkForm((p) => ({ ...p, label: e.target.value }))}
                            placeholder="Label"
                          />
                          <textarea
                            rows={2}
                            value={editLinkForm.notes}
                            onChange={(e) => setEditLinkForm((p) => ({ ...p, notes: e.target.value }))}
                            placeholder="Notes"
                          />
                          <div style={{ display: 'flex', gap: 8 }}>
                            <button
                              className="btn-primary"
                              onClick={async () => {
                                try {
                                  await updateLink(link.id!, { label: editLinkForm.label, notes: editLinkForm.notes });
                                  setEditingLinkId(null);
                                  await loadProjectData();
                                } catch (e) {
                                  console.error('Failed updating link:', e);
                                }
                              }}
                            >
                              Save
                            </button>
                            <button className="btn-secondary" onClick={() => setEditingLinkId(null)}>Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <div className="link-main">
                          <h4>{link.label} {missingLinkIds.has(link.id!) && (link.kind !== 'url') && (<span style={{ color: '#b91c1c', fontSize: 12, marginLeft: 6 }}>Missing</span>)}</h4>
                          <p className="link-target">{link.target}</p>
                          {link.notes && <p className="link-notes">{link.notes}</p>}
                        </div>
                      )}
                    </div>

                    <div className="link-actions">
                      <button
                        onClick={() => {
                          setEditingLinkId(link.id!);
                          setEditLinkForm({ label: link.label, notes: link.notes || '' });
                        }}
                        className="action-btn"
                        title="Edit"
                      >
                        Edit
                      </button>
                      <button
                        onClick={async () => {
                          // move up
                          const idx = links.findIndex((l) => l.id === link.id);
                          if (idx > 0) {
                            const prev = links[idx - 1];
                            const p1 = prev.position ?? idx; // fallback
                            const p2 = link.position ?? idx + 1;
                            try {
                              await Promise.all([
                                updateLink(prev.id!, { position: p2 }),
                                updateLink(link.id!, { position: p1 }),
                              ]);
                              await loadProjectData();
                            } catch (e) {
                              console.error('Failed to move link up:', e);
                            }
                          }
                        }}
                        className="action-btn"
                        title="Move up"
                      >
                        ↑
                      </button>
                      <button
                        onClick={async () => {
                          // move down
                          const idx = links.findIndex((l) => l.id === link.id);
                          if (idx >= 0 && idx < links.length - 1) {
                            const next = links[idx + 1];
                            const p1 = next.position ?? idx + 2;
                            const p2 = link.position ?? idx + 1;
                            try {
                              await Promise.all([
                                updateLink(next.id!, { position: p2 }),
                                updateLink(link.id!, { position: p1 }),
                              ]);
                              await loadProjectData();
                            } catch (e) {
                              console.error('Failed to move link down:', e);
                            }
                          }
                        }}
                        className="action-btn"
                        title="Move down"
                      >
                        ↓
                      </button>
                      <button
                        onClick={() => handleOpenLink(link)}
                        className="action-btn"
                        title="Open"
                      >
                        <ExternalLink size={14} />
                      </button>
                      
                      <button
                        onClick={() => handleCopyPath(link.target)}
                        className="action-btn"
                        title="Copy path"
                      >
                        <Copy size={14} />
                      </button>

                      <button
                        onClick={() => handleLinkDelete(link.id!)}
                        className="action-btn delete"
                        title="Delete"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
        {currentTab === 'notes' && (
          <div className="notes-tab">
            <div className="section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3>Notes</h3>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn-secondary" onClick={async()=>{ try { await upsertNote(project.id!, notes); } catch(e){ console.error(e);} }}>Save</button>
                <button className="btn-secondary" onClick={async()=>{
                  const lines = notes.split(/\r?\n/);
                  const items = lines.filter(l => /^\s*- \[ \]\s+/.test(l)).map(l => l.replace(/^\s*- \[ \]\s+/, '').trim());
                  for (const title of items) {
                    try { await createTask({ project_id: project.id!, title, priority: 3 } as any); } catch(e) { console.error(e);} 
                  }
                  await loadProjectData();
                }}>Extract Action Items</button>
              </div>
            </div>
            <textarea rows={18} value={notes} onChange={(e)=> setNotes(e.target.value)} placeholder="Write Markdown notes here..." style={{ width: '100%', padding: 12 }} />
          </div>
        )}
        {currentTab === 'milestones' && (
          <div className="milestones-tab">
            <div className="section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3>Milestones</h3>
              <button className="btn-secondary" onClick={async()=>{ const title = prompt('Milestone title'); if (!title) return; const due = prompt('Due date (YYYY-MM-DD, optional)') || undefined; await createMilestone({ project_id: project.id!, title, due_date: due, status: 'pending' }); await loadProjectData(); }}>Add</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {milestones.length === 0 ? (
                <div className="empty-state">No milestones</div>
              ) : (
                milestones.map((m, idx) => (
                  <div key={m.id} className="task-item" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <input type="checkbox" checked={m.status === 'done'} onChange={async(e)=>{ await updateMilestone(m.id!, { status: e.target.checked ? 'done' : 'pending' }); await loadProjectData(); }} />
                      <div>
                        <div style={{ fontWeight: 500 }}>{m.title}</div>
                        <div style={{ color: '#6b7280', fontSize: 12 }}>{m.due_date ? `Due ${format(new Date(m.due_date), 'MMM d, yyyy')}` : 'No due date'}</div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="action-btn" title="Move up" onClick={async()=>{
                        if (idx === 0) return;
                        const prev = milestones[idx-1];
                        const p1 = (prev as any).position ?? (idx);
                        const p2 = (m as any).position ?? (idx+1);
                        try { await Promise.all([updateMilestone(prev.id!, { position: p2 }), updateMilestone(m.id!, { position: p1 })]); await loadProjectData(); } catch(e){ console.error(e);} 
                      }}>↑</button>
                      <button className="action-btn" title="Move down" onClick={async()=>{
                        if (idx >= milestones.length - 1) return;
                        const next = milestones[idx+1];
                        const p1 = (next as any).position ?? (idx+2);
                        const p2 = (m as any).position ?? (idx+1);
                        try { await Promise.all([updateMilestone(next.id!, { position: p2 }), updateMilestone(m.id!, { position: p1 })]); await loadProjectData(); } catch(e){ console.error(e);} 
                      }}>↓</button>
                      <button className="btn-secondary" onClick={async()=>{ const title = prompt('Edit title', m.title) || m.title; const due = prompt('Due date YYYY-MM-DD', m.due_date || '') || m.due_date || undefined; await updateMilestone(m.id!, { title, due_date: due }); await loadProjectData(); }}>Edit</button>
                      <button className="btn-secondary" onClick={async()=>{ if (confirm('Delete milestone?')) { await deleteMilestone(m.id!); await loadProjectData(); } }}>Delete</button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
        {currentTab === 'papers' && (
          <div className="papers-tab">
            <div className="section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3>Papers</h3>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn-secondary" onClick={async()=>{
                  const bib = prompt('Paste BibTeX entry');
                  if (!bib) return;
                  const get = (re: RegExp) => (bib.match(re)?.[1] || '').replace(/[{}]/g,'').trim();
                  const title = get(/title\s*=\s*[{\"]([^}\"]+)/i);
                  const authors = get(/author\s*=\s*[{\"]([^}\"]+)/i);
                  const yearStr = get(/year\s*=\s*[{\"]([^}\"]+)/i);
                  const doi = get(/doi\s*=\s*[{\"]([^}\"]+)/i);
                  const url = get(/url\s*=\s*[{\"]([^}\"]+)/i);
                  await createPaper({ project_id: project.id!, title: title || 'Untitled', authors, year: parseInt(yearStr,10)||undefined, doi, url, status: 'to_read', notes: '' });
                  await loadProjectData();
                }}>Import BibTeX</button>
                <button className="btn-secondary" onClick={async()=>{
                  const title = prompt('Title'); if (!title) return;
                  const authors = prompt('Authors (comma-separated)') || '';
                  const year = parseInt(prompt('Year')||'',10) || undefined;
                  const url = prompt('URL (optional)') || '';
                  await createPaper({ project_id: project.id!, title, authors, year, url, status: 'to_read', notes: '' });
                  await loadProjectData();
                }}>Add Paper</button>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {papers.length === 0 ? (<div className="empty-state">No papers</div>) : papers.map((p, idx) => (
                <div key={p.id} className="task-item" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: 500 }}>{p.title}</div>
                    <div style={{ color: '#6b7280', fontSize: 12 }}>{[p.authors, p.year].filter(Boolean).join(' · ')}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="action-btn" title="Move up" onClick={async()=>{
                      if (idx === 0) return;
                      const prev = papers[idx-1];
                      const p1 = (prev as any).position ?? (idx);
                      const p2 = (p as any).position ?? (idx+1);
                      try { await Promise.all([updatePaper(prev.id!, { position: p2 } as any), updatePaper(p.id!, { position: p1 } as any)]); await loadProjectData(); } catch(e){ console.error(e);} 
                    }}>↑</button>
                    <button className="action-btn" title="Move down" onClick={async()=>{
                      if (idx >= papers.length - 1) return;
                      const next = papers[idx+1];
                      const p1 = (next as any).position ?? (idx+2);
                      const p2 = (p as any).position ?? (idx+1);
                      try { await Promise.all([updatePaper(next.id!, { position: p2 } as any), updatePaper(p.id!, { position: p1 } as any)]); await loadProjectData(); } catch(e){ console.error(e);} 
                    }}>↓</button>
                    <select value={p.status || 'to_read'} onChange={async(e)=>{ await updatePaper(p.id!, { status: e.target.value as any }); await loadProjectData(); }}>
                      <option value="to_read">To Read</option>
                      <option value="reading">Reading</option>
                      <option value="read">Read</option>
                    </select>
                    {p.url && <button className="btn-secondary" onClick={()=> window.open(p.url!, '_blank')}>Open</button>}
                    <button className="btn-secondary" onClick={async()=>{ const title = prompt('Edit title', p.title) || p.title; await updatePaper(p.id!, { title }); await loadProjectData(); }}>Edit</button>
                    <button className="btn-secondary" onClick={async()=>{ if (confirm('Delete paper?')) { await deletePaper(p.id!); await loadProjectData(); } }}>Delete</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {currentTab === 'experiments' && (
          <div className="experiments-tab">
            <div className="section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3>Experiments</h3>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn-secondary" onClick={async()=>{
                  const name = prompt('Experiment name'); if (!name) return;
                  await createExperiment({ project_id: project.id!, name, protocol: '', variables_json: '', outcomes: '', status: 'planned' });
                  await loadProjectData();
                }}>New Experiment</button>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {experiments.length === 0 ? (<div className="empty-state">No experiments</div>) : experiments.map(ex => (
                <div key={ex.id} className="task-item" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <strong>{ex.name}</strong>
                      <select value={ex.status || 'planned'} onChange={async(e)=>{ await updateExperiment(ex.id!, { status: e.target.value as any }); await loadProjectData(); }}>
                        <option value="planned">Planned</option>
                        <option value="running">Running</option>
                        <option value="done">Done</option>
                        <option value="blocked">Blocked</option>
                      </select>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
                      <div>
                        <div style={{ fontWeight: 500, marginBottom: 4 }}>Protocol</div>
                        <textarea rows={6} value={ex.protocol || ''} onChange={async(e)=>{ await updateExperiment(ex.id!, { protocol: e.target.value }); }} style={{ width: '100%' }} />
                      </div>
                      <div>
                        <div style={{ fontWeight: 500, marginBottom: 4 }}>Variables (JSON)</div>
                        <textarea rows={6} value={ex.variables_json || ''} onChange={async(e)=>{ await updateExperiment(ex.id!, { variables_json: e.target.value }); }} style={{ width: '100%' }} />
                      </div>
                      <div style={{ gridColumn: '1 / span 2' }}>
                        <div style={{ fontWeight: 500, marginBottom: 4 }}>Outcomes</div>
                        <textarea rows={4} value={ex.outcomes || ''} onChange={async(e)=>{ await updateExperiment(ex.id!, { outcomes: e.target.value }); }} style={{ width: '100%' }} />
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginLeft: 8 }}>
                    <button className="btn-secondary" onClick={async()=>{
                      const md = `# Experiment: ${ex.name}\n\nStatus: ${ex.status}\n\n## Protocol\n\n${ex.protocol || ''}\n\n## Variables\n\n${ex.variables_json || ''}\n\n## Outcomes\n\n${ex.outcomes || ''}\n`;
                      const { save } = await import('@tauri-apps/plugin-dialog');
                      const { invoke } = await import('@tauri-apps/api/core');
                      const path = await save({ title: 'Save Experiment Report', defaultPath: `${ex.name.replace(/[^a-z0-9_-]+/ig,'_')}.md` });
                      if (typeof path === 'string') await invoke('save_text_file', { path, contents: md });
                    }}>Export Report</button>
                    <button className="btn-secondary" onClick={async()=>{ if (confirm('Delete experiment?')) { await deleteExperiment(ex.id!); await loadProjectData(); } }}>Delete</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
      // check link existence
      try {
        const miss = new Set<number>();
        for (const l of linksData) {
          if (l.kind === 'url') continue;
          try { await invoke('path_kind', { path: l.target }); } catch { miss.add(l.id!); }
        }
        setMissingLinkIds(miss);
      } catch {}
