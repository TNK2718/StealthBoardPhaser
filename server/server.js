const express = require('express');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "http://localhost:8080",
        methods: ["GET", "POST"]
    }
});

const rooms = new Map();

app.use(express.static(path.join(__dirname, '../dist')));

// 部屋リストをクライアントが理解できる形式に変換する関数
function getRoomsList() {
    return Array.from(rooms.values()).map(room => ({
        id: room.id,
        players: room.players,
        status: room.signaling.status
    }));
}

// 全クライアントに部屋リストを送信する関数
function broadcastRoomsList() {
    io.emit('roomList', getRoomsList());
}

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // 部屋リスト取得リクエストのハンドラを追加
    socket.on('getRooms', () => {
        socket.emit('roomList', getRoomsList());
    });

    // Create Room
    socket.on('createRoom', () => {
        const roomId = uuidv4();
        rooms.set(roomId, {
            id: roomId,
            players: [socket.id],
            signaling: {
                status: 'waiting',
                offer: null,
                answers: {},
                iceCandidates: new Map()
            }
        });

        socket.join(roomId);
        socket.emit('roomCreated', { roomId, playerId: socket.id });
        console.log('Room created:', roomId);
        broadcastRoomsList(); // 部屋作成後にリストを更新
    });

    // Join Room
    socket.on('joinRoom', (roomId) => {
        const room = rooms.get(roomId);
        if (!room || room.players.length >= 2) {
            socket.emit('error', 'Room is full or does not exist');
            return;
        }

        room.players.push(socket.id);
        socket.join(roomId);

        if (room.players.length === 2) {
            const [player1, player2] = room.players;
            io.to(player1).emit('startConnection', {
                isMaster: true,
                peerId: player2,
                roomId
            });
            io.to(player2).emit('startConnection', {
                isMaster: false,
                peerId: player1,
                roomId
            });
        }

        io.to(roomId).emit('playerJoined', {
            roomId,
            players: room.players,
            joinedPlayer: socket.id
        });
        broadcastRoomsList(); // プレイヤー参加後にリストを更新
    });

    // WebRTC Signaling
    socket.on('offer', ({ roomId, offer }) => {
        const room = rooms.get(roomId);
        if (!room) return;

        room.signaling.offer = offer;
        room.signaling.status = 'offering';

        const otherPlayer = room.players.find(id => id !== socket.id);
        if (otherPlayer) {
            io.to(otherPlayer).emit('offer', { offer, from: socket.id });
        }
        broadcastRoomsList(); // シグナリング状態変更後にリストを更新
    });

    socket.on('answer', ({ roomId, answer, to }) => {
        io.to(to).emit('answer', { answer, from: socket.id });
    });

    socket.on('iceCandidate', ({ roomId, candidate, to }) => {
        io.to(to).emit('iceCandidate', { candidate, from: socket.id });
    });

    // Game State Management
    socket.on('connectionStatus', ({ roomId, status }) => {
        const room = rooms.get(roomId);
        if (!room) return;

        room.signaling.status = status;
        if (status === 'connected') {
            io.to(roomId).emit('roomReady', { roomId });
        }
        broadcastRoomsList(); // 接続状態変更後にリストを更新
    });

    socket.on('gameMove', ({ roomId, move }) => {
        const room = rooms.get(roomId);
        if (!room) return;

        const otherPlayer = room.players.find(id => id !== socket.id);
        if (otherPlayer) {
            io.to(otherPlayer).emit('gameMove', { move, from: socket.id });
        }
    });

    // Disconnect Handling
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);

        for (const [roomId, room] of rooms.entries()) {
            const playerIndex = room.players.indexOf(socket.id);
            if (playerIndex !== -1) {
                room.players.splice(playerIndex, 1);
                io.to(roomId).emit('playerLeft', {
                    roomId,
                    playerId: socket.id,
                    remainingPlayers: room.players
                });

                if (room.players.length === 0) {
                    rooms.delete(roomId);
                    console.log('Room deleted:', roomId);
                }
                broadcastRoomsList(); // プレイヤー退出後にリストを更新
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});