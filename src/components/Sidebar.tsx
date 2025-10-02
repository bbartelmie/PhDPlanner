import React, { useEffect, useState } from 'react';
import { 
  FolderOpen, 
  Inbox, 
  Calendar, 
  Clock, 
  AlertTriangle, 
  Archive, 
  Tag, 
  Plus 
} from 'lucide-react';
import { ViewType } from '../types';

interface SidebarProps {
  currentView: ViewType;
  onViewChange: (view: ViewType) => void;
  allTags: string[];
  selectedTags: string[];
  onTagSelect: (tag: string) => void;
  onNewProject: () => void;
}

export function Sidebar({ 
  currentView, 
  onViewChange, 
  allTags, 
  selectedTags, 
  onTagSelect,
  onNewProject 
}: SidebarProps) {
  const defaultItems = [
    { id: 'all', label: 'All Projects', icon: FolderOpen },
    { id: 'inbox', label: 'Task Inbox', icon: Inbox },
    { id: 'today', label: 'Today', icon: Calendar },
    { id: 'calendar', label: 'Calendar', icon: Calendar },
    { id: 'next7days', label: 'Next 7 Days', icon: Clock },
    { id: 'overdue', label: 'Overdue', icon: AlertTriangle },
    { id: 'archived', label: 'Archived', icon: Archive },
  ] as const;

  const [reorderMode, setReorderMode] = useState(false);
  const [order, setOrder] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('sidebarOrder');
      if (saved) return JSON.parse(saved);
    } catch {}
    return defaultItems.map(i => i.id);
  });

  useEffect(() => {
    try { localStorage.setItem('sidebarOrder', JSON.stringify(order)); } catch {}
  }, [order]);

  // Presets
  const [presets, setPresets] = useState<Record<string, string[]>>(() => {
    try {
      const raw = localStorage.getItem('sidebarPresets');
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  });
  const [presetName, setPresetName] = useState<string>('');
  const [activePreset, setActivePreset] = useState<string>('');
  const savePresets = (next: Record<string,string[]>) => {
    setPresets(next);
    try { localStorage.setItem('sidebarPresets', JSON.stringify(next)); } catch {}
  };
  const applyPreset = (name: string) => {
    const p = presets[name];
    if (p && Array.isArray(p)) { setOrder(p); setActivePreset(name); }
  };

  const itemsMap = Object.fromEntries(defaultItems.map(i => [i.id, i]));
  const sidebarItems = order
    .map(id => itemsMap[id as keyof typeof itemsMap])
    .filter(Boolean) as typeof defaultItems;

  const move = (id: string, dir: -1 | 1) => {
    setOrder(prev => {
      const idx = prev.indexOf(id);
      if (idx < 0) return prev;
      const j = idx + dir;
      if (j < 0 || j >= prev.length) return prev;
      const copy = [...prev];
      const tmp = copy[idx];
      copy[idx] = copy[j];
      copy[j] = tmp;
      return copy;
    });
  };

  const tagColors = [
    'bg-red-100 text-red-800',
    'bg-blue-100 text-blue-800',
    'bg-green-100 text-green-800',
    'bg-yellow-100 text-yellow-800',
    'bg-purple-100 text-purple-800',
    'bg-pink-100 text-pink-800',
    'bg-indigo-100 text-indigo-800',
    'bg-gray-100 text-gray-800',
  ];

  const getTagColor = (tag: string) => {
    const index = tag.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return tagColors[index % tagColors.length];
  };

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <button
          onClick={onNewProject}
          className="new-project-btn"
          title="New Project (⌘N)"
        >
          <Plus size={16} />
          New Project
        </button>
        <div style={{ marginTop: 8, textAlign: 'right' }}>
          <button
            onClick={() => setReorderMode(v => !v)}
            className="btn-secondary"
            style={{ padding: '6px 10px', fontSize: 12 }}
            title="Rearrange sidebar items"
          >
            {reorderMode ? 'Done' : 'Rearrange'}
          </button>
        </div>
        <div style={{ marginTop: 8 }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <select value={activePreset} onChange={(e)=> applyPreset(e.target.value)} style={{ flex: 1 }}>
              <option value="">Presets…</option>
              {Object.keys(presets).map(name => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
            <button className="btn-secondary" style={{ padding: '6px 8px' }}
              onClick={()=>{
                const name = prompt('Preset name', presetName || 'My preset');
                if (!name) return;
                const next = { ...presets, [name]: order };
                savePresets(next);
                setPresetName(name);
                setActivePreset(name);
              }}
            >Save</button>
            {activePreset && (
              <button className="btn-secondary" style={{ padding: '6px 8px' }} onClick={()=>{
                const { [activePreset]: _, ...rest } = presets;
                savePresets(rest);
                setActivePreset('');
              }}>Delete</button>
            )}
          </div>
        </div>
      </div>

      <nav className="sidebar-nav">
        <div className="nav-section">
          {sidebarItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                onClick={() => onViewChange(item.id as ViewType)}
                className={`nav-item ${currentView === item.id ? 'active' : ''}`}
              >
                <Icon size={18} />
                <span>{item.label}</span>
                {reorderMode && (
                  <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                    <button
                      type="button"
                      className="action-btn"
                      onClick={(e) => { e.stopPropagation(); move(item.id, -1); }}
                      title="Move up"
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      className="action-btn"
                      onClick={(e) => { e.stopPropagation(); move(item.id, 1); }}
                      title="Move down"
                    >
                      ▼
                    </button>
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {allTags.length > 0 && (
          <div className="nav-section">
            <div className="nav-section-header">
              <Tag size={16} />
              <span>Tags</span>
            </div>
            <div className="tags-list">
              {allTags.map((tag) => (
                <button
                  key={tag}
                  onClick={() => onTagSelect(tag)}
                  className={`tag-item ${
                    selectedTags.includes(tag) ? 'selected' : ''
                  }`}
                >
                  <span className={`tag-badge ${getTagColor(tag)}`}>
                    {tag}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </nav>
    </div>
  );
}
