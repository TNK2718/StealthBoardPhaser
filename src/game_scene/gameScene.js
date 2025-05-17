import Phaser from 'phaser';
import { GameController } from './gameController';
import firebaseService from '../firebase/firebaseService';

export class GameScene extends Phaser.Scene {
    constructor() {
        super('GameScene');
        // UI関連のオブジェクト群
        this.moveIndicators = [];
        this.skillIndicators = [];
        this.skillMenuSprites = [];
        this.skillMenuTexts = [];
        this.gridInitialized = false; // Flag to track grid initialization
    }

    init(data) {
        this.gameId = data.gameId;
        this.playerRole = data.playerRole;

        // Determine if we're player1 (host) or player2 (guest)
        this.localPlayer = this.playerRole === 'player1' ? 'host' : 'guest';
        this.remotePlayer = this.playerRole === 'player1' ? 'guest' : 'host';

        // Set global game context for visibility checks
        if (window.gameContext) {
            window.gameContext.setPlayerInfo(this.localPlayer, this.remotePlayer, this.playerRole);
        }

        // ゲームコントローラーの初期化
        this.controller = new GameController(this, {
            gameId: this.gameId,
            playerRole: this.playerRole,
            localPlayer: this.localPlayer,
            remotePlayer: this.remotePlayer
        });
    }

    preload() {
        // アセット読み込み
        this.load.image('tile', 'assets/bg.png');
        this.load.image('ship', 'assets/CyanCardBack.png');
        this.load.image('skill', 'assets/skill.jpg');
    }

    create() {
        // グリッド設定
        this.setupGrid();

        // ターン状態表示テキスト
        this.turnStatusText = this.add.text(
            this.cameras.main.centerX,
            this.cameras.main.height - 40,
            "Waiting for turn start...",
            { fontSize: '20px', fill: '#ffffff' }
        ).setOrigin(0.5);

        // Initialize cards with delay to ensure grid is ready
        this.time.delayedCall(100, () => {
            // Double check grid initialization
            if (!this.gridInitialized) {
                console.warn("Grid not fully initialized yet, setting up grid again");
                this.setupGrid();
            }

            // Create cards after ensuring grid is initialized
            console.log("Creating cards with initialized grid");
            this.controller.createCards();

            // Enable board for input
            this.enableLocalCardInput();

            // Start turn after cards are created
            this.controller.startTurn();
        });
    }

    // ---------------------------
    // UI関連のヘルパー関数
    // ---------------------------

    /**
     * グリッド設定（縦7行×横3列、各セル60px）
     */
    setupGrid() {
        // Set grid dimensions
        this.cols = 3;
        this.rows = 7;
        this.cellSize = 60;

        // Ensure camera is available
        if (!this.cameras || !this.cameras.main) {
            console.error("Camera not available during grid setup!");
            // Set fallback values but wait for next frame to try again
            this.gridOrigin = { x: 100, y: 50 };
            this.time.delayedCall(10, () => this.setupGrid());
            return;
        }

        this.gridOrigin = {
            x: (this.cameras.main.width - this.cols * this.cellSize) / 2,
            y: 50
        };

        // Validate that grid origin coordinates are valid numbers
        if (isNaN(this.gridOrigin.x) || isNaN(this.gridOrigin.y)) {
            console.error("Invalid grid origin coordinates:", this.gridOrigin);
            // Set fallback values
            this.gridOrigin = { x: 100, y: 50 };
        }

        console.log("Grid initialized:", {
            cols: this.cols,
            rows: this.rows,
            cellSize: this.cellSize,
            gridOrigin: this.gridOrigin
        });

        // 背景タイルを配置
        for (let r = 0; r < this.rows; r++) {
            for (let c = 0; c < this.cols; c++) {
                const center = this.getCellCenter(c, r);

                // Only create tile if we got valid coordinates
                if (center && !isNaN(center.x) && !isNaN(center.y)) {
                    const tile = this.add.image(center.x, center.y, 'tile');
                    tile.setDisplaySize(this.cellSize, this.cellSize);
                    tile.setDepth(0);
                }
            }
        }

        // Signal that grid is fully initialized
        this.gridInitialized = true;
    }

