// --- Clock & Greeting ---
function updateClock() {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  document.getElementById('clock').textContent = `${hours}:${minutes}:${seconds}`;
}
updateClock();
setInterval(updateClock, 1000);

// --- Search ---
const searchInput = document.getElementById('search');
const searchResults = document.getElementById('searchResults');
const searchResultsInner = document.getElementById('searchResultsInner');
let searchActiveIndex = -1;
let currentSearchResults = [];

// 书签缓存
let cachedBookmarks = [];

async function loadBookmarks() {
  try {
    const tree = await chrome.bookmarks.getTree();
    cachedBookmarks = flattenBookmarks(tree);
  } catch (_) {
    cachedBookmarks = [];
  }
}

function flattenBookmarks(nodes) {
  let result = [];
  for (const node of nodes) {
    if (node.url) {
      result.push({ title: node.title, url: node.url });
    }
    if (node.children) {
      result = result.concat(flattenBookmarks(node.children));
    }
  }
  return result;
}

function performSearch(query) {
  const q = query.toLowerCase();
  const results = [];
  const seenUrls = new Set();

  // 先搜书签（优先展示）
  for (const bm of cachedBookmarks) {
    if (results.length >= 15) break;
    if (
      (bm.title && bm.title.toLowerCase().includes(q)) ||
      (bm.url && bm.url.toLowerCase().includes(q))
    ) {
      if (!seenUrls.has(bm.url)) {
        seenUrls.add(bm.url);
        results.push({ title: bm.title, url: bm.url, source: 'bookmark' });
      }
    }
  }

  // 再搜历史记录
  if (cachedHistoryItems) {
    for (const item of cachedHistoryItems) {
      if (results.length >= 15) break;
      if (
        (item.title && item.title.toLowerCase().includes(q)) ||
        (item.url && item.url.toLowerCase().includes(q))
      ) {
        if (!seenUrls.has(item.url)) {
          seenUrls.add(item.url);
          results.push({ title: item.title, url: item.url, source: 'history' });
        }
      }
    }
  }

  return results;
}

function renderSearchResults(results) {
  searchResultsInner.innerHTML = '';
  currentSearchResults = results;
  searchActiveIndex = -1;

  if (!results.length) {
    searchResultsInner.innerHTML =
      '<div class="search-results-empty">无匹配结果</div>';
    return;
  }

  results.forEach((item, i) => {
    const row = document.createElement('div');
    row.className = 'search-result-item';
    row.dataset.index = i;

    let domain;
    try {
      domain = new URL(item.url).hostname.replace(/^www\./, '');
    } catch {
      domain = item.url;
    }

    const icon = document.createElement('div');
    icon.className = 'search-result-icon';
    setFavicon(icon, item.url, domain, 14);

    const info = document.createElement('div');
    info.className = 'search-result-info';

    const title = document.createElement('div');
    title.className = 'search-result-title';
    title.textContent = item.title || domain;

    const url = document.createElement('div');
    url.className = 'search-result-url';
    url.textContent = item.url;

    info.appendChild(title);
    info.appendChild(url);

    const badge = document.createElement('span');
    badge.className = 'search-result-badge ' + item.source;
    badge.textContent = item.source === 'bookmark' ? '书签' : '历史';

    row.appendChild(icon);
    row.appendChild(info);
    row.appendChild(badge);

    row.addEventListener('click', () => {
      chrome.tabs.update({ url: item.url });
      hideSearchResults();
    });

    searchResultsInner.appendChild(row);
  });
}

function showSearchResults() {
  searchResults.classList.add('show');
}

function hideSearchResults() {
  searchResults.classList.remove('show');
  searchActiveIndex = -1;
}

function updateSearchActive() {
  const items = searchResultsInner.querySelectorAll('.search-result-item');
  items.forEach((el, i) => {
    if (i === searchActiveIndex) {
      el.classList.add('active');
      el.scrollIntoView({ block: 'nearest' });
    } else {
      el.classList.remove('active');
    }
  });
}

let searchDebounceTimer = null;

