import io from 'socket.io-client';
import placeShip from './index.js';

const socket = io('http://localhost:3000');
let peerConnection;
let dataChannel;
let isReady = false;

const config = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

const connectionCallbacks = [];

export async function initWebRTC(isMaster) {
  peerConnection = new RTCPeerConnection(config);

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('ice-candidate', event.candidate);
    }
  };

  if (isMaster) {
    dataChannel = peerConnection.createDataChannel('game');
    setupDataChannel(dataChannel);

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit('offer', offer);
  } else {
    peerConnection.ondatachannel = (event) => {
      dataChannel = event.channel;
      setupDataChannel(dataChannel);
    };
  }

  socket.on('offer', async (offer) => {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit('answer', answer);
  });

  socket.on('answer', async (answer) => {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
    markConnectionReady();
  });

  socket.on('ice-candidate', async (candidate) => {
    await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
  });

  peerConnection.onconnectionstatechange = () => {
    if (peerConnection.connectionState === 'connected') {
      markConnectionReady();
    }
  };
}

function setupDataChannel(channel) {
  channel.onopen = () => {
    markConnectionReady();
  };
  channel.onmessage = (event) => {
    const message = JSON.parse(event.data);
    handleGameMessage(message);
  };
}

function markConnectionReady() {
  if (!isReady) {
    isReady = true;
    connectionCallbacks.forEach((callback) => callback());
  }
}

export function sendGameMessage(message) {
  if (dataChannel && dataChannel.readyState === 'open') {
    dataChannel.send(JSON.stringify(message));
  }
}

export function onConnectionReady(callback) {
  if (isReady) {
    callback();
  } else {
    connectionCallbacks.push(callback);
  }
}

function handleGameMessage(message) {
  if (message.type === 'placeShip') {
    placeShip(message.x, message.y);
  }
}
