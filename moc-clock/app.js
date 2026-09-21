const COLOR_TEXT = '#f2f2f2';
const COLOR_MUTED = '#bdbdbd';
const COLOR_GREEN = '#32d43a';
const COLOR_PANEL = '#202020';
const COLOR_PANEL_ACTIVE = '#12301c';
const COLOR_PANEL_BORDER = '#343434';
const COLOR_TIMELINE_BG = '#171717';
const COLOR_NOW = '#d6e31f';
const COLOR_DELETED = '#777777';
const COLOR_TIMELINE_MARKER = '#5e5e5e';
const COLOR_LEAFSPACE = '#8ff0c8';
const LOCAL_RELOAD_HELP_TEXT = 'Pass files are loaded when the app starts. The clock ticks locally in your browser; use this button after the source files change.';
const STATIC_RELOAD_HELP_TEXT = 'This is a static build. New pass files appear after the publisher updates schedule.json.';

const APP_CONFIG = window.MOC_CLOCK_CONFIG || {
  mode: 'local',
  stateUrl: '/api/state',
  reloadUrl: '/api/reload',
  reloadEnabled: true,
};

const IS_STATIC = APP_CONFIG.mode === 'static';
const RELOAD_HELP_TEXT = IS_STATIC ? STATIC_RELOAD_HELP_TEXT : LOCAL_RELOAD_HELP_TEXT;

const filterState = {
  initialized: false,
  panelOpen: false,
  selectedMissions: new Set(),
  selectedStations: new Set(),
  showDeleted: true,
  renderSignature: '',
};

