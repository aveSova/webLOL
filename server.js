// server.js
import http from 'http';
import url from 'url';
import mysql from 'mysql2/promise';

const config = {
    port: 3000,
    db: {
        host: 'localhost',
        user: 'u82303',
        password: '6795529',
        database: 'u82303',
        port: 3306
    }
};

const server = http.createServer(async (req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }
    
    const parsedUrl = url.parse(req.url || '', true);
    
    // Обработка формы
    if (parsedUrl.pathname === '/save' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const params = new URLSearchParams(body);
                const formData = {
                    full_name: params.get('full_name'),
                    phone: params.get('phone'),
                    email: params.get('email'),
                    birth_date: params.get('birth_date'),
                    gender: params.get('gender'),
                    languages: params.get('languages'),
                    biography: params.get('biography'),
                    contract_accepted: params.get('contract_accepted')
                };
                
                console.log('Получены данные:', formData.full_name);
                
                // Создаём таблицу, если её нет
                const connection = await mysql.createConnection(config.db);
                
                // Создаём таблицу (если не существует)
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
                        contract_accepted TINYINT(1) DEFAULT 0,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                `);
                
                // Вставляем данные
                const sql = `
                    INSERT INTO form_submissions 
                    (full_name, phone, email, birth_date, gender, programming_languages, biography, contract_accepted)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `;
                
                await connection.execute(sql, [
                    formData.full_name,
                    formData.phone,
                    formData.email,
                    formData.birth_date,
                    formData.gender,
                    formData.languages,
                    formData.biography,
                    formData.contract_accepted === '1' ? 1 : 0
                ]);
                
                await connection.end();
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, message: 'Форма отправлена!' }));
                
            } catch (error) {
                console.error('Ошибка:', error.message);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: error.message }));
            }
        });
    } else {
        // Раздача статики
        const fs = await import('fs');
        const path = await import('path');
        let filePath = path.join(process.cwd(), parsedUrl.pathname === '/' ? 'index.html' : parsedUrl.pathname);
        
        fs.readFile(filePath, (err, data) => {
            if (err) {
                res.writeHead(404);
                res.end('404 - Not Found');
            } else {
                const ext = path.extname(filePath);
                const contentType = {
                    '.html': 'text/html',
                    '.js': 'application/javascript',
                    '.css': 'text/css',
                    '.png': 'image/png'
                }[ext] || 'text/plain';
                res.writeHead(200, { 'Content-Type': contentType });
                res.end(data);
            }
        });
    }
});

server.listen(config.port, '0.0.0.0', () => {
    console.log(`🚀 Сервер запущен на порту ${config.port}`);
    console.log(`   http://localhost:${config.port}`);
});