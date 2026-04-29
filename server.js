const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.argv[2], 10) || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'data.json');

// 确保 data 目录存在
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// 解析请求体
function parseBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try { resolve(JSON.parse(body)); }
            catch { reject(new Error('Invalid JSON')); }
        });
        req.on('error', reject);
    });
}

// MIME 映射
const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.ico': 'image/x-icon',
};

const server = http.createServer(async (req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        return res.end();
    }

    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    try {
        // API: 保存 JSON 数据
        if (pathname === '/api/save' && req.method === 'POST') {
            const body = await parseBody(req);
            fs.writeFileSync(DATA_FILE, JSON.stringify(body, null, 2), 'utf-8');
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ ok: true, path: DATA_FILE }));
        }

        // API: 读取 JSON 数据
        if (pathname === '/api/data' && req.method === 'GET') {
            if (fs.existsSync(DATA_FILE)) {
                const raw = fs.readFileSync(DATA_FILE, 'utf-8');
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(raw);
            }
            res.writeHead(404, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'No data' }));
        }

        // API: 清空数据
        if (pathname === '/api/data' && req.method === 'DELETE') {
            if (fs.existsSync(DATA_FILE)) fs.unlinkSync(DATA_FILE);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ ok: true }));
        }

        // 静态文件服务
        let filePath = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);
        if (!fs.existsSync(filePath)) {
            res.writeHead(404);
            return res.end('Not Found');
        }
        const ext = path.extname(filePath);
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        fs.createReadStream(filePath).pipe(res);

    } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
    }
});

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`端口 ${PORT} 已被占用，请先关闭旧进程:`);
        console.error(`  netstat -ano | findstr :${PORT}`);
        console.error(`  taskkill /PID <进程ID> /F`);
        process.exit(1);
    } else {
        console.error('启动失败:', err.message);
        process.exit(1);
    }
});

server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
    console.log(`Data file: ${DATA_FILE}`);
});
