const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(__dirname + '/public'));

// Вставь сюда токен от BotFather (или передай через переменные окружения на Render)
const BOT_TOKEN = process.env.BOT_TOKEN || '8997366237:AAH_ZtkzP9tAHuEZ2uRbavfialF1eNdibmw';

// Валидация подписи Telegram Login Widget
function verifyTelegramAuth(data) {
    const { hash, ...userData } = data;
    if (!hash) return false;

    // 1. Сортируем параметры в алфавитном порядке
    const dataCheckString = Object.keys(userData)
        .sort()
        .map((k) => `${k}=${userData[k]}`)
        .join('\n');

    // 2. Секретный ключ = SHA256 от токена бота
    const secretKey = crypto.createHash('sha256').update(BOT_TOKEN).digest();

    // 3. Вычисляем HMAC-SHA256
    const hmac = crypto
        .createHmac('sha256', secretKey)
        .update(dataCheckString)
        .digest('hex');

    // 4. Сверяем полученный хэш с вычисленным
    return hmac === hash;
}

// Эндпоинт авторизации Telegram
app.post('/api/auth/telegram', (req, res) => {
    const authData = req.body;

    if (!BOT_TOKEN || BOT_TOKEN === 'ТВОЙ_ТОКЕН_БОТА_ОТ_BOTFATHER') {
        // Заглушка, если токен еще не задан (для тестов)
        return res.json({
            success: true,
            user: {
                id: authData.id || 1,
                name: authData.first_name || authData.username || 'Игрок',
                photo: authData.photo_url || null
            }
        });
    }

    if (verifyTelegramAuth(authData)) {
        return res.json({
            success: true,
            user: {
                id: authData.id,
                name: authData.username || `${authData.first_name || ''} ${authData.last_name || ''}`.trim(),
                photo: authData.photo_url || null
            }
        });
    } else {
        return res.status(403).json({ success: false, error: 'Неверная цифровая подпись Telegram' });
    }
});

// Игровая логика
let players = {};
let match = { survivor: null, killer: null };

io.on('connection', (socket) => {
    players[socket.id] = { id: socket.id, role: null, user: null };

    // Сохраняем профиль игрока при поиске
    socket.on('setUserData', (userData) => {
        if (players[socket.id]) players[socket.id].user = userData;
    });

    // Поиск лобби
    socket.on('findMatch', (role) => {
        if (!players[socket.id]) return;
        players[socket.id].role = role;

        if (role === 'SURVIVOR') match.survivor = socket.id;
        if (role === 'KILLER') match.killer = socket.id;

        // Если оба найдены, стартуем матч и отсылаем им профили друг друга
        if (match.survivor && match.killer && match.survivor !== match.killer) {
            const sPlayer = players[match.survivor];
            const kPlayer = players[match.killer];

            io.to(match.survivor).emit('matchStarted', { enemyUser: kPlayer ? kPlayer.user : null });
            io.to(match.killer).emit('matchStarted', { enemyUser: sPlayer ? sPlayer.user : null });
        }
    });

    // Пересылка координат и событий (удары, починка, доски)
    socket.on('updatePosition', (data) => {
        socket.broadcast.emit('enemyPosition', data);
    });

    // Отключение игрока
    socket.on('disconnect', () => {
        if (match.survivor === socket.id) match.survivor = null;
        if (match.killer === socket.id) match.killer = null;
        delete players[socket.id];
        socket.broadcast.emit('enemyDisconnected');
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Сервер запущен на порту ${PORT}`));
