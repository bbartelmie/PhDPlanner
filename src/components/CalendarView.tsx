import React, { useEffect, useMemo, useState } from 'react';
import { addDays, addMonths, endOfMonth, endOfWeek, endOfDay, format, isSameDay, isSameMonth, parseISO, startOfDay, startOfMonth, startOfWeek } from 'date-fns';
import { TaskWithProject, Project } from '../types';
import { getTasksInRange, updateTask } from '../lib/database';
import { CheckCircle2, Circle } from 'lucide-react';
import { save } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';

interface CalendarViewProps {
  onProjectSelect: (project: Project) => void;
  projects: Project[];
  onTaskEdit: (task: TaskWithProject) => void;
  onCreateTaskAt?: (opts: { date: string; time?: string }) => void;
}

type ViewMode = 'month' | 'week' | 'day';

export function CalendarView({ onProjectSelect, projects, onTaskEdit, onCreateTaskAt }: CalendarViewProps) {
  const [viewMode, setViewMode] = useState<ViewMode>(() => (localStorage.getItem('calendar:viewMode') as ViewMode) || 'month');
  const [currentDate, setCurrentDate] = useState<Date>(() => {
    const saved = localStorage.getItem('calendar:currentDate');
    return saved ? new Date(saved) : new Date();
  });
  useEffect(() => { try { localStorage.setItem('calendar:viewMode', viewMode); } catch {} }, [viewMode]);
  useEffect(() => { try { localStorage.setItem('calendar:currentDate', currentDate.toISOString()); } catch {} }, [currentDate]);

  const range = useMemo(() => {
    let start: Date; let end: Date;
    if (viewMode === 'month') { start = startOfWeek(startOfMonth(currentDate), { weekStartsOn: 0 }); end = endOfWeek(endOfMonth(currentDate), { weekStartsOn: 0 }); }
    else if (viewMode === 'week') { start = startOfWeek(currentDate, { weekStartsOn: 0 }); end = endOfWeek(currentDate, { weekStartsOn: 0 }); }
    else { start = startOfDay(currentDate); end = endOfDay(currentDate); }
    return { start, end };
  }, [currentDate, viewMode]);

  const [tasks, setTasks] = useState<TaskWithProject[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => { (async () => { setLoading(true); try { const s=format(range.start,'yyyy-MM-dd'); const e=format(range.end,'yyyy-MM-dd'); setTasks(await getTasksInRange(s,e,{ includeDone:true })); } finally { setLoading(false);} })(); }, [range.start, range.end]);

  const days: Date[] = useMemo(() => { const list: Date[] = []; let d=range.start; while (d<=range.end) { list.push(d); d=addDays(d,1);} return list; }, [range.start, range.end]);

  // Indexes for rendering
  const tasksByDay = useMemo(() => { const m = new Map<string, TaskWithProject[]>(); for (const t of tasks) { if (!t.due_date) continue; const k=t.due_date; if (!m.has(k)) m.set(k, []); m.get(k)!.push(t);} return m; }, [tasks]);
  const tasksByDayHour = useMemo(() => { const m = new Map<string, Map<number, TaskWithProject[]>>(); for (const t of tasks) { if (!t.due_date) continue; const k=t.due_date; if (!m.has(k)) m.set(k,new Map()); const inner=m.get(k)!; const hourStr=(t.start_time || t.due_time)||''; const h = hourStr ? parseInt(hourStr.slice(0,2),10) : -1; if (!inner.has(h)) inner.set(h,[]); inner.get(h)!.push(t);} return m; }, [tasks]);
  const hours = useMemo(()=> Array.from({length:24},(_,i)=>i), []);

  // Formatting helpers
  const shadeFromTone = (hex?: string, tone?: number) => { const h=(hex||'#64748b').replace('#',''); const f=h.length===3?h.split('').map(c=>c+c).join(''):h; let r=parseInt(f.substring(0,2),16), g=parseInt(f.substring(2,4),16), b=parseInt(f.substring(4,6),16); const ratios=[0.85,0.8,0.7,0.6,0.5]; const ratio=ratios[Math.min(Math.max(tone??0,0),4)]; r=Math.round(255-(255-r)*ratio); g=Math.round(255-(255-g)*ratio); b=Math.round(255-(255-b)*ratio); return `rgb(${r},${g},${b})`; };

  // Outlook-style drag overlay
  const [isDragging, setIsDragging] = useState(false);
  const [dragTask, setDragTask] = useState<TaskWithProject|null>(null);
  const [pointer, setPointer] = useState<{x:number;y:number}>({x:0,y:0});
  const [target, setTarget] = useState<{date:string; hour?:number; minutes?:number} | null>(null);
  const [hl, setHl] = useState<{left:number;top:number;width:number;height:number} | null>(null);

  const locate = (x:number,y:number) => {
    const el = document.elementFromPoint(x,y) as HTMLElement|null; if(!el) return;
    const cell = el.closest('[data-cell]') as HTMLElement|null; if(!cell) return;
    const date = cell.getAttribute('data-date')||''; const hrAttr = cell.getAttribute('data-hour'); const hour = hrAttr!=null? parseInt(hrAttr,10): undefined;
    const r = cell.getBoundingClientRect();
    // 15-minute snapping when an hour cell is targeted
    let minutes: number | undefined = undefined;
    let top = r.top; let height = r.height;
    if (hour !== undefined && hour >= 0) {
      const relY = Math.min(Math.max(y - r.top, 0), r.height - 0.01);
      const q = Math.floor((relY / r.height) * 4); // 0..3
      minutes = q * 15;
      top = r.top + (r.height / 4) * q;
      height = r.height / 4;
    }
    if(date) setTarget({ date, hour, minutes });
    setHl({ left:r.left, top, width:r.width, height });
  };

  useEffect(()=>{
    if(!isDragging) return;
    const onMove=(e:MouseEvent)=>{ setPointer({x:e.clientX,y:e.clientY}); locate(e.clientX,e.clientY); };
    const onUp= async ()=>{
      setIsDragging(false); const t=target; const dt=dragTask; setTarget(null); setHl(null); setDragTask(null); if(!t||!dt) return;
      const st = t.hour===undefined||t.hour<0 ? null : `${String(t.hour).padStart(2,'0')}:${String(t.minutes??0).padStart(2,'0')}`;
      setTasks(prev=> prev.map(x=> x.id===dt.id ? { ...x, due_date:t.date, start_time:st, end_time:st } as any : x));
      try { if(st===null) await updateTask(dt.id!, { due_date:t.date, start_time:null as any, end_time:null as any }); else await updateTask(dt.id!, { due_date:t.date, start_time:st, end_time:st }); }
      finally { const s=format(range.start,'yyyy-MM-dd'); const e=format(range.end,'yyyy-MM-dd'); setTasks(await getTasksInRange(s,e,{includeDone:true})); }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    document.body.style.userSelect='none';
    return ()=>{ window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); document.body.style.userSelect=''; };
  },[isDragging, dragTask, target, range.start, range.end]);

  const titleLabel = useMemo(()=> viewMode==='week'? `${format(startOfWeek(currentDate),'MMM d')} – ${format(endOfWeek(currentDate),'MMM d, yyyy')}` : viewMode==='day'? format(currentDate,'EEEE, MMM d, yyyy') : format(currentDate,'MMMM yyyy'), [currentDate, viewMode]);

  const toggleTask = async (t:TaskWithProject)=>{ await updateTask(t.id!, { status: t.status==='done'?'open':'done' }); const s=format(range.start,'yyyy-MM-dd'); const e=format(range.end,'yyyy-MM-dd'); setTasks(await getTasksInRange(s,e,{includeDone:true})); };

  const toIcsDate=(s:string)=> s.replaceAll('-',''); const toIcsDateTime=(d:string,t:string)=>`${d.replaceAll('-','')}T${t.replace(':','')}00`;
  const generateIcs=(items:TaskWithProject[])=>{ const L:string[]=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//PhD Project Manager//EN']; for(const t of items){ if(!t.due_date) continue; const uid=`task-${t.id||Math.random().toString(36).slice(2)}@phd-pm`; const now=format(new Date(),'yyyyMMdd\'T\'HHmmss'); L.push('BEGIN:VEVENT',`UID:${uid}`,`DTSTAMP:${now}`,`SUMMARY:${(t.title||'').replace(/\r?\n/g,' ')}`); if(t.notes){L.push(`DESCRIPTION:${t.notes.replace(/\r?\n/g,'\\n')}`);} if(t.start_time){ const e=t.end_time||t.start_time; L.push(`DTSTART:${toIcsDateTime(t.due_date,t.start_time.slice(0,5))}`,`DTEND:${toIcsDateTime(t.due_date,e.slice(0,5))}`);} else { L.push(`DTSTART;VALUE=DATE:${toIcsDate(t.due_date)}`); const next=format(addDays(parseISO(t.due_date),1),'yyyyMMdd'); L.push(`DTEND;VALUE=DATE:${next}`);} if(t.project_name) L.push(`CATEGORIES:${t.project_name}`); L.push('END:VEVENT'); } L.push('END:VCALENDAR'); return L.join('\n'); };

  return (
    <div style={{ padding:20, display:'flex', flexDirection:'column', height:'100%', overflow:'hidden' }}>
      <div style={{ display:'flex', alignItems:'center', marginBottom:12, gap:8 }}>
        <button className="btn-secondary" onClick={()=>{ if(viewMode==='month') setCurrentDate(startOfMonth(addMonths(currentDate,-1))); else if(viewMode==='week') setCurrentDate(addDays(currentDate,-7)); else setCurrentDate(addDays(currentDate,-1)); }}>◀</button>
        <button className="btn-secondary" onClick={()=>{ if(viewMode==='month') setCurrentDate(startOfMonth(addMonths(currentDate,1))); else if(viewMode==='week') setCurrentDate(addDays(currentDate,7)); else setCurrentDate(addDays(currentDate,1)); }}>▶</button>
        <button className="btn-secondary" onClick={()=> setCurrentDate(viewMode==='month'? startOfMonth(new Date()) : new Date())}>Today</button>
        <h2 style={{ marginLeft:8 }}>{titleLabel}</h2>
        <div style={{ marginLeft:'auto', display:'flex', gap:6 }}>
          <button className="btn-secondary" onClick={()=>{ setViewMode('month'); setCurrentDate(startOfMonth(new Date())); }} style={{ background:viewMode==='month'? '#e5e7eb':undefined }}>Month</button>
          <button className="btn-secondary" onClick={()=>{ setViewMode('week'); setCurrentDate(new Date()); }} style={{ background:viewMode==='week'? '#e5e7eb':undefined }}>Week</button>
          <button className="btn-secondary" onClick={()=>{ setViewMode('day'); setCurrentDate(new Date()); }} style={{ background:viewMode==='day'? '#e5e7eb':undefined }}>Day</button>
          <button className="btn-secondary" onClick={async()=>{ try { const ics=generateIcs(tasks); const path=await save({ title:'Export calendar as .ics', defaultPath:`phd-calendar-${format(range.start,'yyyyMMdd')}-${format(range.end,'yyyyMMdd')}.ics`}); if(typeof path==='string'&&path.length>0){ await invoke('save_text_file',{path,contents:ics}); } } catch(e){ console.warn('ICS export cancelled or failed:', e);} }}>Export .ics</button>
        </div>
        {loading && <span style={{ marginLeft:8, color:'#6b7280' }}>(loading…)</span>}
      </div>

      {viewMode==='month' ? (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', gap:8, overflow:'auto' }}>
          {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(w=> (<div key={w} style={{ fontWeight:600, color:'#64748b', padding:'4px 6px' }}>{w}</div>))}
          {days.map(day=>{ const key=format(day,'yyyy-MM-dd'); const list=tasksByDay.get(key)||[]; const outside=!isSameMonth(day,currentDate); const isToday=isSameDay(day,new Date());
            return (
              <div key={key} data-cell data-date={key} style={{ border:'1px solid #e5e7eb', borderRadius:8, padding:8, background:isToday?'#eef2ff':'#fff', opacity:outside?0.6:1, minHeight:110, display:'flex', flexDirection:'column', boxShadow:'inset 0 -1px #eaeef3, inset -1px 0 #eaeef3', backgroundImage:'repeating-linear-gradient(to bottom, transparent 0, transparent 27px, #f3f4f6 28px)' }}>
                <div style={{ fontSize:12, color:'#374151', marginBottom:6 }}>{format(day,'d')}</div>
                <div style={{ display:'flex', flexDirection:'column', gap:6, overflow:'auto' }}>
                  {list.length===0? (<div style={{ color:'#9ca3af', fontSize:12 }}>No tasks</div>) : list.slice(0,5).map(t=> (
                    <div key={t.id} style={{ display:'flex', alignItems:'center', gap:8, cursor:'grab' }} onMouseDown={(e)=>{ e.preventDefault(); setIsDragging(true); setDragTask(t); setPointer({x:e.clientX,y:e.clientY}); locate(e.clientX,e.clientY); }}>
                      <button onClick={()=> toggleTask(t)} className="task-checkbox" title="Toggle completion" style={{ background:'none', border:'none', cursor:'pointer' }}>{t.status==='done'? <CheckCircle2 size={16} className="completed"/> : <Circle size={16}/>}</button>
                      <span style={{ width:8,height:8,borderRadius:8, background:t.project_color||'#3b82f6' }} />
                      <span style={{ fontSize:12, cursor:'pointer', fontWeight:500, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', flex:'1 1 auto', minWidth:0 }} onClick={()=> onTaskEdit(t)}>{t.title}</span>
                      <span style={{ color:'#6b7280', fontSize:12, cursor:'pointer', marginLeft:6, textDecoration:'underline' }} onClick={()=>{ const proj=projects.find(p=>p.id===t.project_id); if(proj) onProjectSelect(proj); }}>· {t.project_name}</span>
                    </div>
                  ))}
                </div>
              </div>
            );})}
        </div>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', overflow:'auto' }}>
          <div style={{ display:'grid', gridTemplateColumns:viewMode==='day'?'80px 1fr':'80px repeat(7,1fr)', gap:0, marginBottom:6 }}>
            <div />
            {days.map(d=> (<div key={d.toISOString()} style={{ fontWeight:600, color:'#64748b', padding:'4px 6px' }}>{format(d,'EEE, MMM d')}</div>))}
          </div>
          <div style={{ display:'grid', gridTemplateColumns:viewMode==='day'?'80px 1fr':'80px repeat(7,1fr)', gap:0, padding:'6px 0', borderTop:'1px solid #e5e7eb', borderBottom:'1px solid #e5e7eb', background:'#fafafa' }}>
            <div style={{ fontSize:12, color:'#374151', paddingLeft:6 }}>All-day</div>
            {days.map((day,di)=>{ const key=format(day,'yyyy-MM-dd'); const list=(tasksByDayHour.get(key)||new Map()).get(-1)||[]; return (
              <div key={key} data-cell data-date={key} data-hour={-1} style={{ minHeight:28, display:'flex', flexDirection:'column', gap:4, borderRight:'1px solid #e5e7eb', background: di%2===1?'#fafafa':undefined }}>
                {list.map(t=> (
                  <div key={t.id} style={{ fontSize:12, background:shadeFromTone(t.project_color,(t as any).project_tint ?? t.color_tone), border:`1px solid ${shadeFromTone(t.project_color,(t as any).project_tint ?? t.color_tone)}`, borderRadius:6, padding:'2px 6px', display:'flex', gap:6, alignItems:'center', cursor:'grab' }} onMouseDown={(e)=>{ e.preventDefault(); setIsDragging(true); setDragTask(t); setPointer({x:e.clientX,y:e.clientY}); locate(e.clientX,e.clientY); }}>
                    <span style={{ width:8,height:8,borderRadius:8, background:t.project_color||'#3b82f6' }} />
                    <span style={{ cursor:'pointer', fontWeight:500, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', flex:'1 1 auto', minWidth:0 }} onClick={()=> onTaskEdit(t)}>{t.title}</span>
                  </div>
                ))}
              </div>
            );})}
          </div>
          {Array.from({length:24},(_,i)=>i).map(h=> (
            <div key={h} style={{ display:'grid', gridTemplateColumns:viewMode==='day'?'80px 1fr':'80px repeat(7,1fr)', gap:0, alignItems:'flex-start', padding:'4px 0', borderBottom:'1px solid #e5e7eb' }}>
              <div style={{ fontSize:12, color:'#6b7280', paddingLeft:6 }}>{String(h).padStart(2,'0')}:00</div>
              {days.map((day,di)=>{ const key=format(day,'yyyy-MM-dd'); const list=(tasksByDayHour.get(key)||new Map()).get(h)||[]; return (
                <div key={`${key}-${h}`} data-cell data-date={key} data-hour={h}
                  style={{ position:'relative', height:56, borderRight:'1px solid #e5e7eb', background: di%2===1?'#fafafa':undefined }}>
                  {list.map((t, idx)=> { const m = parseInt(((t.start_time||t.due_time)||'00:00').slice(3,5),10) || 0; const topPct = Math.max(0, Math.min(59, m))/60*100; return (
                    <div key={t.id}
                      style={{ position:'absolute', left:6, right:6, top:`${topPct}%`, height:18, background:shadeFromTone(t.project_color,(t as any).project_tint ?? t.color_tone), border:`1px solid ${shadeFromTone(t.project_color,(t as any).project_tint ?? t.color_tone)}`, borderRadius:6, padding:'0 6px', display:'flex', alignItems:'center', gap:6, cursor:'grab' }}
                      onMouseDown={(e)=>{ e.preventDefault(); setIsDragging(true); setDragTask(t); setPointer({x:e.clientX,y:e.clientY}); locate(e.clientX,e.clientY); }}
                    >
                      <span style={{ fontSize:10, color:'#0f172a', opacity:0.8, flex:'0 0 auto' }}>{(t.start_time||'00:00').slice(0,5)}</span>
                      <span style={{ cursor:'pointer', fontWeight:500, fontSize:12, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', flex:'1 1 auto', minWidth:0 }} onClick={()=> onTaskEdit(t)}>{t.title}</span>
                    </div>
                  );})}
                </div>
              );})}
            </div>
          ))}
        </div>
      )}

      {hl && (
        <div style={{ position:'fixed', left:hl.left, top:hl.top, width:hl.width, height:hl.height, border:'2px solid #3b82f6', borderRadius:6, pointerEvents:'none', zIndex:60 }} />
      )}
      {isDragging && dragTask && (
        <div style={{ position:'fixed', left:pointer.x+10, top:pointer.y+10, pointerEvents:'none', zIndex:70, background:'#0ea5e9', color:'#fff', padding:'4px 8px', borderRadius:6, boxShadow:'0 2px 8px rgba(0,0,0,0.2)', fontSize:12 }}>{dragTask.title}</div>
      )}
    </div>
  );
}
