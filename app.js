const STORAGE_KEY = 'anime_library';

const STATUS_LABEL = {
  completed: 'Завершён',
  ongoing: 'Онгоинг',
  dropped: 'Брошен',
  planned: 'Буду смотреть',
};

const PRESET_TAGS = [
  'сёнэн', 'сёдзё', 'сейнэн', 'дзёсэй',
  'боевик', 'романтика', 'комедия', 'драма', 'фэнтези', 'ужасы', 'триллер',
  'школа', 'меха', 'исэкай', 'спорт', 'повседневность', 'мистика',
  'короткий', 'длинный', 'фильм',
];

const COVERS = ['🌸','⚔️','🔥','🌊','🌙','🎭','🦋','🗡️','🌺','💫','🐉','🎌'];

// --- State ---
let db = load();
let editingId = null;
let currentTags = [];
let currentRating = 0;
let currentCover = '';
let filterStatus = '';
let filterTag = '';
let filterSearch = '';
let searchTimer = null;

// --- Persist ---
function load() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
  catch { return []; }
}
function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
}

// --- Render grid ---
function render() {
  const grid = document.getElementById('grid');
  const empty = document.getElementById('empty-state');

  let items = db.filter(a => {
    if (filterStatus && a.status !== filterStatus) return false;
    if (filterTag && !a.tags.includes(filterTag)) return false;
    if (filterSearch && !a.title.toLowerCase().includes(filterSearch.toLowerCase())) return false;
    return true;
  });

  grid.innerHTML = '';

  if (db.length === 0) {
    empty.hidden = false;
  } else {
    empty.hidden = true;
    if (items.length === 0) {
      grid.innerHTML = '<p style="color:var(--muted);grid-column:1/-1">Ничего не найдено по фильтрам.</p>';
    }
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
        ${a.tags.length ? `<div class="card-tags">${a.tags.map(t => `<span class="card-tag">${esc(t)}</span>`).join('')}</div>` : ''}
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
  const all = [...new Set(db.flatMap(a => a.tags))].sort();
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

// --- Modal ---
function openModal(id = null) {
  editingId = id;
  currentTags = [];
  currentRating = 0;

  document.getElementById('modal-title').textContent = id ? 'Редактировать' : 'Новое аниме';
  document.getElementById('btn-delete').hidden = !id;

  if (id) {
    const a = db.find(x => x.id === id);
    document.getElementById('f-title').value = a.title;
    document.getElementById('f-status').value = a.status;
    document.getElementById('f-notes').value = a.notes;
    currentRating = a.rating;
    currentTags = [...a.tags];
    currentCover = a.cover || '';
  } else {
    document.getElementById('f-title').value = '';
    document.getElementById('f-status').value = 'completed';
    document.getElementById('f-notes').value = '';
    currentCover = '';
  }
  renderCoverPreview();

  renderStars();
  renderTagPills();
  renderPresetTags();

  document.getElementById('modal').hidden = false;
  document.getElementById('overlay').hidden = false;
  document.getElementById('f-title').focus();
}

function closeModal() {
  document.getElementById('modal').hidden = true;
  document.getElementById('overlay').hidden = true;
  document.getElementById('search-results').hidden = true;
  editingId = null;
}

// --- Cover preview ---
function renderCoverPreview() {
  const wrap = document.getElementById('cover-preview');
  const img = document.getElementById('cover-img');
  if (currentCover) {
    img.src = currentCover;
    wrap.hidden = false;
  } else {
    wrap.hidden = true;
  }
}

// --- MAL search via Jikan API ---
async function searchAnime(query) {
  const box = document.getElementById('search-results');
  if (!query.trim()) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = '<div class="search-loading">Ищу…</div>';
  try {
    const res = await fetch(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(query)}&limit=6&sfw=true`);
    const json = await res.json();
    const items = json.data || [];
    if (!items.length) { box.innerHTML = '<div class="search-loading">Ничего не найдено</div>'; return; }
    box.innerHTML = '';
    items.forEach(item => {
      const el = document.createElement('div');
      el.className = 'search-result-item';
      const thumb = item.images?.jpg?.small_image_url || '';
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

// --- Stars ---
function renderStars() {
  const container = document.getElementById('stars');
  const val = document.getElementById('rating-val');
  container.innerHTML = '';
  val.textContent = currentRating || '—';

  for (let i = 1; i <= 10; i++) {
    const star = document.createElement('span');
    star.className = 'star' + (i <= currentRating ? ' on' : '');
    star.textContent = '★';
    star.dataset.i = i;
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
    container.querySelectorAll('.star').forEach((s, idx) => s.classList.toggle('on', idx < i));
    val.textContent = i;
  });

  container.addEventListener('mouseout', () => {
    container.querySelectorAll('.star').forEach((s, idx) => s.classList.toggle('on', idx < currentRating));
    val.textContent = currentRating || '—';
  });
}

// --- Tag pills (selected tags) ---
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

// --- Preset tag buttons ---
function renderPresetTags() {
  const wrap = document.getElementById('preset-tags');
  wrap.innerHTML = '';

  // Combine presets + custom tags from db, minus already selected
  const allKnown = [...new Set([...PRESET_TAGS, ...db.flatMap(a => a.tags)])];
  allKnown
    .filter(t => !currentTags.includes(t))
    .forEach(tag => {
      const btn = document.createElement('button');
      btn.className = 'preset-tag';
      btn.textContent = tag;
      btn.type = 'button';
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

// --- Save / Delete ---
function saveEntry() {
  const title = document.getElementById('f-title').value.trim();
  if (!title) { document.getElementById('f-title').focus(); return; }

  const entry = {
    id: editingId || crypto.randomUUID(),
    title,
    rating: currentRating,
    status: document.getElementById('f-status').value,
    tags: [...currentTags],
    notes: document.getElementById('f-notes').value.trim(),
    cover: currentCover,
    createdAt: editingId ? db.find(x => x.id === editingId)?.createdAt : new Date().toISOString(),
  };

  if (editingId) {
    const idx = db.findIndex(x => x.id === editingId);
    db[idx] = entry;
  } else {
    db.unshift(entry);
  }

  save();
  closeModal();
  render();
}

function deleteEntry() {
  if (!editingId) return;
  if (!confirm('Удалить эту запись?')) return;
  db = db.filter(x => x.id !== editingId);
  save();
  closeModal();
  render();
}

// --- Event listeners ---
document.getElementById('btn-add').addEventListener('click', () => openModal());

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
document.getElementById('btn-close').addEventListener('click', closeModal);
document.getElementById('overlay').addEventListener('click', closeModal);
document.getElementById('btn-save').addEventListener('click', saveEntry);
document.getElementById('btn-delete').addEventListener('click', deleteEntry);

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

document.getElementById('f-tag').addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault();
    addTag(e.target.value);
    e.target.value = '';
  }
});
document.getElementById('f-tag').addEventListener('blur', e => {
  if (e.target.value.trim()) {
    addTag(e.target.value);
    e.target.value = '';
  }
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeModal();
});

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
  reader.onload = ev => {
    try {
      const imported = JSON.parse(ev.target.result);
      if (!Array.isArray(imported)) throw new Error();
      const existingIds = new Set(db.map(x => x.id));
      const newItems = imported.filter(x => !existingIds.has(x.id));
      db = [...newItems, ...db];
      save();
      render();
      alert(`Импортировано: ${newItems.length} новых записей.`);
    } catch {
      alert('Ошибка: файл повреждён или неверного формата.');
    }
    e.target.value = '';
  };
  reader.readAsText(file);
});

// --- Init ---
render();
