import Phaser from 'phaser';
import { LobbyScene } from './scenes/lobbyScene';
import { GameScene } from './scenes/gameScene';

const config = {
  type: Phaser.AUTO,
  width: 800,
  height: 600,
  parent: 'gameContainer',
  scene: [LobbyScene, GameScene], // ロビーシーンとゲームシーンを登録
};

const game = new Phaser.Game(config);
