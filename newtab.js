// --- Theme ---
const THEME_KEY = 'mytab_theme';
const darkMq = window.matchMedia('(prefers-color-scheme: dark)');
let themeStored = null;

function applyTheme(dark) {
  document.documentElement.classList.toggle('dark', dark);
}

async function loadTheme() {
  try {
    const result = await chrome.storage.local.get(THEME_KEY);
    themeStored = result[THEME_KEY] || null;
  } catch (_) {
    themeStored = null;
  }
  applyTheme(themeStored !== null ? themeStored === 'dark' : darkMq.matches);
}

async function toggleTheme() {
  const currentDark = document.documentElement.classList.contains('dark');
  const nextDark = !currentDark;
  themeStored = nextDark ? 'dark' : 'light';
  await chrome.storage.local.set({ [THEME_KEY]: themeStored });
  applyTheme(nextDark);
}

darkMq.addEventListener('change', (e) => {
  if (themeStored === null) {
    applyTheme(e.matches);
  }
});

document.getElementById('themeToggle').addEventListener('click', toggleTheme);

// --- Clock ---
const clockEl = document.getElementById('clock');
let clockTimer = null;

function updateClock() {
  const now = new Date();
  const weekDays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const w = weekDays[now.getDay()];
  const h = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  clockEl.textContent = `${y}年${m}月${d}日 ${w} ${h}:${min}:${s}`;

  scheduleNextTick();
}

function scheduleNextTick() {
  const ms = 1000 - (Date.now() % 1000);
  clockTimer = setTimeout(updateClock, ms);
}

function startClock() {
  stopClock();
  updateClock();
}

function stopClock() {
  if (clockTimer !== null) {
    clearTimeout(clockTimer);
    clockTimer = null;
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopClock();
  } else {
    startClock();
  }
});

startClock();

// --- Search ---
const searchInput = document.getElementById('search');
const searchResults = document.getElementById('searchResults');
const searchResultsInner = document.getElementById('searchResultsInner');
let searchActiveIndex = -1;
let currentSearchResults = [];
let searchFilledFromDropdown = false;
let activeSiteGroup = 'all';

// --- Search Engine ---
const ENGINE_KEY = 'mytab_search_engine';
const SEARCH_ENGINES = {
  google: {
    name: 'Google',
    searchUrl: 'https://www.google.com/search?q=',
    getSuggestUrl: (q) => `https://suggestqueries.google.com/complete/search?client=chrome&q=${encodeURIComponent(q)}`,
    parseSuggestions: (data) => (data && Array.isArray(data[1])) ? data[1] : [],
  },
  bing: {
    name: 'Bing',
    searchUrl: 'https://www.bing.com/search?q=',
    getSuggestUrl: (q) => `https://api.bing.com/osjson.aspx?query=${encodeURIComponent(q)}`,
    parseSuggestions: (data) => (data && Array.isArray(data[1])) ? data[1] : [],
  },
  baidu: {
    name: '百度',
    searchUrl: 'https://www.baidu.com/s?wd=',
    getSuggestUrl: null,
    parseSuggestions: null,
  },
};
let currentEngine = 'google';

async function loadEngine() {
  try {
    const result = await chrome.storage.local.get(ENGINE_KEY);
    if (result[ENGINE_KEY] && SEARCH_ENGINES[result[ENGINE_KEY]]) {
      currentEngine = result[ENGINE_KEY];
    }
  } catch (_) {}
  updateEngineUI();
}

async function saveEngine(engine) {
  currentEngine = engine;
  await chrome.storage.local.set({ [ENGINE_KEY]: engine });
  updateEngineUI();
}

function updateEngineUI() {
  const icon = document.getElementById('engineBtnIcon');
  if (icon) {
    const engines = {
      google: { letter: 'G', color: '#4285F4', fontSize: 13 },
      bing:   { letter: 'BI', color: '#00809D', fontSize: 10 },
      baidu:  { letter: '百', color: '#2932E1', fontSize: 10 },
    };
    const e = engines[currentEngine] || engines.google;
    icon.innerHTML = `<circle cx="12" cy="12" r="12" fill="${e.color}"/><text x="12" y="16" text-anchor="middle" font-size="${e.fontSize}" font-weight="700" fill="#fff">${e.letter}</text>`;
  }
  // 更新下拉选中项
  const opts = document.querySelectorAll('.engine-option');
  opts.forEach((opt) => {
    opt.classList.toggle('active', opt.dataset.engine === currentEngine);
  });
}

// Engine dropdown toggle
const engineBtn = document.getElementById('engineBtn');
const engineDropdown = document.getElementById('engineDropdown');

engineBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const isOpen = engineDropdown.classList.contains('show');
  if (isOpen) {
    hideEngineDropdown();
  } else {
    engineDropdown.classList.add('show');
    engineBtn.classList.add('open');
  }
});

function hideEngineDropdown() {
  engineDropdown.classList.remove('show');
  engineBtn.classList.remove('open');
}

engineDropdown.addEventListener('click', (e) => {
  const opt = e.target.closest('.engine-option');
  if (opt) saveEngine(opt.dataset.engine);
});

document.addEventListener('click', (e) => {
  if (!engineDropdown.contains(e.target) && e.target !== engineBtn) {
    hideEngineDropdown();
  }
});

