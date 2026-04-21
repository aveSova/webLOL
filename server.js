// server.js
import http from 'http';
import url from 'url';
import pg from 'pg';
import cookie from 'cookie';
import crypto from 'crypto';

const { Pool } = pg;

// ========== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ==========

function safeCookieValue(data) {
    return Buffer.from(JSON.stringify(data)).toString('base64');
}

function unsafeCookieValue(cookieStr) {
    try {
        return JSON.parse(Buffer.from(cookieStr, 'base64').toString());
    } catch (e) {
        return {};
    }
}

// Генерация случайного логина и пароля
function generateCredentials() {
    const login = `user_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const password = Math.random().toString(36).slice(-8);
    const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
    return { login, password, passwordHash };
}

// Валидация формы
function validateForm(data) {
    const errors = {};
    
    if (!data.full_name || !/^[А-Яа-яA-Za-z\s\-]{2,100}$/.test(data.full_name)) {
        errors.full_name = 'ФИО: только буквы, пробелы и дефис (2-100 символов)';
    }
    
    if (!data.phone || !/^[\+\d\s\-\(\)]{10,20}$/.test(data.phone)) {
        errors.phone = 'Телефон: формат +7 (999) 123-45-67';
    }
    
    if (!data.email || !/^[^\s@]+@([^\s@]+\.)+[^\s@]+$/.test(data.email)) {
        errors.email = 'Email: введите корректный адрес';
    }
    
    if (!data.birth_date || !/^\d{4}-\d{2}-\d{2}$/.test(data.birth_date)) {
        errors.birth_date = 'Дата рождения: формат ГГГГ-ММ-ДД';
    }
    
    if (!data.gender || !['male', 'female', 'other'].includes(data.gender)) {
        errors.gender = 'Выберите пол';
    }
    
    let languages = data.languages;
    if (typeof languages === 'string') {
        languages = languages.split(',');
    }
    if (!languages || languages.length === 0) {
        errors.languages = 'Выберите хотя бы один язык программирования';
    }
    
    if (!data.biography || data.biography.length < 10) {
        errors.biography = 'Расскажите о себе (минимум 10 символов)';
    }
    
    if (!data.contract_accepted || data.contract_accepted !== '1') {
        errors.contract_accepted = 'Необходимо согласие с контрактом';
    }
    
    return errors;
}

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

// ========== МИГРАЦИЯ БД ==========
async function setupDatabase() {
    let client;
    try {
        client = await pool.connect();
        
        // Основная таблица
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
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                login VARCHAR(100) UNIQUE,
                password_hash VARCHAR(255),
                can_edit BOOLEAN DEFAULT FALSE
            )
        `);
        
        // Добавляем колонки, если их нет
        await client.query(`
            DO $$ 
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                              WHERE table_name='form_submissions' AND column_name='login') THEN
                    ALTER TABLE form_submissions ADD COLUMN login VARCHAR(100) UNIQUE;
                END IF;
                
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                              WHERE table_name='form_submissions' AND column_name='password_hash') THEN
                    ALTER TABLE form_submissions ADD COLUMN password_hash VARCHAR(255);
                END IF;
                
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                              WHERE table_name='form_submissions' AND column_name='can_edit') THEN
                    ALTER TABLE form_submissions ADD COLUMN can_edit BOOLEAN DEFAULT FALSE;
                END IF;
            END $$;
        `);
        
        console.log('✅ База данных готова');
    } catch (error) {
        console.error('❌ Ошибка БД:', error.message);
    } finally {
        if (client) client.release();
    }
}

setupDatabase();

