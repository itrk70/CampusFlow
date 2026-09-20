/* =========================================================
   CampusFlow — app logic
   Everything lives in localStorage. No login, no backend.
   ========================================================= */

const STORE_KEY = 'campusflow.v1';
const DAY_LABELS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const DAY_LETTERS = ['Su','M','T','W','Th','F','S'];

if(window.pdfjsLib){
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// ---------- default state ----------
function defaultState(){
  return {
    name: '',
    fullName: '',
    profilePicture: null,   // data URL (jpeg), pre-cropped to 1:1
    idCard: null,            // { pdfBase64, coords: { front:{x,y,w,h}, back:{x,y,w,h} } } — percentages of page
    regularClasses: [],   // {id, subject, professor, building, room, days:[0-6], start:"HH:MM", end:"HH:MM"}
    extraSessions: [],    // {id, subject, professor, building, room, date:"YYYY-MM-DD", start, end}
    works: [],             // {id, subject, type:'assignment'|'lab', dueDate:'YYYY-MM-DD', completed:bool}
    completed: {},        // key `${classId}__${YYYY-MM-DD}` -> true
    settings: {
      notifications: false,
      vibration: false,
      sound: 'Default',
      darkMode: false,
      defaultTab: 'dashboard'
    },
    notifiedKeys: {}      // key -> true, to avoid duplicate 15-min alerts
  };
}

let state = loadState();

function loadState(){
  try{
    const raw = localStorage.getItem(STORE_KEY);
    if(!raw) return defaultState();
    const parsed = JSON.parse(raw);
    return { ...defaultState(), ...parsed, settings: { ...defaultState().settings, ...(parsed.settings||{}) } };
  }catch(e){
    console.error('CampusFlow: failed to load state, resetting.', e);
    return defaultState();
  }
}

function saveState(){
  try{
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
    updateStorageUsedLabel();
  }catch(e){
    console.error('CampusFlow: failed to save state', e);
    showToast("Couldn't save — storage may be full");
  }
}

function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,7); }

