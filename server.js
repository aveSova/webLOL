// server.js (фрагмент с исправленными cookies)
import http from 'http';
import url from 'url';
import pg from 'pg';
import cookie from 'cookie';

const { Pool } = pg;

// ========== ФУНКЦИЯ ДЛЯ БЕЗОПАСНОГО СОХРАНЕНИЯ В COOKIE ==========
function safeCookieValue(data) {
    // Кодируем JSON в base64, чтобы избежать проблем с символами
    return Buffer.from(JSON.stringify(data)).toString('base64');
}

function unsafeCookieValue(cookieStr) {
    try {
        return JSON.parse(Buffer.from(cookieStr, 'base64').toString());
    } catch (e) {
        return {};
    }
}

// ... функция validateForm() остается без изменений ...

// ========== КОНФИГУРАЦИЯ ==========
const config = {
    port: process.env.PORT || 3000,
    db: {
        connectionString: process.env.DATABASE_URL,
    },
    frontendUrl: process.env.FRONTEND_URL || 'http://u82303.kubsu-dev.ru'
};

const pool = new Pool({
    connectionString: config.db.connectionString,
    ssl: { rejectUnauthorized: false }
});

const server = http.createServer(async (req, res) => {
    const cookies = cookie.parse(req.headers.cookie || '');
    
    // CORS
    res.setHeader('Access-Control-Allow-Origin', config.frontendUrl);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    
    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }
    
    const parsedUrl = url.parse(req.url || '', true);
    
    // GET сохранённых данных из cookies (декодируем)
    if (parsedUrl.pathname === '/get-saved-data' && req.method === 'GET') {
        const savedData = cookies.saved_data ? unsafeCookieValue(cookies.saved_data) : {};
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(savedData));
        return;
    }
    
    // POST /save
    if (parsedUrl.pathname === '/save' && req.method === 'POST') {
        let body = '';
        
        req.on('data', chunk => {
            body += chunk.toString();
        });
        
        req.on('end', async () => {
            let client;
            try {
                const params = new URLSearchParams(body);
                const languages = params.getAll('languages');
                
                const formData = {
                    full_name: params.get('full_name') || '',
                    phone: params.get('phone') || '',
                    email: params.get('email') || '',
                    birth_date: params.get('birth_date') || '',
                    gender: params.get('gender') || '',
                    languages: languages,
                    biography: params.get('biography') || '',
                    contract_accepted: params.get('contract_accepted') || '0'
                };
                
                console.log('📨 Получены данные:', formData.full_name, formData.email);
                
                // Валидация
                const errors = validateForm(formData);
                
                if (Object.keys(errors).length > 0) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, errors: errors }));
                    return;
                }
                
                // Сохранение в БД
                client = await pool.connect();
                
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
                
                const languagesStr = Array.isArray(formData.languages) ? formData.languages.join(',') : '';
                
                const result = await client.query(`
                    INSERT INTO form_submissions 
                    (full_name, phone, email, birth_date, gender, programming_languages, biography, contract_accepted)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                    RETURNING id
                `, [
                    formData.full_name,
                    formData.phone,
                    formData.email,
                    formData.birth_date || null,
                    formData.gender,
                    languagesStr,
                    formData.biography,
                    formData.contract_accepted === '1' ? 1 : 0
                ]);
                
                // Безопасное сохранение в cookies (base64)
                const safeData = safeCookieValue(formData);
                
                res.setHeader('Set-Cookie', [
                    `saved_data=${safeData}; Max-Age=${365*24*3600}; Path=/; SameSite=None; Secure; HttpOnly`
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
        return;
    }
    
    // GET /view
    if (parsedUrl.pathname === '/view' && req.method === 'GET') {
        let client;
        try {
            client = await pool.connect();
            const result = await client.query(`
                SELECT * FROM form_submissions ORDER BY created_at DESC LIMIT 100
            `);
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result.rows));
            
        } catch (error) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: error.message }));
        } finally {
            if (client) client.release();
        }
        return;
    }
    
    // Health check
    if (parsedUrl.pathname === '/health' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
        return;
    }
    
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(config.port, '0.0.0.0', () => {
    console.log(`🚀 Сервер запущен на порту ${config.port}`);
    console.log(`   🔗 Фронтенд: ${config.frontendUrl}`);
});