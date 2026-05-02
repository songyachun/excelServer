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
}

// -------- 主题系统 --------
const THEMES = [
    { id: 'warm',  name: '暖阳',  icon: '☀️' },
    { id: 'light', name: '皓月',  icon: '🌙' },
    { id: 'dark',  name: '深空',  icon: '🌌' },
];
const THEME_ICONS = { warm: '☀️', light: '🌙', dark: '🌌' };

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
        const addFormRef = ref(null);
        const multipleTableRef = ref(null);
        const selectedRows = ref([]);
        const onSelectionChange = (rows) => { selectedRows.value = rows; };
        const getNextId = () => {
            const maxId = tableData.value.reduce((max, r) => Math.max(max, Number(r.id) || 0), 0);
            return maxId + 1;
        };
        const getRowKey = (row) => row.id;

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
            return escapeHtml(str.slice(0, idx)) + '<span style="background:#ffd54f;padding:0 2px">' + escapeHtml(str.slice(idx, idx + q.length)) + '</span>' + escapeHtml(str.slice(idx + q.length));
        };
        function escapeHtml(s) {
            return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        }

        const currentPage = ref(1);
        const pageSize = ref(Number(localStorage.getItem(PAGE_SIZE_KEY)) || 50);
        const tableHeight = computed(() => {
            const res = window.innerHeight - 230
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
                columns.value = Object.keys(data[0]).map(k => ({ prop: k, label: k }));
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
                    columns.value = Object.keys(stored.data[0]).map(k => ({ prop: k, label: k }));
                    tableData.value = stored.data;
                    sheetName.value = stored.sheetName || '';
                }
            }
        });
        // -------- 事件处理 --------
        const handleFileChange = async (uploadFile) => {
            const file = uploadFile.raw;
            if (!file) return;

            // 存在数据时询问追加或替换
            let mode = 'replace';
            if (tableData.value.length > 0) {
                try {
                    const action = await ElementPlus.ElMessageBox.confirm(
                        '当前已有数据，请选择导入方式：',
                        '导入确认',
                        {
                            confirmButtonText: '追加',
                            cancelButtonText: '替换',
                            type: 'info',
                        }
                    );
                    mode = 'append';
                } catch {
                    mode = 'replace';
                }
            }

            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const data = new Uint8Array(e.target.result);
                    const workbook = XLSX.read(data, { type: 'array' });
                    const name = workbook.SheetNames[0];
                    const worksheet = workbook.Sheets[name];
                    const jsonData = parseExcel(worksheet);

                    if (jsonData.length === 0) {
                        ElementPlus.ElMessage.warning('未识别到有效数据');
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
                            ElementPlus.ElMessage.info('所有数据均已存在，无需追加');
                            return;
                        }
                        let nextId = getNextId();
                        const newRowsWithId = newRows.map(row => ({ ...row, id: nextId++ }));
                        tableData.value = [...existing, ...newRowsWithId];
                    } else {
                        columns.value = [{ prop: 'id', label: 'ID' }, ...Object.keys(jsonData[0]).map(k => ({ prop: k, label: k }))];
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
                    ElementPlus.ElMessage.success(`成功导入 ${addedCount} 条记录`);
                } catch (err) {
                    ElementPlus.ElMessage.error('文件解析失败：' + err.message);
                }
            };
            reader.readAsArrayBuffer(file);
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
                ElementPlus.ElMessage.warning('请至少填写一个字段');
                return;
            }
            const beforeCount = tableData.value.length;
            tableData.value = [{ id: getNextId(), ...addForm.value }, ...tableData.value];
            addDialogVisible.value = false;
            resetPage();

            await saveToServer(tableData.value, sheetName.value);
            saveToStorage(tableData.value, sheetName.value);
            addLog('新增', '手动新增 1 条', beforeCount);
            ElementPlus.ElMessage.success('已新增 1 条记录');
        };

        const deleteSelected = async () => {
            const beforeCount = tableData.value.length;
            const ids = new Set(selectedRows.value.map(r => r.id));
            tableData.value = tableData.value.filter(r => !ids.has(r.id));
            selectedRows.value = [];
            await saveToServer(tableData.value, sheetName.value);
            saveToStorage(tableData.value, sheetName.value);
            addLog('删除', `删除 ${beforeCount - tableData.value.length} 条`, beforeCount);
            ElementPlus.ElMessage.success('已删除选中数据');
        };

        const clearData = async () => {
            try {
                await ElementPlus.ElMessageBox.confirm(
                    '确定要全部清空数据吗？此操作不可恢复。',
                    '清空数据',
                    { confirmButtonText: '确定', cancelButtonText: '取消', type: 'warning' }
                );
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
            ElementPlus.ElMessage.info('数据已清空');
        };

        return {
            tableData, columns, sheetName, searchQuery, filteredData, pageData,
            currentPage, pageSize, isServerMode, tableHeight,
            handleFileChange, clearData,
            addDialogVisible, addForm, addFormRef, showAddDialog, confirmAdd,
            multipleTableRef, selectedRows, onSelectionChange, deleteSelected,
            getRowKey, highlightText, logs, logDialogVisible,
            themes, currentTheme, themeIcon, themePanelOpen, themeBtnRef,
            setTheme, toggleThemePanel,
        };
    }
});

app.use(ElementPlus);
app.mount('#app');