// ========== СОЗДАНИЕ СЕРВЕРА ==========
const server = http.createServer(async (req, res) => {
    const cookies = cookie.parse(req.headers.cookie || '');
    
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
    
    // ========== GET /get-saved-data ==========
    if (parsedUrl.pathname === '/get-saved-data' && req.method === 'GET') {
        const savedData = cookies.saved_data ? unsafeCookieValue(cookies.saved_data) : {};
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(savedData));
        return;
    }
    
    // ========== POST /save ==========
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
                
                client = await pool.connect();
                
                const languagesStr = Array.isArray(formData.languages) ? formData.languages.join(',') : '';
                
                // Генерируем логин и пароль
                const { login, password, passwordHash } = generateCredentials();
                
                const result = await client.query(`
                    INSERT INTO form_submissions 
                    (full_name, phone, email, birth_date, gender, programming_languages, biography, contract_accepted, login, password_hash, can_edit)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                    RETURNING id
                `, [
                    formData.full_name,
                    formData.phone,
                    formData.email,
                    formData.birth_date || null,
                    formData.gender,
                    languagesStr,
                    formData.biography,
                    formData.contract_accepted === '1' ? 1 : 0,
                    login,
                    passwordHash,
                    false
                ]);
                
                const safeData = safeCookieValue(formData);
                res.setHeader('Set-Cookie', [
                    `saved_data=${safeData}; Max-Age=${365*24*3600}; Path=/; SameSite=None; Secure; HttpOnly`
                ]);
                
                console.log('✅ Данные сохранены, ID:', result.rows[0].id);
                console.log(`🔐 Логин: ${login}, Пароль: ${password}`);
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                    success: true, 
                    message: `Форма отправлена! Ваш логин: ${login}, пароль: ${password}. Сохраните их для редактирования!`,
                    id: result.rows[0].id,
                    login: login,
                    password: password
                }));
                
            } catch (error) {
                console.error('❌ Ошибка:', error.message);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: error.message }));
            } finally {
                if (client) client.release();
            }
        });
        return;
    }
    
    // ========== POST /login ==========
    if (parsedUrl.pathname === '/login' && req.method === 'POST') {
        let body = '';
        
        req.on('data', chunk => {
            body += chunk.toString();
        });
        
        req.on('end', async () => {
            let client;
            try {
                const params = new URLSearchParams(body);
                const login = params.get('login') || '';
                const password = params.get('password') || '';
                const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
                
                client = await pool.connect();
                
                const result = await client.query(`
                    SELECT id, full_name, login, password_hash FROM form_submissions 
                    WHERE login = $1 AND password_hash = $2
                `, [login, passwordHash]);
                
                if (result.rows.length === 0) {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: 'Неверный логин или пароль' }));
                    return;
                }
                
                const user = result.rows[0];
                const sessionToken = crypto.randomBytes(32).toString('hex');
                
                res.setHeader('Set-Cookie', [
                    `session=${sessionToken}; Max-Age=${24*3600}; Path=/; SameSite=None; Secure; HttpOnly`,
                    `user_id=${user.id}; Max-Age=${24*3600}; Path=/; SameSite=None; Secure`
                ]);
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                    success: true, 
                    message: 'Вход выполнен успешно!',
                    userId: user.id,
                    fullName: user.full_name
                }));
                
            } catch (error) {
                console.error('❌ Ошибка:', error.message);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: error.message }));
            } finally {
                if (client) client.release();
            }
        });
        return;
    }
    
    // ========== GET /check-session ==========
    if (parsedUrl.pathname === '/check-session' && req.method === 'GET') {
        const session = cookies.session;
        const userId = cookies.user_id;
        
        if (!session || !userId) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ authenticated: false }));
            return;
        }
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ authenticated: true, userId: userId }));
        return;
    }
    
    // ========== GET /edit/:id ==========
    if (parsedUrl.pathname.startsWith('/edit/') && req.method === 'GET') {
        const session = cookies.session;
        const userId = cookies.user_id;
        const editId = parseInt(parsedUrl.pathname.split('/')[2]);
        
        if (!session || !userId || parseInt(userId) !== editId) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: 'Не авторизован' }));
            return;
        }
        
        let client;
        try {
            client = await pool.connect();
            
            const result = await client.query(`
                SELECT id, full_name, phone, email, birth_date, gender, programming_languages, biography, contract_accepted
                FROM form_submissions WHERE id = $1
            `, [editId]);
            
            if (result.rows.length === 0) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: 'Анкета не найдена' }));
                return;
            }
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, data: result.rows[0] }));
            
        } catch (error) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: error.message }));
        } finally {
            if (client) client.release();
        }
        return;
    }
    
    // ========== POST /edit/:id ==========
    if (parsedUrl.pathname.startsWith('/edit/') && req.method === 'POST') {
        const session = cookies.session;
        const userId = cookies.user_id;
        const editId = parseInt(parsedUrl.pathname.split('/')[2]);
        
        if (!session || !userId || parseInt(userId) !== editId) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: 'Не авторизован' }));
            return;
        }
        
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            let client;
            try {
                const params = new URLSearchParams(body);
                const languages = params.getAll('languages');
                const languagesStr = languages.join(',');
                
                client = await pool.connect();
                
                await client.query(`
                    UPDATE form_submissions 
                    SET full_name = $1, phone = $2, email = $3, birth_date = $4, 
                        gender = $5, programming_languages = $6, biography = $7, contract_accepted = $8
                    WHERE id = $9
                `, [
                    params.get('full_name') || '',
                    params.get('phone') || '',
                    params.get('email') || '',
                    params.get('birth_date') || null,
                    params.get('gender') || '',
                    languagesStr,
                    params.get('biography') || '',
                    params.get('contract_accepted') === '1' ? 1 : 0,
                    editId
                ]);
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, message: 'Данные обновлены!' }));
                
            } catch (error) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: error.message }));
            } finally {
                if (client) client.release();
            }
        });
        return;
    }
    
    // ========== GET /logout ==========
    if (parsedUrl.pathname === '/logout' && req.method === 'GET') {
        res.setHeader('Set-Cookie', [
            'session=; Max-Age=0; Path=/',
            'user_id=; Max-Age=0; Path=/'
        ]);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: 'Выход выполнен' }));
        return;
    }
    
    // ========== GET /view ==========
    if (parsedUrl.pathname === '/view' && req.method === 'GET') {
        let client;
        try {
            client = await pool.connect();
            const result = await client.query(`
                SELECT id, full_name, email, phone, birth_date, gender, programming_languages, created_at 
                FROM form_submissions ORDER BY created_at DESC LIMIT 100
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
    
    // ========== GET /health ==========
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
    console.log(`   🔐 Эндпоинты для задания 5 готовы`);
});