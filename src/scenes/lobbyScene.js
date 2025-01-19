import Phaser from 'phaser';
import { io } from 'socket.io-client';
import { initWebRTC, onConnectionReady, sendGameMove } from '../webrtc';
import { GameScene } from './gameScene';

export class LobbyScene extends Phaser.Scene {
    constructor() {
        super('LobbyScene');
        this.socket = null;
        this.statusText = null;
        this.roomListText = null;
        this.createRoomButton = null;
        this.roomItems = [];
    }

    init(data) {
        // this.socket = data.socket;
    }

    create() {
        this.socket = io('http://localhost:3000');

        this.add.text(400, 50, 'Battleship Lobby', { fontSize: '32px', fill: '#ffffff' }).setOrigin(0.5);

        this.statusText = this.add.text(400, 100, 'Connecting...', { fontSize: '18px', fill: '#ffffff' }).setOrigin(0.5);

        this.createRoomButton = this.add.text(400, 500, 'Create Room', { fontSize: '18px', fill: '#ffffff' })
            .setOrigin(0.5)
            .setInteractive({ useHandCursor: true })
            .on('pointerdown', () => this.socket.emit('createRoom'))
            .on('pointerover', () => this.createRoomButton.setStyle({ fill: '#ff0' }))
            .on('pointerout', () => this.createRoomButton.setStyle({ fill: '#ffffff' }));

        this.setupSocketListeners();
        this.startRoomUpdates();
    }

    setupSocketListeners() {
        this.socket.on('connect', () => this.updateStatus('Connected to server'));
        this.socket.on('disconnect', () => this.updateStatus('Disconnected from server'));
        this.socket.on('roomList', (rooms) => this.updateRoomList(rooms));
        this.socket.on('roomCreated', ({ roomId, playerId }) => {
            this.updateStatus(`Room created! Room ID: ${roomId}`);
        });
        this.socket.on('playerJoined', ({ roomId, players, joinedPlayer }) => {
            this.updateStatus(`Player ${joinedPlayer} joined room ${roomId}`);
            if (players.length === 2) {
                this.updateStatus('Room is full - game can begin');
            }
        });
        this.socket.on('playerLeft', ({ roomId, playerId, remainingPlayers }) => {
            this.updateStatus(`Player ${playerId} left the room`);
            if (remainingPlayers.length < 2) {
                this.updateStatus('Waiting for another player...');
                this.startRoomUpdates();
            }
        });
        this.socket.on('startConnection', async ({ isMaster, peerId, roomId }) => {
            try {
                this.updateStatus('Establishing P2P connection...');
                this.stopRoomUpdates(); // ゲーム開始時に更新を停止
                await initWebRTC(isMaster, this.socket, roomId, peerId);

                // battleshipGame = new GameScene();

                // battleshipGame.setMoveCallback((moveData) => {
                //     console.log('Sending move:', moveData);
                //     sendGameMove(moveData);
                // });

                onConnectionReady(() => {
                    this.updateStatus('Connection established! Starting game...');
                    // battleshipGame.init(isMaster);
                    this.scene.start('GameScene', { isMaster });
                });
            } catch (error) {
                console.error('WebRTC initialization error:', error);
                this.updateStatus('Failed to establish P2P connection');
                this.startRoomUpdates(); // 接続失敗時は更新を再開
            }
        });
    }

    updateStatus(message) {
        this.statusText.setText(message);
        console.log(message);
    }

    updateRoomList(rooms) {
        // Clear existing room items
        this.roomItems.forEach(item => item.destroy());
        this.roomItems = [];

        if (rooms.length === 0) {
            this.add.text(400, 200, 'No rooms available', { fontSize: '16px', fill: '#ffffff' }).setOrigin(0.5);
            return;
        }

        rooms.forEach((room, index) => {
            const yPos = 200 + index * 40;
            const roomText = this.add.text(400, yPos, `Room: ${room.id}, Players: ${room.players.length}/2`, { fontSize: '16px', fill: '#ffffff' })
                .setOrigin(0.5)
                .setInteractive({ useHandCursor: true })
                .on('pointerdown', () => this.joinRoom(room.id))
                .on('pointerover', () => roomText.setStyle({ fill: '#ff0' }))
                .on('pointerout', () => roomText.setStyle({ fill: '#ffffff' }));

            this.roomItems.push(roomText);
        });
    }

    joinRoom(roomId) {
        this.socket.emit('joinRoom', roomId);
        this.updateStatus(`Joining room ${roomId}...`);
    }

    startRoomUpdates() {
        this.socket.emit('getRooms');
        this.roomUpdateEvent = this.time.addEvent({
            delay: 5000,
            callback: () => this.socket.emit('getRooms'),
            loop: true
        });
    }

    stopRoomUpdates() {
        if (this.roomUpdateEvent) {
            this.roomUpdateEvent.destroy();
            this.roomUpdateEvent = null;
        }
    }
}



// import Phaser from 'phaser';
// import { io } from 'socket.io-client';
// import { initWebRTC, onConnectionReady, sendGameMove } from '../webrtc';
// import { GameScene } from './gameScene';
// export class LobbyScene extends Phaser.Scene {
//     constructor() {
//         super({ key: 'LobbyScene' });
//         this.socket = null;
//         this.currentRoom = null;
//         this.currentPlayerId = null;
//         this.roomUpdateInterval = null;
//         this.ROOM_UPDATE_INTERVAL = 5000; // 5秒ごとに更新
//     }

