import { io } from 'socket.io-client';
import { initWebRTC, onConnectionReady, sendGameMove, cleanup } from './webrtc';
import { BattleshipGame } from './scenes/gameScene';

let currentRoom = null;
let currentPlayerId = null;
let battleshipGame = null;
let roomUpdateInterval = null;
const ROOM_UPDATE_INTERVAL = 5000; // 5秒ごとに更新
const socket = io('http://localhost:3000');

// DOM Elements
const createRoomBtn = document.getElementById('createRoom');
const joinRoomBtn = document.getElementById('joinRoom');
const roomIdInput = document.getElementById('roomId');
const statusDisplay = document.getElementById('status');
const gameContainer = document.getElementById('gameContainer');
const roomListContent = document.getElementById('roomListContent');

// 定期更新の開始
function startRoomUpdates() {
  console.log('Starting room updates...');
  // 既存の更新がある場合はクリア
  stopRoomUpdates();

  // 即座に1回目の更新を実行
  socket.emit('getRooms');

  // 定期的な更新を開始
  roomUpdateInterval = setInterval(() => {
    if (!currentRoom) { // ゲーム中でない場合のみ更新
      socket.emit('getRooms');
    }
  }, ROOM_UPDATE_INTERVAL);
}

// 定期更新の停止
function stopRoomUpdates() {
  if (roomUpdateInterval) {
    clearInterval(roomUpdateInterval);
    roomUpdateInterval = null;
  }
}

// ロビー関連の関数
function updateRoomList(rooms) {
  roomListContent.innerHTML = '';

  if (rooms.length === 0) {
    roomListContent.innerHTML = '<p>No rooms available</p>';
    return;
  }

  rooms.forEach(room => {
    const roomElement = document.createElement('div');
    roomElement.className = 'room-item';

    const roomInfo = document.createElement('div');
    roomInfo.innerHTML = `
      Room: ${room.id}<br>
      Players: ${room.players.length}/2
    `;

    const joinButton = document.createElement('button');
    joinButton.textContent = 'Join';
    joinButton.disabled = room.players.length >= 2;
    joinButton.onclick = () => {
      socket.emit('joinRoom', room.id);
    };

    roomElement.appendChild(roomInfo);
    roomElement.appendChild(joinButton);
    roomListContent.appendChild(roomElement);
  });
}

// Event Listeners
createRoomBtn.addEventListener('click', () => {
  socket.emit('createRoom');
});

joinRoomBtn.addEventListener('click', () => {
  const roomId = roomIdInput.value.trim();
  if (roomId) {
    socket.emit('joinRoom', roomId);
  } else {
    updateStatus('Please enter a room ID');
  }
});

// Socket Event Handlers
socket.on('connect', () => {
  updateStatus('Connected to server');
  startRoomUpdates();
});

socket.on('disconnect', () => {
  stopRoomUpdates();
  updateStatus('Disconnected from server');
});

socket.on('roomList', (rooms) => {
  updateRoomList(rooms);
});

socket.on('roomCreated', ({ roomId, playerId }) => {
  currentRoom = roomId;
  currentPlayerId = playerId;
  roomIdInput.value = roomId;
  updateStatus(`Room created! Room ID: ${roomId}`);
});

socket.on('playerJoined', ({ roomId, players, joinedPlayer }) => {
  updateStatus(`Player ${joinedPlayer} joined room ${roomId}`);
  if (players.length === 2) {
    updateStatus('Room is full - game can begin');
  }
});

socket.on('playerLeft', ({ roomId, playerId, remainingPlayers }) => {
  updateStatus(`Player ${playerId} left the room`);
  if (remainingPlayers.length < 2) {
    hideGameUI();
    updateStatus('Waiting for another player...');
    startRoomUpdates(); // 部屋を抜けた時に更新を再開
  }
});

socket.on('startConnection', async ({ isMaster, peerId, roomId }) => {
  try {
    updateStatus('Establishing P2P connection...');
    stopRoomUpdates(); // ゲーム開始時に更新を停止
    await initWebRTC(isMaster, socket, roomId, peerId);

    battleshipGame = new BattleshipGame();

    battleshipGame.setMoveCallback((moveData) => {
      console.log('Sending move:', moveData);
      sendGameMove(moveData);
    });

    onConnectionReady(() => {
      updateStatus('Connection established! Starting game...');
      showGameUI();
      battleshipGame.init(isMaster);
    });
  } catch (error) {
    console.error('WebRTC initialization error:', error);
    updateStatus('Failed to establish P2P connection');
    startRoomUpdates(); // 接続失敗時は更新を再開
  }
});

// Game Message Handler
window.addEventListener('gameMessage', (event) => {
  if (battleshipGame) {
    battleshipGame.handleGameMessage(event.detail);
  }
});

function showGameUI() {
  gameContainer.style.display = 'block';
  document.querySelector('.room-list').style.display = 'none';
}

function hideGameUI() {
  gameContainer.style.display = 'none';
  document.querySelector('.room-list').style.display = 'block';
}

function updateStatus(message) {
  statusDisplay.textContent = message;
  console.log(message);
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  stopRoomUpdates();
  cleanup();
  if (currentRoom) {
    socket.emit('leaveRoom', currentRoom);
  }
  socket.close();
});