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
            this.server.listen(config.port, () => {
                console.log(`🚀 Сервер запущен на http://localhost:${config.port}`);
            });
        } catch (error) {
            console.error('❌ Ошибка при инициализации:', error.message);
            process.exit(1);
        }
    }
    
    async handleRequest(req, res) {
        // CORS заголовки для React
        res.setHeader('Access-Control-Allow-Origin', 'http://localhost:5173');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        
        // Обрабатываем preflight запросы
        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }
        
        const parsedUrl = url.parse(req.url, true);
        const pathname = parsedUrl.pathname;
        
        console.log(`📝 Запрос: ${req.method} ${pathname}`);
        
        if (pathname === '/save' && req.method === 'POST') {
            await this.handleFormSubmit(req, res);
        } 
        else if (pathname === '/view') {
            await this.handleViewSubmissions(req, res);
        }
        else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Not found' }));
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
                    (full_name, phone, email, birth_date, gender, programming_languages, biography, contract_accepted)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `;
                
                const [result] = await connection.execute(sql, [
                    formData.full_name,
                    formData.phone,
                    formData.email,
                    formData.birth_date,
                    formData.gender,
                    JSON.stringify(formData.languages),
                    formData.biography,
                    formData.contract_accepted === '1' ? 1 : 0
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
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(rows));
            
        } catch (error) {
            console.error('❌ Ошибка:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: error.message }));
        }
    }

    async handleRequest(req, res) {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;
    
    // API маршруты
    if (pathname === '/save' && req.method === 'POST') {
        await this.handleFormSubmit(req, res);
    } 
    else if (pathname === '/view') {
        await this.handleViewSubmissions(req, res);
    }
    else {
        // Раздаем статические файлы из папки dist
        const filePath = path.join(__dirname, 'dist', pathname === '/' ? 'index.html' : pathname);
        
        fs.readFile(filePath, (err, data) => {
            if (err) {
                // Если файл не найден, отдаем index.html (для SPA)
                fs.readFile(path.join(__dirname, 'dist', 'index.html'), (err, indexData) => {
                    if (err) {
                        res.writeHead(404);
                        res.end('404 - Not Found');
                    } else {
                        res.writeHead(200, { 'Content-Type': 'text/html' });
                        res.end(indexData);
                    }
                });
            } else {
                const ext = path.extname(filePath);
                const contentType = {
                    '.html': 'text/html',
                    '.js': 'application/javascript',
                    '.css': 'text/css',
                    '.png': 'image/png',
                    '.jpg': 'image/jpeg',
                    '.jpeg': 'image/jpeg',
                    '.svg': 'image/svg+xml',
                    '.ico': 'image/x-icon'
                }[ext] || 'text/plain';
                
                res.writeHead(200, { 'Content-Type': contentType });
                res.end(data);
            }
        });
    }
}
}

// Запускаем сервер
const server = new FormServer();
server.initialize().catch(console.error);