function pad(n){ return String(n).padStart(2,'0'); }
function todayISO(d = new Date()){ return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function timeToMinutes(t){ const [h,m] = t.split(':').map(Number); return h*60+m; }
function minutesNowInDay(d = new Date()){ return d.getHours()*60 + d.getMinutes(); }
function formatTime12(t){
  let [h,m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12; if(h === 0) h = 12;
  return `${h}:${pad(m)} ${ampm}`;
}
function formatDateLong(dateObj){
  return dateObj.toLocaleDateString(undefined, { weekday:'long', month:'long', day:'numeric' });
}
function escapeHtml(str){
  if(!str) return '';
  return str.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}
function escapeAttr(str){ return (str||'').replace(/"/g,'&quot;'); }

// ---------- viewing-day state (Today's Classes can page across days via week ribbon) ----------
let viewingDate = new Date(); // the date currently shown in "Today's Classes"

// =========================================================
// INSTANCE BUILDING — merge regular + extra into day instances
// =========================================================
function getInstancesForDate(dateObj){
  const iso = todayISO(dateObj);
  const dow = dateObj.getDay();
  const instances = [];

  state.regularClasses.forEach(c => {
    if(c.days.includes(dow)){
      instances.push({
        instanceKey: `${c.id}__${iso}`,
        sourceId: c.id,
        kind: 'regular',
        subject: c.subject, professor: c.professor,
        building: c.building, room: c.room,
        start: c.start, end: c.end,
        dateISO: iso
      });
    }
  });

  state.extraSessions.forEach(s => {
    if(s.date === iso){
      instances.push({
        instanceKey: `${s.id}__${iso}`,
        sourceId: s.id,
        kind: 'extra',
        subject: s.subject, professor: s.professor,
        building: s.building, room: s.room,
        start: s.start, end: s.end,
        dateISO: iso
      });
    }
  });

  instances.sort((a,b) => timeToMinutes(a.start) - timeToMinutes(b.start));
  return instances;
}

function computeStatus(instance, now){
  if(state.completed[instance.instanceKey]) return 'completed';
  const isToday = instance.dateISO === todayISO(now);
  const nowMin = minutesNowInDay(now);
  const startMin = timeToMinutes(instance.start);
  const endMin = timeToMinutes(instance.end);

  if(!isToday){
    const todayISOStr = todayISO(now);
    if(instance.dateISO > todayISOStr) return 'upcoming';
    return 'missed';
  }
  if(nowMin < startMin) return 'upcoming';
  if(nowMin >= startMin && nowMin < endMin) return 'ongoing';
  return 'missed';
}

// =========================================================
// RENDER: DASHBOARD
// =========================================================
function renderDashboard(){
  const now = new Date();
  document.getElementById('greeting-line').textContent = formatDateLong(now);

  const todays = getInstancesForDate(now);
  document.getElementById('stat-today').textContent = todays.length;

  const todayISOStr = todayISO(now);
  const extraToday = state.extraSessions.filter(s => s.date === todayISOStr).length;
  document.getElementById('stat-extra').textContent = extraToday;

  const in7 = new Date(now); in7.setDate(in7.getDate()+7);
  const in7ISO = todayISO(in7);
  const upcomingWeek = state.extraSessions.filter(s => s.date >= todayISOStr && s.date <= in7ISO).length;
  document.getElementById('stat-upcoming').textContent = upcomingWeek;

  renderWeekRibbon();
  renderDashboardPreview(now, todays);
  renderAttendance(now, todays);
  renderDashboardWorksPreview();
}

function renderWeekRibbon(){
  const container = document.getElementById('week-ribbon');
  container.innerHTML = '';
  const now = new Date();
  const monday = new Date(now);
  const dow = now.getDay();
  const diffToMonday = (dow === 0 ? -6 : 1 - dow);
  monday.setDate(now.getDate() + diffToMonday);

  for(let i=0;i<7;i++){
    const d = new Date(monday);
    d.setDate(monday.getDate()+i);
    const iso = todayISO(d);
    const isToday = iso === todayISO(now);
    const hasEvents = getInstancesForDate(d).length > 0;

    const btn = document.createElement('button');
    btn.className = 'week-day' + (isToday ? ' is-today' : '');
    btn.innerHTML = `
      <span class="week-day__letter">${DAY_LETTERS[d.getDay()]}</span>
      <span class="week-day__dot${hasEvents ? ' has-events' : ''}"></span>
      ${isToday ? '<span class="week-day__today-label">Today</span>' : ''}
    `;
    btn.addEventListener('click', () => {
      viewingDate = d;
      switchView('classes');
    });
    container.appendChild(btn);
  }
}

function renderDashboardPreview(now, todays){
  const list = document.getElementById('dashboard-preview-list');
  const nowMin = minutesNowInDay(now);
  const rest = todays.filter(i => {
    const st = computeStatus(i, now);
    return st !== 'completed' && timeToMinutes(i.end) >= nowMin;
  }).slice(0,3);

  if(rest.length === 0){
    list.innerHTML = `<p class="preview-empty">Nothing left on today's schedule. 🎉</p>`;
    return;
  }
  list.innerHTML = rest.map(i => `
    <div class="preview-item">
      <span class="preview-item__time">${formatTime12(i.start)}</span>
      <span class="preview-item__name">${escapeHtml(i.subject)}</span>
    </div>
  `).join('');
}

function renderDashboardWorksPreview(){
  const now = new Date();
  const list = document.getElementById('dashboard-works-preview');
  if(!list) return;
  const upcoming = state.works
    .filter(w => computeWorkStatus(w, now) !== 'completed')
    .sort((a,b) => a.dueDate.localeCompare(b.dueDate))
    .slice(0,3);

  if(upcoming.length === 0){
    list.innerHTML = `<p class="preview-empty">No pending works. 🎉</p>`;
    return;
  }
  list.innerHTML = upcoming.map(w => `
    <div class="preview-item">
      <span class="preview-item__time">${formatDateLong(new Date(w.dueDate+'T00:00:00')).split(',')[0]}</span>
      <span class="preview-item__name">${escapeHtml(w.subject)}</span>
    </div>
  `).join('');
}

// =========================================================
// ATTENDANCE DONUT
// =========================================================
const ATTENDANCE_GREENS = ['#1E7A5F', '#2C9271', '#3FA986', '#144F3D', '#57BF9C'];
const ATTENDANCE_REDS   = ['#AC4429', '#C2593B', '#8F3620', '#D9704F', '#9E3A28'];
const ATTENDANCE_GRAYS  = ['#767267', '#8B877A', '#5E5A50', '#A19D8F', '#6E6A5F'];

function attendanceCountForInstance(inst){
  const mins = timeToMinutes(inst.end) - timeToMinutes(inst.start);
  const hours = mins / 60;
  return Math.max(1, Math.round(hours));
}

let attendanceLongPressTimer = null;

function renderAttendance(now, todays){
  const wrap = document.getElementById('attendance-wrap');
  const emptyEl = document.getElementById('attendance-empty');
  const svg = document.getElementById('attendance-donut');
  const legend = document.getElementById('attendance-legend');
  const tooltip = document.getElementById('attendance-tooltip');
  if(!svg) return;

  if(todays.length === 0){
    wrap.hidden = true;
    emptyEl.hidden = false;
    svg.innerHTML = '';
    document.getElementById('attendance-total-num').textContent = '0';
    return;
  }
  emptyEl.hidden = true;
  wrap.hidden = false;

  const segments = todays.map(inst => {
    const status = computeStatus(inst, now);
    const bucket = status === 'completed' ? 'green' : (status === 'missed' ? 'red' : 'gray');
    return { inst, status, bucket, count: attendanceCountForInstance(inst) };
  });

  const totalCount = segments.reduce((s,x) => s + x.count, 0);
  document.getElementById('attendance-total-num').textContent = totalCount;

  const R = 80, CX = 100, CY = 100, STROKE = 26;
  const circumference = 2 * Math.PI * R;
  let offsetAcc = 0;
  const colorIdx = { green:0, red:0, gray:0 };
  const palettes = { green: ATTENDANCE_GREENS, red: ATTENDANCE_REDS, gray: ATTENDANCE_GRAYS };

  svg.innerHTML = segments.map((seg, i) => {
    const frac = totalCount ? seg.count / totalCount : 0;
    const dash = frac * circumference;
    const gap = circumference - dash;
    const dashoffset = -offsetAcc;
    offsetAcc += dash;
    const color = palettes[seg.bucket][colorIdx[seg.bucket] % palettes[seg.bucket].length];
    colorIdx[seg.bucket]++;
    return `<circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="${color}" stroke-width="${STROKE}" stroke-dasharray="${dash} ${gap}" stroke-dashoffset="${dashoffset}" data-idx="${i}"></circle>`;
  }).join('');

  svg.querySelectorAll('circle').forEach(circle => {
    const idx = Number(circle.getAttribute('data-idx'));
    const seg = segments[idx];
    const showTip = () => {
      tooltip.hidden = false;
      tooltip.textContent = `${seg.inst.subject} — ${seg.count} attendance`;
    };
    const hideTip = () => { tooltip.hidden = true; };
    circle.addEventListener('mouseenter', showTip);
    circle.addEventListener('mouseleave', hideTip);
    circle.addEventListener('touchstart', () => {
      clearTimeout(attendanceLongPressTimer);
      attendanceLongPressTimer = setTimeout(showTip, 550);
    }, { passive:true });
    circle.addEventListener('touchend', () => { clearTimeout(attendanceLongPressTimer); hideTip(); });
    circle.addEventListener('touchcancel', () => { clearTimeout(attendanceLongPressTimer); hideTip(); });
  });

  const totals = { green:0, red:0, gray:0 };
  segments.forEach(s => totals[s.bucket] += s.count);
  const legendRows = [
    { label:'Attended', key:'green', color: ATTENDANCE_GREENS[0] },
    { label:'Missed',   key:'red',   color: ATTENDANCE_REDS[0] },
    { label:'Pending',  key:'gray',  color: ATTENDANCE_GRAYS[0] }
  ];
  legend.innerHTML = legendRows.map(r => `
    <div class="attendance-legend__row">
      <span class="attendance-legend__dot" style="background:${r.color}"></span>
      <span class="attendance-legend__label">${r.label}</span>
      <span class="attendance-legend__val">${totals[r.key]}</span>
    </div>
  `).join('');
}

// =========================================================
// RENDER: TODAY'S CLASSES (timeline)
// =========================================================
function renderTimeline(){
  const now = new Date();
  const isToday = todayISO(viewingDate) === todayISO(now);
  const dateLine = document.getElementById('classes-date-line');
  dateLine.textContent = isToday
    ? formatDateLong(now)
    : formatDateLong(viewingDate) + ' · not today';

  const instances = getInstancesForDate(viewingDate);
  const list = document.getElementById('timeline-list');
  const empty = document.getElementById('timeline-empty');

  if(instances.length === 0){
    list.innerHTML = '';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  list.innerHTML = instances.map(instance => {
    const status = computeStatus(instance, now);
    const checked = status === 'completed';
    return `
      <li class="timeline-card" data-status="${status}" data-instance-key="${instance.instanceKey}">
        <div class="timeline-card__top">
          <div>
            <div class="timeline-card__subject">${escapeHtml(instance.subject)}</div>
            ${instance.professor ? `<div class="timeline-card__professor">${escapeHtml(instance.professor)}</div>` : ''}
          </div>
          <span class="status-pill" data-status="${status}">${statusLabel(status)}</span>
        </div>
        <div class="timeline-card__meta">
          ${formatTime12(instance.start)} – ${formatTime12(instance.end)}
          ${instance.kind === 'extra' ? '<span class="chip-extra" style="margin-left:8px;">EXTRA</span>' : ''}
        </div>
        <div class="timeline-card__plaque">
          <span class="timeline-card__plaque-building">${escapeHtml(instance.building)}</span>
          <span class="timeline-card__plaque-room">${escapeHtml(instance.room)}</span>
        </div>
        <div class="timeline-card__foot">
          <span class="check-row${checked ? ' is-checked' : ''}" data-toggle-complete="${instance.instanceKey}">
            <span class="check-box">
              <svg viewBox="0 0 24 24" fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L19 8"/></svg>
            </span>
            Mark as completed
          </span>
          <button class="link-btn" data-edit-instance="${instance.sourceId}" data-edit-kind="${instance.kind}">Edit</button>
        </div>
      </li>
    `;
  }).join('');

  list.querySelectorAll('[data-toggle-complete]').forEach(el => {
    el.addEventListener('click', () => {
      const key = el.getAttribute('data-toggle-complete');
      if(state.completed[key]) delete state.completed[key];
      else state.completed[key] = true;
      saveState();
      renderTimeline();
      renderDashboardStatsQuiet();
    });
  });
  list.querySelectorAll('[data-edit-instance]').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.getAttribute('data-edit-instance');
      const kind = el.getAttribute('data-edit-kind');
      if(kind === 'regular') openRegularModal(state.regularClasses.find(c => c.id === id));
      else openExtraModal(state.extraSessions.find(s => s.id === id));
    });
  });
}

function statusLabel(status){
  return { upcoming:'Upcoming', ongoing:'Ongoing', missed:'Missed', completed:'Completed' }[status] || status;
}

function renderDashboardStatsQuiet(){
  if(document.getElementById('view-dashboard').classList.contains('is-active')) renderDashboard();
}

// =========================================================
// RENDER: WORKS
// =========================================================
function computeWorkStatus(work, now){
  if(work.completed) return 'completed';
  const todayISOStr = todayISO(now);
  if(work.dueDate < todayISOStr) return 'missed';
  return 'ongoing';
}

function renderWorks(){
  const now = new Date();
  const list = document.getElementById('works-list');
  const empty = document.getElementById('works-empty');
  if(!list) return;

  const works = [...state.works].sort((a,b) => a.dueDate.localeCompare(b.dueDate));
  const ongoingCount = works.filter(w => computeWorkStatus(w, now) === 'ongoing').length;
  document.getElementById('works-summary-line').textContent =
    works.length === 0 ? 'Assignments & lab work' : `${ongoingCount} ongoing · ${works.length} total`;

  if(works.length === 0){
    list.innerHTML = '';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  list.innerHTML = works.map(w => {
    const status = computeWorkStatus(w, now);
    const checked = status === 'completed';
    const pillStatus = status === 'ongoing' ? 'upcoming' : status; // reuse amber for "ongoing/pending"
    const pillClass = status === 'completed' ? ' status-pill--positive' : '';
    const pillLabel = status === 'ongoing' ? 'Ongoing' : (status === 'missed' ? 'Missed' : 'Completed');
    return `
      <li class="timeline-card work-card" data-status="${status}" data-work-id="${w.id}">
        <div class="timeline-card__top">
          <div>
            <div class="timeline-card__subject">${escapeHtml(w.subject)}<span class="type-chip">${w.type === 'lab' ? 'Lab Work' : 'Assignment'}</span></div>
          </div>
          <span class="status-pill${pillClass}" data-status="${pillStatus}">${pillLabel}</span>
        </div>
        <div class="timeline-card__meta">Due ${formatDateLong(new Date(w.dueDate + 'T00:00:00'))}</div>
        <div class="timeline-card__foot">
          <span class="check-row${checked ? ' is-checked' : ''}" data-toggle-work="${w.id}">
            <span class="check-box">
              <svg viewBox="0 0 24 24" fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L19 8"/></svg>
            </span>
            Mark as completed
          </span>
          <button class="link-btn" data-edit-work="${w.id}">Edit</button>
        </div>
      </li>
    `;
  }).join('');

  list.querySelectorAll('[data-toggle-work]').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.getAttribute('data-toggle-work');
      const w = state.works.find(x => x.id === id);
      if(w){
        w.completed = !w.completed;
        saveState();
        renderWorks();
        renderDashboardWorksPreview();
      }
    });
  });
  list.querySelectorAll('[data-edit-work]').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.getAttribute('data-edit-work');
      openWorkModal(state.works.find(w => w.id === id));
    });
  });
}

