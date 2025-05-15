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
      // Log when ICE candidates are generated
      console.log('ICE candidate generated:', candidate ? 'New candidate' : 'All candidates gathered');

      if (candidate && currentSocket && currentPeerId) {
        console.log('Sending ICE candidate to peer');
        currentSocket.emit('iceCandidate', {
          roomId: currentRoomId,
          candidate,
          to: currentPeerId
        });
      }
    };

    // Add listeners for ICE connection state changes
    peerConnection.oniceconnectionstatechange = () => {
      console.log('ICE connection state:', peerConnection.iceConnectionState);
    };

    peerConnection.onicegatheringstatechange = () => {
      console.log('ICE gathering state:', peerConnection.iceGatheringState);
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
  // Add detailed logging for data channel state changes
  channel.onopen = () => {
    console.log('Data channel is open - Connection established successfully!');
    notifyConnectionReady();
  };

  channel.onclose = () => {
    console.log('Data channel is closed');
  };

  channel.onerror = (error) => {
    console.error('Data channel error:', error);
  };

  ['bufferedamountlow', 'closing'].forEach(eventName => {
    channel.addEventListener(eventName, () => {
      console.log(`Data channel event: ${eventName}`);
    });
  });

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
        if (candidate) {
          if (peerConnection.remoteDescription) {
            console.log('Adding received ICE candidate');
            await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
          } else {
            console.log('Received ICE candidate but remote description not set yet, this might cause delays');
            // We could potentially queue these candidates for later application
            setTimeout(async () => {
              if (peerConnection.remoteDescription) {
                console.log('Applying delayed ICE candidate');
                await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
              } else {
                console.warn('Still could not apply ICE candidate - remote description missing');
              }
            }, 1000);
          }
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

    // Send the offer immediately without waiting for ICE gathering to complete
    // This implements "Trickle ICE" - ICE candidates will be sent separately as they arrive
    currentSocket?.emit('offer', {
      roomId: currentRoomId,
      offer: peerConnection.localDescription
    });

    console.log('Offer sent. ICE candidates will be sent as they are gathered.');

    // Optional: Add a fallback timeout in case ICE gathering takes too long
    setTimeout(() => {
      if (peerConnection && dataChannel?.readyState !== 'open') {
        console.log('Connection taking longer than expected, but continuing to attempt connection...');
      }
    }, 5000);

  } catch (error) {
    console.error('Error creating offer:', error);
    throw error;
  }
};

const handleGameMessage = (message) => {
  const event = new CustomEvent('gameMessage', { detail: message });
  window.dispatchEvent(event);
};

export const sendGameMessage = (moveData) => {
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