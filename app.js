const STORAGE_KEY = 'anime_library';
const TOKEN_KEY   = 'anime_gh_token';
const GIST_KEY    = 'anime_gist_id';
const GIST_FILE   = 'anime-library.json';

const STATUS_LABEL = {
  completed: 'Завершён',
  ongoing:   'Онгоинг',
  dropped:   'Брошен',
  planned:   'Буду смотреть',
};

const PRESET_TAGS = [
  'сёнэн','сёдзё','сейнэн','дзёсэй',
  'боевик','романтика','комедия','драма','фэнтези','ужасы','триллер',
  'школа','меха','исэкай','спорт','повседневность','мистика',
  'короткий','длинный','фильм',
];

const COVERS = ['🌸','⚔️','🔥','🌊','🌙','🎭','🦋','🗡️','🌺','💫','🐉','🎌'];

// --- State ---
let db = loadLocal();
let editingId   = null;
let currentTags = [];
let currentRating = 0;
let currentCover  = '';
let filterStatus  = '';
let filterTag     = '';
let filterSearch  = '';
let searchTimer   = null;

// --- Local storage ---
function loadLocal() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
  catch { return []; }
}
function saveLocal() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
}

// --- GitHub Gist sync ---
function getToken()  { return localStorage.getItem(TOKEN_KEY)  || ''; }
function getGistId() { return localStorage.getItem(GIST_KEY)   || ''; }

function setSyncIndicator(state, text) {
  let el = document.getElementById('sync-indicator');
  if (!el) {
    el = document.createElement('span');
    el.id = 'sync-indicator';
    el.className = 'sync-indicator';
    document.querySelector('.header-actions').prepend(el);
  }
  el.className = 'sync-indicator ' + state;
  el.textContent = text;
}