    /**
     * 指定セルの中心座標を取得
     * 位置が無効な場合のエラーハンドリング付き
     */
    getCellCenter(col, row) {
        // Ensure grid is initialized
        if (!this.gridOrigin || this.cellSize === undefined) {
            console.error("Grid not initialized when getCellCenter was called");
            return { x: this.cameras.main.centerX, y: this.cameras.main.centerY };
        }

        // Check for invalid or non-numeric inputs
        if (col === undefined || col === null || row === undefined || row === null ||
            isNaN(Number(col)) || isNaN(Number(row))) {

            console.error(`Invalid cell coordinates: col=${col}, row=${row}`);

            // Return a default position rather than crashing
            return {
                x: this.gridOrigin.x + this.cellSize / 2,  // First cell, x-center
                y: this.gridOrigin.y + this.cellSize / 2   // First cell, y-center
            };
        }

        // Convert to numbers if they're strings
        const numCol = Number(col);
        const numRow = Number(row);

        // Make sure columns and rows are within bounds
        const safeCol = Math.max(0, Math.min(Math.floor(numCol), this.cols - 1));
        const safeRow = Math.max(0, Math.min(Math.floor(numRow), this.rows - 1));

        // If we had to correct values, log it
        if (safeCol !== numCol || safeRow !== numRow) {
            console.warn(`Cell coordinates out of bounds, clamped: (${numCol},${numRow}) -> (${safeCol},${safeRow})`);
        }

        // Calculate center coordinates
        const centerX = this.gridOrigin.x + safeCol * this.cellSize + this.cellSize / 2;
        const centerY = this.gridOrigin.y + safeRow * this.cellSize + this.cellSize / 2;

        // Final safety check for NaN (which can happen if gridOrigin is undefined)
        if (isNaN(centerX) || isNaN(centerY)) {
            console.error(`Calculated invalid center coordinates: x=${centerX}, y=${centerY}`);
            return {
                x: this.cameras.main.centerX,
                y: this.cameras.main.centerY
            };
        }

        return { x: centerX, y: centerY };
    }

    /**
     * ドラッグ終了時などに最も近いグリッドセルを返す
     */
    getNearestGridPosition(x, y) {
        let col = Math.floor((x - this.gridOrigin.x) / this.cellSize);
        let row = Math.floor((y - this.gridOrigin.y) / this.cellSize);
        col = Phaser.Math.Clamp(col, 0, this.cols - 1);
        row = Phaser.Math.Clamp(row, 0, this.rows - 1);
        return { col, row };
    }

    /**
     * 移動可能セルのインジケーターを表示（青色）
     */
    showMoveIndicators(card) {
        this.clearMoveIndicators();
        const indicators = [];

        // 同じ行の空セル
        for (let col = 0; col < this.cols; col++) {
            if (col !== card.col && !this.controller.gameLogic.isCellOccupied(col, card.row, card.id)) {
                const center = this.getCellCenter(col, card.row);
                indicators.push(this.add.rectangle(center.x, center.y, this.cellSize, this.cellSize, 0x0000ff, 0.3));
            }
        }
        // 同じ列の空セル
        for (let row = 0; row < this.rows; row++) {
            if (row !== card.row && !this.controller.gameLogic.isCellOccupied(card.col, row, card.id)) {
                const center = this.getCellCenter(card.col, row);
                indicators.push(this.add.rectangle(center.x, center.y, this.cellSize, this.cellSize, 0x0000ff, 0.3));
            }
        }
        this.moveIndicators = indicators;
    }

    /**
     * 移動インジケーターを全て除去
     */
    clearMoveIndicators() {
        this.moveIndicators.forEach(indicator => indicator.destroy());
        this.moveIndicators = [];
    }

    /**
     * スキル使用可能範囲（マンハッタン距離2以内）のインジケーターを表示（赤色）
     */
    showSkillIndicators(card) {
        this.clearSkillIndicators();
        const indicators = [];
        for (let col = 0; col < this.cols; col++) {
            for (let row = 0; row < this.rows; row++) {
                if (col === card.col && row === card.row) continue;
                if (Math.abs(col - card.col) + Math.abs(row - card.row) <= 2) {
                    const center = this.getCellCenter(col, row);
                    indicators.push(this.add.rectangle(center.x, center.y, this.cellSize, this.cellSize, 0xff0000, 0.3));
                }
            }
        }
        this.skillIndicators = indicators;
    }

    /**
     * スキルインジケーターを全て除去
     */
    clearSkillIndicators() {
        this.skillIndicators.forEach(indicator => indicator.destroy());
        this.skillIndicators = [];
    }

