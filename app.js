const { createApp, ref, computed, onMounted, watch } = Vue;

const STORAGE_KEY = 'excel_import_data';
const PAGE_SIZE_KEY = 'excel_page_size';
const LOG_KEY = 'excel_operation_logs';
const THEME_KEY = 'excel_theme';
const MAX_LOG = 500;

// 从 localStorage 读取
function loadFromStorage() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch { return null; }
}

// 保存到 localStorage
function saveToStorage(data, sheetName) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ data, sheetName, savedAt: Date.now() }));
}

function loadLogs() {
    try { return JSON.parse(localStorage.getItem(LOG_KEY)) || []; } catch { return []; }
}
function saveLogs(logs) {
    localStorage.setItem(LOG_KEY, JSON.stringify(logs));
    // 异步保存到服务端
    fetch('/api/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(logs)
    }).catch(() => {});
}
async function loadLogsFromServer() {
    try {
        const res = await fetch('/api/logs');
        if (!res.ok) return null;
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
            localStorage.setItem(LOG_KEY, JSON.stringify(data));
            return data;
        }
    } catch {}
    return null;
}

// 从表头数组生成唯一 prop 的列定义（处理重复列名）
function makeColumns(headers) {
    const seen = {};
    return headers.map(k => {
        if (!(k in seen)) seen[k] = 0;
        seen[k]++;
        const prop = seen[k] > 1 ? `${k}_${seen[k]}` : k;
        return { prop, label: String(k) };
    });
}

// -------- Toast 消息提示 --------
let toastId = 0;
function showToast(message, type) {
    type = type || 'info';
    const container = document.getElementById('toast-container');
    if (!container) return;
    const id = ++toastId;
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.id = 'toast-' + id;
    el.textContent = message;
    container.appendChild(el);
    setTimeout(() => {
        el.classList.add('toast-leave');
        setTimeout(() => el.remove(), 250);
    }, 3000);
}
function showToastSuccess(msg) { showToast(msg, 'success'); }
function showToastWarning(msg) { showToast(msg, 'warning'); }
function showToastInfo(msg) { showToast(msg, 'info'); }
function showToastError(msg) { showToast(msg, 'error'); }

