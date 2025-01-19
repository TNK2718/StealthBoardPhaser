import Phaser from 'phaser';
import { GameLogic } from '../gameLogic';
import { sendGameMove } from '../webrtc';

export class GameScene extends Phaser.Scene {
    constructor() {
        super({ key: 'GameScene' });
        this.gameLogic = new GameLogic();
        this.isMaster = false;
        this.onGameMove = null; // Callback function for sending moves

        window.addEventListener('gameMessage', (event) => {
            this.handleGameMessage(event.detail);
        });
    }

    init(data) {
        this.isMaster = data.isMaster;
    }

    preload() {
        this.load.image('water', 'assets/bg.png');
        this.load.image('ship', 'assets/CyanCardBack.png');
    }

    create() {
        this.createGrid();
    }

    createGrid() {
        for (let i = 0; i < 5; i++) {
            for (let j = 0; j < 5; j++) {
                let tile = this.add.image(80 * j + 40, 80 * i + 40, 'water')
                    .setDisplaySize(80, 80)
                    .setInteractive();

                tile.setData('x', j);
                tile.setData('y', i);

                tile.on('pointerdown', () => {
                    const x = tile.getData('x');
                    const y = tile.getData('y');
                    // Perform ship placement
                    const placedShip = this.gameLogic.placeShip(x, y);
                    if (placedShip) {
                        // Visual update for ship placement
                        this.add.image(80 * x + 40, 80 * y + 40, 'ship').setDisplaySize(80, 80);
                        // Send move to other player
                        const moveData = { type: 'placeShip', x, y };
                        sendGameMove(moveData);
                    }
                });
            }
        }
    }

    update() {
        // Add game update logic here
    }


    handleGameMessage(message) {
        const placedShip = this.gameLogic.handleGameMessage(message);
        console.log(placedShip);
        if (placedShip) {
            // Visual update for ship placement
            this.add.image(80 * placedShip.x + 40, 80 * placedShip.y + 40, 'ship').setDisplaySize(80, 80);
        }
    }
}