function openWorkModal(existing){
  const form = document.getElementById('form-work');
  form.reset();
  document.getElementById('modal-work-title').textContent = existing ? 'Edit work' : 'Add work';
  document.getElementById('work-id').value = existing ? existing.id : '';
  document.getElementById('work-subject').value = existing ? existing.subject : '';
  document.getElementById('work-duedate').value = existing ? existing.dueDate : '';
  document.querySelectorAll('input[name="work-type"]').forEach(r => {
    r.checked = existing ? r.value === existing.type : r.value === 'assignment';
  });
  document.getElementById('btn-delete-work').hidden = !existing;
  openModal('modal-work');
}

document.getElementById('form-work').addEventListener('submit', (e) => {
  e.preventDefault();
  const id = document.getElementById('work-id').value || uid();
  const type = document.querySelector('input[name="work-type"]:checked').value;
  const existing = state.works.find(w => w.id === id);
  const payload = {
    id,
    subject: document.getElementById('work-subject').value.trim(),
    type,
    dueDate: document.getElementById('work-duedate').value,
    completed: existing ? existing.completed : false
  };
  const idx = state.works.findIndex(w => w.id === id);
  if(idx >= 0) state.works[idx] = payload; else state.works.push(payload);
  saveState();
  closeModal('modal-work');
  renderWorks();
  renderDashboardWorksPreview();
  showToast('Work saved');
});

document.getElementById('btn-delete-work').addEventListener('click', () => {
  const id = document.getElementById('work-id').value;
  confirmDialog('Delete this work?', "This can't be undone.", () => {
    state.works = state.works.filter(w => w.id !== id);
    saveState();
    closeModal('modal-work');
    renderWorks();
    renderDashboardWorksPreview();
    showToast('Work deleted');
  });
});

document.getElementById('btn-fab-add-work').addEventListener('click', () => openWorkModal(null));
document.getElementById('btn-manage-works').addEventListener('click', () => openManageModal('works'));
document.getElementById('btn-see-all-works').addEventListener('click', () => switchView('works'));

// =========================================================
// RENDER: EVENTS
// =========================================================
function eventStatus(ev, now){
  const startDT = new Date(`${ev.date}T${ev.startTime}:00`);
  let endDT;
  if(ev.endTime){
    endDT = new Date(`${ev.date}T${ev.endTime}:00`);
  } else {
    endDT = new Date(`${ev.date}T00:00:00`);
    endDT.setDate(endDT.getDate() + 1); // no end time given -> treated as ending at midnight that night
  }
  if(now < startDT) return 'Upcoming';
  if(now >= startDT && now < endDT) return 'Ongoing';
  return 'Closed';
}

