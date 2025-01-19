let peerConnection = null;
let dataChannel = null;
let currentSocket = null;
let currentRoomId = null;
let currentPeerId = null;

const config = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

export const initWebRTC = async (isMaster, socket, roomId, peerId) => {
  cleanup(); // 既存の接続をクリーンアップ

  currentSocket = socket;
  currentRoomId = roomId;
  currentPeerId = peerId;

  try {
    await createPeerConnection(isMaster);
    setupSocketHandlers();

    if (isMaster) {
      await createAndSendOffer();
    }
  } catch (error) {
    console.error('WebRTC initialization failed:', error);
    throw error;
  }
};

const createPeerConnection = async (isMaster) => {
  try {
    peerConnection = new RTCPeerConnection(config);

    peerConnection.onicecandidate = ({ candidate }) => {
      if (candidate && currentSocket && currentPeerId) {
        currentSocket.emit('iceCandidate', {
          roomId: currentRoomId,
          candidate,
          to: currentPeerId
        });
      }
    };

    peerConnection.onconnectionstatechange = () => {
      console.log('Connection state:', peerConnection.connectionState);
      if (peerConnection.connectionState === 'connected') {
        currentSocket?.emit('connectionStatus', {
          roomId: currentRoomId,
          status: 'connected'
        });
      }
    };

    if (isMaster) {
      try {
        dataChannel = peerConnection.createDataChannel('gameChannel', {
          ordered: true
        });
        setupDataChannel(dataChannel);
      } catch (error) {
        console.error('Error creating data channel:', error);
        throw error;
      }
    } else {
      peerConnection.ondatachannel = (event) => {
        dataChannel = event.channel;
        setupDataChannel(dataChannel);
      };
    }
  } catch (error) {
    console.error('Error creating peer connection:', error);
    throw error;
  }
};

const setupDataChannel = (channel) => {
  channel.onopen = () => {
    console.log('Data channel is open');
    notifyConnectionReady();
  };

  channel.onclose = () => {
    console.log('Data channel is closed');
  };

  channel.onerror = (error) => {
    console.error('Data channel error:', error);
  };

  channel.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);
      handleGameMessage(message);
    } catch (error) {
      console.error('Error parsing message:', error);
    }
  };
};

const setupSocketHandlers = () => {
  if (!currentSocket) return;

  const handlers = {
    offer: async ({ offer, from }) => {
      try {
        if (peerConnection.signalingState !== "stable") {
          console.log("Signaling state is not stable, waiting...");
          return;
        }
        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);

        currentSocket.emit('answer', {
          roomId: currentRoomId,
          answer,
          to: from
        });
      } catch (error) {
        console.error('Error handling offer:', error);
      }
    },

    answer: async ({ answer }) => {
      try {
        if (peerConnection.signalingState === "have-local-offer") {
          await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
        }
      } catch (error) {
        console.error('Error handling answer:', error);
      }
    },

    iceCandidate: async ({ candidate }) => {
      try {
        if (candidate && peerConnection.remoteDescription) {
          await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        }
      } catch (error) {
        console.error('Error handling ICE candidate:', error);
      }
    }
  };

  // Remove existing handlers if any
  currentSocket.off('offer');
  currentSocket.off('answer');
  currentSocket.off('iceCandidate');

  // Add new handlers
  Object.entries(handlers).forEach(([event, handler]) => {
    currentSocket.on(event, handler);
  });
};

const createAndSendOffer = async () => {
  try {
    if (!peerConnection || peerConnection.signalingState !== "stable") {
      console.error('PeerConnection is not in stable state');
      return;
    }

    const offer = await peerConnection.createOffer({
      offerToReceiveAudio: false,
      offerToReceiveVideo: false
    });

    await peerConnection.setLocalDescription(offer);

    // Wait for ICE gathering to complete
    await new Promise((resolve) => {
      if (peerConnection.iceGatheringState === 'complete') {
        resolve();
      } else {
        const checkState = () => {
          if (peerConnection.iceGatheringState === 'complete') {
            peerConnection.removeEventListener('icegatheringstatechange', checkState);
            resolve();
          }
        };
        peerConnection.addEventListener('icegatheringstatechange', checkState);
      }
    });

    currentSocket?.emit('offer', {
      roomId: currentRoomId,
      offer: peerConnection.localDescription
    });
  } catch (error) {
    console.error('Error creating offer:', error);
    throw error;
  }
};

const handleGameMessage = (message) => {
  const event = new CustomEvent('gameMessage', { detail: message });
  window.dispatchEvent(event);
};

export const sendGameMove = (moveData) => {
  if (dataChannel?.readyState === 'open') {
    try {
      dataChannel.send(JSON.stringify(moveData));
    } catch (error) {
      console.error('Error sending game move:', error);
    }
  }
};

const connectionReadyCallbacks = new Set();

const notifyConnectionReady = () => {
  connectionReadyCallbacks.forEach(callback => callback());
};

export const onConnectionReady = (callback) => {
  if (dataChannel?.readyState === 'open') {
    callback();
  } else {
    connectionReadyCallbacks.add(callback);
  }
};

export const cleanup = () => {
  if (dataChannel) {
    dataChannel.close();
  }
  if (peerConnection) {
    peerConnection.close();
  }
  dataChannel = null;
  peerConnection = null;
  connectionReadyCallbacks.clear();
};