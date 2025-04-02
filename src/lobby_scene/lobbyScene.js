import Phaser from 'phaser';
import { io } from 'socket.io-client';
import { initWebRTC, onConnectionReady, sendGameMove } from '../webrtc';
import { GameScene } from '../game_scene/gameScene';

export class LobbyScene extends Phaser.Scene {
    constructor() {
        super('LobbyScene');
        this.socket = null;
        this.statusText = null;
        this.roomListText = null;
        this.createRoomButton = null;
        this.roomItems = [];
    }

    init() {
        this.socket = this.game.socket;
    }

    create() {
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

                onConnectionReady(() => {
                    this.updateStatus('Connection established! Starting game...');
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
        if (!this.sys.isActive()) {
            console.warn('Cannot update status, scene is not active');
            return;
        }
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