function renderEvents(){
  const now = new Date();
  const list = document.getElementById('events-list');
  const empty = document.getElementById('events-empty');
  if(!list) return;

  const events = (window.CAMPUSFLOW_EVENTS || []).slice()
    .sort((a,b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));

  const bannerSub = document.getElementById('events-banner-sub');
  if(bannerSub){
    bannerSub.textContent = events.length ? `${events.length} event${events.length === 1 ? '' : 's'} posted` : "See what's happening around campus";
  }

  if(events.length === 0){
    list.innerHTML = '';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  list.innerHTML = events.map(ev => {
    const status = eventStatus(ev, now);
    const statusAttr = status === 'Upcoming' ? 'upcoming' : (status === 'Ongoing' ? 'ongoing' : 'closed');
    const endLabel = ev.endTime ? ` – ${formatTime12(ev.endTime)}` : '';
    return `
      <div class="event-card">
        ${ev.image ? `<img class="event-card__banner" src="${escapeAttr(ev.image)}" alt="" loading="lazy">` : ''}
        <div class="event-card__body">
          <div class="event-card__top">
            <div class="event-card__name">${escapeHtml(ev.name)}</div>
            <span class="status-pill" data-status="${statusAttr}">${status}</span>
          </div>
          <div class="event-card__meta">${formatDateLong(new Date(ev.date + 'T00:00:00'))} · ${formatTime12(ev.startTime)}${endLabel}<br>${escapeHtml(ev.venue)}</div>
          <div class="event-card__desc">${escapeHtml(ev.description)}</div>
        </div>
      </div>
    `;
  }).join('');
}

document.getElementById('btn-dashboard-events').addEventListener('click', () => switchView('events'));
document.getElementById('btn-view-events').addEventListener('click', () => switchView('events'));

// =========================================================
// MANAGE LIST MODAL (Settings → add/edit regular/extra/works)
// =========================================================
let manageMode = 'regular'; // 'regular' | 'extra' | 'works'

function openManageModal(mode){
  manageMode = mode;
  const titles = { regular:'Regular classes', extra:'Extra sessions', works:'Works' };
  document.getElementById('modal-manage-title').textContent = titles[mode];
  renderManageList();
  openModal('modal-manage');
}

function renderManageList(){
  const container = document.getElementById('manage-list');
  const items = manageMode === 'regular' ? state.regularClasses : (manageMode === 'extra' ? state.extraSessions : state.works);

  if(items.length === 0){
    container.innerHTML = `<p class="manage-list__empty">Nothing added yet.</p>`;
    return;
  }
  container.innerHTML = items.map(item => {
    let sub;
    if(manageMode === 'regular') sub = `${item.days.map(d => DAY_LETTERS[d]).join(' ')} · ${formatTime12(item.start)}–${formatTime12(item.end)}`;
    else if(manageMode === 'extra') sub = `${formatDateLong(new Date(item.date + 'T00:00:00'))} · ${formatTime12(item.start)}–${formatTime12(item.end)}`;
    else sub = `${item.type === 'lab' ? 'Lab Work' : 'Assignment'} · Due ${formatDateLong(new Date(item.dueDate + 'T00:00:00'))}`;
    return `
      <div class="manage-list-item" data-manage-id="${item.id}">
        <div class="manage-list-item__main">
          <div class="manage-list-item__title">${escapeHtml(item.subject)}</div>
          <div class="manage-list-item__sub">${sub}</div>
        </div>
        <span class="manage-list-item__chevron">${chevronSVG()}</span>
      </div>
    `;
  }).join('');

  container.querySelectorAll('[data-manage-id]').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.getAttribute('data-manage-id');
      closeModal('modal-manage');
      if(manageMode === 'regular') openRegularModal(state.regularClasses.find(c => c.id === id));
      else if(manageMode === 'extra') openExtraModal(state.extraSessions.find(s => s.id === id));
      else openWorkModal(state.works.find(w => w.id === id));
    });
  });
}

function chevronSVG(){
  return '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>';
}

// =========================================================
// MODAL: ADD/EDIT REGULAR CLASS
// =========================================================
let selectedDays = new Set();

function openRegularModal(existing){
  const form = document.getElementById('form-regular');
  form.reset();
  selectedDays = new Set(existing ? existing.days : []);
  document.querySelectorAll('#regular-days .day-chip').forEach(chip => {
    const d = Number(chip.getAttribute('data-day'));
    chip.classList.toggle('is-selected', selectedDays.has(d));
  });

  document.getElementById('modal-regular-title').textContent = existing ? 'Edit regular class' : 'Add regular class';
  document.getElementById('regular-id').value = existing ? existing.id : '';
  document.getElementById('regular-subject').value = existing ? existing.subject : '';
  document.getElementById('regular-professor').value = existing ? existing.professor || '' : '';
  document.getElementById('regular-building').value = existing ? existing.building : '';
  document.getElementById('regular-room').value = existing ? existing.room : '';
  document.getElementById('regular-start').value = existing ? existing.start : '';
  document.getElementById('regular-end').value = existing ? existing.end : '';
  document.getElementById('btn-delete-regular').hidden = !existing;
  openModal('modal-regular');
}

document.getElementById('regular-days').addEventListener('click', (e) => {
  const chip = e.target.closest('.day-chip');
  if(!chip) return;
  const d = Number(chip.getAttribute('data-day'));
  if(selectedDays.has(d)) selectedDays.delete(d); else selectedDays.add(d);
  chip.classList.toggle('is-selected', selectedDays.has(d));
});

document.getElementById('form-regular').addEventListener('submit', (e) => {
  e.preventDefault();
  const id = document.getElementById('regular-id').value || uid();
  const start = document.getElementById('regular-start').value;
  const end = document.getElementById('regular-end').value;

  if(selectedDays.size === 0){ showToast('Pick at least one day'); return; }
  if(timeToMinutes(end) <= timeToMinutes(start)){ showToast('End time must be after start time'); return; }

  const payload = {
    id,
    subject: document.getElementById('regular-subject').value.trim(),
    professor: document.getElementById('regular-professor').value.trim(),
    building: document.getElementById('regular-building').value.trim(),
    room: document.getElementById('regular-room').value.trim(),
    start, end,
    days: Array.from(selectedDays).sort()
  };
  const idx = state.regularClasses.findIndex(c => c.id === id);
  if(idx >= 0) state.regularClasses[idx] = payload; else state.regularClasses.push(payload);
  saveState();
  closeModal('modal-regular');
  refreshAllViews();
  showToast('Class saved');
});

document.getElementById('btn-delete-regular').addEventListener('click', () => {
  const id = document.getElementById('regular-id').value;
  confirmDialog('Delete this class?', 'This removes it from every day it repeats on. This can\'t be undone.', () => {
    state.regularClasses = state.regularClasses.filter(c => c.id !== id);
    saveState();
    closeModal('modal-regular');
    refreshAllViews();
    showToast('Class deleted');
  });
});