//     preload() {
//         // 必要であれば画像やフォントなどをプリロード
//     }

//     create() {
//         this.socket = io('http://localhost:3000');

//         // 部屋一覧表示エリア
//         this.roomListText = this.add.text(10, 10, 'Fetching rooms...', { fontSize: '16px', color: '#ffffff' });

//         // 部屋作成ボタン
//         this.add.text(10, 40, 'Create Room', { fontSize: '16px', color: '#00ff00' })
//             .setInteractive()
//             .on('pointerdown', () => {
//                 this.socket.emit('createRoom');
//             });

//         // 部屋参加入力とボタン
//         this.roomIdInput = this.add.dom(200, 80, 'input', { type: 'text', placeholder: 'Enter Room ID' });
//         this.add.text(10, 80, 'Join Room', { fontSize: '16px', color: '#00ff00' })
//             .setInteractive()
//             .on('pointerdown', () => {
//                 const roomId = this.roomIdInput.node.value.trim();
//                 if (roomId) {
//                     this.socket.emit('joinRoom', roomId);
//                 } else {
//                     this.updateStatus('Please enter a room ID');
//                 }
//             });

//         // ソケットイベントリスナー
//         this.setupSocketEvents();

//         // 部屋リストの定期更新
//         this.startRoomUpdates();
//     }

//     setupSocketEvents() {
//         this.socket.on('connect', () => {
//             this.updateStatus('Connected to server');
//             this.startRoomUpdates();
//         });

//         this.socket.on('disconnect', () => {
//             this.stopRoomUpdates();
//             this.updateStatus('Disconnected from server');
//         });

//         this.socket.on('roomList', (rooms) => {
//             this.updateRoomList(rooms);
//         });

//         this.socket.on('roomCreated', ({ roomId, playerId }) => {
//             this.currentRoom = roomId;
//             this.currentPlayerId = playerId;
//             this.roomIdInput.value = roomId;
//             this.updateStatus(`Room created! Room ID: ${roomId}`);
//         });

//         this.socket.on('playerJoined', ({ roomId, players, joinedPlayer }) => {
//             this.updateStatus(`Player ${joinedPlayer} joined room ${roomId}`);
//             if (players.length === 2) {
//                 this.updateStatus('Room is full - game can begin');
//             }
//         });

//         this.socket.on('playerLeft', ({ roomId, playerId, remainingPlayers }) => {
//             this.updateStatus(`Player ${playerId} left the room`);
//             if (remainingPlayers.length < 2) {
//                 hideGameUI();
//                 this.updateStatus('Waiting for another player...');
//                 startRoomUpdates(); // 部屋を抜けた時に更新を再開
//             }
//         });

//         this.socket.on('startConnection', async ({ isMaster, peerId, roomId }) => {
//             try {
//                 this.updateStatus('Establishing P2P connection...');
//                 this.stopRoomUpdates(); // ゲーム開始時に更新を停止
//                 await initWebRTC(isMaster, this.socket, roomId, peerId);

//                 // battleshipGame = new GameScene();

//                 // battleshipGame.setMoveCallback((moveData) => {
//                 //     console.log('Sending move:', moveData);
//                 //     sendGameMove(moveData);
//                 // });

//                 onConnectionReady(() => {
//                     updateStatus('Connection established! Starting game...');
//                     battleshipGame.init(isMaster);
//                     this.scene.start('GameScene', { isMaster });
//                 });
//             } catch (error) {
//                 console.error('WebRTC initialization error:', error);
//                 this.updateStatus('Failed to establish P2P connection');
//                 this.startRoomUpdates(); // 接続失敗時は更新を再開
//             }
//         });
//     }

//     startRoomUpdates() {
//         this.stopRoomUpdates(); // 既存のタイマーをクリア
//         this.socket.emit('getRooms'); // 初回の部屋リスト取得

//         this.roomUpdateInterval = setInterval(() => {
//             if (!this.currentRoom) {
//                 this.socket.emit('getRooms'); // 定期的に部屋リストを更新
//             }
//         }, this.ROOM_UPDATE_INTERVAL);
//     }

//     stopRoomUpdates() {
//         if (this.roomUpdateInterval) {
//             clearInterval(this.roomUpdateInterval);
//             this.roomUpdateInterval = null;
//         }
//     }

//     updateRoomList(rooms) {
//         let roomText = '';
//         if (rooms.length === 0) {
//             roomText = 'No rooms available';
//         } else {
//             rooms.forEach((room) => {
//                 roomText += `Room: ${room.id} (${room.players.length}/2)\n`;
//             });
//         }
//         this.roomListText.setText(roomText);
//     }

//     updateStatus(message) {
//         console.log(message); // デバッグログとしても出力
//     }

//     shutdown() {
//         this.stopRoomUpdates();
//         if (this.currentRoom) {
//             this.socket.emit('leaveRoom', this.currentRoom);
//         }
//         this.socket.close();
//     }
// }
