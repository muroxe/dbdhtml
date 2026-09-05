const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname + '/public'));

let players = {};
let match = { survivor: null, killer: null };

io.on('connection', (socket) => {
    console.log('Игрок подключился:', socket.id);
    players[socket.id] = { id: socket.id, role: null };

    // Поиск игры
    socket.on('findMatch', (role) => {
        players[socket.id].role = role;
        if (role === 'SURVIVOR') match.survivor = socket.id;
        if (role === 'KILLER') match.killer = socket.id;

        // Если оба найдены, стартуем
        if (match.survivor && match.killer) {
            io.to(match.survivor).emit('matchStarted', { enemyId: match.killer });
            io.to(match.killer).emit('matchStarted', { enemyId: match.survivor });
        }
    });

    // Синхронизация движений
    socket.on('updatePosition', (data) => {
        socket.broadcast.emit('enemyPosition', data);
    });

    socket.on('disconnect', () => {
        console.log('Игрок отключился:', socket.id);
        if (match.survivor === socket.id) match.survivor = null;
        if (match.killer === socket.id) match.killer = null;
        delete players[socket.id];
        socket.broadcast.emit('enemyDisconnected');
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Сервер запущен на порту ${PORT}`));