    /**
     * スキルメニュー（攻撃・罠）の表示
     */
    showSkillMenu(card) {
        this.clearSkillMenu();
        this.clearMoveIndicators();
        this.showSkillIndicators(card);

        const desiredSize = (this.cellSize * 0.8) * 0.5; // カードサイズの50%
        // 攻撃スキル：右上に配置
        const atkX = card.container.x + 40;
        const atkY = card.container.y - 40;
        const atkSprite = this.add.image(atkX, atkY, 'skill');
        const atkScale = desiredSize / atkSprite.width;
        atkSprite.setScale(atkScale);
        atkSprite.setInteractive();
        atkSprite.setDepth(3);
        const atkText = this.add.text(atkX, atkY - (desiredSize / 2) - 5, 'Atk', {
            fontSize: '12px',
            fill: '#ffffff'
        }).setOrigin(0.5);
        atkText.setDepth(3);

        // 罠スキル：左上に配置
        const trapX = card.container.x - 40;
        const trapY = card.container.y - 40;
        const trapSprite = this.add.image(trapX, trapY, 'skill');
        const trapScale = desiredSize / trapSprite.width;
        trapSprite.setScale(trapScale);
        trapSprite.setInteractive();
        trapSprite.setDepth(3);
        const trapText = this.add.text(trapX, trapY - (desiredSize / 2) - 5, 'Trap', {
            fontSize: '12px',
            fill: '#ffffff'
        }).setOrigin(0.5);
        trapText.setDepth(3);

        this.skillMenuSprites.push(atkSprite, trapSprite);
        this.skillMenuTexts.push(atkText, trapText);

        // ドラッグ操作の登録
        this.input.setDraggable(atkSprite);
        this.input.setDraggable(trapSprite);
        atkSprite.on('drag', (pointer, dragX, dragY) => {
            atkSprite.x = dragX;
            atkSprite.y = dragY;
            atkText.x = dragX;
            atkText.y = dragY - (desiredSize / 2) - 5;
        });
        trapSprite.on('drag', (pointer, dragX, dragY) => {
            trapSprite.x = dragX;
            trapSprite.y = dragY;
            trapText.x = dragX;
            trapText.y = dragY - (desiredSize / 2) - 5;
        });

        // ドロップ時の共通処理
        const handleSkillDrop = (sprite, skillSubtype) => {
            if (
                sprite.x < this.gridOrigin.x ||
                sprite.x > this.gridOrigin.x + this.cols * this.cellSize ||
                sprite.y < this.gridOrigin.y ||
                sprite.y > this.gridOrigin.y + this.rows * this.cellSize
            ) {
                this.clearSkillMenu();
                this.clearSkillIndicators();
                return;
            }
            const targetPos = this.getNearestGridPosition(sprite.x, sprite.y);
            const center = this.getCellCenter(targetPos.col, targetPos.row);
            this.tweens.add({
                targets: [sprite, atkText, trapText],
                x: center.x,
                y: center.y,
                duration: 200,
                onComplete: () => {
                    // コントローラー経由でスキルアクション登録を依頼
                    this.controller.registerLocalAction({
                        cardId: card.id,
                        actionType: 'skill',
                        skillSubtype: skillSubtype,
                        destination: { col: targetPos.col, row: targetPos.row }
                    });
                    this.clearSkillMenu();
                }
            });
        };

        atkSprite.on('dragend', () => handleSkillDrop(atkSprite, 'atk'));
        trapSprite.on('dragend', () => handleSkillDrop(trapSprite, 'trap'));

        // メニュー外クリックでキャンセル
        this.time.delayedCall(1, () => {
            this.input.once('pointerdown', (pointer, currentlyOver) => {
                if (
                    !currentlyOver ||
                    (!currentlyOver.includes(atkSprite) && !currentlyOver.includes(trapSprite))
                ) {
                    this.clearSkillMenu();
                    this.clearSkillIndicators();
                }
            });
        });
    }

    /**
     * スキルメニューのオブジェクトを全削除
     */
    clearSkillMenu() {
        this.skillMenuSprites.forEach(sprite => sprite.destroy());
        this.skillMenuSprites = [];
        this.skillMenuTexts.forEach(text => text.destroy());
        this.skillMenuTexts = [];
    }

    /**
     * 連続アニメーションを順次実行する（UI用）
     */
    playTweenSequence(tweenConfigs, onComplete) {
        const sequence = [...tweenConfigs];
        const playNext = () => {
            if (sequence.length === 0) {
                if (onComplete) onComplete();
                return;
            }
            const config = sequence.shift();
            const originalOnComplete = config.onComplete;
            config.onComplete = () => {
                if (originalOnComplete) originalOnComplete();
                playNext();
            };
            this.tweens.add(config);
        };
        playNext();
    }

    /**
     * ローカル側カードの入力無効化
     */
    disableLocalCardInput() {
        Object.values(this.controller.gameLogic.cards).forEach(card => {
            if (card.owner === this.localPlayer && card.container) {
                card.container.disableInteractive();
            }
        });
    }

    /**
     * ローカル側カードの入力有効化
     */
    enableLocalCardInput() {
        if (!this.controller || !this.controller.gameLogic) {
            console.warn("Cannot enable card input: controller or game logic not initialized");
            return;
        }

        console.log(`Enabling input for ${this.localPlayer} cards`);

        Object.values(this.controller.gameLogic.cards).forEach(card => {
            // Only add interaction to cards that belong to the local player
            if (card.owner === this.localPlayer && card.container) {
                console.log(`Enabling interaction for card ${card.id}`);

                // Make the card interactive and draggable
                card.container.setInteractive({ draggable: true });

                // Make sure it's visible
                card.container.setVisible(true);
                card.isHidden = false;
            }
        });
    }

    shutdown() {
        window.removeEventListener('gameMessage', this.controller.handleGameMessage);
        this.controller.cleanup();
    }
}
