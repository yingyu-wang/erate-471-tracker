const API = '/api';

const STATUS_LABELS = {
  draft: 'Draft',
  certified: 'Certified',
  under_review: 'Under Review',
  fcdl_issued: 'FCDL Issued',
  denied: 'Denied',
  cancelled: 'Cancelled',
  partially_funded: 'Partially Funded',
  pending: 'Pending',
  committed: 'Committed',
};

let appStatuses = [];
let frnStatuses = [];
let currentView = 'dashboard';
let selectedAppId = null;
let modalMode = null;
let editingId = null;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

async function api(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.errors?.join(', ') || 'Request failed');
  return data;
}

function formatCurrency(n) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n || 0);
}

function formatDate(d) {
  if (!d) return '—';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function statusBadge(status) {
  const label = STATUS_LABELS[status] || status;
  return `<span class="badge badge-${status}">${label}</span>`;
}

function showView(name) {
  currentView = name;
  $$('.view').forEach((v) => v.classList.remove('active'));
  $(`#view-${name}`).classList.add('active');
  $$('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === name));

  const titles = {
    dashboard: 'Dashboard',
    applications: 'Form 471 Applications',
    frns: 'Funding Request Numbers',
    detail: 'Application Detail',
  };
  $('#page-title').textContent = titles[name] || 'E-Rate Tracker';
  $('#btn-new-app').style.display = name === 'applications' || name === 'dashboard' ? '' : 'none';
  $('#btn-import-usac').style.display = name === 'dashboard' ? '' : 'none';
}

async function checkHealth() {
  const el = $('#db-status');
  try {
    const data = await api('/health');
    el.textContent = data.database === 'connected' ? '● Database connected' : '● Database unavailable';
    el.className = `db-status ${data.database === 'connected' ? 'ok' : 'error'}`;
  } catch {
    el.textContent = '● Database unavailable';
    el.className = 'db-status error';
  }
}

async function loadMeta() {
  const [apps, frns] = await Promise.all([
    api('/applications/meta/statuses'),
    api('/frns/meta/statuses'),
  ]);
  appStatuses = apps.application_statuses;
  frnStatuses = frns.frn_statuses;

  const statusSelect = $('#filter-status');
  statusSelect.innerHTML = '<option value="">All statuses</option>';
  appStatuses.forEach((s) => {
    statusSelect.innerHTML += `<option value="${s}">${STATUS_LABELS[s] || s}</option>`;
  });
}

async function loadDashboard() {
  const stats = await api('/dashboard/stats');

  $('#stats-grid').innerHTML = `
    <div class="stat-card"><div class="label">Applications</div><div class="value">${stats.totals.applications}</div></div>
    <div class="stat-card"><div class="label">FRNs</div><div class="value">${stats.totals.frns}</div></div>
    <div class="stat-card"><div class="label">Funding Years</div><div class="value">${stats.by_funding_year.length}</div></div>
  `;

  const maxStatus = Math.max(...stats.applications_by_status.map((s) => s.count), 1);
  $('#status-chart').innerHTML = stats.applications_by_status.map((s) => `
    <div class="bar-row">
      <span>${STATUS_LABELS[s.application_status] || s.application_status}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${(s.count / maxStatus) * 100}%"></div></div>
      <span class="bar-count">${s.count}</span>
    </div>
  `).join('') || '<div class="empty-state">No data yet</div>';

  const maxYear = Math.max(...stats.by_funding_year.map((y) => y.total_requested), 1);
  $('#year-chart').innerHTML = stats.by_funding_year.map((y) => `
    <div class="bar-row">
      <span>FY ${y.funding_year}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${(y.total_requested / maxYear) * 100}%"></div></div>
      <span class="bar-count">${formatCurrency(y.total_requested)}</span>
    </div>
  `).join('') || '<div class="empty-state">No data yet</div>';

  $('#recent-activity').innerHTML = stats.recent_activity.map((a) => `
    <div class="activity-item">
      <div>
        <strong>${a.record_label || 'Record'}</strong>:
        ${a.old_status ? `${STATUS_LABELS[a.old_status] || a.old_status} → ` : ''}
        ${STATUS_LABELS[a.new_status] || a.new_status}
        ${a.notes ? `<span class="activity-meta"> — ${a.notes}</span>` : ''}
      </div>
      <span class="activity-meta">${new Date(a.changed_at).toLocaleDateString()}</span>
    </div>
  `).join('') || '<div class="empty-state">No recent activity</div>';

  const years = [...new Set(stats.by_funding_year.map((y) => y.funding_year))];
  const yearSelect = $('#filter-year');
  yearSelect.innerHTML = '<option value="">All funding years</option>';
  years.forEach((y) => { yearSelect.innerHTML += `<option value="${y}">FY ${y}</option>`; });
}

function setSearchStatus(message, type = 'info') {
  const el = $('#search-status');
  if (!message) {
    el.classList.add('hidden');
    el.textContent = '';
    el.className = 'search-status hidden';
    return;
  }
  el.classList.remove('hidden');
  el.className = `search-status ${type}`;
  el.textContent = message;
}

async function loadApplications() {
  const params = new URLSearchParams();
  const search = $('#filter-search').value.trim();
  const year = $('#filter-year').value;
  const status = $('#filter-status').value;
  if (search) params.set('search', search);
  if (year) params.set('funding_year', year);
  if (status) params.set('status', status);

  const tbody = $('#applications-tbody');
  const btn = $('#btn-apply-filters');

  if (search) {
    setSearchStatus('Querying USAC Open Data for latest status…', 'running');
    btn.disabled = true;
    tbody.innerHTML = '<tr><td colspan="9" class="empty-state">Fetching live data from USAC…</td></tr>';
  } else {
    setSearchStatus('');
  }

  try {
    const data = await api(`/applications?${params}`);
    const apps = Array.isArray(data) ? data : (data.results || []);
    const isLive = !Array.isArray(data) && data.source === 'usac_live';

    if (!apps.length) {
      tbody.innerHTML = '<tr><td colspan="9" class="empty-state">No applications found</td></tr>';
      if (search) {
        setSearchStatus(
          isLive ? 'No matches in USAC Open Data for this search.' : 'No applications found.',
          isLive ? 'live' : 'info'
        );
      }
      return;
    }

    if (isLive) {
      const fetchedAt = data.fetched_at
        ? new Date(data.fetched_at).toLocaleString()
        : 'just now';
      setSearchStatus(
        `Live from USAC Open Data — ${data.usac_matches ?? apps.length} match(es), synced ${fetchedAt}`,
        'live'
      );
    }

    tbody.innerHTML = apps.map((a) => `
      <tr>
        <td class="mono">${a.application_number}</td>
        <td>${a.funding_year}</td>
        <td class="mono">${a.ben}</td>
        <td>${a.entity_name}${isLive ? '<span class="badge-live">Live</span>' : ''}</td>
        <td>${statusBadge(a.application_status)}</td>
        <td>${a.frn_count}</td>
        <td>${formatCurrency(a.total_requested)}</td>
        <td>${formatCurrency(a.total_committed)}</td>
        <td><button class="btn btn-sm btn-secondary" data-view-app="${a.id}" data-live="${isLive ? '1' : '0'}">View</button></td>
      </tr>
    `).join('');

    tbody.querySelectorAll('[data-view-app]').forEach((el) => {
      el.addEventListener('click', () => viewApplication(el.dataset.viewApp, el.dataset.live === '1'));
    });
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty-state">Search failed</td></tr>';
    if (search) setSearchStatus(err.message, 'error');
    else throw err;
  } finally {
    btn.disabled = false;
  }
}

async function loadFrns() {
  const frns = await api('/frns');
  const tbody = $('#frns-tbody');

  if (!frns.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty-state">No FRNs found</td></tr>';
    return;
  }

  tbody.innerHTML = frns.map((f) => `
    <tr>
      <td class="mono">${f.frn_number}</td>
      <td class="mono">${f.application_number}</td>
      <td>${f.funding_year}</td>
      <td>${f.entity_name}</td>
      <td>Cat ${f.category}</td>
      <td>${f.service_type}</td>
      <td>${statusBadge(f.frn_status)}</td>
      <td>${formatCurrency(f.pre_discount_amount)}</td>
      <td>${formatCurrency(f.committed_amount)}</td>
    </tr>
  `).join('');
}

async function viewApplication(id, fromLiveSearch = false) {
  selectedAppId = id;
  const liveParam = fromLiveSearch ? '?live=1' : '';
  const app = await api(`/applications/${id}${liveParam}`);
  showView('detail');

  const frnRows = app.frns.map((f) => `
    <tr>
      <td class="mono">${f.frn_number}</td>
      <td>Cat ${f.category}</td>
      <td>${f.service_type}</td>
      <td>${f.service_provider_name || '—'}</td>
      <td>${statusBadge(f.frn_status)}</td>
      <td>${formatCurrency(f.pre_discount_amount)}</td>
      <td>${formatCurrency(f.committed_amount)}</td>
      <td>
        <button class="btn btn-sm btn-ghost" data-edit-frn="${f.id}">Edit</button>
      </td>
    </tr>
  `).join('');

  const historyRows = app.status_history.map((h) => `
    <div class="activity-item">
      <div>
        ${h.old_status ? `${STATUS_LABELS[h.old_status] || h.old_status} → ` : ''}
        <strong>${STATUS_LABELS[h.new_status] || h.new_status}</strong>
        ${h.notes ? ` — ${h.notes}` : ''}
      </div>
      <span class="activity-meta">${new Date(h.changed_at).toLocaleString()}</span>
    </div>
  `).join('');

  $('#detail-content').innerHTML = `
    <div class="detail-header">
      <div>
        <h3>${app.entity_name}</h3>
        <p class="activity-meta">App #${app.application_number} · BEN ${app.ben} · FY ${app.funding_year}${app.source === 'usac_live' ? ' · <span class="badge-live">Live USAC</span>' : ''}</p>
      </div>
      <div class="detail-actions">
        ${statusBadge(app.application_status)}
        <button class="btn btn-secondary" data-edit-app="${app.id}">Edit Application</button>
        <button class="btn btn-danger btn-sm" data-delete-app="${app.id}">Delete</button>
      </div>
    </div>

    <div class="detail-grid">
      <div class="card detail-field"><div class="label">Entity Type</div><div class="value">${app.entity_type}</div></div>
      <div class="card detail-field"><div class="label">Certified Date</div><div class="value">${formatDate(app.certified_date)}</div></div>
      <div class="card detail-field"><div class="label">FCDL Date</div><div class="value">${formatDate(app.fcdl_date)}</div></div>
      <div class="card detail-field"><div class="label">Contact</div><div class="value">${app.contact_name || '—'}<br>${app.contact_email || ''}</div></div>
      <div class="card detail-field" style="grid-column: 1/-1"><div class="label">Notes</div><div class="value">${app.notes || '—'}</div></div>
    </div>

    <div class="section-title">
      <span>Funding Request Numbers (${app.frns.length})</span>
      <button class="btn btn-sm btn-primary" data-add-frn="${app.id}">+ Add FRN</button>
    </div>
    <div class="card table-card">
      <table class="data-table">
        <thead>
          <tr><th>FRN</th><th>Cat</th><th>Service</th><th>Provider</th><th>Status</th><th>Requested</th><th>Committed</th><th></th></tr>
        </thead>
        <tbody>${frnRows || '<tr><td colspan="8" class="empty-state">No FRNs yet</td></tr>'}</tbody>
      </table>
    </div>

    <div class="section-title">Status History</div>
    <div class="card">${historyRows || '<div class="empty-state">No history</div>'}</div>
  `;

  $('#detail-content').querySelector('[data-edit-app]')?.addEventListener('click', () => openAppModal(app));
  $('#detail-content').querySelector('[data-delete-app]')?.addEventListener('click', () => deleteApplication(app.id));
  $('#detail-content').querySelector('[data-add-frn]')?.addEventListener('click', () => openFrnModal(app.id));
  $('#detail-content').querySelectorAll('[data-edit-frn]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const frn = app.frns.find((f) => f.id === btn.dataset.editFrn);
      openFrnModal(app.id, frn);
    });
  });
}