// 实时过滤图标 + 搜索历史/书签
searchInput.addEventListener('input', () => {
  const query = searchInput.value.trim().toLowerCase();

  // 过滤网站卡片（即时响应）
  const cards = document.querySelectorAll('.site-card:not(.empty)');
  cards.forEach((card) => {
    const name = (card.querySelector('.site-name')?.textContent || '').toLowerCase();
    const title = (card.title || '').toLowerCase();
    if (!query || name.includes(query) || title.includes(query)) {
      card.classList.remove('filtered-out');
    } else {
      card.classList.add('filtered-out');
    }
  });

  // 搜索历史记录和书签（防抖 150ms）
  clearTimeout(searchDebounceTimer);
  if (!query) {
    hideSearchResults();
    return;
  }
  searchDebounceTimer = setTimeout(() => {
    const results = performSearch(query);
    renderSearchResults(results);
    showSearchResults();
  }, 150);
});

// 回车/方向键/ESC 处理
searchInput.addEventListener('keydown', (e) => {
  const query = searchInput.value.trim();

  if (e.key === 'ArrowDown') {
    if (!searchResults.classList.contains('show')) return;
    e.preventDefault();
    if (searchActiveIndex < currentSearchResults.length - 1) {
      searchActiveIndex++;
      updateSearchActive();
    }
    return;
  }

  if (e.key === 'ArrowUp') {
    if (!searchResults.classList.contains('show')) return;
    e.preventDefault();
    if (searchActiveIndex > 0) {
      searchActiveIndex--;
      updateSearchActive();
    }
    return;
  }

  if (e.key === 'Escape') {
    if (searchResults.classList.contains('show')) {
      e.preventDefault();
      hideSearchResults();
    }
    return;
  }

  if (e.key !== 'Enter') return;
  if (!query) return;

  // 如果下拉有选中项，优先导航到选中项
  if (searchResults.classList.contains('show') && currentSearchResults.length > 0) {
    const idx = searchActiveIndex >= 0 ? searchActiveIndex : 0;
    const item = currentSearchResults[idx];
    if (item && item.url) {
      chrome.tabs.update({ url: item.url });
      hideSearchResults();
      searchInput.blur();
      return;
    }
  }

  // 如果过滤后有匹配的网站卡片，打开第一个可见的
  const visible = document.querySelector('.site-card:not(.filtered-out):not(.empty)');
  if (query && visible) {
    const url = visible.dataset.url || visible.href;
    if (url && url.startsWith('http')) {
      chrome.tabs.update({ url });
      return;
    }
  }

  const urlPattern = /^(https?:\/\/)?[\w-]+(\.[\w-]+)+[/#?]?.*$/i;
  const hasDot = /\./.test(query) && !/\s/.test(query);

  if (hasDot && urlPattern.test(query)) {
    const url = query.startsWith('http') ? query : `https://${query}`;
    chrome.tabs.update({ url });
  } else {
    chrome.tabs.update({ url: `https://www.google.com/search?q=${encodeURIComponent(query)}` });
  }
});

// 点击搜索框外部关闭下拉
document.addEventListener('click', (e) => {
  if (!searchResults.contains(e.target) && e.target !== searchInput) {
    hideSearchResults();
  }
});

// --- Favicon helpers ---
function getColorForDomain(domain) {
  const colors = [
    '#6c63ff', '#e91e63', '#2196f3', '#4caf50', '#ff9800',
    '#9c27b0', '#00bcd4', '#ff5722', '#607d8b', '#795548',
    '#f44336', '#3f51b5', '#009688', '#cddc39', '#8bc34a',
  ];
  let hash = 0;
  for (let i = 0; i < domain.length; i++) {
    hash = domain.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

function getInitial(domain) {
  return (domain.replace(/^www\./, '')[0] || '?').toUpperCase();
}

// --- Storage ---
const PINNED_KEY = 'mytab_pinned';
const HIDDEN_KEY = 'mytab_hidden';
const MAX_SLOTS = 32;

async function loadPinned() {
  const result = await chrome.storage.local.get(PINNED_KEY);
  return result[PINNED_KEY] || {};
}

async function savePinned(pinned) {
  await chrome.storage.local.set({ [PINNED_KEY]: pinned });
}

async function loadHidden() {
  const result = await chrome.storage.local.get(HIDDEN_KEY);
  return new Set(result[HIDDEN_KEY] || []);
}

async function saveHidden(hiddenSet) {
  await chrome.storage.local.set({ [HIDDEN_KEY]: [...hiddenSet] });
}

function compactPinned(pinned) {
  const entries = Object.entries(pinned)
    .map(([pos, s]) => ({ pos: parseInt(pos, 10), site: s }))
    .sort((a, b) => a.pos - b.pos);

  for (const key of Object.keys(pinned)) delete pinned[key];
  for (let i = 0; i < entries.length; i++) {
    pinned[i] = entries[i].site;
  }
}

// --- Dynamic sites cache ---
let cachedDynamicSites = [];

// --- Load & Merge ---
async function loadTopSites() {
  const grid = document.getElementById('sitesGrid');
  grid.innerHTML = '<div class="loading">加载中...</div>';

  try {
    const [pinned, sites, hiddenSet] = await Promise.all([
      loadPinned(),
      fetchDynamicSites(),
      loadHidden(),
    ]);

    // 过滤掉被隐藏的 URL
    cachedDynamicSites = sites.filter((s) => !hiddenSet.has(s.url));
    buildMergedGrid(pinned);
  } catch (err) {
    grid.innerHTML = '<div class="loading">无法加载常用网站</div>';
    console.error('loadTopSites error:', err);
  }
}

async function fetchDynamicSites() {
  let sites = [];

  if (chrome.topSites) {
    sites = await new Promise((resolve) => {
      chrome.topSites.get((r) => resolve(r || []));
    });
  }

  if (sites.length < MAX_SLOTS && chrome.history) {
    const historySites = await getTopSitesFromHistory();
    const existingUrls = new Set(sites.map((s) => s.url));
    for (const hs of historySites) {
      if (!existingUrls.has(hs.url)) {
        existingUrls.add(hs.url);
        sites.push(hs);
        if (sites.length >= MAX_SLOTS) break;
      }
    }
  }

  return sites;
}

function buildMergedGrid(pinned) {
  const slots = new Array(MAX_SLOTS).fill(null);
  const pinnedUrls = new Set();

  for (const [pos, site] of Object.entries(pinned)) {
    const idx = parseInt(pos, 10);
    if (idx < MAX_SLOTS) {
      slots[idx] = { ...site, pinned: true, locked: !!site.locked, position: idx };
      pinnedUrls.add(site.url);
    }
  }

  let di = 0;
  for (let i = 0; i < MAX_SLOTS; i++) {
    if (slots[i]) continue;
    while (di < cachedDynamicSites.length && pinnedUrls.has(cachedDynamicSites[di].url)) {
      di++;
    }
    if (di < cachedDynamicSites.length) {
      slots[i] = { ...cachedDynamicSites[di], pinned: false, position: i };
      di++;
    }
  }

  renderGrid(slots, pinned);
}

let cachedHistoryItems = null;
let cachedHistoryPromise = null;
async function getCachedHistoryItems() {
  if (cachedHistoryItems) return cachedHistoryItems;
  if (cachedHistoryPromise) return cachedHistoryPromise;
  const oneYearAgo = Date.now() - 365 * 24 * 60 * 60 * 1000;
  cachedHistoryPromise = new Promise((resolve) => {
    chrome.history.search(
      { text: '', startTime: oneYearAgo, maxResults: 10000 },
      (results) => {
        cachedHistoryItems = results || [];
        resolve(cachedHistoryItems);
      }
    );
  });
  return cachedHistoryPromise;
}

async function getTopSitesFromHistory() {
  const historyItems = await getCachedHistoryItems();

  const urlMap = new Map();
  for (const item of historyItems) {
    try {
      const u = new URL(item.url);
      const key = u.hostname;
      const existing = urlMap.get(key);
      if (existing) {
        existing.count += item.visitCount || 1;
      } else {
        urlMap.set(key, {
          title: key.replace(/^www\./, ''),
          url: `${u.protocol}//${u.hostname}/`,
          count: item.visitCount || 1,
        });
      }
    } catch (_) {}
  }

  return [...urlMap.values()]
    .sort((a, b) => b.count - a.count);
}

let menuCard = null;
let currentSlots = [];
let dragSrcPos = null;

function hideCardMenu() {
  const existing = document.querySelector('.card-menu');
  if (existing) existing.remove();
  const btn = document.querySelector('.kebab-btn.open');
  if (btn) btn.classList.remove('open');
  menuCard = null;
}

function showCardMenu(card, position, site, pinned) {
  hideCardMenu();

  const menu = document.createElement('div');
  menu.className = 'card-menu show';

  const addItem = (label, cls, action) => {
    const item = document.createElement('button');
    item.className = 'card-menu-item' + (cls ? ' ' + cls : '');
    item.textContent = label;
    item.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      hideCardMenu();
      action();
    });
    menu.appendChild(item);
  };

  if (site.pinned) {
    addItem('重命名', '', () => {
      const nameEl = card.querySelector('.site-name');
      startRename(nameEl, position, pinned);
    });
    addItem('取消固定', '', async () => {
      delete pinned[position];
      compactPinned(pinned);
      await savePinned(pinned);
      buildMergedGrid(pinned);
    });
    addItem('移除', 'danger', () => removeCard(position, site, pinned));
  } else {
    addItem('固定到此位置', '', () => togglePin(position, site, pinned));
    addItem('移除', 'danger', async () => {
      const hiddenSet = await loadHidden();
      hiddenSet.add(site.url);
      await saveHidden(hiddenSet);
      cachedDynamicSites = cachedDynamicSites.filter((s) => s.url !== site.url);
      buildMergedGrid(pinned);
    });
  }

  card.appendChild(menu);
  menuCard = card;

  // Click outside to close
  const close = (e) => {
    if (!menu.contains(e.target)) {
      hideCardMenu();
      document.removeEventListener('click', close);
    }
  };
  setTimeout(() => document.addEventListener('click', close), 0);
}

function renderGrid(slots, pinned) {
  const grid = document.getElementById('sitesGrid');
  grid.innerHTML = '';

  currentSlots = slots;

  const hasContent = slots.some((s) => s !== null);
  if (!hasContent) {
    grid.innerHTML = '<div class="loading">暂无数据，继续浏览网页后将自动出现</div>';
    return;
  }

  for (let i = 0; i < slots.length; i++) {
    const site = slots[i];
    const position = i;

    if (!site) {
      const empty = document.createElement('div');
      empty.className = 'site-card empty';
      empty.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        empty.classList.add('drag-over');
      });
      empty.addEventListener('dragleave', () => {
        empty.classList.remove('drag-over');
      });
      empty.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        empty.classList.remove('drag-over');
        if (dragSrcPos !== null && dragSrcPos !== position) {
          handleDrop(dragSrcPos, position, pinned);
        }
      });
      grid.appendChild(empty);
      continue;
    }

    const { url, title } = site;
    let domain;
    try {
      domain = new URL(url).hostname.replace(/^www\./, '');
    } catch {
      domain = url;
    }

    const card = document.createElement(site.pinned ? 'div' : 'a');
    card.className = 'site-card';
    if (site.pinned) card.classList.add('is-pinned');
    if (site.locked) card.classList.add('is-locked');
    if (!site.pinned) card.href = url;
    card.title = title || domain;
    card.dataset.position = position;
    card.dataset.url = url;

    const icon = createIconEl(url, domain);
    card.appendChild(icon);

    const name = document.createElement('div');
    name.className = 'site-name';
    name.textContent = title || domain;
    card.appendChild(name);

    const dot = document.createElement('div');
    dot.className = 'pinned-dot';
    card.appendChild(dot);

    // Kebab menu button
    const kebab = document.createElement('button');
    kebab.className = 'kebab-btn';
    kebab.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><circle cx="8" cy="3" r="1.5"/><circle cx="8" cy="8" r="1.5"/><circle cx="8" cy="13" r="1.5"/></svg>';
    kebab.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const isOpen = kebab.classList.contains('open');
      hideCardMenu();
      if (!isOpen) {
        kebab.classList.add('open');
        showCardMenu(card, position, site, pinned);
      }
    });
    card.appendChild(kebab);

    // Click navigation
    if (site.pinned) {
      card.style.cursor = 'pointer';
      card.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        chrome.tabs.update({ url });
      });
    }

    // Drag & Drop（锁定卡片不允许拖拽）
    if (!site.locked) {
      card.draggable = true;

      card.addEventListener('dragstart', (e) => {
        dragSrcPos = position;
        card.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', '');
      });

      card.addEventListener('dragend', () => {
        card.classList.remove('dragging');
        document.querySelectorAll('.site-card.drag-over').forEach(c => c.classList.remove('drag-over'));
        dragSrcPos = null;
      });

      card.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (dragSrcPos !== position) {
          card.classList.add('drag-over');
        }
      });

      card.addEventListener('dragleave', () => {
        card.classList.remove('drag-over');
      });

      card.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        card.classList.remove('drag-over');
        if (dragSrcPos !== null && dragSrcPos !== position) {
          handleDrop(dragSrcPos, position, pinned);
        }
      });
    }

    grid.appendChild(card);
  }
}

