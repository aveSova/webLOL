// server.js
import http from 'http';
import url from 'url';
import mysql from 'mysql2/promise';

// Конфигурация через переменные окружения (для Render)
const config = {
    port: process.env.PORT || 3000,
    db: {
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'u82303',
        password: process.env.DB_PASSWORD || 'ваш_пароль',
        database: process.env.DB_NAME || 'u82303',
        port: 3306
    }
};

const server = http.createServer(async (req, res) => {
    // CORS для вашего фронтенда на kubsu-dev.ru
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }
    
    const parsedUrl = url.parse(req.url || '', true);
    
    // Обработка сохранения формы
    if (parsedUrl.pathname === '/save' && req.method === 'POST') {
        let body = '';
        
        req.on('data', chunk => {
            body += chunk.toString();
        });
        
        req.on('end', async () => {
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
                
                // Подключение к БД
                const connection = await mysql.createConnection(config.db);
                
                // Создаём таблицу, если её нет
                await connection.execute(`
                    CREATE TABLE IF NOT EXISTS form_submissions (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        full_name VARCHAR(255) NOT NULL,
                        phone VARCHAR(20),
                        email VARCHAR(255),
                        birth_date DATE,
                        gender VARCHAR(20),
                        programming_languages TEXT,
                        biography TEXT,
                        contract_accepted TINYINT DEFAULT 0,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                `);
                
                // Вставляем данные
                const sql = `
                    INSERT INTO form_submissions 
                    (full_name, phone, email, birth_date, gender, programming_languages, biography, contract_accepted)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `;
                
                const [result] = await connection.execute(sql, [
                    formData.full_name,
                    formData.phone,
                    formData.email,
                    formData.birth_date,
                    formData.gender,
                    formData.languages,
                    formData.biography,
                    formData.contract_accepted
                ]);
                
                await connection.end();
                
                console.log('✅ Данные сохранены, ID:', result.insertId);
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                    success: true, 
                    message: 'Форма успешно отправлена!',
                    id: result.insertId 
                }));
                
            } catch (error) {
                console.error('❌ Ошибка:', error.message);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                    success: false, 
                    message: error.message 
                }));
            }
        });
    } 
    else if (parsedUrl.pathname === '/health' && req.method === 'GET') {
        // Эндпоинт для проверки работоспособности
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
    }
    else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
    }
});

server.listen(config.port, '0.0.0.0', () => {
    console.log(`🚀 Сервер запущен на порту ${config.port}`);
    console.log(`   Health check: http://localhost:${config.port}/health`);
});

// Обработка graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully...');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});