function openModal(title) {
  $('#modal-title').textContent = title;
  $('#modal').classList.remove('hidden');
}

function closeModal() {
  $('#modal').classList.add('hidden');
  modalMode = null;
  editingId = null;
}

function selectOptions(values, selected) {
  return values.map((v) => `<option value="${v}" ${v === selected ? 'selected' : ''}>${STATUS_LABELS[v] || v}</option>`).join('');
}

function openAppModal(app = null) {
  modalMode = 'application';
  editingId = app?.id || null;
  openModal(editingId ? 'Edit Application' : 'New Application');

  $('#modal-form').innerHTML = `
    <div class="form-row">
      <div class="form-group"><label>Application Number *</label><input name="application_number" required value="${app?.application_number || ''}"></div>
      <div class="form-group"><label>Funding Year *</label><input name="funding_year" type="number" required value="${app?.funding_year || new Date().getFullYear()}"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>BEN *</label><input name="ben" required value="${app?.ben || ''}"></div>
      <div class="form-group"><label>Entity Type</label>
        <select name="entity_type">
          ${['School District','School','Library','Library System','Consortium','NIF'].map((t) =>
            `<option value="${t}" ${app?.entity_type === t ? 'selected' : ''}>${t}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-group"><label>Entity Name *</label><input name="entity_name" required value="${app?.entity_name || ''}"></div>
    <div class="form-group"><label>Status</label><select name="application_status">${selectOptions(appStatuses, app?.application_status || 'draft')}</select></div>
    <div class="form-row">
      <div class="form-group"><label>Certified Date</label><input name="certified_date" type="date" value="${app?.certified_date?.slice(0,10) || ''}"></div>
      <div class="form-group"><label>FCDL Date</label><input name="fcdl_date" type="date" value="${app?.fcdl_date?.slice(0,10) || ''}"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Contact Name</label><input name="contact_name" value="${app?.contact_name || ''}"></div>
      <div class="form-group"><label>Contact Email</label><input name="contact_email" type="email" value="${app?.contact_email || ''}"></div>
    </div>
    <div class="form-group"><label>Contact Phone</label><input name="contact_phone" value="${app?.contact_phone || ''}"></div>
    <div class="form-group"><label>Notes</label><textarea name="notes">${app?.notes || ''}</textarea></div>
  `;
}

function openFrnModal(applicationId, frn = null) {
  modalMode = 'frn';
  editingId = frn?.id || null;
  openModal(editingId ? 'Edit FRN' : 'Add FRN');

  $('#modal-form').innerHTML = `
    <input type="hidden" name="application_id" value="${applicationId}">
    <div class="form-row">
      <div class="form-group"><label>FRN Number *</label><input name="frn_number" required value="${frn?.frn_number || ''}"></div>
      <div class="form-group"><label>Category *</label>
        <select name="category" required>
          <option value="1" ${frn?.category === 1 ? 'selected' : ''}>Category 1</option>
          <option value="2" ${frn?.category === 2 ? 'selected' : ''}>Category 2</option>
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Service Type *</label><input name="service_type" required value="${frn?.service_type || ''}"></div>
      <div class="form-group"><label>Function Type</label><input name="function_type" value="${frn?.function_type || ''}"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>SPIN</label><input name="spin" value="${frn?.spin || ''}"></div>
      <div class="form-group"><label>Service Provider</label><input name="service_provider_name" value="${frn?.service_provider_name || ''}"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Pre-Discount Amount</label><input name="pre_discount_amount" type="number" step="0.01" value="${frn?.pre_discount_amount || 0}"></div>
      <div class="form-group"><label>Discount %</label><input name="discount_percentage" type="number" step="0.01" value="${frn?.discount_percentage || ''}"></div>
    </div>
    <div class="form-group"><label>FRN Status</label><select name="frn_status">${selectOptions(frnStatuses, frn?.frn_status || 'pending')}</select></div>
    <div class="form-row">
      <div class="form-group"><label>Service Start Date</label><input name="service_start_date" type="date" value="${frn?.service_start_date?.slice(0,10) || ''}"></div>
      <div class="form-group"><label>Invoicing Deadline</label><input name="invoicing_deadline" type="date" value="${frn?.invoicing_deadline?.slice(0,10) || ''}"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Committed Amount</label><input name="committed_amount" type="number" step="0.01" value="${frn?.committed_amount || 0}"></div>
      <div class="form-group"><label>Disbursed Amount</label><input name="disbursed_amount" type="number" step="0.01" value="${frn?.disbursed_amount || 0}"></div>
    </div>
    <div class="form-group"><label>Notes</label><textarea name="notes">${frn?.notes || ''}</textarea></div>
  `;
}

async function handleFormSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const fd = new FormData(form);
  const body = Object.fromEntries(fd.entries());

  if (body.funding_year) body.funding_year = parseInt(body.funding_year, 10);
  if (body.category) body.category = parseInt(body.category, 10);
  ['pre_discount_amount', 'discount_percentage', 'committed_amount', 'disbursed_amount'].forEach((k) => {
    if (body[k] !== undefined && body[k] !== '') body[k] = parseFloat(body[k]);
  });

  try {
    if (modalMode === 'application') {
      if (editingId) {
        await api(`/applications/${editingId}`, { method: 'PUT', body: JSON.stringify(body) });
      } else {
        await api('/applications', { method: 'POST', body: JSON.stringify(body) });
      }
      closeModal();
      await refresh();
      if (editingId) viewApplication(editingId);
    } else if (modalMode === 'frn') {
      if (editingId) {
        await api(`/frns/${editingId}`, { method: 'PUT', body: JSON.stringify(body) });
      } else {
        await api('/frns', { method: 'POST', body: JSON.stringify(body) });
      }
      closeModal();
      if (selectedAppId) viewApplication(selectedAppId);
      await refresh();
    }
  } catch (err) {
    alert(err.message);
  }
}

function showImportStatus(message, type = 'info') {
  const el = $('#import-status');
  el.textContent = message;
  el.className = `import-status ${type}`;
  el.classList.remove('hidden');
}

function hideImportStatus() {
  $('#import-status').classList.add('hidden');
}

async function importUsacData() {
  const btn = $('#btn-import-usac');
  if (!confirm('Import California Form 471 applications and FRNs from USAC Open Data? This may take several minutes.')) {
    return;
  }

  btn.disabled = true;
  showImportStatus('Importing California data from USAC Open Data… this may take a few minutes.', 'running');

  try {
    const result = await api('/import/usac', {
      method: 'POST',
      body: JSON.stringify({ state: 'CA', includePending: true }),
    });
    const s = result.summary;
    const mins = Math.floor(s.elapsedSec / 60);
    const secs = s.elapsedSec % 60;
    const elapsed = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
    showImportStatus(
      `Import complete — ${s.totals.applications} applications, ${s.totals.frns} FRNs (${elapsed}).`,
      'success'
    );
    await refresh();
  } catch (err) {
    showImportStatus(`Import failed: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
  }
}