async function handleDrop(srcPos, dstPos, pinned) {
  const srcSite = currentSlots[srcPos];
  const dstSite = currentSlots[dstPos];
  if (!srcSite || srcSite.locked) return;
  if (dstSite && dstSite.locked) return;

  // 两个都是动态卡片（未固定）：直接在缓存中交换位置，不固定任何一个
  if (!srcSite.pinned && dstSite && !dstSite.pinned) {
    const srcIdx = cachedDynamicSites.findIndex(s => s.url === srcSite.url);
    const dstIdx = cachedDynamicSites.findIndex(s => s.url === dstSite.url);
    if (srcIdx >= 0 && dstIdx >= 0) {
      [cachedDynamicSites[srcIdx], cachedDynamicSites[dstIdx]] =
        [cachedDynamicSites[dstIdx], cachedDynamicSites[srcIdx]];
    }
    buildMergedGrid(pinned);
    return;
  }

  const newPinned = {};

  for (const [pos, site] of Object.entries(pinned)) {
    const oldPos = parseInt(pos, 10);
    let newPos = oldPos;
    if (oldPos === srcPos) newPos = dstPos;
    else if (dstSite && oldPos === dstPos) newPos = srcPos;
    newPinned[newPos] = site;
  }

  // 拖拽源是非固定卡片 → 固定到目标位置
  if (!srcSite.pinned) {
    newPinned[dstPos] = { url: srcSite.url, title: srcSite.title, locked: true };
  }

  compactPinned(newPinned);
  await savePinned(newPinned);
  buildMergedGrid(newPinned);
}

