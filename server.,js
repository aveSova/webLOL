// server.js
import http from 'http';
import url from 'url';
import mysql from 'mysql2/promise';

const config = {
    port: 3000,
    db: {
        host: 'localhost',
        user: 'root',
        password: '13577531admin',  // ваш пароль
        database: 'form_db',
        port: 3306
    }
};

const server = http.createServer(async (req, res) => {
    // CORS для React
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
                    birth_date: params.get('birth_date') || '',
                    gender: params.get('gender') || '',
                    languages: params.get('languages') || '',
                    biography: params.get('biography') || '',
                    contract_accepted: params.get('contract_accepted') || '0'
                };
                
                console.log('Получены данные:', formData);
                
                // Подключение к БД
                const connection = await mysql.createConnection(config.db);
                
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
                
                console.log('Данные сохранены');
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, message: 'Форма отправлена!' }));
                
            } catch (error) {
                console.error('Ошибка:', error);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: error.message }));
            }
        });
    }
    // Отдача статики (ваш React билд)
    else {
        // Здесь будет раздача index.html и файлов из билда
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h1>Сервер работает</h1>');
    }
});

server.listen(config.port, '0.0.0.0', () => {
    console.log(`Сервер запущен на порту ${config.port}`);
});