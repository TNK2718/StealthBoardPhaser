import Phaser from 'phaser';
import { initWebRTC, sendGameMessage, onConnectionReady } from './webrtc';

let gameState = {
  grid: Array(5).fill().map(() => Array(5).fill(null)),
};

let isMaster = confirm('Are you the master player?');
initWebRTC(isMaster);

const config = {
  type: Phaser.AUTO,
  width: 400,
  height: 400,
  scene: {
    preload: preload,
    create: create,
    update: update,
  },
};

let game;

onConnectionReady(() => {
  console.log('Connection established! Starting the game...');
  game = new Phaser.Game(config); // 接続完了後にゲームを開始
});

function preload() {
  this.load.image('water', 'assets/bg.png');
  this.load.image('ship', 'assets/CyanCardBack.png');
}

function create() {
  for (let i = 0; i < 5; i++) {
    for (let j = 0; j < 5; j++) {
      let tile = this.add.image(80 * j + 40, 80 * i + 40, 'water').setDisplaySize(80, 80).setInteractive();
      tile.setData('x', j);
      tile.setData('y', i);

      tile.on('pointerdown', () => {
        if (isMaster) {
          placeShip(j, i);
          sendGameMessage({ type: 'placeShip', x: j, y: i });
        }
      });
    }
  }
}

function update() { }

function placeShip(x, y) {
  if (!gameState.grid[y][x]) {
    gameState.grid[y][x] = 'ship';
    game.scene.scenes[0].add.image(80 * x + 40, 80 * y + 40, 'ship').setDisplaySize(80, 80);
  }
}
