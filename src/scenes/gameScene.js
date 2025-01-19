import Phaser from 'phaser';

export class BattleshipGame {
    constructor() {
        this.gameState = {
            grid: Array(5).fill().map(() => Array(5).fill(null)),
        };
        this.game = null;
    }

    init(isMaster) {
        this.isMaster = isMaster;
        const config = {
            type: Phaser.AUTO,
            width: 400,
            height: 400,
            parent: 'gameContent',
            scene: {
                preload: this.preload.bind(this),
                create: this.create.bind(this),
                update: this.update.bind(this),
            },
        };
        this.game = new Phaser.Game(config);
    }

    preload() {
        this.game.scene.scenes[0].load.image('water', 'assets/bg.png');
        this.game.scene.scenes[0].load.image('ship', 'assets/CyanCardBack.png');
    }

    create() {
        const scene = this.game.scene.scenes[0];
        for (let i = 0; i < 5; i++) {
            for (let j = 0; j < 5; j++) {
                let tile = scene.add.image(80 * j + 40, 80 * i + 40, 'water')
                    .setDisplaySize(80, 80)
                    .setInteractive();

                tile.setData('x', j);
                tile.setData('y', i);

                tile.on('pointerdown', () => {
                    // タイルクリック時に座標情報を送信
                    const moveData = {
                        type: 'placeShip',
                        x: j,
                        y: i
                    };
                    // ローカルでも配置を実行
                    this.placeShip(j, i);
                    // 他のプレイヤーに送信
                    this.onGameMove(moveData);
                });
            }
        }
    }

    update() {
        // Add game update logic here
    }

    placeShip(x, y) {
        if (!this.gameState.grid[y][x]) {
            this.gameState.grid[y][x] = 'ship';
            this.game.scene.scenes[0].add.image(80 * x + 40, 80 * y + 40, 'ship')
                .setDisplaySize(80, 80);
        }
    }

    handleGameMessage(message) {
        if (message.type === 'placeShip') {
            this.placeShip(message.x, message.y);
        }
    }

    // 移動情報を送信するためのコールバック関数
    setMoveCallback(callback) {
        this.onGameMove = callback;
    }
}