import Phaser from 'phaser';
import { GameLogic } from '../gameLogic';

export class GameScene extends Phaser.Scene {
    constructor() {
        super('GameScene');
        // UI関連のオブジェクト群
        this.moveIndicators = [];
        this.skillIndicators = [];
        this.skillMenuSprites = [];
        this.skillMenuTexts = [];
    }

    init(data) {
        this.isMaster = data.isMaster;
        this.localPlayer = this.isMaster ? 'host' : 'guest';
        this.remotePlayer = this.isMaster ? 'guest' : 'host';

        // ゲームロジッククラスのインスタンスを生成（UI側の参照を渡す）
        this.gameLogic = new GameLogic(this, {
            isMaster: this.isMaster,
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

        // カード生成（gameLogic 内で状態管理＋UI作成を実施）
        this.gameLogic.createCards();

        // ターン状態表示テキスト
        this.turnStatusText = this.add.text(
            this.cameras.main.centerX,
            this.cameras.main.height - 40,
            "Waiting for turn start...",
            { fontSize: '20px', fill: '#ffffff' }
        ).setOrigin(0.5);

        // ゲームメッセージ受信用イベントリスナーの登録
        window.addEventListener('gameMessage', this.gameLogic.handleGameMessage.bind(this.gameLogic));

        // ターン開始処理
        this.gameLogic.startTurn();
    }

    // ---------------------------
    // UI関連のヘルパー関数
    // ---------------------------

    /**
     * グリッド設定（縦7行×横3列、各セル60px）
     */
    setupGrid() {
        this.cols = 3;
        this.rows = 7;
        this.cellSize = 60;
        this.gridOrigin = {
            x: (this.cameras.main.width - this.cols * this.cellSize) / 2,
            y: 50
        };

        // 背景タイルを配置
        for (let r = 0; r < this.rows; r++) {
            for (let c = 0; c < this.cols; c++) {
                const center = this.getCellCenter(c, r);
                const tile = this.add.image(center.x, center.y, 'tile');
                tile.setDisplaySize(this.cellSize, this.cellSize);
                tile.setDepth(0);
            }
        }
    }

    /**
     * 指定セルの中心座標を取得
     */
    getCellCenter(col, row) {
        return {
            x: this.gridOrigin.x + col * this.cellSize + this.cellSize / 2,
            y: this.gridOrigin.y + row * this.cellSize + this.cellSize / 2
        };
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
            if (col !== card.col && !this.gameLogic.isCellOccupied(col, card.row, card.id)) {
                const center = this.getCellCenter(col, card.row);
                indicators.push(this.add.rectangle(center.x, center.y, this.cellSize, this.cellSize, 0x0000ff, 0.3));
            }
        }
        // 同じ列の空セル
        for (let row = 0; row < this.rows; row++) {
            if (row !== card.row && !this.gameLogic.isCellOccupied(card.col, row, card.id)) {
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
                    // ロジック側へスキルアクション登録を依頼
                    this.gameLogic.registerLocalAction({
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
        Object.values(this.gameLogic.cards).forEach(card => {
            if (card.owner === this.localPlayer) {
                card.container.disableInteractive();
            }
        });
    }

    /**
     * ローカル側カードの入力有効化
     */
    enableLocalCardInput() {
        Object.values(this.gameLogic.cards).forEach(card => {
            if (card.owner === this.localPlayer) {
                card.container.setInteractive();
            }
        });
    }

    shutdown() {
        window.removeEventListener('gameMessage', this.gameLogic.handleGameMessage.bind(this.gameLogic));
    }
}
