import Phaser from 'phaser';
import { LobbyScene } from './scenes/lobbyScene';
import { GameScene } from './scenes/gameScene';
import { io } from 'socket.io-client';

let socket = io('http://localhost:3000');

const config = {
  type: Phaser.AUTO,
  width: 800,
  height: 600,
  parent: 'gameContainer',
  scene: [LobbyScene, GameScene], // ロビーシーンとゲームシーンを登録
};

const game = new Phaser.Game(config);
game.socket = socket;