// =========================================================
// MODAL: ADD/EDIT EXTRA SESSION
// =========================================================
function openExtraModal(existing){
  const form = document.getElementById('form-extra');
  form.reset();
  document.getElementById('modal-extra-title').textContent = existing ? 'Edit extra session' : 'Add extra session';
  document.getElementById('extra-id').value = existing ? existing.id : '';
  document.getElementById('extra-subject').value = existing ? existing.subject : '';
  document.getElementById('extra-professor').value = existing ? existing.professor || '' : '';
  document.getElementById('extra-building').value = existing ? existing.building : '';
  document.getElementById('extra-room').value = existing ? existing.room : '';
  document.getElementById('extra-date').value = existing ? existing.date : todayISO(viewingDate);
  document.getElementById('extra-start').value = existing ? existing.start : '';
  document.getElementById('extra-end').value = existing ? existing.end : '';
  document.getElementById('btn-delete-extra').hidden = !existing;
  openModal('modal-extra');
}

document.getElementById('form-extra').addEventListener('submit', (e) => {
  e.preventDefault();
  const id = document.getElementById('extra-id').value || uid();
  const start = document.getElementById('extra-start').value;
  const end = document.getElementById('extra-end').value;
  if(timeToMinutes(end) <= timeToMinutes(start)){ showToast('End time must be after start time'); return; }

  const payload = {
    id,
    subject: document.getElementById('extra-subject').value.trim(),
    professor: document.getElementById('extra-professor').value.trim(),
    building: document.getElementById('extra-building').value.trim(),
    room: document.getElementById('extra-room').value.trim(),
    date: document.getElementById('extra-date').value,
    start, end
  };
  const idx = state.extraSessions.findIndex(s => s.id === id);
  if(idx >= 0) state.extraSessions[idx] = payload; else state.extraSessions.push(payload);
  saveState();
  closeModal('modal-extra');
  refreshAllViews();
  showToast('Session saved');
});

document.getElementById('btn-delete-extra').addEventListener('click', () => {
  const id = document.getElementById('extra-id').value;
  confirmDialog('Delete this session?', 'This can\'t be undone.', () => {
    state.extraSessions = state.extraSessions.filter(s => s.id !== id);
    saveState();
    closeModal('modal-extra');
    refreshAllViews();
    showToast('Session deleted');
  });
});

// =========================================================
// MODAL / DIALOG HELPERS
// =========================================================
function openModal(id){ document.getElementById(id).classList.add('is-open'); }
function closeModal(id){ document.getElementById(id).classList.remove('is-open'); }

document.querySelectorAll('[data-close-modal]').forEach(btn => {
  btn.addEventListener('click', () => closeModal(btn.getAttribute('data-close-modal')));
});
document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
  backdrop.addEventListener('click', (e) => {
    if(e.target === backdrop) backdrop.classList.remove('is-open');
  });
});

let confirmCallback = null;
function confirmDialog(title, body, onConfirm){
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-body').textContent = body;
  confirmCallback = onConfirm;
  openModal('modal-confirm');
}
document.getElementById('confirm-ok').addEventListener('click', () => {
  closeModal('modal-confirm');
  if(confirmCallback) confirmCallback();
  confirmCallback = null;
});
document.getElementById('confirm-cancel').addEventListener('click', () => {
  closeModal('modal-confirm');
  confirmCallback = null;
});

let toastTimer = null;
function showToast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('is-visible'), 2400);
}

// =========================================================
// SIDE PANELS (hamburger drawer + profile panel)
// =========================================================
function openPanel(id){ document.getElementById(id).classList.add('is-open'); }
function closePanel(id){ document.getElementById(id).classList.remove('is-open'); }

document.querySelectorAll('[data-close-panel]').forEach(el => {
  el.addEventListener('click', () => closePanel(el.getAttribute('data-close-panel')));
});
document.getElementById('btn-hamburger').addEventListener('click', () => openPanel('panel-drawer'));
document.getElementById('btn-avatar').addEventListener('click', () => openPanel('panel-profile'));

document.querySelectorAll('.drawer-link[data-view]').forEach(btn => {
  btn.addEventListener('click', () => {
    closePanel('panel-drawer');
    if(btn.getAttribute('data-view') === 'classes') viewingDate = new Date();
    switchView(btn.getAttribute('data-view'));
  });
});

document.getElementById('btn-open-edit-name').addEventListener('click', () => {
  closePanel('panel-profile');
  document.getElementById('name-input').value = state.name || '';
  document.getElementById('fullname-input').value = state.fullName || '';
  openModal('modal-name');
});
document.getElementById('btn-open-id-card').addEventListener('click', () => {
  openIdCardViewer();
});

document.getElementById('form-name').addEventListener('submit', (e) => {
  e.preventDefault();
  state.name = document.getElementById('name-input').value.trim();
  state.fullName = document.getElementById('fullname-input').value.trim();
  saveState();
  closeModal('modal-name');
  renderAvatar();
});

function renderAvatar(){
  const initials = state.name ? state.name.trim().charAt(0).toUpperCase() : 'S';
  const initialsEl = document.getElementById('avatar-initials');
  const imgEl = document.getElementById('avatar-picture');
  initialsEl.textContent = initials || 'S';
  if(state.profilePicture){
    imgEl.src = state.profilePicture;
    imgEl.hidden = false;
    initialsEl.style.display = 'none';
  } else {
    imgEl.hidden = true;
    initialsEl.style.display = '';
  }
}

// =========================================================
// NAVIGATION
// =========================================================
const VALID_VIEWS = ['dashboard','classes','works','events','settings'];

function switchView(name){
  if(!VALID_VIEWS.includes(name)) name = 'dashboard';
  document.querySelectorAll('.view').forEach(v => v.classList.remove('is-active'));
  document.getElementById(`view-${name}`).classList.add('is-active');
  document.querySelectorAll('.nav-btn, .topnav-link').forEach(b => b.classList.toggle('is-active', b.getAttribute('data-view') === name));

  if(name === 'dashboard') renderDashboard();
  if(name === 'classes') renderTimeline();
  if(name === 'works') renderWorks();
  if(name === 'events') renderEvents();
  if(name === 'settings') renderSettings();

  try{ history.replaceState(null, '', name === 'dashboard' ? (location.pathname + location.search) : `#${name}`); }catch(e){}
}

document.querySelectorAll('.nav-btn, .topnav-link').forEach(btn => {
  btn.addEventListener('click', () => {
    if(btn.getAttribute('data-view') === 'classes') viewingDate = new Date();
    switchView(btn.getAttribute('data-view'));
  });
});
document.getElementById('btn-jump-today').addEventListener('click', () => {
  viewingDate = new Date();
  renderTimeline();
});
document.getElementById('btn-see-all-today').addEventListener('click', () => {
  viewingDate = new Date();
  switchView('classes');
});

// dashboard quick-add
document.getElementById('btn-add-regular').addEventListener('click', () => openRegularModal(null));
document.getElementById('btn-add-extra').addEventListener('click', () => openExtraModal(null));
document.getElementById('btn-fab-add').addEventListener('click', () => openExtraModal(null));