async function gistFetch(method, path, body) {
  const token = getToken();
  const res = await fetch('https://api.github.com' + path, {
    method,
    headers: {
      Authorization: 'token ' + token,
      'Content-Type': 'application/json',
      Accept: 'application/vnd.github.v3+json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(res.status);
  return res.json();
}

async function syncPull() {
  const gistId = getGistId();
  if (!getToken() || !gistId) return;
  setSyncIndicator('syncing', '↓ загрузка…');
  try {
    const gist = await gistFetch('GET', '/gists/' + gistId);
    const raw = gist.files?.[GIST_FILE]?.content;
    if (raw) {
      const remote = JSON.parse(raw);
      const merged = mergeDb(db, remote);
      db = merged;
      saveLocal();
      render();
    }
    setSyncIndicator('synced', '☁️ синхр.');
  } catch (e) {
    setSyncIndicator('error', '☁️ ошибка');
  }
}

async function syncPush() {
  const gistId = getGistId();
  if (!getToken() || !gistId) return;
  setSyncIndicator('syncing', '↑ сохранение…');
  try {
    await gistFetch('PATCH', '/gists/' + gistId, {
      files: { [GIST_FILE]: { content: JSON.stringify(db) } },
    });
    setSyncIndicator('synced', '☁️ синхр.');
  } catch {
    setSyncIndicator('error', '☁️ ошибка');
  }
}

function mergeDb(local, remote) {
  const map = new Map();
  [...remote, ...local].forEach(a => map.set(a.id, a));
  return [...map.values()].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

async function connectGist(token) {
  const statusEl = document.getElementById('sync-status');
  statusEl.className = 'sync-status loading';
  statusEl.textContent = 'Подключаюсь…';
  try {
    // Check token validity
    const userRes = await fetch('https://api.github.com/user', {
      headers: { Authorization: 'token ' + token, Accept: 'application/vnd.github.v3+json' },
    });
    if (userRes.status === 401) throw new Error('Неверный токен');
    if (!userRes.ok) throw new Error('Ошибка GitHub: ' + userRes.status);

    // Check gist scope
    const scopes = userRes.headers.get('x-oauth-scopes') || '';
    if (!scopes.includes('gist')) throw new Error('Токен не имеет разрешения "gist". Создай новый токен с галочкой gist на github.com/settings/tokens/new');

    localStorage.setItem(TOKEN_KEY, token);

    // Find existing gist or create new
    let gistId = '';
    const gists = await gistFetch('GET', '/gists');
    const existing = gists.find(g => g.files?.[GIST_FILE]);
    if (existing) {
      gistId = existing.id;
    } else {
      const created = await gistFetch('POST', '/gists', {
        description: 'Anime Library Data',
        public: false,
        files: { [GIST_FILE]: { content: JSON.stringify(db) } },
      });
      gistId = created.id;
    }

    localStorage.setItem(GIST_KEY, gistId);
    statusEl.className = 'sync-status ok';
    statusEl.textContent = '✓ Подключено! Загружаю данные…';
    document.getElementById('btn-sync-disconnect').hidden = false;
    document.getElementById('btn-sync-connect').textContent = 'Обновить';

    await syncPull();
    closeSyncModal();
  } catch (e) {
    statusEl.className = 'sync-status err';
    statusEl.textContent = '✗ ' + (e.message || 'Ошибка подключения');
  }
}

// --- Render grid ---
function render() {
  const grid  = document.getElementById('grid');
  const empty = document.getElementById('empty-state');

  const items = db.filter(a => {
    if (filterStatus && a.status !== filterStatus) return false;
    if (filterTag    && !a.tags.includes(filterTag)) return false;
    if (filterSearch && !a.title.toLowerCase().includes(filterSearch.toLowerCase())) return false;
    return true;
  });

  grid.innerHTML = '';
  empty.hidden = db.length === 0 ? false : true;

  if (db.length === 0) { empty.hidden = false; return; }
  if (items.length === 0) {
    grid.innerHTML = '<p style="color:var(--muted);grid-column:1/-1">Ничего не найдено по фильтрам.</p>';
  }

  items.forEach(a => {
    const card = document.createElement('div');
    card.className = 'card';
    const coverHtml = a.cover
      ? `<img src="${esc(a.cover)}" alt="" loading="lazy" />`
      : COVERS[Math.abs(hashStr(a.id)) % COVERS.length];
    card.innerHTML = `
      <div class="card-cover">${coverHtml}</div>
      <div class="card-body">
        <div class="card-title">${esc(a.title)}</div>
        <div class="card-rating">${a.rating ? '★ ' + a.rating + ' / 10' : '—'}</div>
        <span class="card-status status-${a.status}">${STATUS_LABEL[a.status]}</span>
        ${a.tags.length ? `<div class="card-tags">${a.tags.map(t=>`<span class="card-tag">${esc(t)}</span>`).join('')}</div>` : ''}
      </div>`;
    card.addEventListener('click', () => openModal(a.id));
    grid.appendChild(card);
  });

  renderTagFilters();
}

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(31, h) + s.charCodeAt(i) | 0;
  return h;
}
function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// --- Tag filter chips ---
function renderTagFilters() {
  const all  = [...new Set(db.flatMap(a => a.tags))].sort();
  const wrap = document.getElementById('tag-filters');
  wrap.innerHTML = '';
  if (!all.length) return;

  const clearChip = document.createElement('button');
  clearChip.className = 'chip' + (!filterTag ? ' active' : '');
  clearChip.textContent = 'Все теги';
  clearChip.addEventListener('click', () => { filterTag = ''; render(); });
  wrap.appendChild(clearChip);

  all.forEach(tag => {
    const chip = document.createElement('button');
    chip.className = 'chip' + (filterTag === tag ? ' active' : '');
    chip.textContent = tag;
    chip.addEventListener('click', () => { filterTag = filterTag === tag ? '' : tag; render(); });
    wrap.appendChild(chip);
  });
}

// --- Entry modal ---
function openModal(id = null) {
  editingId     = id;
  currentTags   = [];
  currentRating = 0;
  currentCover  = '';

  document.getElementById('modal-title').textContent = id ? 'Редактировать' : 'Новое аниме';
  document.getElementById('btn-delete').hidden = !id;

  if (id) {
    const a = db.find(x => x.id === id);
    document.getElementById('f-title').value  = a.title;
    document.getElementById('f-status').value = a.status;
    document.getElementById('f-notes').value  = a.notes;
    currentRating = a.rating;
    currentTags   = [...a.tags];
    currentCover  = a.cover || '';
  } else {
    document.getElementById('f-title').value  = '';
    document.getElementById('f-status').value = 'completed';
    document.getElementById('f-notes').value  = '';
  }

  renderCoverPreview();
  renderStars();
  renderTagPills();
  renderPresetTags();

  document.getElementById('modal').hidden   = false;
  document.getElementById('overlay').hidden = false;
  document.getElementById('f-title').focus();
}

function closeModal() {
  document.getElementById('modal').hidden          = true;
  document.getElementById('overlay').hidden        = true;
  document.getElementById('search-results').hidden = true;
  editingId = null;
}

// --- Sync modal ---
function openSyncModal() {
  const token  = getToken();
  const gistId = getGistId();
  document.getElementById('sync-token').value = token;
  document.getElementById('sync-status').textContent = '';
  document.getElementById('sync-status').className   = 'sync-status';
  document.getElementById('btn-sync-disconnect').hidden = !(token && gistId);
  document.getElementById('btn-sync-connect').textContent = (token && gistId) ? 'Обновить' : 'Подключить';
  document.getElementById('sync-modal').hidden  = false;
  document.getElementById('overlay').hidden     = false;
}

function closeSyncModal() {
  document.getElementById('sync-modal').hidden  = true;
  document.getElementById('overlay').hidden     = true;
}

// --- Cover preview ---
function renderCoverPreview() {
  const wrap = document.getElementById('cover-preview');
  const img  = document.getElementById('cover-img');
  if (currentCover) { img.src = currentCover; wrap.hidden = false; }
  else wrap.hidden = true;
}

// --- Stars ---
function renderStars() {
  const container = document.getElementById('stars');
  const val       = document.getElementById('rating-val');
  container.innerHTML = '';
  val.textContent = currentRating || '—';

  for (let i = 1; i <= 10; i++) {
    const star = document.createElement('span');
    star.className  = 'star' + (i <= currentRating ? ' on' : '');
    star.textContent = '★';
    star.dataset.i  = i;
    container.appendChild(star);
  }

  container.addEventListener('click', e => {
    const i = +e.target.dataset.i;
    if (!i) return;
    currentRating = currentRating === i ? 0 : i;
    renderStars();
  });
  container.addEventListener('mouseover', e => {
    const i = +e.target.dataset.i;
    if (!i) return;
    container.querySelectorAll('.star').forEach((s,idx) => s.classList.toggle('on', idx < i));
    val.textContent = i;
  });
  container.addEventListener('mouseout', () => {
    container.querySelectorAll('.star').forEach((s,idx) => s.classList.toggle('on', idx < currentRating));
    val.textContent = currentRating || '—';
  });
}

// --- Tag pills ---
function renderTagPills() {
  const list = document.getElementById('tag-list');
  list.innerHTML = '';
  currentTags.forEach((tag, i) => {
    const pill = document.createElement('span');
    pill.className = 'tag-pill';
    pill.innerHTML = `${esc(tag)}<button title="Удалить тег">×</button>`;
    pill.querySelector('button').addEventListener('click', () => {
      currentTags.splice(i, 1);
      renderTagPills();
      renderPresetTags();
    });
    list.appendChild(pill);
  });
}

function renderPresetTags() {
  const wrap = document.getElementById('preset-tags');
  wrap.innerHTML = '';
  const allKnown = [...new Set([...PRESET_TAGS, ...db.flatMap(a => a.tags)])];
  allKnown.filter(t => !currentTags.includes(t)).forEach(tag => {
    const btn = document.createElement('button');
    btn.className   = 'preset-tag';
    btn.textContent = tag;
    btn.type        = 'button';
    btn.addEventListener('click', () => {
      currentTags.push(tag);
      renderTagPills();
      renderPresetTags();
    });
    wrap.appendChild(btn);
  });
}

function addTag(raw) {
  const tag = raw.trim().toLowerCase();
  if (tag && !currentTags.includes(tag)) {
    currentTags.push(tag);
    renderTagPills();
    renderPresetTags();
  }
}

// --- MAL search via Jikan ---
async function searchAnime(query) {
  const box = document.getElementById('search-results');
  if (!query.trim()) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = '<div class="search-loading">Ищу…</div>';
  try {
    const res  = await fetch(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(query)}&limit=6&sfw=true`);
    const json = await res.json();
    const items = json.data || [];
    if (!items.length) { box.innerHTML = '<div class="search-loading">Ничего не найдено</div>'; return; }
    box.innerHTML = '';
    items.forEach(item => {
      const el    = document.createElement('div');
      el.className = 'search-result-item';
      const thumb  = item.images?.jpg?.small_image_url || '';
      el.innerHTML = `${thumb ? `<img src="${esc(thumb)}" alt="" />` : ''}<span>${esc(item.title)}</span>`;
      el.addEventListener('click', () => {
        document.getElementById('f-title').value = item.title;
        currentCover = item.images?.jpg?.large_image_url || item.images?.jpg?.image_url || '';
        renderCoverPreview();
        const genres = (item.genres || []).map(g => g.name.toLowerCase());
        genres.forEach(g => { if (!currentTags.includes(g)) currentTags.push(g); });
        renderTagPills();
        renderPresetTags();
        box.hidden = true;
      });
      box.appendChild(el);
    });
  } catch {
    box.innerHTML = '<div class="search-loading">Ошибка загрузки</div>';
  }
}

// --- Save / Delete ---
async function saveEntry() {
  const title = document.getElementById('f-title').value.trim();
  if (!title) { document.getElementById('f-title').focus(); return; }

  const entry = {
    id:        editingId || crypto.randomUUID(),
    title,
    rating:    currentRating,
    status:    document.getElementById('f-status').value,
    tags:      [...currentTags],
    notes:     document.getElementById('f-notes').value.trim(),
    cover:     currentCover,
    createdAt: editingId ? db.find(x => x.id === editingId)?.createdAt : new Date().toISOString(),
  };

  if (editingId) {
    const idx = db.findIndex(x => x.id === editingId);
    db[idx] = entry;
  } else {
    db.unshift(entry);
  }

  saveLocal();
  closeModal();
  render();
  await syncPush();
}

async function deleteEntry() {
  if (!editingId) return;
  if (!confirm('Удалить эту запись?')) return;
  db = db.filter(x => x.id !== editingId);
  saveLocal();
  closeModal();
  render();
  await syncPush();
}

// --- Export / Import ---
document.getElementById('btn-export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob),
    download: 'anime-library.json',
  });
  a.click();
});

document.getElementById('btn-import').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async ev => {
    try {
      const imported = JSON.parse(ev.target.result);
      if (!Array.isArray(imported)) throw new Error();
      db = mergeDb(db, imported);
      saveLocal();
      render();
      alert(`Импортировано: ${imported.length} записей.`);
      await syncPush();
    } catch {
      alert('Ошибка: файл повреждён или неверного формата.');
    }
    e.target.value = '';
  };
  reader.readAsText(file);
});

// --- Event listeners ---
document.getElementById('btn-add').addEventListener('click', () => openModal());
document.getElementById('btn-close').addEventListener('click', closeModal);
document.getElementById('btn-save').addEventListener('click', saveEntry);
document.getElementById('btn-delete').addEventListener('click', deleteEntry);

document.getElementById('btn-sync-settings').addEventListener('click', openSyncModal);
document.getElementById('btn-sync-close').addEventListener('click', closeSyncModal);
document.getElementById('btn-sync-connect').addEventListener('click', () => {
  const token = document.getElementById('sync-token').value.trim();
  if (!token) return;
  connectGist(token);
});
document.getElementById('btn-sync-disconnect').addEventListener('click', () => {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(GIST_KEY);
  closeSyncModal();
  setSyncIndicator('', '');
  document.getElementById('sync-indicator')?.remove();
});

document.getElementById('overlay').addEventListener('click', () => {
  closeModal();
  closeSyncModal();
});

document.getElementById('search').addEventListener('input', e => {
  filterSearch = e.target.value;
  render();
});

document.querySelectorAll('.chip[data-status]').forEach(chip => {
  chip.addEventListener('click', () => {
    filterStatus = chip.dataset.status;
    document.querySelectorAll('.chip[data-status]').forEach(c => c.classList.toggle('active', c === chip));
    render();
  });
});

document.getElementById('f-title').addEventListener('input', e => {
  clearTimeout(searchTimer);
  const q = e.target.value.trim();
  if (q.length < 2) { document.getElementById('search-results').hidden = true; return; }
  searchTimer = setTimeout(() => searchAnime(q), 500);
});
document.getElementById('f-title').addEventListener('blur', () => {
  setTimeout(() => { document.getElementById('search-results').hidden = true; }, 200);
});

document.getElementById('btn-clear-cover').addEventListener('click', () => {
  currentCover = '';
  renderCoverPreview();
});

document.getElementById('f-tag').addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault();
    addTag(e.target.value);
    e.target.value = '';
  }
});
document.getElementById('f-tag').addEventListener('blur', e => {
  if (e.target.value.trim()) { addTag(e.target.value); e.target.value = ''; }
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeModal(); closeSyncModal(); }
});

// --- Init ---
render();
syncPull();
