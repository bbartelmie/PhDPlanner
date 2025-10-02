import React, { useEffect, useMemo, useState } from "react";
import "./App.css";
import type { ViewType, Project, Task, ProjectTab } from "./types";
import { initDatabase, getProjects, exportAllData, importAllData } from "./lib/database";
import { Sidebar } from "./components/Sidebar";
import { SearchBar } from "./components/SearchBar";
import { ProjectList } from "./components/ProjectList";
import { ProjectDetail } from "./components/ProjectDetail";
import { ProjectModal, TaskModal, QuickTaskModal } from "./components/ModalComponents";
import { CalendarView } from "./components/CalendarView";
import { check } from "@tauri-apps/plugin-updater";
import { register, unregisterAll } from "@tauri-apps/plugin-global-shortcut";
import { save, open as openDialog } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";

function App() {
  const [dbReady, setDbReady] = useState<"idle" | "ok" | "error">("idle");
  const [dbError, setDbError] = useState<string | null>(null);

  const [projects, setProjects] = useState<Project[]>([]);
  const [currentView, setCurrentView] = useState<ViewType>("all");
  const [allTags, setAllTags] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [currentTab, setCurrentTab] = useState<ProjectTab>("overview");
  const [searchQuery, setSearchQuery] = useState("");

  // Modals
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [taskProjectId, setTaskProjectId] = useState<number | null>(null);
  const [showQuickTaskModal, setShowQuickTaskModal] = useState(false);
  const [quickInitial, setQuickInitial] = useState<Partial<Task> | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [showDataMenu, setShowDataMenu] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        setDbReady("idle");
        await initDatabase();
        setDbReady("ok");
        await refreshProjects();
        // Register global shortcut for Quick Task (works when app unfocused)
        try {
          await unregisterAll();
          await register('CommandOrControl+Shift+T', () => {
            setShowQuickTaskModal(true);
          });
        } catch (e) {
          console.warn('[GlobalShortcut] registration failed:', e);
        }
      } catch (e: any) {
        console.error("[App] DB init failed:", e);
        setDbReady("error");
        setDbError(String(e?.message ?? e));
      }
    })();
    return () => { try { unregisterAll(); } catch {} };
  }, []);

  const handleCheckUpdates = async () => {
    try {
      const update = await check();
      if (update?.available) {
        const ok = window.confirm(
          `Update ${update.version} available.\n\n` +
          "Download and install now? The app will restart."
        );
        if (ok) {
          await update.downloadAndInstall();
          // Updater will relaunch the app automatically.
        }
      } else {
        alert("You are up to date.");
      }
    } catch (e) {
      alert("Update check failed. See console for details.");
      console.warn("[Updater] Check failed:", e);
    }
  };

  const refreshProjects = async () => {
    const rows = await getProjects(true);
    setProjects(rows);
    const tags = new Set<string>();
    rows.forEach((p) => {
      if (p.tags) {
        p.tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean)
          .forEach((t) => tags.add(t));
      }
    });
    setAllTags(Array.from(tags).sort());
  };

  const handleViewChange = (view: ViewType) => {
    setCurrentView(view);
    setSelectedProjectId(null);
  };

  const handleTagSelect = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const visibleProjects = useMemo(() => {
    let list = [...projects];
    if (selectedTags.length > 0) {
      list = list.filter((p) => {
        const ptags = (p.tags || "")
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean);
        return selectedTags.every((t) => ptags.includes(t));
      });
    }
    switch (currentView) {
      case "archived":
        return list.filter((p) => Number(p.archived) === 1);
      default:
        return list.filter((p) => Number(p.archived) !== 1);
    }
  }, [projects, selectedTags, currentView]);

  const selectedProject = useMemo(
    () => visibleProjects.find((p) => p.id === selectedProjectId) || null,
    [visibleProjects, selectedProjectId]
  );

  // Project/Task modals
  const handleNewProject = () => {
    setEditingProject(null);
    setShowProjectModal(true);
  };
  const handleEditProject = (project: Project) => {
    setEditingProject(project);
    setShowProjectModal(true);
  };
  const handleNewTask = (projectId?: number) => {
    const pid = projectId ?? selectedProjectId;
    if (!pid) return;
    setEditingTask(null);
    setTaskProjectId(pid);
    setShowTaskModal(true);
  };
  const handleEditTask = (task: Task) => {
    setEditingTask(task);
    setTaskProjectId(task.project_id);
    setShowTaskModal(true);
  };

  // Keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;
      if (e.key.toLowerCase() === "n") {
        e.preventDefault();
        handleNewProject();
      }
      if (e.key.toLowerCase() === "t" && !e.shiftKey) {
        e.preventDefault();
        handleNewTask();
      }
      if (e.key.toLowerCase() === "t" && e.shiftKey) {
        e.preventDefault();
        setShowQuickTaskModal(true);
      }
      if (e.key.toLowerCase() === "f") {
        e.preventDefault();
        const el = document.querySelector<HTMLInputElement>(".search-input");
        el?.focus();
      }
      if (["1", "2", "3", "4", "5", "6", "7"].includes(e.key) && selectedProject) {
        e.preventDefault();
        const map: Record<string, ProjectTab> = { "1": "overview", "2": "tasks", "3": "links", "4": "notes", "5": "milestones", "6": "papers", "7": "experiments" } as const;
        setCurrentTab(map[e.key]);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedProjectId, selectedProject]);

  return (
    <div className="app">
      <header className="app-header" style={{ gap: 12, display: 'flex' }}>
        <h1 style={{ fontSize: 18, marginRight: 12 }}>PhD Project Manager</h1>
        <SearchBar value={searchQuery} onChange={setSearchQuery} placeholder="Search projects..." />
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ position: 'relative' }}>
            <button className="btn-secondary" onClick={() => setShowDataMenu(v=>!v)} title="Export/Import/Backup">Data ▾</button>
            {showDataMenu && (
              <div className="dropdown-menu" style={{ position: 'absolute', right: 0, top: 32 }}>
                <button onClick={async()=>{
                  try {
                    const data = await exportAllData();
                    const json = JSON.stringify(data, null, 2);
                    const path = await save({ title: 'Export data', defaultPath: `phd-projects-export-${new Date().toISOString().slice(0,10)}.json` });
                    if (typeof path === 'string') await invoke('save_text_file', { path, contents: json });
                  } catch(e) { console.warn('Export failed:', e);} finally { setShowDataMenu(false);} 
                }}>Export JSON</button>
                <button onClick={async()=>{
                  try {
                    const sel = await openDialog({ multiple: false, directory: false, title: 'Import JSON' });
                    if (typeof sel === 'string') {
                      const content = await invoke<string>('read_text_file', { path: sel });
                      const data = JSON.parse(content);
                      if (window.confirm('Import data into current database? This may create duplicates.')) {
                        await importAllData(data);
                        await refreshProjects();
                      }
                    }
                  } catch(e) { console.warn('Import failed:', e);} finally { setShowDataMenu(false);} 
                }}>Import JSON</button>
                <button onClick={async()=>{
                  try {
                    const data = await exportAllData();
                    const json = JSON.stringify(data);
                    const path = await save({ title: 'Backup now', defaultPath: `phd-projects-backup-${new Date().toISOString().replace(/[:.]/g,'-')}.json` });
                    if (typeof path === 'string') await invoke('save_text_file', { path, contents: json });
                  } catch(e) { console.warn('Backup failed:', e);} finally { setShowDataMenu(false);} 
                }}>Backup Now</button>
              </div>
            )}
          </div>
          <button className="btn-secondary" onClick={handleCheckUpdates}>Check for Updates</button>
          <div style={{ fontSize: 14, color: '#374151' }}>
            <strong>DB:</strong> {dbReady === 'ok' ? '✅' : dbReady === 'idle' ? '…' : '❌'}
          </div>
        </div>
      </header>

      {dbError && (
        <div style={{ padding: 12 }}>
          <pre
            style={{
              marginTop: 8,
              background: "#fff7ed",
              border: "1px solid #fed7aa",
              padding: 8,
              borderRadius: 8,
              color: "#7c2d12",
              whiteSpace: "pre-wrap",
            }}
          >
            {dbError}
          </pre>
        </div>
      )}

      <div className="app-body">
        <Sidebar
          currentView={currentView}
          onViewChange={(v) => {
            setSelectedProjectId(null);
            setCurrentView(v);
          }}
          allTags={allTags}
          selectedTags={selectedTags}
          onTagSelect={handleTagSelect}
          onNewProject={handleNewProject}
        />

        <main className="main-content">
          {currentView === 'calendar' ? (
            <CalendarView
              projects={projects}
              onProjectSelect={(p) => {
                setSelectedProjectId(p.id!);
                setCurrentTab('overview');
                setCurrentView(Number(p.archived) === 1 ? 'archived' : 'all');
              }}
              onTaskEdit={(task) => {
                setEditingTask(task);
                setTaskProjectId(task.project_id);
                setShowTaskModal(true);
              }}
              onCreateTaskAt={({ date, time }) => {
                setQuickInitial({ due_date: date, start_time: time, end_time: time });
                setShowQuickTaskModal(true);
              }}
            />
          ) : currentView === 'inbox' || currentView === 'today' || currentView === 'next7days' || currentView === 'overdue' ? (
            <ProjectList
              projects={projects}
              currentView={currentView}
              searchQuery={searchQuery}
              selectedTags={selectedTags}
              onProjectSelect={(p) => {
                setSelectedProjectId(p.id!);
                setCurrentTab('overview');
                // Switch to Projects or Archived view based on project
                setCurrentView(Number(p.archived) === 1 ? 'archived' : 'all');
              }}
              onProjectEdit={handleEditProject}
              onRefresh={refreshProjects}
            />
          ) : selectedProject ? (
            <ProjectDetail
              project={selectedProject}
              refreshTick={refreshTick}
              currentTab={currentTab}
              onTabChange={setCurrentTab}
              onEditProject={handleEditProject}
              onNewTask={() => handleNewTask(selectedProject.id!)}
              onEditTask={handleEditTask}
              onProjectDeleted={async () => {
                setSelectedProjectId(null);
                await refreshProjects();
                setCurrentView('all');
              }}
              onOpenProject={(p) => {
                setSelectedProjectId(p.id!);
                setCurrentView(Number(p.archived) === 1 ? 'archived' : 'all');
                setCurrentTab('overview');
              }}
              onBackToAll={() => {
                setSelectedProjectId(null);
                setCurrentView('all');
                setCurrentTab('overview');
              }}
            />
          ) : (
            <ProjectList
              projects={visibleProjects}
              currentView={currentView}
              searchQuery={searchQuery}
              selectedTags={selectedTags}
              onProjectSelect={(p) => {
                setSelectedProjectId(p.id!);
                setCurrentTab('overview');
              }}
              onProjectEdit={handleEditProject}
              onRefresh={refreshProjects}
            />
          )}
        </main>
      </div>

      {showProjectModal && (
        <ProjectModal
          project={editingProject}
          onSave={async () => {
            setShowProjectModal(false);
            setEditingProject(null);
            await refreshProjects();
            setRefreshTick((t) => t + 1);
          }}
          onCancel={() => {
            setShowProjectModal(false);
            setEditingProject(null);
          }}
          parentId={(editingProject as any)?.parent_id ?? null}
        />
      )}

      {showTaskModal && taskProjectId && (
        <TaskModal
          task={editingTask}
          projectId={taskProjectId}
          onSave={async () => {
            setShowTaskModal(false);
            setEditingTask(null);
            await refreshProjects();
            setRefreshTick((t) => t + 1);
          }}
          onCancel={() => {
            setShowTaskModal(false);
            setEditingTask(null);
          }}
        />
      )}

      {showQuickTaskModal && (
        <QuickTaskModal
          projects={projects}
          initial={quickInitial || undefined}
          onSave={async () => {
            setShowQuickTaskModal(false);
            setQuickInitial(null);
            await refreshProjects();
            setRefreshTick((t) => t + 1);
          }}
          onCancel={() => { setShowQuickTaskModal(false); setQuickInitial(null); }}
        />
      )}
    </div>
  );
}

export default App;
