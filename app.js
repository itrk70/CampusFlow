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
    works: [],             // {id, subject, type:'assignment'|'lab'|'ppt'|'quiz'|'workshop'|'onlineexam'|'nptel'|'other', otherType?, dueDate:'YYYY-MM-DD', completed:bool}
    completed: {},        // key `${classId}__${YYYY-MM-DD}` -> true
    planner: [],           // {id, kind:'exam'|'event', name, examType, building, room, date, mode:'partial'|'complete', start, end}
    notes: [],             // {id, title, body(html), updatedAt}
    activePreset: null,   // e.g. "CSE-E1" — which preset's classes are currently auto-applied (null = none / manual only)
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
  if(str === null || str === undefined || str === '') return '';
  return String(str).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}
function escapeAttr(str){ return String(str ?? '').replace(/"/g,'&quot;'); }

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

  // exams / events cancel classes: complete-day cancels everything, partial cancels overlapping classes
  const plans = plannerForDate(iso);
  if(plans.length){
    instances.forEach(inst => {
      const hit = plans.find(p => p.mode === 'complete' ||
        (p.start && p.end && timeToMinutes(inst.start) < timeToMinutes(p.end) && timeToMinutes(inst.end) > timeToMinutes(p.start)));
      if(hit) inst.canceledBy = hit;
    });
  }
  return instances;
}

function computeStatus(instance, now){
  if(instance.canceledBy) return 'canceled';
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

  const todays = getInstancesForDate(now).filter(i => !i.canceledBy);
  document.getElementById('stat-today').textContent = todays.length;

  const todayISOStr = todayISO(now);
  const extraToday = todays.filter(i => i.kind === 'extra').length;
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
    const hasEvents = getInstancesForDate(d).some(i => !i.canceledBy);

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

function daysUntil(iso, now){
  const a = new Date(iso + 'T00:00:00');
  const b = new Date(todayISO(now) + 'T00:00:00');
  return Math.round((a - b) / 86400000);
}

// "Urgent works": not completed and due today, tomorrow or the day after
function renderDashboardWorksPreview(){
  const now = new Date();
  const panel = document.getElementById('urgent-panel');
  const list = document.getElementById('urgent-list');
  if(!panel || !list) return;
  const urgent = state.works
    .filter(w => !w.completed)
    .map(w => ({ w, d: daysUntil(w.dueDate, now) }))
    .filter(x => x.d >= 0 && x.d <= 2)
    .sort((a,b) => a.d - b.d || a.w.subject.localeCompare(b.w.subject));

  panel.hidden = urgent.length === 0;
  if(urgent.length === 0){ list.innerHTML = ''; return; }
  list.innerHTML = urgent.map(({w,d}) => {
    const badge = d === 0 ? 'TODAY' : (d === 1 ? '1 DAY LEFT' : '2 DAYS LEFT');
    const due = new Date(w.dueDate + 'T00:00:00').toLocaleDateString(undefined, { weekday:'short', day:'numeric', month:'short' });
    return `
      <button class="urgent-card" data-days="${d}" data-go-works>
        <span class="urgent-card__badge">${badge}</span>
        <span class="urgent-card__main">
          <span class="urgent-card__name">${escapeHtml(w.subject)}</span>
          <span class="urgent-card__meta">${escapeHtml(workTypeLabel(w))} · Due ${due}</span>
        </span>
        <span class="urgent-card__arrow">›</span>
      </button>`;
  }).join('');
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

  const plans = plannerForDate(todayISO(viewingDate))
    .sort((a,b) => (a.start || '00:00').localeCompare(b.start || '00:00'));

  if(instances.length === 0 && plans.length === 0){
    list.innerHTML = '';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  const planHtml = plans.map(p => `
      <li class="timeline-card planner-card" data-kind="${p.kind}">
        <div class="timeline-card__top">
          <div>
            <div class="timeline-card__subject">${escapeHtml(p.name)}<span class="chip-plan">${p.kind === 'exam' ? 'EXAM' : 'EVENT'}</span></div>
            ${p.kind === 'exam' && p.examType ? `<div class="timeline-card__professor">${escapeHtml(p.examType)}</div>` : ''}
          </div>
        </div>
        <div class="timeline-card__meta">${plannerTimeLabel(p)}${p.building || p.room ? ' · ' + escapeHtml([p.building, p.room].filter(Boolean).join(', ')) : ''}</div>
      </li>`).join('');

  list.innerHTML = planHtml + instances.map(instance => {
    const status = computeStatus(instance, now);
    const checked = status === 'completed';
    const canceled = status === 'canceled';
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
          ${canceled
            ? `<span class="cancel-reason">Canceled · ${escapeHtml(instance.canceledBy.name)}</span>`
            : `<span class="check-row${checked ? ' is-checked' : ''}" data-toggle-complete="${instance.instanceKey}">
            <span class="check-box">
              <svg viewBox="0 0 24 24" fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L19 8"/></svg>
            </span>
            Mark as completed
          </span>`}
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
  return { upcoming:'Upcoming', ongoing:'Ongoing', missed:'Missed', completed:'Completed', canceled:'Canceled' }[status] || status;
}

function renderDashboardStatsQuiet(){
  if(document.getElementById('view-dashboard').classList.contains('is-active')) renderDashboard();
}

// =========================================================
// RENDER: WORKS
// =========================================================
function computeWorkStatus(work, now){
  if(work.completed) return 'done';
  const todayISOStr = todayISO(now);
  if(work.dueDate < todayISOStr) return 'overdue'; // due date has fully passed (past midnight of that day)
  return 'pending'; // not yet due, or due today but the day hasn't ended yet
}

// ---------- work types ----------
const WORK_TYPES = [
  { value:'assignment', label:'Assignment' },
  { value:'lab',        label:'Lab Work' },
  { value:'ppt',        label:'PPT' },
  { value:'quiz',       label:'Quiz' },
  { value:'workshop',   label:'Workshop' },
  { value:'onlineexam', label:'Online Exam' },
  { value:'nptel',      label:'NPTEL' },
  { value:'other',      label:'Other' }
];
function workTypeKey(w){ return WORK_TYPES.some(t => t.value === w.type) ? w.type : 'assignment'; }
function workTypeLabel(w){
  const key = workTypeKey(w);
  if(key === 'other') return (w.otherType || '').trim() || 'Other';
  return WORK_TYPES.find(t => t.value === key).label;
}
const workFilter = new Set(WORK_TYPES.map(t => t.value)); // all checked by default

function renderWorks(){
  const now = new Date();
  const list = document.getElementById('works-list');
  const empty = document.getElementById('works-empty');
  if(!list) return;

  const all = [...state.works].sort((a,b) => a.dueDate.localeCompare(b.dueDate));
  const works = all.filter(w => workFilter.has(workTypeKey(w)));
  const pendingCount = all.filter(w => computeWorkStatus(w, now) === 'pending').length;
  const filtering = workFilter.size !== WORK_TYPES.length;
  document.getElementById('works-summary-line').textContent =
    all.length === 0 ? 'Assignments, labs & more' : `${pendingCount} not completed · ${all.length} total${filtering ? ' · filtered' : ''}`;

  if(works.length === 0){
    list.innerHTML = '';
    document.getElementById('works-empty-title').textContent = all.length === 0 ? 'No works added yet' : 'No works match this filter';
    document.getElementById('works-empty-body').textContent = all.length === 0
      ? "Track assignments, labs, quizzes and more with due dates — they'll show up here."
      : 'Tick more types in the filter to see the rest of your works.';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  list.innerHTML = works.map(w => {
    const status = computeWorkStatus(w, now); // 'pending' | 'overdue' | 'done'
    const checked = status === 'done';
    const pillLabel = status === 'done' ? 'Completed' : 'Not Completed';
    const key = workTypeKey(w);
    return `
      <li class="timeline-card work-card${key === 'nptel' ? ' work-card--nptel' : ''}" data-status="${status}" data-type="${key}" data-work-id="${w.id}">
        <div class="timeline-card__top">
          <div>
            <div class="timeline-card__subject">${escapeHtml(w.subject)}<span class="type-chip">${escapeHtml(workTypeLabel(w))}</span></div>
          </div>
          <span class="status-pill" data-status="${status}">${pillLabel}</span>
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

function buildWorkTypeRow(){
  const row = document.getElementById('work-type-row');
  row.innerHTML = WORK_TYPES.map((t,i) =>
    `<label class="radio-chip"><input type="radio" name="work-type" value="${t.value}"${i === 0 ? ' checked' : ''}><span>${t.label}</span></label>`
  ).join('');
  row.addEventListener('change', syncWorkOtherField);
}
function syncWorkOtherField(){
  const checked = document.querySelector('input[name="work-type"]:checked');
  const isOther = !!checked && checked.value === 'other';
  document.getElementById('work-other-field').hidden = !isOther;
  document.getElementById('work-other-type').required = isOther;
  if(isOther) setTimeout(() => document.getElementById('work-other-type').focus(), 30);
}

function openWorkModal(existing){
  const form = document.getElementById('form-work');
  form.reset();
  document.getElementById('modal-work-title').textContent = existing ? 'Edit work' : 'Add work';
  document.getElementById('work-id').value = existing ? existing.id : '';
  document.getElementById('work-subject').value = existing ? existing.subject : '';
  document.getElementById('work-duedate').value = existing ? existing.dueDate : '';
  const key = existing ? workTypeKey(existing) : 'assignment';
  document.querySelectorAll('input[name="work-type"]').forEach(r => { r.checked = r.value === key; });
  document.getElementById('work-other-type').value = existing && key === 'other' ? (existing.otherType || '') : '';
  syncWorkOtherField();
  document.getElementById('btn-delete-work').hidden = !existing;
  openModal('modal-work');
}

document.getElementById('form-work').addEventListener('submit', (e) => {
  e.preventDefault();
  const id = document.getElementById('work-id').value || uid();
  const type = document.querySelector('input[name="work-type"]:checked').value;
  const otherType = document.getElementById('work-other-type').value.trim();
  if(type === 'other' && !otherType){ showToast('Please specify the type of work'); return; }
  const existing = state.works.find(w => w.id === id);
  const payload = {
    id,
    subject: document.getElementById('work-subject').value.trim(),
    type,
    dueDate: document.getElementById('work-duedate').value,
    completed: existing ? existing.completed : false
  };
  if(type === 'other') payload.otherType = otherType;
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
function getEventEndDate(ev){
  if(ev.endTime){
    return new Date(`${ev.date}T${ev.endTime}:00`);
  }
  const endDT = new Date(`${ev.date}T00:00:00`);
  endDT.setDate(endDT.getDate() + 1); // no end time given -> treated as ending at midnight that night
  return endDT;
}

function eventStatus(ev, now){
  const startDT = new Date(`${ev.date}T${ev.startTime}:00`);
  const endDT = getEventEndDate(ev);
  if(now < startDT) return 'Upcoming';
  if(now >= startDT && now < endDT) return 'Ongoing';
  return 'Closed';
}

// events auto-drop from the visible list 10 days after their end date/time —
// events-data.js is a static admin file the app can't write back to, so
// "deleting" here means filtering it out of what's rendered, not editing the file
const EVENT_EXPIRY_DAYS = 10;
function isEventExpired(ev, now){
  const endDT = getEventEndDate(ev);
  const cutoff = new Date(endDT);
  cutoff.setDate(cutoff.getDate() + EVENT_EXPIRY_DAYS);
  return now >= cutoff;
}

let visibleEvents = [];

function formatMar(v){
  if(v === null || v === undefined || v === '') return 'MAR Point: N/A';
  const n = Number(v);
  return 'MAR Points: ' + (Number.isFinite(n) ? String(n).padStart(2,'0') : String(v));
}

function renderEvents(){
  const now = new Date();
  const list = document.getElementById('events-list');
  const empty = document.getElementById('events-empty');
  if(!list) return;

  const events = (window.CAMPUSFLOW_EVENTS || []).slice()
    .filter(ev => !isEventExpired(ev, now))
    .sort((a,b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));
  visibleEvents = events;

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

  list.innerHTML = events.map((ev, i) => {
    const status = eventStatus(ev, now);
    const statusAttr = status === 'Upcoming' ? 'upcoming' : (status === 'Ongoing' ? 'ongoing' : 'closed');
    const endLabel = ev.endTime ? ` – ${formatTime12(ev.endTime)}` : '';
    return `
      <div class="event-card is-clickable" data-event-index="${i}" role="button" tabindex="0" aria-label="View details: ${escapeAttr(ev.name)}">
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

function openEventDetail(index){
  const ev = visibleEvents[index];
  if(!ev) return;
  const now = new Date();
  const status = eventStatus(ev, now);
  const statusAttr = status === 'Upcoming' ? 'upcoming' : (status === 'Ongoing' ? 'ongoing' : 'closed');
  const endLabel = ev.endTime ? ` – ${formatTime12(ev.endTime)}` : '';
  document.getElementById('event-detail-body').innerHTML = `
    ${ev.image ? `<img class="event-detail__banner" src="${escapeAttr(ev.image)}" alt="${escapeAttr(ev.name)} banner">` : '<div class="event-detail__spacer"></div>'}
    <div class="event-detail__content">
      <div class="event-detail__top">
        <h2 class="event-detail__name">${escapeHtml(ev.name)}</h2>
        <span class="status-pill" data-status="${statusAttr}">${status}</span>
      </div>
      <dl class="event-detail__facts">
        <div><dt>Date</dt><dd>${formatDateLong(new Date(ev.date + 'T00:00:00'))}</dd></div>
        <div><dt>Time</dt><dd>${formatTime12(ev.startTime)}${endLabel}</dd></div>
        <div><dt>Venue</dt><dd>${escapeHtml(ev.venue)}</dd></div>
        <div><dt>MAR</dt><dd class="event-detail__mar">${escapeHtml(formatMar(ev.mar))}</dd></div>
      </dl>
      <p class="event-detail__desc">${escapeHtml(ev.description)}</p>
    </div>`;
  document.getElementById('event-detail-body').scrollTop = 0;
  openModal('modal-event');
}

document.getElementById('events-list').addEventListener('click', (e) => {
  const card = e.target.closest('[data-event-index]');
  if(card) openEventDetail(Number(card.getAttribute('data-event-index')));
});
document.getElementById('events-list').addEventListener('keydown', (e) => {
  if(e.key !== 'Enter' && e.key !== ' ') return;
  const card = e.target.closest('[data-event-index]');
  if(card){ e.preventDefault(); openEventDetail(Number(card.getAttribute('data-event-index'))); }
});

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
    else sub = `${workTypeLabel(item)} · Due ${formatDateLong(new Date(item.dueDate + 'T00:00:00'))}`;
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
let extraMultiDates = [];

function renderExtraDateChips(){
  const box = document.getElementById('extra-date-chips');
  box.innerHTML = extraMultiDates.map(d => `
    <span class="date-chip">${new Date(d + 'T00:00:00').toLocaleDateString(undefined, { day:'numeric', month:'short', year:'numeric' })}
      <button type="button" data-remove-date="${d}" aria-label="Remove date">×</button></span>`).join('');
}

function openExtraModal(existing){
  const form = document.getElementById('form-extra');
  form.reset();
  extraMultiDates = [];
  renderExtraDateChips();
  document.getElementById('extra-multi-box').hidden = true;
  document.getElementById('extra-multi-wrap').hidden = !!existing; // repeating only applies when creating
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

document.getElementById('extra-multiple').addEventListener('change', (e) => {
  document.getElementById('extra-multi-box').hidden = !e.target.checked;
});

function addExtraRepeatDate(){
  const input = document.getElementById('extra-extra-date');
  const val = input.value;
  if(!val) return false;
  if(val === document.getElementById('extra-date').value){ showToast('That is already the main date'); return false; }
  if(extraMultiDates.includes(val)){ showToast('Date already added'); return false; }
  extraMultiDates.push(val);
  extraMultiDates.sort();
  input.value = '';
  renderExtraDateChips();
  return true;
}
document.getElementById('btn-extra-add-date').addEventListener('click', addExtraRepeatDate);
document.getElementById('extra-extra-date').addEventListener('keydown', (e) => {
  if(e.key === 'Enter'){ e.preventDefault(); addExtraRepeatDate(); }
});
document.getElementById('extra-date-chips').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-remove-date]');
  if(!btn) return;
  extraMultiDates = extraMultiDates.filter(d => d !== btn.getAttribute('data-remove-date'));
  renderExtraDateChips();
});

document.getElementById('form-extra').addEventListener('submit', (e) => {
  e.preventDefault();
  const existingId = document.getElementById('extra-id').value;
  const start = document.getElementById('extra-start').value;
  const end = document.getElementById('extra-end').value;
  if(timeToMinutes(end) <= timeToMinutes(start)){ showToast('End time must be after start time'); return; }

  const mainDate = document.getElementById('extra-date').value;
  let dates = [mainDate];
  if(!existingId && document.getElementById('extra-multiple').checked){
    if(document.getElementById('extra-extra-date').value) addExtraRepeatDate(); // a typed-but-not-added date still counts
    if(extraMultiDates.length === 0){ showToast('Add at least one more date'); return; }
    dates = Array.from(new Set([mainDate, ...extraMultiDates])).sort();
  }

  const base = {
    subject: document.getElementById('extra-subject').value.trim(),
    professor: document.getElementById('extra-professor').value.trim(),
    building: document.getElementById('extra-building').value.trim(),
    room: document.getElementById('extra-room').value.trim(),
    start, end
  };
  if(existingId){
    const payload = { ...base, id: existingId, date: mainDate };
    const idx = state.extraSessions.findIndex(s => s.id === existingId);
    if(idx >= 0) state.extraSessions[idx] = payload; else state.extraSessions.push(payload);
  } else {
    dates.forEach(d => state.extraSessions.push({ ...base, id: uid(), date: d }));
  }
  saveState();
  closeModal('modal-extra');
  refreshAllViews();
  showToast(dates.length > 1 && !existingId ? `${dates.length} sessions saved` : 'Session saved');
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
const VALID_VIEWS = ['dashboard','classes','works','planner','notes','events','settings'];

function switchView(name){
  if(!VALID_VIEWS.includes(name)) name = 'dashboard';
  document.querySelectorAll('.view').forEach(v => v.classList.remove('is-active'));
  document.getElementById(`view-${name}`).classList.add('is-active');
  document.querySelectorAll('.nav-btn, .topnav-link').forEach(b => b.classList.toggle('is-active', b.getAttribute('data-view') === name));

  if(name === 'dashboard') renderDashboard();
  if(name === 'classes') renderTimeline();
  if(name === 'works') renderWorks();
  if(name === 'planner') renderPlanner();
  if(name === 'notes') renderNotes();
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
document.getElementById('btn-add-work').addEventListener('click', () => openWorkModal(null));
document.getElementById('btn-add-note').addEventListener('click', () => openNoteEditor(null));
document.getElementById('btn-fab-add-planner').addEventListener('click', () => openPlannerModal(null));
document.getElementById('btn-fab-add-note').addEventListener('click', () => openNoteEditor(null));
document.getElementById('urgent-list').addEventListener('click', (e) => { if(e.target.closest('[data-go-works]')) switchView('works'); });
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
  const presetHint = document.getElementById('preset-current-hint');
  presetHint.textContent = state.activePreset
    ? `Currently applied: ${state.activePreset}. Picking a different one will replace it.`
    : 'No preset applied yet — pick one above to auto-fill your regular classes.';
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
document.getElementById('btn-apply-preset').addEventListener('click', () => {
  const val = document.getElementById('select-preset').value;
  if(!val){ showToast('Pick a class & group first'); return; }
  const presets = window.CAMPUSFLOW_PRESETS || {};
  const data = presets[val];
  if(!data || !Array.isArray(data.regularClasses)){
    showToast('That preset isn\'t available yet');
    return;
  }
  const previousPreset = state.activePreset;
  const previousCount = previousPreset ? state.regularClasses.filter(c => c._presetTag === previousPreset).length : 0;
  const isSamePreset = previousPreset === val;

  const message = previousPreset && !isSamePreset
    ? `This removes your ${previousCount} previously auto-added ${previousPreset} class(es) and adds ${data.regularClasses.length} for ${val} instead. Any classes, works, or sessions you added yourself are left untouched.`
    : (previousPreset && isSamePreset
      ? `${val} is already applied. This will refresh it — removing the ${previousCount} existing ${val} class(es) and re-adding ${data.regularClasses.length} fresh ones.`
      : `This adds ${data.regularClasses.length} regular class(es) for ${val} to your schedule. You can edit or remove any of them afterward.`);

  confirmDialog(`Add ${val} classes?`, message, () => {
    if(previousPreset){
      state.regularClasses = state.regularClasses.filter(c => c._presetTag !== previousPreset);
    }
    data.regularClasses.forEach(c => state.regularClasses.push({ ...c, id: uid(), _presetTag: val }));
    state.activePreset = val;
    saveState();
    refreshAllViews();
    showToast(`${val} classes added`);
  });
});

// =========================================================
// CLEAR DATA
// =========================================================
document.getElementById('btn-clear-data').addEventListener('click', () => {
  confirmDialog(
    'Clear local schedule data?',
    'This permanently deletes every regular class, extra session, work, exam/event and completion mark stored on this device. Your notes, settings, ID card and profile picture stay as they are.',
    () => {
      state.regularClasses = [];
      state.extraSessions = [];
      state.works = [];
      state.planner = [];
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
    extraSessions: state.extraSessions,
    works: state.works,
    planner: state.planner,
    notes: state.notes
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
        `This adds ${data.regularClasses.length} regular class(es), ${data.extraSessions.length} extra session(s)${Array.isArray(data.works) ? `, ${data.works.length} work(s)` : ''}${Array.isArray(data.planner) ? `, ${data.planner.length} exam/event(s)` : ''}${Array.isArray(data.notes) ? ` and ${data.notes.length} note(s)` : ''} to your current data.`,
        () => {
          data.regularClasses.forEach(c => state.regularClasses.push({ ...c, id: uid() }));
          data.extraSessions.forEach(s => state.extraSessions.push({ ...s, id: uid() }));
          if(Array.isArray(data.works)) data.works.forEach(w => state.works.push({ ...w, id: uid() }));
          if(Array.isArray(data.planner)) data.planner.forEach(p => state.planner.push({ ...p, id: uid() }));
          if(Array.isArray(data.notes)) data.notes.forEach(n => state.notes.push({ ...n, id: uid(), body: sanitizeNoteHtml(n.body || '') }));
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
  const nowISO = todayISO();
  if(lastPruneDay !== null && nowISO !== lastPruneDay){
    lastPruneDay = nowISO;
    if(pruneOldWorks()) saveState();
  }
  if(document.getElementById('view-classes').classList.contains('is-active')) renderTimeline();
  if(document.getElementById('view-dashboard').classList.contains('is-active')) renderDashboard();
  if(document.getElementById('view-works').classList.contains('is-active')) renderWorks();
  if(document.getElementById('view-planner').classList.contains('is-active')) renderPlanner();
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
    if(instance.canceledBy) return; // canceled by an exam/event
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

// auto-remove works whose due date is more than 7 days in the past, completed or not
function pruneOldWorks(){
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate()-7);
  const cutoffISO = todayISO(cutoff);
  const before = state.works.length;
  state.works = state.works.filter(w => w.dueDate >= cutoffISO);
  return state.works.length !== before;
}

// =========================================================
// PLANNER — exams & events (cancel classes)
// =========================================================
function plannerForDate(iso){ return (state.planner || []).filter(p => p.date === iso); }

function plannerTimeLabel(p){
  if(p.mode === 'complete') return 'Complete day' + (p.start && p.end ? ` · ${formatTime12(p.start)} – ${formatTime12(p.end)}` : '');
  return `${formatTime12(p.start)} – ${formatTime12(p.end)}`;
}

function plannerStatus(p, now){
  let startDT, endDT;
  if(p.mode === 'complete'){
    startDT = new Date(`${p.date}T00:00:00`);
    endDT = new Date(startDT); endDT.setDate(endDT.getDate() + 1);
  } else {
    startDT = new Date(`${p.date}T${p.start}:00`);
    endDT = new Date(`${p.date}T${p.end}:00`);
  }
  if(now < startDT) return 'upcoming';
  if(now < endDT) return 'ongoing';
  return 'closed';
}

function renderPlanner(){
  const list = document.getElementById('planner-list');
  const empty = document.getElementById('planner-empty');
  if(!list) return;
  const now = new Date();
  const items = [...(state.planner || [])].sort((a,b) => (a.date + (a.start || '00:00')).localeCompare(b.date + (b.start || '00:00')));
  const upcoming = items.filter(p => plannerStatus(p, now) !== 'closed').length;
  document.getElementById('planner-summary-line').textContent =
    items.length === 0 ? 'Exams, holidays & special events' : `${upcoming} upcoming · ${items.length} total`;

  if(items.length === 0){ list.innerHTML = ''; empty.hidden = false; return; }
  empty.hidden = true;

  list.innerHTML = items.map(p => {
    const status = plannerStatus(p, now);
    const label = status === 'upcoming' ? 'Upcoming' : (status === 'ongoing' ? 'Ongoing' : 'Closed');
    const place = [p.building, p.room].filter(Boolean).join(', ');
    return `
      <li class="timeline-card planner-card" data-kind="${p.kind}" data-status="${status}">
        <div class="timeline-card__top">
          <div>
            <div class="timeline-card__subject">${escapeHtml(p.name)}<span class="chip-plan">${p.kind === 'exam' ? 'EXAM' : 'EVENT'}</span></div>
            ${p.kind === 'exam' && p.examType ? `<div class="timeline-card__professor">${escapeHtml(p.examType)}</div>` : ''}
          </div>
          <span class="status-pill" data-status="${status}">${label}</span>
        </div>
        <div class="timeline-card__meta">${formatDateLong(new Date(p.date + 'T00:00:00'))}<br>${plannerTimeLabel(p)}</div>
        ${place ? `<div class="timeline-card__plaque"><span class="timeline-card__plaque-building">${escapeHtml(p.building || '—')}</span><span class="timeline-card__plaque-room">${escapeHtml(p.room || '—')}</span></div>` : ''}
        <div class="timeline-card__foot">
          <span class="cancel-note">${p.mode === 'complete' ? 'Cancels all classes that day' : 'Cancels classes in this time slot'}</span>
          <button class="link-btn" data-edit-planner="${p.id}">Edit</button>
        </div>
      </li>`;
  }).join('');

  list.querySelectorAll('[data-edit-planner]').forEach(el => {
    el.addEventListener('click', () => openPlannerModal(state.planner.find(p => p.id === el.getAttribute('data-edit-planner'))));
  });
}

function plannerKind(){ return document.querySelector('input[name="planner-kind"]:checked').value; }
function plannerMode(){ return document.querySelector('input[name="planner-mode"]:checked').value; }

function syncPlannerForm(){
  const isExam = plannerKind() === 'exam';
  const complete = plannerMode() === 'complete';
  document.getElementById('planner-name-label').textContent = isExam ? 'Subject name' : 'Event name';
  document.getElementById('planner-name').placeholder = isExam ? 'e.g. Data Structures' : 'e.g. Gandhi Jayanti';
  document.getElementById('planner-examtype-field').hidden = !isExam;
  document.getElementById('planner-examtype').required = isExam;
  document.getElementById('planner-building-label').textContent = isExam ? 'Building' : 'Building (optional)';
  document.getElementById('planner-room-label').textContent = isExam ? 'Room' : 'Room (optional)';
  document.getElementById('planner-building').required = isExam;
  document.getElementById('planner-room').required = isExam;
  document.getElementById('planner-start').required = !complete;
  document.getElementById('planner-end').required = !complete;
  document.getElementById('planner-start-label').textContent = complete ? 'Starts (optional)' : 'Starts';
  document.getElementById('planner-end-label').textContent = complete ? 'Ends (optional)' : 'Ends';
  document.getElementById('planner-mode-hint').textContent = complete
    ? 'Every class on this date is marked Canceled.'
    : 'Only classes that overlap this start–end time are marked Canceled.';
}
document.querySelectorAll('input[name="planner-kind"], input[name="planner-mode"]').forEach(r => r.addEventListener('change', syncPlannerForm));

function openPlannerModal(existing){
  document.getElementById('form-planner').reset();
  document.getElementById('modal-planner-title').textContent = existing ? 'Edit exam / event' : 'Add exam / event';
  document.getElementById('planner-id').value = existing ? existing.id : '';
  const kind = existing ? existing.kind : 'exam';
  const mode = existing ? existing.mode : 'partial';
  document.querySelectorAll('input[name="planner-kind"]').forEach(r => { r.checked = r.value === kind; });
  document.querySelectorAll('input[name="planner-mode"]').forEach(r => { r.checked = r.value === mode; });
  document.getElementById('planner-name').value = existing ? existing.name : '';
  document.getElementById('planner-examtype').value = existing ? existing.examType || '' : '';
  document.getElementById('planner-building').value = existing ? existing.building || '' : '';
  document.getElementById('planner-room').value = existing ? existing.room || '' : '';
  document.getElementById('planner-date').value = existing ? existing.date : todayISO();
  document.getElementById('planner-start').value = existing ? existing.start || '' : '';
  document.getElementById('planner-end').value = existing ? existing.end || '' : '';
  document.getElementById('btn-delete-planner').hidden = !existing;
  syncPlannerForm();
  openModal('modal-planner');
}

document.getElementById('form-planner').addEventListener('submit', (e) => {
  e.preventDefault();
  const kind = plannerKind();
  const mode = plannerMode();
  const start = document.getElementById('planner-start').value;
  const end = document.getElementById('planner-end').value;
  if(mode === 'partial' && !(start && end)){ showToast('Add a start and end time'); return; }
  if((start || end) && !(start && end)){ showToast('Add both start and end time, or leave both empty'); return; }
  if(start && end && timeToMinutes(end) <= timeToMinutes(start)){ showToast('End time must be after start time'); return; }

  const id = document.getElementById('planner-id').value || uid();
  const payload = {
    id, kind, mode,
    name: document.getElementById('planner-name').value.trim(),
    examType: kind === 'exam' ? document.getElementById('planner-examtype').value.trim() : '',
    building: document.getElementById('planner-building').value.trim(),
    room: document.getElementById('planner-room').value.trim(),
    date: document.getElementById('planner-date').value,
    start, end
  };
  const idx = state.planner.findIndex(p => p.id === id);
  if(idx >= 0) state.planner[idx] = payload; else state.planner.push(payload);
  saveState();
  closeModal('modal-planner');
  refreshAllViews();
  showToast(kind === 'exam' ? 'Exam saved' : 'Event saved');
});

document.getElementById('btn-delete-planner').addEventListener('click', () => {
  const id = document.getElementById('planner-id').value;
  confirmDialog('Delete this entry?', 'Any classes it canceled will be back on your schedule.', () => {
    state.planner = state.planner.filter(p => p.id !== id);
    saveState();
    closeModal('modal-planner');
    refreshAllViews();
    showToast('Deleted');
  });
});

// =========================================================
// NOTEPAD
// =========================================================
const NOTE_ALLOWED = new Set(['B','STRONG','I','EM','U','UL','OL','LI','BR','DIV','P']);
function sanitizeNoteHtml(html){
  const tpl = document.createElement('template');
  tpl.innerHTML = String(html || '');
  const walk = (node) => {
    Array.from(node.childNodes).forEach(ch => {
      if(ch.nodeType === 3) return;
      if(ch.nodeType !== 1 || ['SCRIPT','STYLE'].includes(ch.tagName)){ ch.remove(); return; }
      if(!NOTE_ALLOWED.has(ch.tagName)){
        walk(ch);
        while(ch.firstChild) node.insertBefore(ch.firstChild, ch);
        ch.remove();
        return;
      }
      Array.from(ch.attributes).forEach(a => ch.removeAttribute(a.name));
      walk(ch);
    });
  };
  walk(tpl.content);
  return tpl.innerHTML;
}
function noteToText(html){
  const d = document.createElement('div');
  d.innerHTML = String(html || '').replace(/<\/(li|div|p)>|<br\s*\/?>/gi, ' ');
  return d.textContent.replace(/\s+/g, ' ').trim();
}

let noteEditingId = null;

function renderNotes(){
  const list = document.getElementById('notes-list');
  const empty = document.getElementById('notes-empty');
  if(!list) return;
  const notes = [...(state.notes || [])].sort((a,b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  document.getElementById('notes-summary-line').textContent =
    notes.length === 0 ? 'Important & short notes' : `${notes.length} note${notes.length === 1 ? '' : 's'}`;
  if(notes.length === 0){ list.innerHTML = ''; empty.hidden = false; return; }
  empty.hidden = true;

  list.innerHTML = notes.map(n => {
    const preview = noteToText(n.body).slice(0, 160);
    const when = new Date(n.updatedAt || Date.now()).toLocaleDateString(undefined, { day:'numeric', month:'short', year:'numeric' });
    return `
      <li class="timeline-card note-card" data-open-note="${n.id}" tabindex="0">
        <div class="timeline-card__subject">${n.title ? escapeHtml(n.title) : '<em class="note-untitled">Untitled</em>'}</div>
        ${preview ? `<div class="note-card__preview">${escapeHtml(preview)}</div>` : ''}
        <div class="timeline-card__foot">
          <span class="timeline-card__meta" style="margin:0;">${when}</span>
          <button class="link-btn link-btn--danger" data-delete-note="${n.id}">Delete</button>
        </div>
      </li>`;
  }).join('');
}

document.getElementById('notes-list').addEventListener('click', (e) => {
  const del = e.target.closest('[data-delete-note]');
  if(del){
    const id = del.getAttribute('data-delete-note');
    confirmDialog('Delete this note?', "This can't be undone.", () => {
      state.notes = state.notes.filter(n => n.id !== id);
      saveState();
      renderNotes();
      showToast('Note deleted');
    });
    return;
  }
  const card = e.target.closest('[data-open-note]');
  if(card) openNoteEditor(state.notes.find(n => n.id === card.getAttribute('data-open-note')));
});
document.getElementById('notes-list').addEventListener('keydown', (e) => {
  if(e.key !== 'Enter' || e.target.closest('button')) return;
  const card = e.target.closest('[data-open-note]');
  if(card) openNoteEditor(state.notes.find(n => n.id === card.getAttribute('data-open-note')));
});

function openNoteEditor(note){
  noteEditingId = note ? note.id : null;
  document.getElementById('note-title').value = note ? note.title || '' : '';
  document.getElementById('note-body').innerHTML = note ? sanitizeNoteHtml(note.body) : '';
  closeNoteMenu();
  document.getElementById('note-editor').hidden = false;
  setTimeout(() => { if(!note) document.getElementById('note-title').focus(); }, 40);
}
function closeNoteEditor(){
  // nothing is written to storage here — unsaved text is simply discarded
  document.getElementById('note-editor').hidden = true;
  closeNoteMenu();
  noteEditingId = null;
}
function closeNoteMenu(){
  document.getElementById('note-menu').hidden = true;
  document.getElementById('btn-note-menu').setAttribute('aria-expanded', 'false');
}

document.getElementById('btn-note-menu').addEventListener('click', (e) => {
  e.stopPropagation();
  const menu = document.getElementById('note-menu');
  const open = menu.hidden;
  menu.hidden = !open;
  e.currentTarget.setAttribute('aria-expanded', open ? 'true' : 'false');
});
document.addEventListener('click', (e) => {
  if(!e.target.closest('.note-menu-wrap')) closeNoteMenu();
});

document.getElementById('btn-note-save').addEventListener('click', () => {
  const body = document.getElementById('note-body');
  const title = document.getElementById('note-title').value.trim();
  const hasBody = body.textContent.trim().length > 0 || !!body.querySelector('li');
  if(!title && !hasBody){ closeNoteMenu(); showToast('Add a title or some text first'); return; }

  const payload = { id: noteEditingId || uid(), title, body: sanitizeNoteHtml(body.innerHTML), updatedAt: Date.now() };
  const idx = state.notes.findIndex(n => n.id === payload.id);
  if(idx >= 0) state.notes[idx] = payload; else state.notes.push(payload);
  noteEditingId = payload.id; // later saves update this same note
  saveState();
  renderNotes();
  closeNoteMenu();
  showToast('Note Saved');
});
document.getElementById('btn-note-close').addEventListener('click', closeNoteEditor);

// toolbar: mousedown + preventDefault keeps the text selection while formatting
document.getElementById('note-toolbar').addEventListener('mousedown', (e) => {
  if(e.target.closest('button')) e.preventDefault();
});
document.getElementById('note-toolbar').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-cmd]');
  if(!btn) return;
  document.getElementById('note-body').focus();
  document.execCommand(btn.getAttribute('data-cmd'), false, null);
});
document.getElementById('note-body').addEventListener('input', (e) => {
  const body = e.currentTarget;
  if(!body.textContent.trim() && !body.querySelector('li')) body.innerHTML = ''; // keeps the "Body" placeholder visible
});
document.getElementById('note-body').addEventListener('paste', (e) => {
  e.preventDefault(); // plain text only
  const text = (e.clipboardData || window.clipboardData).getData('text/plain');
  document.execCommand('insertText', false, text);
});

document.addEventListener('keydown', (e) => {
  if(e.key !== 'Escape') return;
  if(!document.getElementById('note-menu').hidden){ closeNoteMenu(); return; }
  document.querySelectorAll('.modal-backdrop.is-open').forEach(m => m.classList.remove('is-open'));
});

// work type chips + filter
function buildWorkFilter(){
  const box = document.getElementById('work-filter-options');
  box.innerHTML = WORK_TYPES.map(t =>
    `<label class="filter-check"><input type="checkbox" value="${t.value}" checked><span>${t.label}</span></label>`
  ).join('');
  box.addEventListener('change', (e) => {
    const cb = e.target;
    if(cb.checked) workFilter.add(cb.value); else workFilter.delete(cb.value);
    renderWorks();
  });
}
function setWorkFilterOpen(open){
  document.getElementById('work-filter-panel').classList.toggle('is-open', open);
  document.getElementById('work-filter-panel').setAttribute('aria-hidden', open ? 'false' : 'true');
  const btn = document.getElementById('btn-work-filter');
  btn.classList.toggle('is-open', open);
  btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  btn.setAttribute('aria-label', open ? 'Close filter' : 'Filter works');
}
document.getElementById('btn-work-filter').addEventListener('click', () => {
  setWorkFilterOpen(!document.getElementById('work-filter-panel').classList.contains('is-open'));
});
buildWorkFilter();
buildWorkTypeRow();

// =========================================================
// INIT
// =========================================================
function refreshAllViews(){
  renderDashboard();
  renderTimeline();
  renderWorks();
  renderPlanner();
  renderNotes();
  renderEvents();
  renderSettings();
}

function getInitialView(){
  const hash = (location.hash || '').replace('#','');
  if(VALID_VIEWS.includes(hash)) return hash;
  if(state.settings.defaultTab === 'classes') return 'classes';
  if(state.settings.defaultTab === 'works') return 'works';
  if(state.settings.defaultTab === 'planner') return 'planner';
  if(state.settings.defaultTab === 'notes') return 'notes';
  return 'dashboard';
}

let lastPruneDay = null;

function init(){
  applyTheme();
  pruneNotifiedKeys();
  pruneOldWorks();
  lastPruneDay = todayISO();
  saveState();
  renderAvatar();

  switchView(getInitialView());

  setInterval(tick, 20000);
}

init();