// settings management entries
document.getElementById('btn-manage-regular').addEventListener('click', () => openManageModal('regular'));
document.getElementById('btn-manage-extra').addEventListener('click', () => openManageModal('extra'));
document.getElementById('btn-manage-add-new').addEventListener('click', () => {
  closeModal('modal-manage');
  if(manageMode === 'regular') openRegularModal(null);
  else if(manageMode === 'extra') openExtraModal(null);
  else openWorkModal(null);
});

// =========================================================
// SETTINGS VIEW
// =========================================================
function renderSettings(){
  setSwitch('toggle-notifications', state.settings.notifications);
  setSwitch('toggle-vibration', state.settings.vibration);
  setSwitch('toggle-dark', state.settings.darkMode);
  document.getElementById('select-default-tab').value = state.settings.defaultTab;
  document.getElementById('sound-value').textContent = state.settings.sound + ' ›';
  document.getElementById('select-preset').value = '';
  updateNotifStatusLine();
  updateStorageUsedLabel();
  renderPictureSettingsRow();
  renderIdCardSettingsRow();
}

function setSwitch(id, on){
  const el = document.getElementById(id);
  el.setAttribute('aria-checked', on ? 'true' : 'false');
}

function updateNotifStatusLine(){
  const el = document.getElementById('notif-status');
  if(!('Notification' in window)){
    el.textContent = 'This browser doesn\'t support notifications.';
    return;
  }
  if(!state.settings.notifications){
    el.textContent = 'Off — turn on to get alerted 15 minutes before class.';
  } else if(Notification.permission === 'granted'){
    el.textContent = 'On — you\'ll be notified 15 minutes before each class starts.';
  } else if(Notification.permission === 'denied'){
    el.textContent = 'Blocked by your browser. Enable notifications for this site in browser settings.';
  } else {
    el.textContent = 'Almost there — allow the permission prompt to finish turning this on.';
  }
}

document.getElementById('toggle-notifications').addEventListener('click', async () => {
  if(!state.settings.notifications){
    if(!('Notification' in window)){ showToast('Notifications aren\'t supported in this browser'); return; }
    let perm = Notification.permission;
    if(perm === 'default') perm = await Notification.requestPermission();
    if(perm !== 'granted'){
      state.settings.notifications = false;
      updateNotifStatusLine();
      showToast('Notification permission was not granted');
      return;
    }
    state.settings.notifications = true;
  } else {
    state.settings.notifications = false;
  }
  saveState();
  setSwitch('toggle-notifications', state.settings.notifications);
  updateNotifStatusLine();
});

document.getElementById('toggle-vibration').addEventListener('click', () => {
  state.settings.vibration = !state.settings.vibration;
  saveState();
  setSwitch('toggle-vibration', state.settings.vibration);
  if(state.settings.vibration && navigator.vibrate) navigator.vibrate(60);
});

document.getElementById('toggle-dark').addEventListener('click', () => {
  state.settings.darkMode = !state.settings.darkMode;
  saveState();
  applyTheme();
  setSwitch('toggle-dark', state.settings.darkMode);
});

document.getElementById('select-default-tab').addEventListener('change', (e) => {
  state.settings.defaultTab = e.target.value;
  saveState();
});

document.getElementById('btn-sound').addEventListener('click', () => {
  const options = ['Default', 'Chime', 'Ping', 'Silent'];
  const current = state.settings.sound;
  const next = options[(options.indexOf(current)+1) % options.length];
  state.settings.sound = next;
  saveState();
  document.getElementById('sound-value').textContent = next + ' ›';
});

function applyTheme(){
  document.body.setAttribute('data-theme', state.settings.darkMode ? 'dark' : 'light');
}

// =========================================================
// PRESET CLASS IMPORT (Settings → Add classes from preset)
// =========================================================
document.getElementById('btn-apply-preset').addEventListener('click', async () => {
  const val = document.getElementById('select-preset').value;
  if(!val){ showToast('Pick a class & group first'); return; }
  try{
    const res = await fetch(`presets/${val}.json`);
    if(!res.ok) throw new Error('preset not found');
    const data = await res.json();
    if(!Array.isArray(data.regularClasses)) throw new Error('bad preset format');
    confirmDialog(
      `Add ${val} classes?`,
      `This adds ${data.regularClasses.length} regular class(es) for ${val} to your schedule. You can edit or remove any of them afterward.`,
      () => {
        data.regularClasses.forEach(c => state.regularClasses.push({ ...c, id: uid() }));
        saveState();
        refreshAllViews();
        showToast(`${val} classes added`);
      }
    );
  }catch(err){
    console.error(err);
    showToast('Could not load that preset');
  }
});

// =========================================================
// CLEAR DATA
// =========================================================
document.getElementById('btn-clear-data').addEventListener('click', () => {
  confirmDialog(
    'Clear local schedule data?',
    'This permanently deletes every regular class, extra session, work, and completion mark stored on this device. Your settings, ID card and profile picture stay as they are.',
    () => {
      state.regularClasses = [];
      state.extraSessions = [];
      state.works = [];
      state.completed = {};
      state.notifiedKeys = {};
      saveState();
      refreshAllViews();
      showToast('Schedule data cleared');
    }
  );
});

