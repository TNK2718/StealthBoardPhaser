import { io } from 'socket.io-client';
import { initWebRTC, onConnectionReady, sendGameMove, cleanup } from './webrtc';

let currentRoom = null;
let currentPlayerId = null;
const socket = io('http://localhost:3000');

// DOM Elements
const createRoomBtn = document.getElementById('createRoom');
const joinRoomBtn = document.getElementById('joinRoom');
const roomIdInput = document.getElementById('roomId');
const statusDisplay = document.getElementById('status');
const gameContainer = document.getElementById('gameContainer');

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

socket.on('startConnection', async ({ isMaster, peerId, roomId }) => {
  try {
    updateStatus('Establishing P2P connection...');
    await initWebRTC(isMaster, socket, roomId, peerId);
  } catch (error) {
    console.error('WebRTC initialization error:', error);
    updateStatus('Failed to establish P2P connection');
  }
});

socket.on('roomReady', ({ roomId }) => {
  if (currentRoom === roomId) {
    updateStatus('P2P connection established - Game is ready!');
    showGameUI();
  }
});

socket.on('playerLeft', ({ roomId, playerId, remainingPlayers }) => {
  updateStatus(`Player ${playerId} left the room`);
  if (remainingPlayers.length < 2) {
    hideGameUI();
    updateStatus('Waiting for another player...');
  }
});

socket.on('error', (message) => {
  updateStatus(`Error: ${message}`);
});

// Game UI Functions
function showGameUI() {
  gameContainer.style.display = 'block';
}

function hideGameUI() {
  gameContainer.style.display = 'none';
}

function updateStatus(message) {
  statusDisplay.textContent = message;
  console.log(message);
}

// Game Message Handler
window.addEventListener('gameMessage', (event) => {
  const message = event.detail;
  console.log('Received game message:', message);
  // Handle game-specific messages here
});

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  cleanup();
  if (currentRoom) {
    socket.emit('leaveRoom', currentRoom);
  }
  socket.close();
});

export function sendMove(moveData) {
  if (currentRoom) {
    sendGameMove(moveData);
    socket.emit('gameMove', { roomId: currentRoom, move: moveData });
  }
}

// Initialize game-specific logic here
onConnectionReady(() => {
  console.log('P2P connection is ready for game data');
  // Add your game initialization code here
});