// -------- Confirm 对话框 --------
function showConfirm(message, title, okText, cancelText) {
    return new Promise((resolve, reject) => {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay open';
        overlay.innerHTML = `
            <div class="modal-box sm confirm-box">
                <div class="modal-header">${title || '提示'}</div>
                <div class="modal-body">
                    <p class="confirm-msg">${message}</p>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-default btn-cancel">${cancelText || '取消'}</button>
                    <button class="btn btn-primary btn-ok">${okText || '确定'}</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.querySelector('.btn-ok').onclick = () => { overlay.remove(); resolve(); };
        overlay.querySelector('.btn-cancel').onclick = () => { overlay.remove(); reject(); };
        overlay.onclick = (e) => { if (e.target === overlay) { overlay.remove(); reject(); } };
    });
}

// -------- 主题系统 --------
const THEMES = [
    { id: 'warm',  name: '暖阳',  icon: '☀️' },
    { id: 'light', name: '皓月',  icon: '🌙' },
    { id: 'dark',  name: '深空',  icon: '🌌' },
    { id: 'cyber', name: '赛博',  icon: '💠' },
];
const THEME_ICONS = { warm: '☀️', light: '🌙', dark: '🌌', cyber: '💠' };

function applyTheme(themeId) {
    document.documentElement.dataset.theme = themeId;
    try { localStorage.setItem(THEME_KEY, themeId); } catch {}
}

const app = createApp({
    setup() {
        const tableData = ref([]);
        const columns = ref([]);
        const sheetName = ref('');
        const searchQuery = ref('');
        const isServerMode = ref(false);
        const addDialogVisible = ref(false);
        const addForm = ref({});
        const selectedRowIds = ref(new Set());
        function toggleRowSelection(row) {
            const s = new Set(selectedRowIds.value);
            s.has(row.id) ? s.delete(row.id) : s.add(row.id);
            selectedRowIds.value = s;
        }
        function toggleAllSelection() {
            const all = pageData.value.map(r => r.id);
            selectedRowIds.value = selectedRowIds.value.size === all.length
                ? new Set() : new Set(all);
        }
        const isAllSelected = computed(() => pageData.value.length > 0 && selectedRowIds.value.size === pageData.value.length);
        const isIndeterminate = computed(() => {
            const s = selectedRowIds.value.size;
            return s > 0 && s < pageData.value.length;
        });
        const getNextId = () => {
            const maxId = tableData.value.reduce((max, r) => Math.max(max, Number(r.id) || 0), 0);
            return maxId + 1;
        };

        // -------- 操作日志 --------
        const logs = ref(loadLogs());
        const logDialogVisible = ref(false);
        function addLog(action, detail, beforeCount) {
            const entry = {
                id: Date.now(),
                time: new Date().toLocaleString('zh-CN', { hour12: false }),
                action,
                detail,
                beforeCount,
                afterCount: tableData.value.length,
            };
            logs.value.unshift(entry);
            if (logs.value.length > MAX_LOG) logs.value.length = MAX_LOG;
            saveLogs(logs.value);
        }
        const highlightText = (text) => {
            const q = searchQuery.value.trim();
            if (!q || text === null || text === undefined) return escapeHtml(String(text ?? ''));
            const str = String(text);
            const idx = str.toLowerCase().indexOf(q.toLowerCase());
            if (idx === -1) return escapeHtml(str);
            return escapeHtml(str.slice(0, idx)) + '<span class="cell-hl">' + escapeHtml(str.slice(idx, idx + q.length)) + '</span>' + escapeHtml(str.slice(idx + q.length));
        };
        function escapeHtml(s) {
            return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        }

        const currentPage = ref(1);
        const pageSize = ref(Number(localStorage.getItem(PAGE_SIZE_KEY)) || 50);
        const tableHeight = computed(() => {
            const res = window.innerHeight - 330
            return res > 300 ? res : 300;
        });
        const filteredData = computed(() => {
            const q = searchQuery.value.trim().toLowerCase();
            if (!q) return tableData.value;
            return tableData.value.filter(row =>
                Object.values(row).some(val =>
                    val !== null && val !== undefined && String(val).toLowerCase().includes(q)
                )
            );
        });
        const pageData = computed(() => {
            const start = (currentPage.value - 1) * pageSize.value;
            return filteredData.value.slice(start, start + pageSize.value);
        });
        const totalPages = computed(() => Math.max(1, Math.ceil(filteredData.value.length / pageSize.value)));

        function resetPage() { currentPage.value = 1; }

        watch(pageSize, (val) => {
            localStorage.setItem(PAGE_SIZE_KEY, val);
            resetPage();
        });
        watch(searchQuery, () => { resetPage(); });

        // -------- 主题 --------
        const themes = THEMES;
        const currentTheme = ref('warm');
        const themePanelOpen = ref(false);
        const themeBtnRef = ref(null);
        const themeIcon = computed(() => THEME_ICONS[currentTheme.value] || '☀️');

        function setTheme(id) {
            currentTheme.value = id;
            applyTheme(id);
            themePanelOpen.value = false;
        }

        function toggleThemePanel() {
            themePanelOpen.value = !themePanelOpen.value;
        }

        // 点击外部关闭主题面板
        function onDocClick(e) {
            if (themePanelOpen.value && themeBtnRef.value) {
                const el = themeBtnRef.value;
                if (!el.contains(e.target)) {
                    themePanelOpen.value = false;
                }
            }
        }

        // -------- 分页导航 ---------
        function goPage(p) {
            if (p < 1 || p > totalPages.value) return;
            currentPage.value = p;
        }
        function pageRange() {
            const total = totalPages.value;
            const cur = currentPage.value;
            if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
            const pages = [];
            pages.push(1);
            if (cur > 3) pages.push('...');
            const start = Math.max(2, cur - 1);
            const end = Math.min(total - 1, cur + 1);
            for (let i = start; i <= end; i++) pages.push(i);
            if (cur < total - 2) pages.push('...');
            pages.push(total);
            return pages;
        }

        // -------- 列宽调整 --------
        const columnWidths = ref(loadColumnWidths());
        function loadColumnWidths() {
            try { return JSON.parse(localStorage.getItem('excel_column_widths')) || {}; } catch { return {}; }
        }
        function saveColumnWidths() {
            try { localStorage.setItem('excel_column_widths', JSON.stringify(columnWidths.value)); } catch {}
        }
        function colWidthStyle(prop) {
            const w = columnWidths.value[prop];
            return w ? { width: w + 'px', minWidth: '120px' } : {};
        }
        const resizing = ref(null);
        function startResize(e, prop) {
            const th = e.target.closest('th');
            if (!th) return;
            resizing.value = { prop, startX: e.clientX, startWidth: th.offsetWidth };
            document.addEventListener('mousemove', onResize);
            document.addEventListener('mouseup', stopResize);
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
            e.preventDefault();
        }
        function onResize(e) {
            if (!resizing.value) return;
            const diff = e.clientX - resizing.value.startX;
            const newWidth = Math.max(80, resizing.value.startWidth + diff);
            columnWidths.value = { ...columnWidths.value, [resizing.value.prop]: newWidth };
        }
        function stopResize() {
            if (resizing.value) {
                saveColumnWidths();
                resizing.value = null;
            }
            document.removeEventListener('mousemove', onResize);
            document.removeEventListener('mouseup', stopResize);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        }

        // -------- 单元格溢出提示（只有鼠标离开单元格和提示框两者才隐藏） --------
        const tipVisible = ref(false);
        const tipText = ref('');
        const tipX = ref(0);
        const tipY = ref(0);
        let tipTimer = null;
        let inCell = false;  // 鼠标在触发提示的单元格内
        let inTip = false;   // 鼠标在提示框内
        const TIP_DELAY = 200;
        function tipCheckHide() {
            if (!inCell && !inTip) {
                tipTimer = setTimeout(() => { tipVisible.value = false; }, TIP_DELAY);
            }
        }
        function handleCellEnter(e, row, col) {
            inCell = true;
            const td = e.currentTarget;
            if (td.scrollWidth <= td.clientWidth) return;
            const rect = td.getBoundingClientRect();
            tipText.value = row[col.prop] != null ? String(row[col.prop]) : '';
            tipX.value = rect.left;
            tipY.value = rect.top;
            clearTimeout(tipTimer);
            tipTimer = setTimeout(() => { tipVisible.value = true; }, TIP_DELAY);
        }
        function handleCellLeave() {
            inCell = false;
            clearTimeout(tipTimer);
            tipCheckHide();
        }
        function handleTipEnter() {
            inTip = true;
            clearTimeout(tipTimer);
        }
        function handleTipLeave() {
            inTip = false;
            clearTimeout(tipTimer);
            tipCheckHide();
        }

        // -------- 解析 Excel --------
        function parseExcel(worksheet) {
            const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
            let headerIdx = -1, maxCols = 0;
            for (let i = 0; i < rows.length; i++) {
                const r = rows[i];
                if (!r) continue;
                const count = r.filter(c => c !== null && c !== undefined && c !== '').length;
                if (count > maxCols) { maxCols = count; headerIdx = i; }
            }
            if (headerIdx === -1) return [];

            const headers = rows[headerIdx];
            const result = [];
            for (let i = headerIdx + 1; i < rows.length; i++) {
                const r = rows[i];
                if (!r || r.every(c => c === null || c === undefined || c === '')) continue;
                if (r.length <= 2 && typeof r[0] === 'string' && r[0].startsWith('#')) continue;
                const obj = {};
                headers.forEach((h, idx) => {
                    if (h !== null && h !== undefined && h !== '') {
                        obj[h] = idx < r.length ? r[idx] : null;
                    }
                });
                result.push(obj);
            }
            return result;
        }

        // -------- 服务端 API --------
        async function tryLoadFromServer() {
            try {
                const res = await fetch('/api/data');
                if (!res.ok) return false;
                const payload = await res.json();
                const data = payload.data || payload;
                if (!Array.isArray(data) || data.length === 0) return false;
                columns.value = makeColumns(Object.keys(data[0]));
                tableData.value = data;
                sheetName.value = payload.sheetName || 'data';
                isServerMode.value = true;
                return true;
            } catch { return false; }
        }

        async function saveToServer(data, name) {
            try {
                const payload = {
                    sheetName: name,
                    exportedAt: new Date().toISOString(),
                    total: data.length,
                    data: data
                };
                const res = await fetch('/api/save', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                if (res.ok) isServerMode.value = true;
            } catch { /* 服务端不可用，忽略 */ }
        }

        async function clearServerData() {
            try {
                await fetch('/api/data', { method: 'DELETE' });
            } catch { /* 忽略 */ }
        }

        // -------- 初始化 --------
        onMounted(async () => {
            // 恢复主题
            const saved = (() => {
                try { return localStorage.getItem(THEME_KEY); } catch { return null; }
            })();
            if (saved && THEMES.some(t => t.id === saved)) {
                currentTheme.value = saved;
                applyTheme(saved);
            } else {
                applyTheme('warm');
            }
            document.addEventListener('click', onDocClick);

            // 优先从服务端加载（启动时自动读 data.json）
            const loaded = await tryLoadFromServer();
            if (!loaded) {
                // 回退到 localStorage
                const stored = loadFromStorage();
                if (stored && stored.data && stored.data.length) {
                    columns.value = makeColumns(Object.keys(stored.data[0]));
                    tableData.value = stored.data;
                    sheetName.value = stored.sheetName || '';
                }
            }
            // 从服务端加载操作日志
            const serverLogs = await loadLogsFromServer();
            if (serverLogs) logs.value = serverLogs;
        });
        // -------- 事件处理 --------
        const handleFileInput = async (e) => {
            const file = e.target.files && e.target.files[0];
            if (!file) return;

            // 存在数据时询问追加或替换
            let mode = 'replace';
            if (tableData.value.length > 0) {
                try {
                    await showConfirm('当前已有数据，请选择导入方式：', '导入确认', '追加', '替换');
                    mode = 'append';
                } catch {
                    mode = 'replace';
                }
            }

            const reader = new FileReader();
            reader.onload = async (ev) => {
                try {
                    const data = new Uint8Array(ev.target.result);
                    const workbook = XLSX.read(data, { type: 'array' });
                    const name = workbook.SheetNames[0];
                    const worksheet = workbook.Sheets[name];
                    const jsonData = parseExcel(worksheet);

                    if (jsonData.length === 0) {
                        showToastWarning('未识别到有效数据');
                        return;
                    }

                    const beforeCount = tableData.value.length;
                    let addedCount = jsonData.length;
                    if (mode === 'append') {
                        const existing = tableData.value;
                        const newRows = jsonData.filter(row =>
                            !existing.some(ex =>
                                Object.keys(row).every(k => row[k] === ex[k])
                            )
                        );
                        addedCount = newRows.length;
                        if (addedCount === 0) {
                            showToastInfo('所有数据均已存在，无需追加');
                            return;
                        }
                        let nextId = getNextId();
                        const newRowsWithId = newRows.map(row => ({ ...row, id: nextId++ }));
                        tableData.value = [...existing, ...newRowsWithId];
                    } else {
                        columns.value = [{ prop: 'id', label: 'ID' }, ...makeColumns(Object.keys(jsonData[0]))];
                        const dataWithId = jsonData.map((row, idx) => ({ ...row, id: idx + 1 }));
                        tableData.value = dataWithId;
                        sheetName.value = name;
                    }
                    resetPage();

                    // 保存到服务端（自动写入项目目录 data.json）
                    await saveToServer(tableData.value, sheetName.value || name);
                    // 同时保存到 localStorage 作为备份
                    saveToStorage(tableData.value, sheetName.value || name);

                    addLog(mode === 'append' ? '追加导入' : '导入', `文件: ${file.name}, ${addedCount} 条`, beforeCount);
                    showToastSuccess(`成功导入 ${addedCount} 条记录`);
                } catch (err) {
                    showToastError('文件解析失败：' + err.message);
                }
            };
            reader.readAsArrayBuffer(file);
            // 重置 input 以便重复选择同一文件
            e.target.value = '';
        };

        const showAddDialog = () => {
            const form = {};
            columns.value.forEach(col => { if (col.prop !== 'id') form[col.prop] = ''; });
            addForm.value = form;
            addDialogVisible.value = true;
        };

        const confirmAdd = async () => {
            const hasValue = Object.values(addForm.value).some(v => v !== '' && v !== null && v !== undefined);
            if (!hasValue) {
                showToastWarning('请至少填写一个字段');
                return;
            }
            const beforeCount = tableData.value.length;
            tableData.value = [{ id: getNextId(), ...addForm.value }, ...tableData.value];
            addDialogVisible.value = false;
            resetPage();

            await saveToServer(tableData.value, sheetName.value);
            saveToStorage(tableData.value, sheetName.value);
            addLog('新增', '手动新增 1 条', beforeCount);
            showToastSuccess('已新增 1 条记录');
        };

        const deleteSelected = async () => {
            const beforeCount = tableData.value.length;
            const ids = selectedRowIds.value;
            tableData.value = tableData.value.filter(r => !ids.has(r.id));
            selectedRowIds.value = new Set();
            await saveToServer(tableData.value, sheetName.value);
            saveToStorage(tableData.value, sheetName.value);
            addLog('删除', `删除 ${beforeCount - tableData.value.length} 条`, beforeCount);
            showToastSuccess('已删除选中数据');
        };

        const clearData = async () => {
            try {
                await showConfirm('确定要全部清空数据吗？此操作不可恢复。', '清空数据');
            } catch {
                return;
            }
            const beforeCount = tableData.value.length;
            tableData.value = [];
            columns.value = [];
            sheetName.value = '';
            searchQuery.value = '';
            localStorage.removeItem(STORAGE_KEY);
            clearServerData();
            resetPage();
            addLog('清空', `清空全部 ${beforeCount} 条数据`, beforeCount);
            showToastInfo('数据已清空');
        };

        return {
            tableData, columns, sheetName, searchQuery, filteredData, pageData,
            currentPage, pageSize, totalPages, isServerMode, tableHeight,
            handleFileInput, clearData,
            addDialogVisible, addForm, showAddDialog, confirmAdd,
            deleteSelected, highlightText, logs, logDialogVisible,
            selectedRowIds, toggleRowSelection, toggleAllSelection, isAllSelected, isIndeterminate,
            themes, currentTheme, themeIcon, themePanelOpen, themeBtnRef,
            setTheme, toggleThemePanel, goPage, pageRange,
            columnWidths, colWidthStyle, startResize,
            tipVisible, tipText, tipX, tipY, handleCellEnter, handleCellLeave, handleTipEnter, handleTipLeave,
        };
    }
});

app.directive('indeterminate', {
    mounted(el, binding) { el.indeterminate = binding.value; },
    updated(el, binding) { el.indeterminate = binding.value; }
});

app.mount('#app');