// --- Search Suggestions ---
let suggestController = null;
let searchRequestSeq = 0;

async function fetchSuggestions(query) {
  const engine = SEARCH_ENGINES[currentEngine];
  if (!engine.getSuggestUrl) {
    return [];
  }

  try {
    if (suggestController) suggestController.abort();
    suggestController = new AbortController();
    const resp = await fetch(engine.getSuggestUrl(query), { signal: suggestController.signal });
    const data = await resp.json();
    return engine.parseSuggestions(data);
  } catch (e) {
    if (e.name !== 'AbortError') return [];
    return [];
  }
}

function renderSuggestions(suggestions) {
  if (!suggestions.length) return;

  const header = document.createElement('div');
  header.className = 'search-section-header';
  header.textContent = '搜索建议';
  searchResultsInner.appendChild(header);

  suggestions.forEach((text, i) => {
    const row = document.createElement('div');
    row.className = 'search-suggestion-item';
    row.dataset.searchIndex = i;
    row.dataset.type = 'suggestion';

    const icon = document.createElement('div');
    icon.className = 'search-suggestion-icon';
    icon.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>';

    const span = document.createElement('span');
    span.className = 'search-suggestion-text';
    span.textContent = text;

    row.appendChild(icon);
    row.appendChild(span);

    row.addEventListener('click', () => {
      searchInput.value = text;
      hideSearchResults();
      doSearch(text);
    });

    searchResultsInner.appendChild(row);
  });
}

// 书签缓存
let cachedBookmarks = [];