// =========================================================
// EXPORT / IMPORT
// =========================================================
document.getElementById('btn-export').addEventListener('click', () => {
  const payload = {
    exportedAt: new Date().toISOString(),
    name: state.name,
    regularClasses: state.regularClasses,
    extraSessions: state.extraSessions
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `campusflow-schedule-${todayISO()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('Schedule exported');
});

document.getElementById('btn-import').addEventListener('click', () => {
  document.getElementById('file-import').click();
});

document.getElementById('file-import').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try{
      const data = JSON.parse(reader.result);
      if(!Array.isArray(data.regularClasses) || !Array.isArray(data.extraSessions)){
        throw new Error('Missing expected fields');
      }
      confirmDialog(
        'Import this schedule?',
        `This adds ${data.regularClasses.length} regular class(es) and ${data.extraSessions.length} extra session(s) to your current schedule.`,
        () => {
          data.regularClasses.forEach(c => state.regularClasses.push({ ...c, id: uid() }));
          data.extraSessions.forEach(s => state.extraSessions.push({ ...s, id: uid() }));
          saveState();
          refreshAllViews();
          showToast('Schedule imported');
        }
      );
    }catch(err){
      showToast('That file doesn\'t look like a valid CampusFlow export');
    }
    e.target.value = '';
  };
  reader.readAsText(file);
});

function updateStorageUsedLabel(){
  const el = document.getElementById('storage-used');
  if(!el) return;
  try{
    const bytes = new Blob([localStorage.getItem(STORE_KEY) || '']).size;
    el.textContent = bytes < 1024 ? `${bytes} B` : (bytes < 1024*1024 ? `${(bytes/1024).toFixed(1)} KB` : `${(bytes/1024/1024).toFixed(2)} MB`);
  }catch(e){ el.textContent = '—'; }
}

// =========================================================
// PROFILE PICTURE (Settings) — auto center-cropped to 1:1
// =========================================================
function renderPictureSettingsRow(){
  const el = document.getElementById('picture-actions');
  if(!el) return;
  if(state.profilePicture){
    el.innerHTML = `<button class="upload-btn" id="btn-picture-edit">Edit</button><button class="upload-btn upload-btn--danger" id="btn-picture-delete">Delete</button>`;
    document.getElementById('btn-picture-edit').addEventListener('click', () => document.getElementById('file-picture').click());
    document.getElementById('btn-picture-delete').addEventListener('click', () => {
      confirmDialog('Remove profile picture?', 'Your avatar will show your initial again.', () => {
        state.profilePicture = null;
        saveState();
        renderPictureSettingsRow();
        renderAvatar();
        showToast('Profile picture removed');
      });
    });
  } else {
    el.innerHTML = `<button class="upload-btn upload-btn--primary" id="btn-picture-upload">Upload</button>`;
    document.getElementById('btn-picture-upload').addEventListener('click', () => document.getElementById('file-picture').click());
  }
}

document.getElementById('file-picture').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if(!file) return;
  if(!['image/jpeg','image/png'].includes(file.type)){
    showToast('Please choose a JPG or PNG image');
    e.target.value = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const size = Math.min(img.naturalWidth, img.naturalHeight);
      const sx = (img.naturalWidth - size) / 2, sy = (img.naturalHeight - size) / 2;
      const outSize = Math.min(size, 480);
      const canvas = document.createElement('canvas');
      canvas.width = outSize; canvas.height = outSize;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, sx, sy, size, size, 0, 0, outSize, outSize);
      state.profilePicture = canvas.toDataURL('image/jpeg', 0.88);
      saveState();
      renderPictureSettingsRow();
      renderAvatar();
      showToast('Profile picture updated');
    };
    img.onerror = () => showToast('Could not read that image');
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
  e.target.value = '';
});

// =========================================================
// STUDENT ID CARD — upload, coordinate mapping, mockup composite, viewer
// =========================================================
const DEFAULT_ID_COORDS = {
  front: { x: 10.9, y: 10.7, w: 31.9, h: 33.0 },
  back:  { x: 45.2, y: 10.7, w: 31.8, h: 33.0 }
};
// Where the blank card sits inside assets/id-card-mockup.png (as % of that image)
const MOCKUP_CARD_RECT = { xPct: 16.519, yPct: 33.5, wPct: 66.785, hPct: 61.4 };

let idmapSourceCanvas = null; // the uploaded PDF's page 1, rasterized
let idmapPdfBase64 = null;    // pending base64 while the mapping modal is open
let idCardMockupImg = null;   // preloaded mockup Image
let idCardCurrentSide = 'front';

async function renderPdfPageToCanvas(dataUrl, targetWidth){
  const loadingTask = pdfjsLib.getDocument(dataUrl);
  const pdf = await loadingTask.promise;
  const page = await pdf.getPage(1);
  const viewport1 = page.getViewport({ scale: 1 });
  const scale = targetWidth / viewport1.width;
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}

function renderIdCardSettingsRow(){
  const el = document.getElementById('idcard-actions');
  if(!el) return;
  if(state.idCard && state.idCard.pdfBase64){
    el.innerHTML = `<button class="upload-btn" id="btn-idcard-edit">Edit</button><button class="upload-btn upload-btn--danger" id="btn-idcard-delete">Delete</button>`;
    document.getElementById('btn-idcard-edit').addEventListener('click', () => openIdCardMapModal(state.idCard.pdfBase64));
    document.getElementById('btn-idcard-delete').addEventListener('click', () => {
      confirmDialog('Remove ID card?', 'This deletes the uploaded PDF and its mapping from this device.', () => {
        state.idCard = null;
        saveState();
        renderIdCardSettingsRow();
        showToast('ID card removed');
      });
    });
  } else {
    el.innerHTML = `<button class="upload-btn upload-btn--primary" id="btn-idcard-upload">Upload PDF</button>`;
    document.getElementById('btn-idcard-upload').addEventListener('click', () => document.getElementById('file-idcard').click());
  }
}

document.getElementById('file-idcard').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if(!file) return;
  if(file.type !== 'application/pdf'){
    showToast('Please choose a PDF file');
    e.target.value = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    openIdCardMapModal(reader.result);
  };
  reader.readAsDataURL(file);
  e.target.value = '';
});

document.getElementById('btn-idcard-replace').addEventListener('click', () => {
  document.getElementById('file-idcard').click();
});

async function openIdCardMapModal(base64){
  if(!window.pdfjsLib){ showToast('PDF reader failed to load — check your connection'); return; }
  idmapPdfBase64 = base64;
  try{
    idmapSourceCanvas = await renderPdfPageToCanvas(base64, 1000);
  }catch(err){
    console.error(err);
    showToast('Could not read that PDF file');
    return;
  }
  const coords = (state.idCard && state.idCard.pdfBase64 === base64 && state.idCard.coords) ? state.idCard.coords : DEFAULT_ID_COORDS;
  setIdMapFieldValues(coords);
  drawIdMapPreview();
  openModal('modal-idcard-map');
}

function setIdMapFieldValues(coords){
  document.getElementById('front-x').value = coords.front.x;
  document.getElementById('front-y').value = coords.front.y;
  document.getElementById('front-w').value = coords.front.w;
  document.getElementById('front-h').value = coords.front.h;
  document.getElementById('back-x').value = coords.back.x;
  document.getElementById('back-y').value = coords.back.y;
  document.getElementById('back-w').value = coords.back.w;
  document.getElementById('back-h').value = coords.back.h;
}

function getIdMapFieldValues(){
  const num = id => parseFloat(document.getElementById(id).value) || 0;
  return {
    front: { x: num('front-x'), y: num('front-y'), w: num('front-w'), h: num('front-h') },
    back:  { x: num('back-x'),  y: num('back-y'),  w: num('back-w'),  h: num('back-h') }
  };
}

function drawIdMapPreview(){
  if(!idmapSourceCanvas) return;
  const canvas = document.getElementById('idmap-canvas');
  canvas.width = idmapSourceCanvas.width;
  canvas.height = idmapSourceCanvas.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(idmapSourceCanvas, 0, 0);
  const coords = getIdMapFieldValues();
  drawDashedRect(ctx, coords.front, canvas.width, canvas.height, '#1E7A5F', 'FRONT');
  drawDashedRect(ctx, coords.back, canvas.width, canvas.height, '#A66A17', 'BACK');
}

function drawDashedRect(ctx, box, cw, ch, color, label){
  const x = box.x/100*cw, y = box.y/100*ch, w = box.w/100*cw, h = box.h/100*ch;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(2, cw*0.003);
  ctx.setLineDash([8,6]);
  ctx.strokeRect(x,y,w,h);
  ctx.setLineDash([]);
  ctx.fillStyle = color;
  ctx.font = `bold ${Math.max(14, Math.round(cw*0.02))}px sans-serif`;
  ctx.fillText(label, x+6, y+18);
  ctx.restore();
}

document.querySelectorAll('#modal-idcard-map input[type="number"]').forEach(inp => {
  inp.addEventListener('input', drawIdMapPreview);
});

document.getElementById('btn-idcard-save-map').addEventListener('click', () => {
  const coords = getIdMapFieldValues();
  state.idCard = { pdfBase64: idmapPdfBase64, coords };
  saveState();
  closeModal('modal-idcard-map');
  renderIdCardSettingsRow();
  showToast('ID card saved');
});

function preloadMockupImage(){
  if(idCardMockupImg) return Promise.resolve(idCardMockupImg);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => { idCardMockupImg = img; resolve(img); };
    img.onerror = reject;
    img.src = 'assets/id-card-mockup.png';
  });
}

function roundRectPath(ctx, x, y, w, h, r){
  ctx.beginPath();
  ctx.moveTo(x+r, y);
  ctx.arcTo(x+w, y, x+w, y+h, r);
  ctx.arcTo(x+w, y+h, x, y+h, r);
  ctx.arcTo(x, y+h, x, y, r);
  ctx.arcTo(x, y, x+w, y, r);
  ctx.closePath();
}

async function compositeIdCard(side){
  const mockup = await preloadMockupImage();
  if(!idmapSourceCanvas || idmapPdfBase64 !== state.idCard.pdfBase64){
    idmapSourceCanvas = await renderPdfPageToCanvas(state.idCard.pdfBase64, 1000);
    idmapPdfBase64 = state.idCard.pdfBase64;
  }
  const canvas = document.getElementById('idcard-render-canvas');
  canvas.width = mockup.naturalWidth;
  canvas.height = mockup.naturalHeight;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(mockup, 0, 0);

  const coords = state.idCard.coords[side];
  const srcX = coords.x/100 * idmapSourceCanvas.width;
  const srcY = coords.y/100 * idmapSourceCanvas.height;
  const srcW = coords.w/100 * idmapSourceCanvas.width;
  const srcH = coords.h/100 * idmapSourceCanvas.height;

  const destX = MOCKUP_CARD_RECT.xPct/100 * canvas.width;
  const destY = MOCKUP_CARD_RECT.yPct/100 * canvas.height;
  const destW = MOCKUP_CARD_RECT.wPct/100 * canvas.width;
  const destH = MOCKUP_CARD_RECT.hPct/100 * canvas.height;

  // cover-fit crop so the uploaded card isn't stretched/distorted to fit the mockup
  const srcAspect = srcW / srcH, destAspect = destW / destH;
  let cropW = srcW, cropH = srcH, cropX = srcX, cropY = srcY;
  if(srcAspect > destAspect){
    cropW = srcH * destAspect;
    cropX = srcX + (srcW - cropW) / 2;
  } else {
    cropH = srcW / destAspect;
    cropY = srcY + (srcH - cropH) / 2;
  }

  ctx.save();
  roundRectPath(ctx, destX, destY, destW, destH, Math.min(destW, destH) * 0.045);
  ctx.clip();
  ctx.drawImage(idmapSourceCanvas, cropX, cropY, cropW, cropH, destX, destY, destW, destH);
  ctx.restore();
}

async function openIdCardViewer(){
  if(!state.idCard || !state.idCard.pdfBase64){
    showToast('No ID card uploaded yet — add one from Settings');
    return;
  }
  closePanel('panel-profile');
  idCardCurrentSide = 'front';
  try{
    await compositeIdCard('front');
  }catch(err){
    console.error(err);
    showToast('Could not render your ID card');
    return;
  }
  document.getElementById('idcard-viewer').classList.add('is-open');
}

document.getElementById('btn-idcard-flip').addEventListener('click', () => {
  const stage = document.querySelector('.idcard-viewer__stage');
  stage.classList.add('is-flipping');
  setTimeout(async () => {
    idCardCurrentSide = idCardCurrentSide === 'front' ? 'back' : 'front';
    try{ await compositeIdCard(idCardCurrentSide); }catch(err){ console.error(err); }
    stage.classList.remove('is-flipping');
  }, 220);
});

document.getElementById('btn-idcard-close').addEventListener('click', () => {
  document.getElementById('idcard-viewer').classList.remove('is-open');
});

// =========================================================
// DYNAMIC STATE ENGINE + NOTIFICATIONS (polling loop)
// =========================================================
function tick(){
  if(document.getElementById('view-classes').classList.contains('is-active')) renderTimeline();
  if(document.getElementById('view-dashboard').classList.contains('is-active')) renderDashboard();
  if(document.getElementById('view-works').classList.contains('is-active')) renderWorks();
  if(document.getElementById('view-events').classList.contains('is-active')) renderEvents();
  checkUpcomingNotifications();
}

function checkUpcomingNotifications(){
  if(!state.settings.notifications) return;
  if(!('Notification' in window) || Notification.permission !== 'granted') return;

  const now = new Date();
  const nowMin = minutesNowInDay(now);
  const instances = getInstancesForDate(now);

  instances.forEach(instance => {
    const startMin = timeToMinutes(instance.start);
    const minsUntil = startMin - nowMin;
    if(minsUntil <= 15 && minsUntil >= 0 && !state.notifiedKeys[instance.instanceKey]){
      fireNotification(instance, minsUntil);
      state.notifiedKeys[instance.instanceKey] = true;
      saveState();
    }
  });
}

function fireNotification(instance, minsUntil){
  try{
    const n = new Notification(`${instance.subject} starts soon`, {
      body: `${minsUntil <= 0 ? 'Starting now' : `In ${minsUntil} min`} · ${instance.building}, Room ${instance.room}`,
      tag: instance.instanceKey,
      icon: undefined
    });
    n.onclick = () => window.focus();
  }catch(e){ console.warn('Notification failed', e); }
  if(state.settings.vibration && navigator.vibrate) navigator.vibrate([80,40,80]);
}

// clean up notifiedKeys older than 2 days so storage doesn't grow forever
function pruneNotifiedKeys(){
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate()-2);
  const cutoffISO = todayISO(cutoff);
  Object.keys(state.notifiedKeys).forEach(key => {
    const dateStr = key.split('__')[1];
    if(dateStr && dateStr < cutoffISO) delete state.notifiedKeys[key];
  });
}

// =========================================================
// INIT
// =========================================================
function refreshAllViews(){
  renderDashboard();
  renderTimeline();
  renderWorks();
  renderEvents();
  renderSettings();
}

function getInitialView(){
  const hash = (location.hash || '').replace('#','');
  if(VALID_VIEWS.includes(hash)) return hash;
  if(state.settings.defaultTab === 'classes') return 'classes';
  if(state.settings.defaultTab === 'works') return 'works';
  return 'dashboard';
}

function init(){
  applyTheme();
  pruneNotifiedKeys();
  saveState();
  renderAvatar();

  switchView(getInitialView());

  setInterval(tick, 20000);
}

init();
