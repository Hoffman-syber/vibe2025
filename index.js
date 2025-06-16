const http = require('http');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const crypto = require('crypto');

const PORT = 3000;

// Настройки подключения к БД
const dbConfig = {
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'todolist',
};

// Простое хранение сессий в памяти
const SESSIONS = {};

// Создать новую сессию
function createSession() {
    const sessionId = crypto.randomBytes(16).toString('hex');
    SESSIONS[sessionId] = { authenticated: true };
    return sessionId;
}

// Получить сессию из cookie
function getSession(req) {
    const cookie = req.headers.cookie;
    if (!cookie) return null;
    const match = cookie.match(/session=([a-f0-9]+)/);
    if (match && SESSIONS[match[1]]) {
        return { id: match[1], data: SESSIONS[match[1]] };
    }
    return null;
}

// Установить cookie сессии
function setSessionCookie(res, sessionId) {
    res.setHeader('Set-Cookie', `session=${sessionId}; HttpOnly; Path=/`);
}

// Удалить сессию
function destroySession(sessionId) {
    delete SESSIONS[sessionId];
}

// Получить все элементы из БД
async function retrieveListItems() {
    const connection = await mysql.createConnection(dbConfig);
    const query = 'SELECT id, text FROM items ORDER BY id';
    const [rows] = await connection.execute(query);
    await connection.end();
    return rows;
}

// Добавить элемент в БД
async function addItemToDB(text) {
    const connection = await mysql.createConnection(dbConfig);
    const query = 'INSERT INTO items (text) VALUES (?)';
    const [result] = await connection.execute(query, [text]);
    await connection.end();
    return result.insertId;
}

// Обновить элемент в БД
async function updateItemInDB(id, text) {
    const connection = await mysql.createConnection(dbConfig);
    const query = 'UPDATE items SET text = ? WHERE id = ?';
    const [result] = await connection.execute(query, [text, id]);
    await connection.end();
    return result.affectedRows > 0;
}

// Удалить элемент из БД
async function deleteItemFromDB(id) {
    const connection = await mysql.createConnection(dbConfig);
    const query = 'DELETE FROM items WHERE id = ?';
    const [result] = await connection.execute(query, [id]);
    await connection.end();
    return result.affectedRows > 0;
}

// Обработчик запросов
async function handleRequest(req, res) {
    // Обработка CORS и OPTIONS если нужно (зависит от клиента)
    // Здесь не добавляю, т.к. клиент и сервер на одном домене

    if (req.url === '/login' && req.method === 'POST') {
        // Авторизация
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { login, password } = JSON.parse(body);
                if (login === 'danil' && password === 'guap3331') {
                    const sessionId = createSession();
                    setSessionCookie(res, sessionId);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true }));
                } else {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false }));
                }
            } catch {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false }));
            }
        });
        return;
    }

    if (req.url === '/check-auth' && req.method === 'GET') {
        const session = getSession(req);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ authenticated: !!(session && session.data.authenticated) }));
        return;
    }

    // Защищённый маршрут: получить список дел
    if (req.url === '/items' && req.method === 'GET') {
        const session = getSession(req);
        if (!session || !session.data.authenticated) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Unauthorized' }));
            return;
        }
        try {
            const items = await retrieveListItems();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(items));
        } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'DB error' }));
        }
        return;
    }

    // Добавление нового элемента
    if (req.url === '/items' && req.method === 'POST') {
        const session = getSession(req);
        if (!session || !session.data.authenticated) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'Unauthorized' }));
            return;
        }
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const { text } = JSON.parse(body);
                if (!text || typeof text !== 'string' || !text.trim()) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: 'Invalid text' }));
                    return;
                }
                const id = await addItemToDB(text.trim());
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, id }));
            } catch {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: 'Server error' }));
            }
        });
        return;
    }

    // Обновление элемента
    if (req.url.startsWith('/items/') && req.method === 'PUT') {
        const session = getSession(req);
        if (!session || !session.data.authenticated) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'Unauthorized' }));
            return;
        }
        const id = parseInt(req.url.split('/')[2], 10);
        if (!id) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'Invalid ID' }));
            return;
        }
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const { text } = JSON.parse(body);
                if (!text || typeof text !== 'string' || !text.trim()) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: 'Invalid text' }));
                    return;
                }
                const updated = await updateItemInDB(id, text.trim());
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: updated }));
            } catch {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: 'Server error' }));
            }
        });
        return;
    }

    // Удаление элемента
    if (req.url.startsWith('/items/') && req.method === 'DELETE') {
        const session = getSession(req);
        if (!session || !session.data.authenticated) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'Unauthorized' }));
            return;
        }
        const id = parseInt(req.url.split('/')[2], 10);
        if (!id) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'Invalid ID' }));
            return;
        }
        try {
            const deleted = await deleteItemFromDB(id);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: deleted }));
        } catch {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'Server error' }));
        }
        return;
    }

    // Главная страница — отдаём index.html с пустым {{rows}} (список подгружается через JS)
    if ((req.url === '/' || req.url === '/index.html') && req.method === 'GET') {
        try {
            const html = await fs.promises.readFile(path.join(__dirname, 'index.html'), 'utf8');
            const processedHtml = html.replace('{{rows}}', '');
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(processedHtml);
        } catch (err) {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Error loading index.html');
        }
        return;
    }

    // Статические файлы (если нужны)
    // Можно добавить обработку CSS/JS файлов здесь, если вы их добавите

    // Если ничего не подошло — 404
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Route not found');
}

const server = http.createServer(handleRequest);

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