async function deleteApplication(id) {
  if (!confirm('Delete this application and all its FRNs?')) return;
  try {
    await api(`/applications/${id}`, { method: 'DELETE' });
    selectedAppId = null;
    showView('applications');
    await refresh();
  } catch (err) {
    alert(err.message);
  }
}

async function refresh() {
  await checkHealth();
  if (currentView === 'dashboard') await loadDashboard();
  if (currentView === 'applications') await loadApplications();
  if (currentView === 'frns') await loadFrns();
}

function init() {
  $$('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      showView(btn.dataset.view);
      await refresh();
    });
  });

  $('#btn-new-app').addEventListener('click', () => openAppModal());
  $('#btn-import-usac').addEventListener('click', () => importUsacData());
  $('#btn-apply-filters').addEventListener('click', () => loadApplications());
  $('#filter-search').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') loadApplications();
  });

  $('#btn-back').addEventListener('click', () => {
    showView('applications');
    loadApplications();
  });

  $('#modal-form').addEventListener('submit', handleFormSubmit);
  $('.modal-close').addEventListener('click', closeModal);
  $('.modal-cancel').addEventListener('click', closeModal);
  $('.modal-backdrop').addEventListener('click', closeModal);

  loadMeta()
    .then(() => refresh())
    .catch((err) => {
      console.error(err);
      $('#db-status').textContent = '● Setup required — see README';
      $('#db-status').className = 'db-status error';
    });
}

init();