async function loadBookmarks() {
  try {
    if (!(await hasOptionalPermission(BOOKMARKS_PERMISSION))) {
      cachedBookmarks = [];
      return;
    }
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
  currentSearchResults = results;
  searchActiveIndex = -1;

  if (!results.length) {
    searchResultsInner.innerHTML =
      '<div class="search-results-empty">无匹配结果</div>';
    return;
  }

  const header = document.createElement('div');
  header.className = 'search-section-header';
  header.textContent = '书签和历史';
  searchResultsInner.appendChild(header);

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

function renderLocalSearchPermissionPrompt() {
  const prompt = document.createElement('button');
  prompt.className = 'search-permission-prompt';
  prompt.type = 'button';
  prompt.textContent = '启用书签和历史搜索';
  prompt.addEventListener('click', async () => {
    const granted = await requestOptionalPermissions([BOOKMARKS_PERMISSION, HISTORY_PERMISSION]);
    if (!granted) return;
    cachedHistoryItems = null;
    cachedHistoryPromise = null;
    await loadBookmarks();
    await getCachedHistoryItems();
    searchInput.dispatchEvent(new Event('input'));
  });
  searchResultsInner.appendChild(prompt);
}

function showSearchResults() {
  searchResults.classList.add('show');
}

function hideSearchResults() {
  searchResults.classList.remove('show');
  searchActiveIndex = -1;
}

function updateSearchActive() {
  const items = collectSelectableItems();
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

// 更新下拉列表中所有可选中条目（统一索引）
function collectSelectableItems() {
  return searchResultsInner.querySelectorAll('.search-result-item, .search-suggestion-item');
}

function applySiteFilters(queryLower = searchInput.value.trim().toLowerCase()) {
  const cards = document.querySelectorAll('.site-card');
  cards.forEach((card) => {
    if (card.classList.contains('empty')) {
      card.classList.toggle('filtered-out', !!queryLower || activeSiteGroup !== 'all');
      return;
    }

    const name = (card.querySelector('.site-name')?.textContent || '').toLowerCase();
    const title = (card.title || '').toLowerCase();
    const group = card.dataset.group || 'other';
    const matchesQuery = !queryLower || name.includes(queryLower) || title.includes(queryLower);
    const matchesGroup = activeSiteGroup === 'all' || group === activeSiteGroup;
    card.classList.toggle('filtered-out', !matchesQuery || !matchesGroup);
  });
}

// 实时过滤图标 + 搜索建议/历史/书签
searchInput.addEventListener('input', () => {
  searchFilledFromDropdown = false;
  const query = searchInput.value.trim();
  const queryLower = query.toLowerCase();
  const requestSeq = ++searchRequestSeq;

  applySiteFilters(queryLower);

  clearTimeout(searchDebounceTimer);
  if (!query) {
    hideSearchResults();
    return;
  }

  searchDebounceTimer = setTimeout(async () => {
    const canSearchBookmarks = await hasOptionalPermission(BOOKMARKS_PERMISSION);
    const canSearchHistory = await hasOptionalPermission(HISTORY_PERMISSION);
    if (requestSeq !== searchRequestSeq || query !== searchInput.value.trim()) return;

    searchResultsInner.innerHTML = '';

    // 获取搜索建议
    const suggestions = await fetchSuggestions(query);
    if (requestSeq !== searchRequestSeq || query !== searchInput.value.trim()) return;
    if (suggestions.length) {
      renderSuggestions(suggestions.slice(0, 6));
    }

    // 搜索书签和历史
    const results = performSearch(queryLower);
    if (results.length) {
      renderSearchResults(results);
    }

    if (!canSearchBookmarks || !canSearchHistory) {
      renderLocalSearchPermissionPrompt();
    }

    if (!suggestions.length && !results.length) {
      const hasPrompt = searchResultsInner.querySelector('.search-permission-prompt');
      if (!hasPrompt) {
        searchResultsInner.innerHTML =
          '<div class="search-results-empty">无匹配结果</div>';
      }
    }

    showSearchResults();
  }, 150);
});

// 回车/方向键/ESC 处理
searchInput.addEventListener('keydown', (e) => {
  const query = searchInput.value.trim();

  if (e.key === 'ArrowDown') {
    if (!searchResults.classList.contains('show')) return;
    e.preventDefault();
    const items = collectSelectableItems();
    if (searchActiveIndex < items.length - 1) {
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
  if (!query && !searchFilledFromDropdown) return;

  // 如果下拉有选中项，第一次回车填入搜索框，不清空
  if (searchResults.classList.contains('show')) {
    const items = collectSelectableItems();
    if (items.length > 0) {
      const idx = searchActiveIndex >= 0 ? searchActiveIndex : 0;
      const item = items[idx];
      if (item) {
        const type = item.dataset.type;
        if (type === 'suggestion') {
          const text = (item.querySelector('.search-suggestion-text')?.textContent || '').trim();
          if (text) {
            searchInput.value = text;
            searchFilledFromDropdown = true;
            hideSearchResults();
            return;
          }
        } else {
          const resultIdx = parseInt(item.dataset.index, 10);
          const result = currentSearchResults[resultIdx];
          if (result && result.url) {
            searchInput.value = result.url;
            searchFilledFromDropdown = true;
            hideSearchResults();
            return;
          }
        }
      }
    }
  }

  // 第二次回车：执行搜索或跳转
  searchFilledFromDropdown = false;

  if (!query) return;

  // 如果过滤后有匹配的网站卡片，打开第一个可见的
  const visible = document.querySelector('.site-card:not(.filtered-out):not(.empty)');
  if (query && visible) {
    const url = visible.dataset.url || visible.href;
    if (url && url.startsWith('http')) {
      chrome.tabs.update({ url });
      return;
    }
  }

  doSearch(query);
});

function doSearch(query) {
  const urlPattern = /^(https?:\/\/)?[\w-]+(\.[\w-]+)+[/#?]?.*$/i;
  const hasDot = /\./.test(query) && !/\s/.test(query);

  if (hasDot && urlPattern.test(query)) {
    const url = query.startsWith('http') ? query : `https://${query}`;
    chrome.tabs.update({ url });
  } else {
    const engine = SEARCH_ENGINES[currentEngine];
    chrome.tabs.update({ url: engine.searchUrl + encodeURIComponent(query) });
  }

  searchInput.blur();
}

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

function getDomainFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

// --- Storage ---
const PINNED_KEY = 'mytab_pinned';
const HIDDEN_KEY = 'mytab_hidden';
const GROUPS_KEY = 'mytab_site_groups';
const MAX_SLOTS = 40;
const HISTORY_PERMISSION = 'history';
const BOOKMARKS_PERMISSION = 'bookmarks';
const SITE_GROUPS = {
  all: { label: '全部', color: '#5f6368' },
  work: { label: '工作', color: '#1a73e8' },
  study: { label: '学习', color: '#0f9d58' },
  fun: { label: '娱乐', color: '#db4437' },
  tool: { label: '工具', color: '#f4b400' },
  other: { label: '其他', color: '#9aa0a6' },
};
const DEMO_SITES = [
  { title: 'GitHub', url: 'https://github.com/' },
  { title: 'MDN', url: 'https://developer.mozilla.org/' },
  { title: 'YouTube', url: 'https://youtube.com/' },
  { title: 'Google', url: 'https://google.com/' },
  { title: 'Notion', url: 'https://notion.so/' },
  { title: 'Stack Overflow', url: 'https://stackoverflow.com/' },
  { title: 'ChatGPT', url: 'https://chatgpt.com/' },
  { title: 'Bilibili', url: 'https://bilibili.com/' },
];

function isExtensionRuntime() {
  return !!globalThis.chrome?.runtime?.id;
}

let siteGroupOverrides = {};

async function loadSiteGroups() {
  if (!isExtensionRuntime()) return {};
  try {
    const result = await chrome.storage.local.get(GROUPS_KEY);
    const groups = result[GROUPS_KEY] || {};
    normalizeSiteGroups(groups);
    return groups;
  } catch (_) {
    return {};
  }
}

async function saveSiteGroups(groups) {
  if (!isExtensionRuntime()) return;
  normalizeSiteGroups(groups);
  await chrome.storage.local.set({ [GROUPS_KEY]: groups });
}

function normalizeSiteGroups(groups) {
  for (const [url, group] of Object.entries(groups)) {
    if (!url || !SITE_GROUPS[group] || group === 'all') {
      delete groups[url];
    }
  }
}

function getManualGroup(url) {
  return siteGroupOverrides[url] || null;
}

function getEffectiveGroup(site) {
  if (site.group && SITE_GROUPS[site.group]) return site.group;
  const manualGroup = getManualGroup(site.url);
  if (manualGroup) return manualGroup;
  return classifyDomain(site.domain || '').key;
}

function getGroupLabel(group) {
  return SITE_GROUPS[group]?.label || SITE_GROUPS.other.label;
}

function getGroupColor(group) {
  return SITE_GROUPS[group]?.color || SITE_GROUPS.other.color;
}

function setActiveGroup(group) {
  activeSiteGroup = SITE_GROUPS[group] ? group : 'all';
  document.querySelectorAll('.site-group-tab').forEach((item) => {
    item.classList.toggle('active', item.dataset.group === activeSiteGroup);
  });
  applySiteFilters();
}

async function setSiteGroup(url, group) {
  if (!url || !SITE_GROUPS[group] || group === 'all') return;
  siteGroupOverrides[url] = group;
  await saveSiteGroups(siteGroupOverrides);
  buildMergedGrid(await loadPinned());
}

async function clearSiteGroup(url) {
  if (!url) return;
  delete siteGroupOverrides[url];
  await saveSiteGroups(siteGroupOverrides);
  buildMergedGrid(await loadPinned());
}

async function applyManualGroup(site, group) {
  if (!site?.url) return;
  if (!group) {
    await clearSiteGroup(site.url);
    return;
  }
  await setSiteGroup(site.url, group);
  setActiveGroup(group);
}

async function moveSiteGroup(oldUrl, newUrl) {
  if (!oldUrl || !newUrl || oldUrl === newUrl) return;
  const group = siteGroupOverrides[oldUrl];
  if (!group) return;
  delete siteGroupOverrides[oldUrl];
  siteGroupOverrides[newUrl] = group;
  await saveSiteGroups(siteGroupOverrides);
}

async function hasOptionalPermission(permission) {
  try {
    return await chrome.permissions.contains({ permissions: [permission] });
  } catch (_) {
    return false;
  }
}

async function requestOptionalPermissions(permissions) {
  try {
    return await chrome.permissions.request({ permissions });
  } catch (_) {
    return false;
  }
}

async function loadPinned() {
  if (!isExtensionRuntime()) return {};
  const result = await chrome.storage.local.get(PINNED_KEY);
  const pinned = result[PINNED_KEY] || {};
  normalizePinned(pinned);
  return pinned;
}

async function savePinned(pinned) {
  if (!isExtensionRuntime()) return;
  normalizePinned(pinned);
  await chrome.storage.local.set({ [PINNED_KEY]: pinned });
}

async function loadHidden() {
  if (!isExtensionRuntime()) return new Set();
  const result = await chrome.storage.local.get(HIDDEN_KEY);
  return new Set(result[HIDDEN_KEY] || []);
}

async function saveHidden(hiddenSet) {
  if (!isExtensionRuntime()) return;
  await chrome.storage.local.set({ [HIDDEN_KEY]: [...hiddenSet] });
}

function normalizePinned(pinned) {
  for (const key of Object.keys(pinned)) {
    const pos = Number(key);
    if (!Number.isInteger(pos) || pos < 0 || pos >= MAX_SLOTS || !pinned[key]?.url) {
      delete pinned[key];
    }
  }
}

function findFirstFreePosition(pinned) {
  const occupied = new Set(Object.keys(pinned).map(Number));
  for (let i = 0; i < MAX_SLOTS; i++) {
    if (!occupied.has(i)) return i;
  }
  return -1;
}

// --- Dynamic sites cache ---
let cachedDynamicSites = [];

// --- Load & Merge ---
async function loadTopSites() {
  const grid = document.getElementById('sitesGrid');
  grid.innerHTML = '<div class="loading">加载中...</div>';

  try {
    const [pinned, sites, hiddenSet, groups] = await Promise.all([
      loadPinned(),
      fetchDynamicSites(),
      loadHidden(),
      loadSiteGroups(),
    ]);

    siteGroupOverrides = groups;
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

  if (!isExtensionRuntime()) {
    return DEMO_SITES;
  }

  if (chrome.topSites) {
    sites = await new Promise((resolve) => {
      chrome.topSites.get((r) => resolve(r || []));
    });
  }

  if (
    sites.length < MAX_SLOTS &&
    chrome.history &&
    await hasOptionalPermission(HISTORY_PERMISSION)
  ) {
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
      const domain = getDomainFromUrl(site.url);
      slots[idx] = {
        ...site,
        domain,
        group: getEffectiveGroup({ ...site, domain }),
        pinned: true,
        locked: !!site.locked,
        position: idx,
      };
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
      const site = cachedDynamicSites[di];
      const domain = getDomainFromUrl(site.url);
      slots[i] = {
        ...site,
        domain,
        group: getEffectiveGroup({ ...site, domain }),
        pinned: false,
        position: i,
      };
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
  if (!(await hasOptionalPermission(HISTORY_PERMISSION))) {
    cachedHistoryItems = [];
    return cachedHistoryItems;
  }
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
let menuCloseHandler = null;

function hideCardMenu() {
  if (menuCloseHandler) {
    document.removeEventListener('click', menuCloseHandler);
    menuCloseHandler = null;
  }
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

  const addGroupActions = () => {
    addItem('设为工作', '', () => applyManualGroup(site, 'work'));
    addItem('设为学习', '', () => applyManualGroup(site, 'study'));

    addItem('设为工具', '', () => applyManualGroup(site, 'tool'));
    addItem('设为其他', '', () => applyManualGroup(site, 'other'));
    addItem('恢复自动', '', () => applyManualGroup(site, null));
  };

  if (site.pinned) {
    addItem('重命名', '', () => {
      const nameEl = card.querySelector('.site-name');
      startRename(nameEl, position, pinned);
    });
    addItem('编辑网址', '', () => {
      showEditUrlModal(position, site, pinned);
    });
    addGroupActions();
    addItem('取消固定', '', async () => {
      delete pinned[position];
      await savePinned(pinned);
      buildMergedGrid(pinned);
    });
    addItem('移除', 'danger', () => removeCard(position, site, pinned));
  } else {
    addItem('重命名', '', () => {
      const nameEl = card.querySelector('.site-name');
      startRename(nameEl, position, pinned);
    });
    addItem('编辑网址', '', () => {
      showEditUrlModal(position, site, pinned);
    });
    addGroupActions();
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
  menuCloseHandler = (e) => {
    if (!menu.contains(e.target)) {
      hideCardMenu();
    }
  };
  setTimeout(() => document.addEventListener('click', menuCloseHandler), 0);
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
    const domain = site.domain || getDomainFromUrl(url);

    const card = document.createElement('div');
    card.className = 'site-card';
    if (site.pinned) card.classList.add('is-pinned');
    if (site.locked) card.classList.add('is-locked');
    card.title = title || domain;
    card.dataset.position = position;
    card.dataset.url = url;
    card.dataset.group = site.group || classifyDomain(domain).key;

    const icon = createIconEl(url, domain);
    card.appendChild(icon);

    const name = document.createElement('div');
    name.className = 'site-name';
    name.textContent = title || domain;
    card.appendChild(name);

    if (site.manualGroup) {
      const groupLabel = document.createElement('div');
      groupLabel.className = 'site-group-label';
      groupLabel.textContent = getGroupLabel(site.manualGroup);
      groupLabel.style.borderColor = getGroupColor(site.manualGroup);
      groupLabel.style.color = getGroupColor(site.manualGroup);
      card.appendChild(groupLabel);
    }

    const dot = document.createElement('div');
    dot.className = 'pinned-dot';
    dot.title = '已锁定';
    dot.innerHTML = '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
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
    card.style.cursor = 'pointer';
    card.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      chrome.tabs.update({ url });
    });

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

  applySiteFilters();
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

  // 拖拽源是非固定卡片 → 固定到目标位置（但不锁定）
  if (!srcSite.pinned) {
    newPinned[dstPos] = { url: srcSite.url, title: srcSite.title, locked: false };
  }

  await savePinned(newPinned);
  buildMergedGrid(newPinned);
}

function setFavicon(container, url, domain, size) {
  if (!isExtensionRuntime()) {
    const fb = document.createElement('div');
    fb.className = 'fallback';
    fb.style.background = getColorForDomain(domain);
    fb.textContent = getInitial(domain);
    container.appendChild(fb);
    return;
  }

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
  pinned[position] = { url: site.url, title: site.title, locked: true };
  await savePinned(pinned);
  buildMergedGrid(pinned);
}

// --- Remove Card ---
async function removeCard(position, site, pinned) {
  if (!site.pinned) return;

  delete pinned[position];

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
    } else {
      // Unpinned card: pin it with the new title
      const site = currentSlots[position];
      if (site) {
        pinned[position] = { url: site.url, title: newName, locked: false };
        await savePinned(pinned);
        buildMergedGrid(pinned);
      }
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

// --- Modal helpers ---
let addFormCleanup = null;

function showAddFormModal(titleText, urlValue, nameValue, onConfirm) {
  const form = document.getElementById('addForm');
  const urlInput = document.getElementById('addUrl');
  const nameInput = document.getElementById('addName');
  const titleEl = document.getElementById('addFormTitle');
  const cancelBtn = document.getElementById('addCancel');
  const confirmBtn = document.getElementById('addConfirm');

  // 清理旧的事件监听
  if (addFormCleanup) addFormCleanup();

  if (titleEl) titleEl.textContent = titleText;
  urlInput.value = urlValue;
  nameInput.value = nameValue;
  form.classList.add('show');
  urlInput.focus();

  const hide = () => {
    form.classList.remove('show');
    if (addFormCleanup) {
      addFormCleanup();
      addFormCleanup = null;
    }
  };

  const onCancel = () => hide();
  const onKeyDown = (e) => {
    if (e.key === 'Escape') hide();
    if (e.key === 'Enter') confirmBtn.click();
  };

  const confirmHandler = async () => {
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

    await onConfirm(url, name);
    hide();
  };

  cancelBtn.addEventListener('click', onCancel);
  confirmBtn.addEventListener('click', confirmHandler);
  form.addEventListener('keydown', onKeyDown);

  addFormCleanup = () => {
    cancelBtn.removeEventListener('click', onCancel);
    confirmBtn.removeEventListener('click', confirmHandler);
    form.removeEventListener('keydown', onKeyDown);
  };
}

// --- Edit URL Modal ---
function showEditUrlModal(position, site, pinned) {
  const titleValue = (pinned[position] && pinned[position].title) || site.title || '';
  showAddFormModal('编辑网站', site.url, titleValue, async (url, name) => {
    const previousUrl = (pinned[position] && pinned[position].url) || site.url;
    if (pinned[position]) {
      pinned[position].url = url;
      pinned[position].title = name;
    } else {
      pinned[position] = { url, title: name, locked: false };
    }
    await moveSiteGroup(previousUrl, url);
    await savePinned(pinned);
    buildMergedGrid(pinned);
  });
}

// --- Add Form ---
function showAddForm(pinned) {
  showAddFormModal('添加网站', '', '', async (url, name) => {
    // 移除同 URL 的旧固定
    for (const [pos, s] of Object.entries(pinned)) {
      if (s.url === url) delete pinned[pos];
    }

    const targetPos = findFirstFreePosition(pinned);
    if (targetPos < 0) return;

    // 从隐藏列表中移除
    const hiddenSet = await loadHidden();
    hiddenSet.delete(url);
    await saveHidden(hiddenSet);

    // 从缓存中移除
    cachedDynamicSites = cachedDynamicSites.filter((s) => s.url !== url);

    pinned[targetPos] = { url, title: name, locked: false };
    await savePinned(pinned);
    buildMergedGrid(pinned);
  });
}

// --- Usage Stats ---
const USAGE_RANGES = {
  today: { label: '今天', days: 1, fromStartOfDay: true },
  '7d': { label: '7天', days: 7 },
  '30d': { label: '30天', days: 30 },
};
const CATEGORY_RULES = [
  {
    key: 'work',
    label: '工作',
    color: '#1a73e8',
    domains: ['github.com', 'gitlab.com', 'docs.google.com', 'notion.so', 'figma.com', 'linear.app', 'slack.com', 'trello.com'],
  },
  {
    key: 'study',
    label: '学习',
    color: '#0f9d58',
    domains: ['developer.mozilla.org', 'stackoverflow.com', 'wikipedia.org', 'medium.com', 'dev.to', 'coursera.org', 'udemy.com'],
  },
  {
    key: 'fun',
    label: '娱乐',
    color: '#db4437',
    domains: ['youtube.com', 'bilibili.com', 'netflix.com', 'reddit.com', 'twitter.com', 'x.com', 'instagram.com'],
  },
  {
    key: 'tool',
    label: '工具',
    color: '#f4b400',
    domains: ['google.com', 'bing.com', 'baidu.com', 'chatgpt.com', 'openai.com', 'translate.google.com', 'npmjs.com'],
  },
  {
    key: 'other',
    label: '其他',
    color: '#9aa0a6',
    domains: [],
  },
];

let currentUsageRange = 'today';

async function loadRanking() {
  await loadUsageStats(currentUsageRange);
}

async function loadUsageStats(rangeKey) {
  const content = document.getElementById('usageContent');
  content.innerHTML = '<div class="usage-loading">加载中...</div>';

  try {
    if (!(await hasOptionalPermission(HISTORY_PERMISSION))) {
      renderHistoryPermissionPrompt();
      return;
    }

    const range = getUsageRange(rangeKey);
    const previousRange = getPreviousUsageRange(range, rangeKey);
    const [currentStats, previousStats] = await Promise.all([
      collectUsageStats(range.start, range.end),
      collectUsageStats(previousRange.start, previousRange.end),
    ]);

    renderUsageStats(currentStats, previousStats, rangeKey);
  } catch (err) {
    content.innerHTML = '<div class="usage-empty">无法加载使用统计</div>';
  }
}

function getUsageRange(rangeKey) {
  const now = Date.now();
  const config = USAGE_RANGES[rangeKey] || USAGE_RANGES.today;
  let start;

  if (config.fromStartOfDay) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    start = today.getTime();
  } else {
    start = now - config.days * 24 * 60 * 60 * 1000;
  }

  return { start, end: now };
}

function getPreviousUsageRange(range, rangeKey) {
  const duration = range.end - range.start;
  if (rangeKey === 'today') {
    const previousStart = range.start - 24 * 60 * 60 * 1000;
    return {
      start: previousStart,
      end: previousStart + duration,
    };
  }

  return {
    start: range.start - duration,
    end: range.start,
  };
}

async function collectUsageStats(startTime, endTime) {
  const historyItems = await new Promise((resolve) => {
    chrome.history.search(
      { text: '', startTime, endTime, maxResults: 2000 },
      (results) => resolve(results || [])
    );
  });

  const domainMap = new Map();
  await Promise.all(historyItems.map(async (item) => {
    let parsed;
    try {
      parsed = new URL(item.url);
    } catch (_) {
      return;
    }

    const visits = await getVisitsForUrl(item.url);
    const visitsInRange = visits.filter((visit) =>
      visit.visitTime >= startTime && visit.visitTime < endTime
    );
    if (!visitsInRange.length) return;

    const domain = parsed.hostname.replace(/^www\./, '');
    const existing = domainMap.get(domain);
    const count = visitsInRange.length;
    if (existing) {
      existing.count += count;
    } else {
      domainMap.set(domain, {
        domain,
        title: item.title || domain,
        url: `${parsed.protocol}//${parsed.hostname}/`,
        count,
      });
    }
  }));

  const domains = [...domainMap.values()].sort((a, b) => b.count - a.count);
  const totalVisits = domains.reduce((sum, item) => sum + item.count, 0);
  const categoryTotals = buildCategoryTotals(domains);

  return {
    totalVisits,
    activeDomains: domains.length,
    topDomain: domains[0] || null,
    domains,
    categoryTotals,
  };
}

function getVisitsForUrl(url) {
  return new Promise((resolve) => {
    chrome.history.getVisits({ url }, (visits) => resolve(visits || []));
  });
}

function buildCategoryTotals(domains) {
  const totals = new Map(CATEGORY_RULES.map((category) => [category.key, {
    ...category,
    count: 0,
  }]));

  for (const item of domains) {
    const category = classifyDomain(item.domain);
    totals.get(category.key).count += item.count;
  }

  return [...totals.values()].filter((category) => category.count > 0);
}

function classifyDomain(domain) {
  for (const category of CATEGORY_RULES) {
    if (category.key === 'other') continue;
    if (category.domains.some((known) => domain === known || domain.endsWith('.' + known))) {
      return category;
    }
  }
  return CATEGORY_RULES.find((category) => category.key === 'other');
}

function renderHistoryPermissionPrompt() {
  const content = document.getElementById('usageContent');
  content.innerHTML = '';

  const button = document.createElement('button');
  button.className = 'rank-permission-prompt';
  button.type = 'button';
  button.textContent = '启用使用统计';
  button.addEventListener('click', async () => {
    const granted = await requestOptionalPermissions([HISTORY_PERMISSION]);
    if (!granted) return;
    cachedHistoryItems = null;
    cachedHistoryPromise = null;
    await loadTopSites();
    await loadRanking();
  });

  const note = document.createElement('div');
  note.className = 'usage-permission-note';
  note.textContent = '统计仅在本地读取浏览历史生成。';

  content.appendChild(button);
  content.appendChild(note);
}

function renderUsageStats(stats, previousStats, rangeKey) {
  const content = document.getElementById('usageContent');
  content.innerHTML = '';

  if (!stats.totalVisits) {
    content.innerHTML = '<div class="usage-empty">这个时间段暂无浏览记录</div>';
    return;
  }

  const summary = document.createElement('div');
  summary.className = 'usage-summary';
  summary.appendChild(createUsageMetric('访问次数', formatCount(stats.totalVisits)));
  summary.appendChild(createUsageMetric('活跃站点', formatCount(stats.activeDomains)));
  summary.appendChild(createUsageMetric('最常访问', stats.topDomain ? stats.topDomain.domain : '-'));
  content.appendChild(summary);

  const trend = document.createElement('div');
  trend.className = 'usage-trend';
  trend.textContent = formatTrend(stats.totalVisits, previousStats.totalVisits, rangeKey);
  content.appendChild(trend);

  renderUsageTopList(content, stats.domains.slice(0, 8));
  renderCategoryBars(content, stats.categoryTotals, stats.totalVisits);
}

function createUsageMetric(label, value) {
  const metric = document.createElement('div');
  metric.className = 'usage-metric';

  const valueEl = document.createElement('div');
  valueEl.className = 'usage-metric-value';
  valueEl.textContent = value;

  const labelEl = document.createElement('div');
  labelEl.className = 'usage-metric-label';
  labelEl.textContent = label;

  metric.appendChild(valueEl);
  metric.appendChild(labelEl);
  return metric;
}

function renderUsageTopList(container, domains) {
  const section = document.createElement('div');
  section.className = 'usage-section';

  const title = document.createElement('div');
  title.className = 'usage-section-title';
  title.textContent = 'TOP 网站';
  section.appendChild(title);

  const list = document.createElement('ol');
  list.className = 'rank-list';

  domains.forEach((item, i) => {
    const li = document.createElement('li');
    li.className = 'rank-item';
    li.title = `${item.domain} - 访问 ${item.count} 次`;

    const num = document.createElement('span');
    num.className = 'rank-num';
    num.textContent = i + 1;

    const icon = document.createElement('span');
    icon.className = 'rank-favicon';
    setFavicon(icon, item.url, item.domain, 12);

    const domain = document.createElement('span');
    domain.className = 'rank-domain';
    domain.textContent = item.domain;

    const count = document.createElement('span');
    count.className = 'rank-count';
    count.textContent = formatCount(item.count);

    li.appendChild(num);
    li.appendChild(icon);
    li.appendChild(domain);
    li.appendChild(count);
    li.addEventListener('click', () => chrome.tabs.update({ url: item.url }));

    list.appendChild(li);
  });

  section.appendChild(list);
  container.appendChild(section);
}

function renderCategoryBars(container, categories, totalVisits) {
  const section = document.createElement('div');
  section.className = 'usage-section';

  const title = document.createElement('div');
  title.className = 'usage-section-title';
  title.textContent = '分类占比';
  section.appendChild(title);

  const sorted = [...categories].sort((a, b) => b.count - a.count);
  sorted.forEach((category) => {
    const percent = totalVisits ? Math.round((category.count / totalVisits) * 100) : 0;
    const row = document.createElement('div');
    row.className = 'usage-category';

    const label = document.createElement('div');
    label.className = 'usage-category-label';
    const dot = document.createElement('span');
    dot.style.background = category.color;
    label.appendChild(dot);
    label.appendChild(document.createTextNode(category.label));

    const value = document.createElement('div');
    value.className = 'usage-category-value';
    value.textContent = `${percent}%`;

    const bar = document.createElement('div');
    bar.className = 'usage-category-bar';
    const fill = document.createElement('div');
    fill.style.width = `${percent}%`;
    fill.style.background = category.color;
    bar.appendChild(fill);

    row.appendChild(label);
    row.appendChild(value);
    row.appendChild(bar);
    section.appendChild(row);
  });

  container.appendChild(section);
}

function formatTrend(current, previous, rangeKey) {
  const label = rangeKey === 'today' ? '较昨日同期' : '较上一周期';
  if (!previous && !current) return `${label} 暂无变化`;
  if (!previous) return `${label} 新增 ${formatCount(current)} 次`;

  const diff = current - previous;
  const percent = Math.round((diff / previous) * 100);
  if (diff === 0) return `${label} 持平`;
  return `${label} ${diff > 0 ? '+' : ''}${percent}%`;
}

function formatCount(n) {
  if (n >= 10000) return (n / 10000).toFixed(1) + '万';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}

// --- Rank Toggle ---
document.getElementById('addSiteBtn').addEventListener('click', async () => {
  const pinned = await loadPinned();
  showAddForm(pinned);
});

document.getElementById('rankToggle').addEventListener('click', () => {
  const panel = document.getElementById('rankPanel');
  const btn = document.getElementById('rankToggle');
  const isOpen = panel.classList.toggle('open');
  btn.classList.toggle('active', isOpen);
  btn.textContent = isOpen ? '收起统计' : '统计';
});

const siteGroupTabsEl = document.getElementById('siteGroupTabs');
siteGroupTabsEl.addEventListener('click', (e) => {
  const tab = e.target.closest('.site-group-tab');
  if (!tab) return;
  setActiveGroup(tab.dataset.group);
});

siteGroupTabsEl.addEventListener('dragover', (e) => {
  const tab = e.target.closest('.site-group-tab');
  if (!tab) return;
  e.preventDefault();
  tab.classList.add('drag-over');
});

siteGroupTabsEl.addEventListener('dragleave', (e) => {
  const tab = e.target.closest('.site-group-tab');
  if (tab) tab.classList.remove('drag-over');
});

siteGroupTabsEl.addEventListener('drop', async (e) => {
  const tab = e.target.closest('.site-group-tab');
  if (!tab) return;
  e.preventDefault();
  e.stopPropagation();
  tab.classList.remove('drag-over');

  if (dragSrcPos === null) return;
  const site = currentSlots[dragSrcPos];
  if (!site) return;

  await applyManualGroup(site, tab.dataset.group);
  setActiveGroup(tab.dataset.group);
});

document.getElementById('usageTabs').addEventListener('click', (e) => {
  const tab = e.target.closest('.usage-tab');
  if (!tab) return;

  currentUsageRange = tab.dataset.range;
  document.querySelectorAll('.usage-tab').forEach((item) => {
    item.classList.toggle('active', item === tab);
  });
  loadRanking();
});

// --- Note ---
const NOTE_KEY = 'mytab_note';
const noteFab = document.getElementById('noteFab');
const noteFabDot = document.getElementById('noteFabDot');
const notePanel = document.getElementById('notePanel');
const noteTextarea = document.getElementById('noteTextarea');
const noteSaved = document.getElementById('noteSaved');
const noteCount = document.getElementById('noteCount');
let noteSaveTimer = null;

async function loadNote() {
  try {
    const result = await chrome.storage.local.get(NOTE_KEY);
    const data = result[NOTE_KEY];
    if (data && data.content) {
      noteTextarea.value = data.content;
      updateNoteIndicator();
    }
  } catch (_) {}
}

function updateNoteIndicator() {
  const hasContent = noteTextarea.value.trim().length > 0;
  noteFab.classList.toggle('has-content', hasContent);
  noteCount.textContent = noteTextarea.value.length;
}

async function saveNote() {
  const content = noteTextarea.value;
  await chrome.storage.local.set({ [NOTE_KEY]: { content, updatedAt: Date.now() } });
  noteSaved.classList.add('show');
  setTimeout(() => noteSaved.classList.remove('show'), 1200);
}

noteTextarea.addEventListener('input', () => {
  updateNoteIndicator();
  clearTimeout(noteSaveTimer);
  noteSaveTimer = setTimeout(saveNote, 500);
});

noteFab.addEventListener('click', () => {
  const isOpen = notePanel.classList.contains('show');
  if (isOpen) {
    notePanel.classList.remove('show');
    noteFab.classList.remove('open');
  } else {
    notePanel.classList.add('show');
    noteFab.classList.add('open');
    noteTextarea.focus();
  }
});

document.getElementById('notePanelClose').addEventListener('click', () => {
  notePanel.classList.remove('show');
  noteFab.classList.remove('open');
});

document.addEventListener('click', (e) => {
  if (notePanel.classList.contains('show') &&
      !notePanel.contains(e.target) &&
      e.target !== noteFab &&
      !noteFab.contains(e.target)) {
    notePanel.classList.remove('show');
    noteFab.classList.remove('open');
  }
});

loadTheme();
loadTopSites();
loadRanking();
loadBookmarks();
loadEngine();
loadNote();