function setFavicon(container, url, domain, size) {
  const dpr = Math.ceil(window.devicePixelRatio || 1);
  const img = document.createElement('img');
  img.src = `chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(url)}&size=${size * dpr}`;
  img.width = size;
  img.height = size;
  img.onerror = () => {
    img.style.display = 'none';
    const fb = document.createElement('div');
    fb.className = 'fallback';
    fb.style.background = getColorForDomain(domain);
    fb.textContent = getInitial(domain);
    container.appendChild(fb);
  };
  container.appendChild(img);
}

function createIconEl(url, domain) {
  const icon = document.createElement('div');
  icon.className = 'site-icon';
  setFavicon(icon, url, domain, 24);
  return icon;
}

// --- Pin ---
async function togglePin(position, site, pinned) {
  // 移除同 URL 的旧固定
  for (const [pos, s] of Object.entries(pinned)) {
    if (s.url === site.url) delete pinned[pos];
  }
  compactPinned(pinned);
  pinned[position] = { url: site.url, title: site.title, locked: true };
  await savePinned(pinned);
  buildMergedGrid(pinned);
}

// --- Remove Card ---
async function removeCard(position, site, pinned) {
  if (!site.pinned) return;

  delete pinned[position];
  compactPinned(pinned);

  // 加入隐藏列表，避免再次出现
  const hiddenSet = await loadHidden();
  hiddenSet.add(site.url);
  await saveHidden(hiddenSet);

  // 从缓存中移除
  cachedDynamicSites = cachedDynamicSites.filter((s) => s.url !== site.url);

  await savePinned(pinned);
  buildMergedGrid(pinned);
}