function esc(value) {
  return String(value ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
}

function toMillis(iso) {
  return new Date(iso).getTime();
}

function currentNowMs() {
  return Date.now() + appState.serverClockOffsetMs;
}

function formatDurationMs(deltaMs) {
  const total = Math.floor(Math.abs(deltaMs) / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const sign = deltaMs < 0 ? '-' : '';
  return `${sign}${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatUtcDoy(date) {
  const year = date.getUTCFullYear();
  const start = Date.UTC(year, 0, 1);
  const doy = Math.floor((date.getTime() - start) / 86400000) + 1;
  return `${year}/${String(doy).padStart(3, '0')}-${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}:${String(date.getUTCSeconds()).padStart(2, '0')}`;
}

function formatUtcHms(date) {
  return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}:${String(date.getUTCSeconds()).padStart(2, '0')}`;
}

function formatMountainLabel(date, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.month} ${parts.day} ${parts.hour}:${parts.minute}:${parts.second} ${parts.dayPeriod}`;
}

function isoWeekNumber(date) {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  return Math.ceil((((target.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

function isEventActive(event, nowMs) {
  return toMillis(event.aos) <= nowMs && nowMs < toMillis(event.los);
}

function isFutureOrActive(event, nowMs) {
  return toMillis(event.los) >= nowMs;
}

function applyFilters(events) {
  const missionSet = filterState.selectedMissions;
  const stationSet = filterState.selectedStations;
  return events.filter(event => {
    if (!filterState.showDeleted && event.deleted) {
      return false;
    }
    if (!missionSet.size || !missionSet.has(event.spacecraft)) {
      return false;
    }
    if (!stationSet.size || !stationSet.has(event.filter_station)) {
      return false;
    }
    return true;
  });
}

function currentAndNext(events, nowMs) {
  const active = events.filter(event => isEventActive(event, nowMs) && !event.deleted);
  if (active.length) {
    return { active: active[0], next: active[0] };
  }
  const upcoming = events.filter(event => toMillis(event.aos) >= nowMs && !event.deleted);
  return { active: null, next: upcoming[0] || null };
}

function buildMarkers(nowMs, horizonMs) {
  const markers = [];
  const marker = new Date(nowMs);
  marker.setUTCMinutes(0, 0, 0);
  marker.setUTCHours(Math.floor(marker.getUTCHours() / 6) * 6);
  if (marker.getTime() < nowMs) {
    marker.setUTCHours(marker.getUTCHours() + 6);
  }
  while (marker.getTime() <= horizonMs) {
    markers.push({ utc: marker.toISOString(), label: formatUtcHms(marker) });
    marker.setUTCHours(marker.getUTCHours() + 6);
  }
  return markers;
}

function buildDisplayState(snapshot, nowMs) {
  const now = new Date(nowMs);
  const horizonMs = nowMs + (24 * 60 * 60 * 1000);
  const filteredEvents = applyFilters(snapshot.events || []);
  const windowEvents = filteredEvents.filter(event => isFutureOrActive(event, nowMs) && toMillis(event.aos) < horizonMs);
  const tableHorizonMs = nowMs + (72 * 60 * 60 * 1000);
  const tableEvents = filteredEvents.filter(event => isFutureOrActive(event, nowMs) && toMillis(event.aos) < tableHorizonMs);
  const { active, next } = currentAndNext(filteredEvents, nowMs);

  const topCards = windowEvents
    .filter(event => !event.deleted)
    .slice(0, 4)
    .map(event => {
      if (isEventActive(event, nowMs)) {
        return {
          title: `IN PROGRESS: ${event.station_code} ${event.spacecraft}`,
          countdown: formatDurationMs(toMillis(event.los) - nowMs),
          color: event.color,
          bg: COLOR_PANEL_ACTIVE,
        };
      }
      return {
        title: `${event.station_code} ${event.spacecraft} AOS`,
        countdown: formatDurationMs(toMillis(event.aos) - nowMs),
        color: event.color,
        bg: COLOR_PANEL,
      };
    });

  let nextPanel;
  let detailPanel;
  if (!next) {
    nextPanel = {
      title: 'No upcoming contacts',
      countdown: '--:--:--',
      color: COLOR_MUTED,
      bg: COLOR_PANEL,
    };
    detailPanel = {
      title: 'End of pass file',
      lines: [],
      color: COLOR_TEXT,
      bg: COLOR_PANEL,
    };
  } else if (active) {
    nextPanel = {
      title: `CONTACT IN PROGRESS: ${next.spacecraft}`,
      countdown: `LOS in ${formatDurationMs(toMillis(next.los) - nowMs)}`,
      color: COLOR_GREEN,
      bg: COLOR_PANEL_ACTIVE,
    };
    detailPanel = {
      title: next.station_mode,
      lines: [
        `AOS (MT): ${next.aos_mt}`,
        `Max Elev: ${next.peak_elevation}`,
        `Duration: ${next.duration_min}`,
      ],
      color: next.color,
      bg: COLOR_PANEL_ACTIVE,
    };
  } else {
    nextPanel = {
      title: `Next Contact: ${next.spacecraft}`,
      countdown: formatDurationMs(toMillis(next.aos) - nowMs),
      color: next.color,
      bg: COLOR_PANEL,
    };
    detailPanel = {
      title: next.station_mode,
      lines: [
        `AOS (MT): ${next.aos_mt}`,
        `Max Elev: ${next.peak_elevation}`,
        `Duration: ${next.duration_min}`,
      ],
      color: next.color,
      bg: COLOR_PANEL,
    };
  }

  const sats = [];
  windowEvents.forEach(event => {
    if (!sats.includes(event.spacecraft)) {
      sats.push(event.spacecraft);
    }
  });

  return {
    local_label: formatMountainLabel(now, snapshot.mountain_tz || 'America/Denver'),
    utc_label: formatUtcDoy(now),
    week: isoWeekNumber(now),
    top_cards: topCards,
    next_panel: nextPanel,
    detail_panel: detailPanel,
    timeline: {
      now: now.toISOString(),
      horizon: new Date(horizonMs).toISOString(),
      now_label: 'Now',
      now_time: formatUtcDoy(now),
      horizon_label: '+24:00:00',
      horizon_time: formatUtcDoy(new Date(horizonMs)),
      sats: sats.slice(0, 6),
      markers: buildMarkers(nowMs, horizonMs),
      events: windowEvents,
    },
    table: {
      columns: ['S/C', 'GS', 'DOY', 'AOS (MT)', 'AOS (UTC)', 'LOS (UTC)', 'ELEV', 'AZ', 'IN SUN?'],
      col_widths: [10, 16, 9, 9, 9, 9, 7, 9, 7],
      rows: tableEvents.map(event => ({
        cells: [
          event.spacecraft,
          event.station_mode,
          event.doy,
          event.aos_mt,
          event.aos_time,
          event.los_time,
          event.peak_elevation,
          event.az_path,
          event.in_sun,
        ],
        color: isEventActive(event, nowMs) && !event.deleted ? COLOR_GREEN : event.color,
      })),
      empty_message: tableEvents.length ? '' : 'No events remain in the next 48 hours.',
    },
  };
}

const appState = {
  snapshot: null,
  refreshTimer: null,
  serverClockOffsetMs: 0,
};

function setPanelOpen(open) {
  filterState.panelOpen = open;
  const panel = document.getElementById('settingsPanel');
  const backdrop = document.getElementById('settingsBackdrop');
  const toggle = document.getElementById('settingsToggle');
  panel.classList.toggle('open', open);
  backdrop.classList.toggle('open', open);
  panel.setAttribute('aria-hidden', open ? 'false' : 'true');
  toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function syncFilterState(filters) {
  const missions = Array.isArray(filters.missions) ? filters.missions : [];
  const stations = Array.isArray(filters.stations) ? filters.stations : [];
  if (!filterState.initialized) {
    filterState.selectedMissions = new Set(missions);
    filterState.selectedStations = new Set(stations);
    filterState.showDeleted = filters.show_deleted_default !== false;
    filterState.initialized = true;
    return;
  }
  const missionSet = new Set(missions);
  const stationSet = new Set(stations);
  filterState.selectedMissions = new Set([...filterState.selectedMissions].filter(value => missionSet.has(value)));
  filterState.selectedStations = new Set([...filterState.selectedStations].filter(value => stationSet.has(value)));
}

function renderOptionList(containerId, group, options, selectedValues) {
  const container = document.getElementById(containerId);
  if (!options.length) {
    container.innerHTML = `<div class="settings-empty">No ${group} options available.</div>`;
    return;
  }
  container.innerHTML = options.map(value => `
    <label class="settings-option">
      <input type="checkbox" data-filter-group="${group}" value="${esc(value)}" ${selectedValues.has(value) ? 'checked' : ''}>
      <span>${esc(value)}</span>
    </label>
  `).join('');
}

function renderFilterPanel(filters) {
  const nextSignature = JSON.stringify({
    missions: filters.missions || [],
    stations: filters.stations || [],
    selectedMissions: [...filterState.selectedMissions].sort(),
    selectedStations: [...filterState.selectedStations].sort(),
    showDeleted: filterState.showDeleted,
  });
  if (filterState.renderSignature === nextSignature) {
    return;
  }
  filterState.renderSignature = nextSignature;
  renderOptionList('missionOptions', 'mission', filters.missions || [], filterState.selectedMissions);
  renderOptionList('stationOptions', 'station', filters.stations || [], filterState.selectedStations);
  document.getElementById('deletedToggle').checked = filterState.showDeleted;
}

function updateTopCards(cards) {
  const topFrame = document.getElementById('topFrame');
  const padded = [...cards];
  while (padded.length < 4) padded.push(null);
  topFrame.innerHTML = padded.map(card => {
    if (!card) {
      return `<div class="top-card"><div class="top-title" style="color:${COLOR_MUTED}"></div><div class="top-time" style="color:${COLOR_MUTED}"></div></div>`;
    }
    return `<div class="top-card" style="background:${card.bg};border-color:${COLOR_PANEL_BORDER}">
      <div class="top-title" style="color:${card.color}">${esc(card.title)}</div>
      <div class="top-time" style="color:${card.color}">${esc(card.countdown)}</div>
    </div>`;
  }).join('');
}

function updateMainPanels(state) {
  const nextPanel = document.getElementById('nextPanel');
  const detailPanel = document.getElementById('detailPanel');
  const next = state.next_panel;
  const detail = state.detail_panel;
  const detailLines = Array.isArray(detail.lines) ? detail.lines : [detail.body ?? ''];

  nextPanel.style.background = next.bg;
  nextPanel.innerHTML = `<div class="main-title" style="color:${next.color}">${esc(next.title)}</div>
    <div class="main-count" style="color:${next.color}">${esc(next.countdown)}</div>`;

  detailPanel.style.background = detail.bg;
  detailPanel.innerHTML = `<div class="main-title" style="color:${detail.color}">${esc(detail.title)}</div>
        <div class="detail-body">${detailLines.map(line => `<div>${esc(line)}</div>`).join('')}</div>`;
}

function drawTimeline(timeline) {
  const canvas = document.getElementById('timelineCanvas');
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth || 900;
  const height = canvas.clientHeight || 112;
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = COLOR_PANEL;
  ctx.fillRect(0, 0, width, height);

  const left = 210;
  const right = width - 164;
  const top = 24;
  const bottom = height - 30;
  const now = toMillis(timeline.now);
  const horizon = toMillis(timeline.horizon);
  const span = Math.max(1, horizon - now);

  ctx.fillStyle = COLOR_TIMELINE_BG;
  ctx.fillRect(left, top, Math.max(1, right - left), Math.max(1, bottom - top));

  ctx.font = '22px Helvetica';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = COLOR_TEXT;
  ctx.textAlign = 'left';
  ctx.fillText(timeline.now_label, 10, height / 2 - 13);
  ctx.textAlign = 'right';
  ctx.fillText(timeline.horizon_label, width - 10, height / 2 - 13);

  ctx.font = '14px Helvetica';
  ctx.fillStyle = COLOR_MUTED;
  ctx.textAlign = 'left';
  ctx.fillText(timeline.now_time, 10, height / 2 + 13);
  ctx.textAlign = 'right';
  ctx.fillText(timeline.horizon_time, width - 10, height / 2 + 13);

  ctx.font = '13px Helvetica';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = COLOR_LEAFSPACE;
  ctx.fillText('Leaf Space', 12, top - 10);
  ctx.strokeStyle = COLOR_LEAFSPACE;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(92, top - 16, 22, 10);

  ctx.strokeStyle = COLOR_NOW;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(left, top);
  ctx.lineTo(left, bottom);
  ctx.stroke();

  timeline.markers.forEach(marker => {
    const x = left + ((toMillis(marker.utc) - now) / span) * (right - left);
    ctx.save();
    ctx.strokeStyle = COLOR_TIMELINE_MARKER;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.stroke();
    ctx.restore();

    ctx.font = '14px Helvetica';
    ctx.fillStyle = COLOR_MUTED;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(marker.label, x, bottom + 2);
  });

  if (!timeline.sats.length) {
    return;
  }

  const rowHeight = (bottom - top) / Math.max(timeline.sats.length, 1);
  timeline.sats.forEach((sat, index) => {
    const y = top + rowHeight * (index + 0.5);
    const eventColor = (timeline.events.find(event => event.spacecraft === sat) || {}).color || COLOR_TEXT;
    ctx.font = '14px Helvetica';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = eventColor;
    ctx.fillText(sat, left - 8, y - 8);

    ctx.strokeStyle = eventColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
    ctx.stroke();

    timeline.events.filter(event => event.spacecraft === sat).forEach(event => {
      const x1 = left + Math.max(0, toMillis(event.aos) - now) / span * (right - left);
      const x2 = left + Math.min(span, toMillis(event.los) - now) / span * (right - left);
      if (x2 < left || x1 > right) return;
      ctx.fillStyle = event.deleted ? COLOR_DELETED : event.color;
      const barWidth = Math.max(2, x2 - x1);
      ctx.fillRect(x1, y - 5, barWidth, 10);
      if (event.is_leafspace) {
        ctx.save();
        ctx.strokeStyle = COLOR_LEAFSPACE;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x1, y - 5, barWidth, 10);
        ctx.restore();
      }
      const label = `${event.spacecraft} ${event.mode}`;
      if (barWidth > 70) {
        ctx.font = '14px Helvetica';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = event.deleted ? COLOR_DELETED : event.color;
        ctx.fillText(label, x1 + barWidth / 2, y - 13);
      }
    });
  });
}

function updateTable(table) {
  const tableLines = document.getElementById('tableLines');
  const template = (table.col_widths || []).map(w => `${w}ch`).join(' ');
  const header = `<div class="table-row header" style="grid-template-columns:${template}">${
    (table.columns || []).map(col => `<span class="table-cell">${esc(col)}</span>`).join('')
  }</div>`;
  const separator = `<div class="table-separator" id="tableSeparator"></div>`;
  const rows = (table.rows || []).map(row =>
    `<div class="table-row" style="grid-template-columns:${template};color:${row.color}">${
      (row.cells || []).map(cell => `<span class="table-cell">${esc(cell)}</span>`).join('')
    }</div>`
  );
  const empty = table.empty_message
    ? `<div class="table-empty">${esc(table.empty_message)}</div>`
    : '';
  tableLines.innerHTML = [header, separator, ...rows, empty].join('');

  const sep = document.getElementById('tableSeparator');
  if (sep) {
    const widths = Array.from(tableLines.querySelectorAll('.table-row')).map(el => el.scrollWidth);
    const maxWidth = Math.max(tableLines.clientWidth, ...widths, 0);
    sep.style.width = `${maxWidth}px`;
  }
}

async function refresh() {
  const response = await fetch(APP_CONFIG.stateUrl, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const snapshot = await response.json();
  appState.snapshot = snapshot;
  appState.serverClockOffsetMs = IS_STATIC ? 0 : toMillis(snapshot.server_now) - Date.now();
  syncFilterState(snapshot.filters || {});
  renderFilterPanel(snapshot.filters || {});
  document.getElementById('reloadStatus').textContent = RELOAD_HELP_TEXT;
  renderCurrentState();
  return snapshot.refresh_ms || 1000;
}

async function reloadPassFiles() {
  if (!APP_CONFIG.reloadEnabled || !APP_CONFIG.reloadUrl) {
    document.getElementById('reloadStatus').textContent = STATIC_RELOAD_HELP_TEXT;
    return;
  }
  const button = document.getElementById('reloadButton');
  const status = document.getElementById('reloadStatus');
  button.disabled = true;
  status.textContent = 'Reloading pass files...';
  try {
    const response = await fetch(APP_CONFIG.reloadUrl, {
      method: 'POST',
      cache: 'no-store',
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const snapshot = await response.json();
    appState.snapshot = snapshot;
    appState.serverClockOffsetMs = toMillis(snapshot.server_now) - Date.now();
    syncFilterState(snapshot.filters || {});
    renderFilterPanel(snapshot.filters || {});
    status.textContent = 'Pass files reloaded. The updated schedule is now cached in this browser tab.';
    renderCurrentState();
  } finally {
    button.disabled = false;
  }
}

function renderCurrentState() {
  if (!appState.snapshot) {
    return;
  }
  const state = buildDisplayState(appState.snapshot, currentNowMs());
  document.getElementById('localLabel').textContent = state.local_label;
  document.getElementById('utcLabel').textContent = `${state.utc_label}\nWeek ${state.week.toString().padStart(2, '0')}`;
  updateTopCards(state.top_cards || []);
  updateMainPanels(state);
  drawTimeline(state.timeline);
  updateTable(state.table);
}

function scheduleNextRefresh(refreshMs) {
  clearTimeout(appState.refreshTimer);
  appState.refreshTimer = setTimeout(tick, refreshMs);
}

function showClockError(message) {
  clearTimeout(appState.refreshTimer);
  document.getElementById('tableLines').innerHTML = `<div class="table-row header">  Clock update failed: ${esc(message)}  </div>`;
  appState.refreshTimer = setTimeout(tick, 1000);
}

async function tick() {
  try {
    if (!appState.snapshot) {
      const refreshMs = await refresh();
      scheduleNextRefresh(refreshMs);
      return;
    }
    renderCurrentState();
    scheduleNextRefresh(appState.snapshot.refresh_ms || 1000);
  } catch (error) {
    showClockError(error.message);
  }
}

document.getElementById('settingsToggle').addEventListener('click', () => setPanelOpen(!filterState.panelOpen));
document.getElementById('settingsClose').addEventListener('click', () => setPanelOpen(false));
document.getElementById('settingsBackdrop').addEventListener('click', () => setPanelOpen(false));
document.getElementById('deletedToggle').addEventListener('change', event => {
  filterState.showDeleted = event.target.checked;
  renderFilterPanel((appState.snapshot || {}).filters || {});
  renderCurrentState();
});
document.getElementById('settingsPanel').addEventListener('change', event => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) {
    return;
  }
  const group = target.dataset.filterGroup;
  if (group === 'mission') {
    if (target.checked) {
      filterState.selectedMissions.add(target.value);
    } else {
      filterState.selectedMissions.delete(target.value);
    }
    renderFilterPanel((appState.snapshot || {}).filters || {});
    renderCurrentState();
  }
  if (group === 'station') {
    if (target.checked) {
      filterState.selectedStations.add(target.value);
    } else {
      filterState.selectedStations.delete(target.value);
    }
    renderFilterPanel((appState.snapshot || {}).filters || {});
    renderCurrentState();
  }
});
document.getElementById('settingsPanel').addEventListener('click', event => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }
  const button = target.closest('[data-action]');
  if (!(button instanceof HTMLButtonElement)) {
    return;
  }
  const action = button.dataset.action;
  const group = button.dataset.group;
  const options = group === 'mission'
    ? [...document.querySelectorAll('#missionOptions input[data-filter-group="mission"]')].map(input => input.value)
    : [...document.querySelectorAll('#stationOptions input[data-filter-group="station"]')].map(input => input.value);
  const targetSet = group === 'mission' ? filterState.selectedMissions : filterState.selectedStations;
  targetSet.clear();
  if (action === 'all') {
    options.forEach(value => targetSet.add(value));
  }
  renderFilterPanel({
    missions: ((appState.snapshot || {}).filters || {}).missions || [],
    stations: ((appState.snapshot || {}).filters || {}).stations || [],
  });
  renderCurrentState();
});
document.getElementById('reloadButton').addEventListener('click', () => {
  reloadPassFiles().catch(error => {
    document.getElementById('reloadStatus').textContent = `Reload failed: ${error.message}`;
  });
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && filterState.panelOpen) {
    setPanelOpen(false);
  }
});
window.addEventListener('resize', () => renderCurrentState());

if (!APP_CONFIG.reloadEnabled) {
  const reloadButton = document.getElementById('reloadButton');
  reloadButton.disabled = true;
}

document.getElementById('reloadStatus').textContent = RELOAD_HELP_TEXT;
tick();
