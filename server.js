// server.js
import http from 'http';
import url from 'url';
import pg from 'pg';
import cookie from 'cookie';

const { Pool } = pg;

// ========== ФУНКЦИЯ ВАЛИДАЦИИ ==========
function validateForm(data) {
    const errors = {};
    
    // ФИО: только буквы, пробелы, дефис
    if (!data.full_name || !/^[А-Яа-яA-Za-z\s\-]{2,100}$/.test(data.full_name)) {
        errors.full_name = 'ФИО: только буквы, пробелы и дефис (2-100 символов)';
    }
    
    // Телефон
    if (!data.phone || !/^[\+\d\s\-\(\)]{10,20}$/.test(data.phone)) {
        errors.phone = 'Телефон: формат +7 (999) 123-45-67';
    }
    
    // Email
    if (!data.email || !/^[^\s@]+@([^\s@]+\.)+[^\s@]+$/.test(data.email)) {
        errors.email = 'Email: введите корректный адрес';
    }
    
    // Дата рождения
    if (!data.birth_date || !/^\d{4}-\d{2}-\d{2}$/.test(data.birth_date)) {
        errors.birth_date = 'Дата рождения: формат ГГГГ-ММ-ДД';
    }
    
    // Пол
    if (!data.gender || !['male', 'female', 'other'].includes(data.gender)) {
        errors.gender = 'Выберите пол';
    }
    
    // Языки (множественный выбор)
    let languages = data.languages;
    if (typeof languages === 'string') {
        languages = languages.split(',');
    }
    if (!languages || languages.length === 0 || (languages.length === 1 && !languages[0])) {
        errors.languages = 'Выберите хотя бы один язык программирования';
    }
    
    // Биография
    if (!data.biography || data.biography.length < 10) {
        errors.biography = 'Расскажите о себе (минимум 10 символов)';
    }
    
    // Согласие
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
    // Домен фронтенда (без порта)
    frontendUrl: process.env.FRONTEND_URL || 'http://u82303.kubsu-dev.ru'
};

// Создаём пул соединений с PostgreSQL
const pool = new Pool({
    connectionString: config.db.connectionString,
    ssl: { rejectUnauthorized: false }
});

// ========== СОЗДАНИЕ СЕРВЕРА ==========
const server = http.createServer(async (req, res) => {
    // Парсим cookies
    const cookies = cookie.parse(req.headers.cookie || '');
    
    // CORS для React фронтенда (разные домены)
    res.setHeader('Access-Control-Allow-Origin', config.frontendUrl);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Credentials', 'true'); // Разрешаем cookies
    
    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }
    
    const parsedUrl = url.parse(req.url || '', true);
    
    // ========== HEALTH CHECK ==========
    if (parsedUrl.pathname === '/health' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
        return;
    }
    
    // ========== GET СОХРАНЁННЫХ ДАННЫХ ИЗ COOKIES ==========
    if (parsedUrl.pathname === '/get-saved-data' && req.method === 'GET') {
        const savedData = cookies.saved_data ? JSON.parse(cookies.saved_data) : {};
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(savedData));
        return;
    }
    
    // ========== ОСНОВНОЙ API ДЛЯ REACT (JSON) ==========
    if (parsedUrl.pathname === '/save' && req.method === 'POST') {
        let body = '';
        
        req.on('data', chunk => {
            body += chunk.toString();
        });
        
        req.on('end', async () => {
            let client;
            try {
                const params = new URLSearchParams(body);
                
                // Получаем языки как массив
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
                
                console.log('📨 Получены данные от React:', formData.full_name, formData.email);
                
                // ========== ВАЛИДАЦИЯ ==========
                const errors = validateForm(formData);
                
                if (Object.keys(errors).length > 0) {
                    // Возвращаем ошибки в React
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ 
                        success: false, 
                        errors: errors 
                    }));
                    return;
                }
                
                // ========== СОХРАНЕНИЕ В БД ==========
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
                
                // Преобразуем массив языков в строку
                const languagesStr = Array.isArray(formData.languages) ? formData.languages.join(',') : '';
                
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
                    formData.birth_date || null,
                    formData.gender,
                    languagesStr,
                    formData.biography,
                    formData.contract_accepted === '1' ? 1 : 0
                ]);
                
                // Сохраняем данные в cookies на год (для разных доменов)
                res.setHeader('Set-Cookie', [
                    `saved_data=${JSON.stringify(formData)}; Max-Age=${365*24*3600}; Path=/; SameSite=None; Secure`
                ]);
                
                console.log('✅ Данные сохранены в БД, ID:', result.rows[0].id);
                console.log('🍪 Cookie установлена для домена:', config.frontendUrl);
                
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
                    message: 'Ошибка сервера: ' + error.message 
                }));
            } finally {
                if (client) client.release();
            }
        });
        return;
    }
    
    // ========== GET /view - ДЛЯ REACT (ВОЗВРАЩАЕТ JSON) ==========
    if (parsedUrl.pathname === '/view' && req.method === 'GET') {
        let client;
        try {
            client = await pool.connect();
            
            const result = await client.query(`
                SELECT * FROM form_submissions 
                ORDER BY created_at DESC 
                LIMIT 100
            `);
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result.rows));
            
        } catch (error) {
            console.error('❌ Ошибка:', error.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: error.message }));
        } finally {
            if (client) client.release();
        }
        return;
    }
    
    // ========== 404 ==========
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
});

// ========== ЗАПУСК СЕРВЕРА ==========
server.listen(config.port, '0.0.0.0', () => {
    console.log(`🚀 Сервер запущен на порту ${config.port}`);
    console.log(`   📝 React API: http://localhost:${config.port}/save`);
    console.log(`   📋 Данные анкет: http://localhost:${config.port}/view`);
    console.log(`   🔗 Фронтенд домен: ${config.frontendUrl}`);
    console.log(`   🍪 Cookies: SameSite=None; Secure`);
});