// --- Rename ---
function startRename(nameEl, position, pinned) {
  const currentName = nameEl.textContent;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'rename-input';
  input.value = currentName;
  input.maxLength = 30;

  nameEl.classList.add('editing');
  nameEl.parentNode.insertBefore(input, nameEl.nextSibling);

  input.focus();
  input.select();

  const finish = async () => {
    const newName = input.value.trim() || currentName;
    input.remove();
    nameEl.classList.remove('editing');
    nameEl.textContent = newName;

    if (pinned[position]) {
      pinned[position].title = newName;
      await savePinned(pinned);
    }
  };

  input.addEventListener('blur', finish);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') finish();
    if (e.key === 'Escape') {
      input.value = currentName;
      finish();
    }
  });
}

// --- Add Form ---
function showAddForm(pinned) {
  const form = document.getElementById('addForm');
  const urlInput = document.getElementById('addUrl');
  const nameInput = document.getElementById('addName');

  urlInput.value = '';
  nameInput.value = '';
  form.classList.add('show');
  urlInput.focus();

  const hide = () => form.classList.remove('show');

  document.getElementById('addCancel').onclick = hide;

  document.getElementById('addConfirm').onclick = async () => {
    let url = urlInput.value.trim();
    if (!url) return;

    if (!/^https?:\/\//i.test(url)) {
      url = 'https://' + url;
    }

    let name = nameInput.value.trim();
    if (!name) {
      try {
        name = new URL(url).hostname.replace(/^www\./, '');
      } catch {
        name = url;
      }
    }

    // 找到第一个空位
    let targetPos = -1;
    for (let i = 0; i < MAX_SLOTS; i++) {
      if (!pinned[i]) { targetPos = i; break; }
    }

    if (targetPos === -1) {
      // 没有空位，添加到末尾
      const pinnedKeys = Object.keys(pinned).map(Number);
      targetPos = pinnedKeys.length ? Math.max(...pinnedKeys) + 1 : 0;
    }

    if (targetPos >= MAX_SLOTS) return;

    // 移除同 URL 的旧固定
    for (const [pos, s] of Object.entries(pinned)) {
      if (s.url === url) delete pinned[pos];
    }
    compactPinned(pinned);

    // 从隐藏列表中移除
    const hiddenSet = await loadHidden();
    hiddenSet.delete(url);
    await saveHidden(hiddenSet);

    // 从缓存中移除
    cachedDynamicSites = cachedDynamicSites.filter((s) => s.url !== url);

    pinned[targetPos] = { url, title: name, locked: true };
    await savePinned(pinned);

    hide();
    buildMergedGrid(pinned);
  };

  // ESC 关闭
  form.onkeydown = (e) => {
    if (e.key === 'Escape') hide();
    if (e.key === 'Enter') document.getElementById('addConfirm').click();
  };
}

