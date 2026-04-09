// server.js
import http from 'http';
import url from 'url';
import pg from 'pg';

const { Pool } = pg;

// Конфигурация через переменные окружения
const config = {
    port: process.env.PORT || 3000,
    db: {
        connectionString: process.env.DATABASE_URL,
    }
};

// Создаём пул соединений
const pool = new Pool({
    connectionString: config.db.connectionString,
    ssl: {
        rejectUnauthorized: false
    }
});

const server = http.createServer(async (req, res) => {
    // CORS для вашего фронтенда
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }
    
    const parsedUrl = url.parse(req.url || '', true);
    
    // Health check
    if (parsedUrl.pathname === '/health' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
        return;
    }
    
    // Обработка сохранения формы
    if (parsedUrl.pathname === '/save' && req.method === 'POST') {
        let body = '';
        
        req.on('data', chunk => {
            body += chunk.toString();
        });
        
        req.on('end', async () => {
            let client;
            try {
                const params = new URLSearchParams(body);
                
                const formData = {
                    full_name: params.get('full_name') || '',
                    phone: params.get('phone') || '',
                    email: params.get('email') || '',
                    birth_date: params.get('birth_date') || null,
                    gender: params.get('gender') || '',
                    languages: params.get('languages') || '',
                    biography: params.get('biography') || '',
                    contract_accepted: params.get('contract_accepted') === '1' ? 1 : 0
                };
                
                console.log('📨 Получены данные:', formData.full_name, formData.email);
                
                client = await pool.connect();
                
                // Создаём таблицу, если её нет
                await client.query(`
                    CREATE TABLE IF NOT EXISTS form_submissions (
                        id SERIAL PRIMARY KEY,
                        full_name VARCHAR(255) NOT NULL,
                        phone VARCHAR(20),
                        email VARCHAR(255),
                        birth_date DATE,
                        gender VARCHAR(20),
                        programming_languages TEXT,
                        biography TEXT,
                        contract_accepted INTEGER DEFAULT 0,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                `);
                
                // Вставляем данные
                const sql = `
                    INSERT INTO form_submissions 
                    (full_name, phone, email, birth_date, gender, programming_languages, biography, contract_accepted)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                    RETURNING id
                `;
                
                const result = await client.query(sql, [
                    formData.full_name,
                    formData.phone,
                    formData.email,
                    formData.birth_date,
                    formData.gender,
                    formData.languages,
                    formData.biography,
                    formData.contract_accepted
                ]);
                
                console.log('✅ Данные сохранены, ID:', result.rows[0].id);
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                    success: true, 
                    message: 'Форма успешно отправлена!',
                    id: result.rows[0].id 
                }));
                
            } catch (error) {
                console.error('❌ Ошибка:', error.message);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                    success: false, 
                    message: error.message 
                }));
            } finally {
                if (client) client.release();
            }
        });
    }
    // Просмотр сохранённых анкет
    else if (parsedUrl.pathname === '/view' && req.method === 'GET') {
        let client;
        try {
            client = await pool.connect();
            
            const result = await client.query(`
                SELECT * FROM form_submissions 
                ORDER BY created_at DESC 
                LIMIT 100
            `);
            
            let html = `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="UTF-8">
                    <title>Сохранённые анкеты</title>
                    <style>
                        body { font-family: Arial, sans-serif; margin: 20px; background: #1c1c1c; color: #ddd; }
                        table { border-collapse: collapse; width: 100%; margin-top: 20px; }
                        th, td { border: 1px solid #555; padding: 8px; text-align: left; }
                        th { background: #333; }
                        a { color: #ddd; text-decoration: none; }
                        a:hover { text-decoration: underline; }
                        h1 { text-align: center; }
                    </style>
                </head>
                <body>
                    <h1>Сохранённые анкеты</h1>
                    <div style="text-align: center; margin-bottom: 20px;">
                        <a href="http://u82303.kubsu-dev.ru">← Вернуться к форме</a>
                    </div>
                    <table>
                        <thead>
                            <tr>
                                <th>ID</th>
                                <th>ФИО</th>
                                <th>Email</th>
                                <th>Телефон</th>
                                <th>Дата рождения</th>
                                <th>Пол</th>
                                <th>Языки</th>
                                <th>Создано</th>
                            </tr>
                        </thead>
                        <tbody>
            `;
            
            for (const row of result.rows) {
                html += `
                    <tr>
                        <td>${row.id}</td>
                        <td>${escapeHtml(row.full_name)}</td>
                        <td>${escapeHtml(row.email)}</td>
                        <td>${escapeHtml(row.phone)}</td>
                        <td>${row.birth_date || ''}</td>
                        <td>${escapeHtml(row.gender)}</td>
                        <td>${escapeHtml(row.programming_languages)}</td>
                        <td>${new Date(row.created_at).toLocaleString()}</td>
                    </tr>
                `;
            }
            
            html += `
                        </tbody>
                    </table>
                </body>
                </html>
            `;
            
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(html);
            
        } catch (error) {
            console.error('❌ Ошибка:', error.message);
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Error: ' + error.message);
        } finally {
            if (client) client.release();
        }
    }
    else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
    }
});

function escapeHtml(text) {
    if (!text) return '';
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

server.listen(config.port, '0.0.0.0', () => {
    console.log(`🚀 Сервер запущен на порту ${config.port}`);
    console.log(`   База данных PostgreSQL`);
});