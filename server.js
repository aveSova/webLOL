// server.js (ES modules version)
import http from 'http';
import url from 'url';
import fs from 'fs';
import path from 'path';
import mysql from 'mysql2/promise';
import config from './config.js';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class FormServer {
    constructor() {
        this.server = null;
        this.dbPool = null;
    }
    
    async initialize() {
        try {
            // Создаем пул соединений
            this.dbPool = await mysql.createPool(config.db);
            console.log('✅ База данных подключена');
            
            // Создаем HTTP сервер
            this.server = http.createServer(this.handleRequest.bind(this));
            
            // Запускаем сервер
            this.server.listen(config.port, '0.0.0.0', () => {
                console.log(`🚀 Сервер запущен на http://localhost:${config.port}`);
                console.log(`   Корневая папка: ${__dirname}`);
                console.log(`   Доступен извне на порту ${config.port}`);
            });
        } catch (error) {
            console.error('❌ Ошибка при инициализации:', error.message);
            process.exit(1);
        }
    }
    
    async handleRequest(req, res) {
        // CORS заголовки
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        
        // Обрабатываем preflight запросы
        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }
        
        const parsedUrl = url.parse(req.url, true);
        let pathname = parsedUrl.pathname;
        
        console.log(`📝 Запрос: ${req.method} ${pathname}`);
        
        // API маршруты
        if (pathname === '/save' && req.method === 'POST') {
            await this.handleFormSubmit(req, res);
        } 
        else if (pathname === '/view' && req.method === 'GET') {
            await this.handleViewSubmissions(req, res);
        }
        else {
            // Раздаем статические файлы из корневой папки
            // Если путь заканчивается на /, отдаем index.html
            if (pathname === '/' || pathname === '') {
                pathname = '/index.html';
            }
            
            const filePath = path.join(__dirname, pathname);
            
            console.log(`📁 Ищем файл: ${filePath}`);
            
            // Проверяем, существует ли файл
            fs.access(filePath, fs.constants.F_OK, (err) => {
                if (err) {
                    console.log(`❌ Файл не найден: ${filePath}`);
                    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
                    res.end('404 - Файл не найден');
                } else {
                    // Определяем MIME тип
                    const ext = path.extname(filePath).toLowerCase();
                    const contentType = {
                        '.html': 'text/html',
                        '.js': 'application/javascript',
                        '.css': 'text/css',
                        '.png': 'image/png',
                        '.jpg': 'image/jpeg',
                        '.jpeg': 'image/jpeg',
                        '.gif': 'image/gif',
                        '.svg': 'image/svg+xml',
                        '.ico': 'image/x-icon',
                        '.json': 'application/json',
                        '.txt': 'text/plain'
                    }[ext] || 'text/plain';
                    
                    fs.readFile(filePath, (err, data) => {
                        if (err) {
                            console.log(`❌ Ошибка чтения файла: ${filePath}`);
                            res.writeHead(500);
                            res.end('500 - Server Error');
                        } else {
                            res.writeHead(200, { 'Content-Type': contentType });
                            res.end(data);
                        }
                    });
                }
            });
        }
    }
    
    async handleFormSubmit(req, res) {
        let body = '';
        
        req.on('data', chunk => {
            body += chunk.toString();
        });
        
        req.on('end', async () => {
            try {
                console.log('📨 Получены данные формы');
                
                const params = new URLSearchParams(body);
                
                const formData = {
                    full_name: params.get('full_name') || '',
                    phone: params.get('phone') || '',
                    email: params.get('email') || '',
                    birth_date: params.get('birth_date') || '',
                    gender: params.get('gender') || '',
                    languages: params.get('languages') ? params.get('languages').split(',') : [],
                    biography: params.get('biography') || '',
                    contract_accepted: params.get('contract_accepted') || '0'
                };
                
                console.log('📊 Данные:', {
                    full_name: formData.full_name,
                    email: formData.email,
                    phone: formData.phone,
                    languages: formData.languages
                });
                
                // Валидация
                if (!formData.full_name) {
                    throw new Error('ФИО обязательно');
                }
                if (!formData.phone) {
                    throw new Error('Телефон обязателен');
                }
                if (!formData.email) {
                    throw new Error('Email обязателен');
                }
                if (!formData.birth_date) {
                    throw new Error('Дата рождения обязательна');
                }
                if (!formData.gender) {
                    throw new Error('Пол обязателен');
                }
                if (formData.languages.length === 0) {
                    throw new Error('Выберите хотя бы один язык программирования');
                }
                if (formData.contract_accepted !== '1') {
                    throw new Error('Необходимо согласие с контрактом');
                }
                
                // Сохраняем в базу данных
                const connection = await this.dbPool.getConnection();
                
                const sql = `
                    INSERT INTO form_submissions 
                    (full_name, phone, email, birth_date, gender, programming_languages, biography, contract_accepted, ip_address, user_agent)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `;
                
                const [result] = await connection.execute(sql, [
                    formData.full_name,
                    formData.phone,
                    formData.email,
                    formData.birth_date,
                    formData.gender,
                    JSON.stringify(formData.languages),
                    formData.biography,
                    formData.contract_accepted === '1' ? 1 : 0,
                    req.socket.remoteAddress || '',
                    req.headers['user-agent'] || ''
                ]);
                
                connection.release();
                
                console.log('✅ Данные сохранены, ID:', result.insertId);
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    success: true,
                    message: 'Форма успешно сохранена',
                    id: result.insertId
                }));
                
            } catch (error) {
                console.error('❌ Ошибка:', error.message);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    success: false,
                    message: error.message,
                    errors: { general: error.message }
                }));
            }
        });
    }
    
    async handleViewSubmissions(req, res) {
        try {
            const connection = await this.dbPool.getConnection();
            
            const [rows] = await connection.execute(`
                SELECT * FROM form_submissions 
                ORDER BY created_at DESC 
                LIMIT 100
            `);
            
            connection.release();
            
            // Возвращаем HTML для удобного просмотра
            let html = `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="UTF-8">
                    <title>Сохраненные анкеты</title>
                    <style>
                        body { font-family: Arial, sans-serif; margin: 20px; background: #1c1c1c; color: #dbdbdb; }
                        table { border-collapse: collapse; width: 100%; background: rgba(255,255,255,0.1); }
                        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
                        th { background: rgba(0,0,0,0.5); }
                        tr:hover { background: rgba(255,255,255,0.1); }
                        .container { max-width: 1200px; margin: 0 auto; }
                        h1 { text-align: center; }
                        .back { display: block; text-align: center; margin-top: 20px; color: #dbdbdb; }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <h1>Сохраненные анкеты</h1>
                        <table>
                            <thead>
                                <tr>
                                    <th>ID</th>
                                    <th>ФИО</th>
                                    <th>Телефон</th>
                                    <th>Email</th>
                                    <th>Дата рождения</th>
                                    <th>Пол</th>
                                    <th>Языки</th>
                                    <th>Биография</th>
                                    <th>Дата создания</th>
                                </tr>
                            </thead>
                            <tbody>
            `;
            
            for (const row of rows) {
                const languages = JSON.parse(row.programming_languages || '[]');
                const gender = {
                    male: 'Мужской',
                    female: 'Женский',
                    other: 'Другой'
                }[row.gender] || row.gender;
                
                html += `
                    <tr>
                        <td>${row.id}</td>
                        <td>${escapeHtml(row.full_name)}</td>
                        <td>${escapeHtml(row.phone)}</td>
                        <td>${escapeHtml(row.email)}</td>
                        <td>${row.birth_date}</td>
                        <td>${gender}</td>
                        <td>${languages.join(', ')}</td>
                        <td>${escapeHtml(row.biography || '').substring(0, 100)}${(row.biography || '').length > 100 ? '...' : ''}</td>
                        <td>${row.created_at}</td>
                    </tr>
                `;
            }
            
            html += `
                            </tbody>
                        </table>
                        <a href="/" class="back">← Вернуться к форме</a>
                    </div>
                </body>
                </html>
            `;
            
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(html);
            
        } catch (error) {
            console.error('❌ Ошибка:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: error.message }));
        }
    }
}

function escapeHtml(text) {
    if (!text) return '';
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Запускаем сервер
const server = new FormServer();
server.initialize().catch(console.error);