// --- Domain Ranking ---
async function loadRanking() {
  const list = document.getElementById('rankList');
  list.innerHTML = '<li class="loading" style="grid-column:auto;padding:12px;font-size:12px">加载中...</li>';

  try {
    const historyItems = await getCachedHistoryItems();

    const domainMap = new Map();
    for (const item of historyItems) {
      try {
        const hostname = new URL(item.url).hostname.replace(/^www\./, '');
        const existing = domainMap.get(hostname);
        if (existing) {
          existing.count += item.visitCount || 1;
        } else {
          domainMap.set(hostname, {
            domain: hostname,
            url: item.url,
            count: item.visitCount || 1,
          });
        }
      } catch (_) {}
    }

    const ranked = [...domainMap.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 16);

    renderRanking(ranked);
  } catch (err) {
    list.innerHTML = '';
  }
}

function renderRanking(ranked) {
  const list = document.getElementById('rankList');
  list.innerHTML = '';

  if (!ranked.length) return;

  ranked.forEach((item, i) => {
    const li = document.createElement('li');
    li.className = 'rank-item';
    li.title = `${item.domain} - 访问 ${item.count} 次`;

    // 序号
    const num = document.createElement('span');
    num.className = 'rank-num';
    num.textContent = i + 1;

    // favicon
    const icon = document.createElement('span');
    icon.className = 'rank-favicon';
    setFavicon(icon, item.url, item.domain, 12);

    // 域名
    const domain = document.createElement('span');
    domain.className = 'rank-domain';
    domain.textContent = item.domain;

    // 次数
    const count = document.createElement('span');
    count.className = 'rank-count';
    count.textContent = formatCount(item.count);

    li.appendChild(num);
    li.appendChild(icon);
    li.appendChild(domain);
    li.appendChild(count);

    li.addEventListener('click', () => {
      chrome.tabs.update({ url: item.url });
    });

    list.appendChild(li);
  });
}

function formatCount(n) {
  if (n >= 10000) return (n / 10000).toFixed(1) + '万';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}

// --- Rank Toggle ---
document.getElementById('rankToggle').addEventListener('click', () => {
  const panel = document.getElementById('rankPanel');
  const btn = document.getElementById('rankToggle');
  const isOpen = panel.classList.toggle('open');
  btn.classList.toggle('active', isOpen);
  btn.textContent = isOpen ? '收起排行' : 'TOP访问';
});

loadTopSites();
loadRanking();
loadBookmarks();
