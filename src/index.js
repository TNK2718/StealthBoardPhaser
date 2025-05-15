import Phaser from 'phaser';
import { LobbyScene } from './lobby_scene/lobbyScene';
import { GameScene } from './game_scene/gameScene';
import { io } from 'socket.io-client';

let socket = io();

const config = {
  type: Phaser.AUTO,
  width: 800,
  height: 600,
  parent: 'gameContainer',
  scene: [LobbyScene, GameScene], // ロビーシーンとゲームシーンを登録
};

const game = new Phaser.Game(config);
game.socket = socket;