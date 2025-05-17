import Phaser from 'phaser';
import { AuthScene } from './auth_scene/authScene';
import { LobbyScene } from './lobby_scene/lobbyScene';
import { GameScene } from './game_scene/gameScene';

// Global game context to help with player identification
window.gameContext = {
  localPlayer: null,
  remotePlayer: null,
  playerRole: null,
  setPlayerInfo: function (localPlayer, remotePlayer, playerRole) {
    this.localPlayer = localPlayer;
    this.remotePlayer = remotePlayer;
    this.playerRole = playerRole;
    console.log(`Game context set: localPlayer=${localPlayer}, remotePlayer=${remotePlayer}, role=${playerRole}`);
  }
};

const config = {
  type: Phaser.AUTO,
  width: 800,
  height: 600,
  parent: 'gameContainer',
  scene: [AuthScene, LobbyScene, GameScene], // Auth -> Lobby -> Game
};

const game = new Phaser.Game(config);