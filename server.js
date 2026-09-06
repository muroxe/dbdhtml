const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(__dirname + '/public'));

const BOT_TOKEN = process.env.BOT_TOKEN || '8997366237:AAH_ZtkzP9tAHuEZ2uRbavfialF1eNdibmw';
const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://dbdhtml:lolimpivo4ka@cluster0.0jgd1gx.mongodb.net/dbd_game?retryWrites=true&w=majority&appName=Cluster0';

mongoose.connect(MONGO_URI)
    .then(() => console.log('Успешное подключение к MongoDB!'))
    .catch(err => console.error('Ошибка подключения к MongoDB:', err));

const userSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true },
    chars: { type: [String], default: ['s_base', 'k_ill'] },
    perks: { type: [String], default: ['s1', 'k1'] }
});
const UserProgress = mongoose.model('UserProgress', userSchema);

function verifyTelegramAuth(data) {
    const { hash, ...userData } = data;
    if (!hash) return false;

    const dataCheckString = Object.keys(userData)
        .sort()
        .map((k) => `${k}=${userData[k]}`)
        .join('\n');

    const secretKey = crypto.createHash('sha256').update(BOT_TOKEN).digest();
    const hmac = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
    
    return hmac === hash;
}

app.post('/api/auth/telegram', async (req, res) => {
    const authData = req.body;
    let user = { 
        id: authData.id || Date.now(), 
        name: authData.username || authData.first_name || 'Игрок', 
        photo: authData.photo_url || null 
    };

    let progressDoc = await UserProgress.findOne({ userId: user.id.toString() });
    if (!progressDoc) {
        progressDoc = new UserProgress({ userId: user.id.toString() });
        await progressDoc.save();
    }
    
    let progress = { chars: progressDoc.chars, perks: progressDoc.perks };

    if (!BOT_TOKEN || BOT_TOKEN === 'ТВОЙ_ТОКЕН_БОТА_ОТ_BOTFATHER') {
        return res.json({ success: true, user, progress });
    }

    if (verifyTelegramAuth(authData)) {
        return res.json({ success: true, user, progress });
    } else {
        return res.status(403).json({ success: false, error: 'Неверная подпись Telegram' });
    }
});

let queue = { killers: [], survivors: [] };

setInterval(() => {
    if (queue.killers.length > 0 && queue.survivors.length > 0) {
        let k = queue.killers.shift();
        let s_arr = queue.survivors.splice(0, 4); 
        
        let matchId = 'match_' + Date.now();
        k.matchId = matchId;
        k.join(matchId);

        let matchInfo = { id: matchId, killer: { id: k.id, user: k.userData }, survivors: [] };
        
        s_arr.forEach(s => {
            s.matchId = matchId;
            s.join(matchId);
            matchInfo.survivors.push({ id: s.id, user: s.userData });
        });

        io.to(matchId).emit('matchStarted', matchInfo);
    }
}, 3000);

io.on('connection', (socket) => {
    socket.userData = null;
    socket.matchId = null;

    socket.on('setUserData', (data) => { socket.userData = data; });

    socket.on('saveProgress', async (newProgress) => {
        if (socket.userData && socket.userData.id) {
            await UserProgress.findOneAndUpdate(
                { userId: socket.userData.id.toString() },
                { chars: newProgress.chars, perks: newProgress.perks },
                { upsert: true }
            );
        }
    });

    socket.on('findMatch', (role) => {
        // ЖЕСТКАЯ ОЧИСТКА: Удаляем сокет из всех очередей, чтобы не было дублирования матчей
        queue.killers = queue.killers.filter(s => s.id !== socket.id);
        queue.survivors = queue.survivors.filter(s => s.id !== socket.id);
        
        if (role === 'KILLER') queue.killers.push(socket);
        if (role === 'SURVIVOR') queue.survivors.push(socket);
    });

    socket.on('updatePosition', (data) => {
        if (!socket.matchId) return;
        socket.to(socket.matchId).emit('playerUpdated', { id: socket.id, ...data });
    });

    socket.on('hitPlayer', (targetId) => {
        io.to(targetId).emit('youGotHit');
    });

    socket.on('leaveMatch', () => {
        if (socket.matchId) {
            socket.to(socket.matchId).emit('playerDisconnected', socket.id);
            socket.leave(socket.matchId);
            socket.matchId = null;
        }
        queue.killers = queue.killers.filter(s => s.id !== socket.id);
        queue.survivors = queue.survivors.filter(s => s.id !== socket.id);
    });

    socket.on('disconnect', () => {
        if (socket.matchId) {
            socket.to(socket.matchId).emit('playerDisconnected', socket.id);
        }
        queue.killers = queue.killers.filter(s => s.id !== socket.id);
        queue.survivors = queue.survivors.filter(s => s.id !== socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Сервер запущен на порту ${PORT}`));
