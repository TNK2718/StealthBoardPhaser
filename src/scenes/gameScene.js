// scene/gameScene.js
import Phaser from 'phaser';
import { sendGameMessage } from '../webrtc';

export class GameScene extends Phaser.Scene {
    constructor() {
        super('GameScene');
    }

    init(data) {
        this.isMaster = data.isMaster;
        this.localPlayer = this.isMaster ? 'host' : 'remote';
        this.remotePlayer = this.isMaster ? 'remote' : 'host';

        // 各カードの状態（id ごと）
        this.cards = {};
        // 各ターンの行動を保持（'host' と 'remote'）
        this.turnActions = {};
        this.turnInProgress = false;
        this.gameOver = false;

        // スキル使用時のターゲット選択用フラグ
        this.selectingSkillTarget = false;
        this.skillSourceCard = null;
        this.skillMenu = null;
        this.skillOverlay = null;
    }

    preload() {
        // カード画像の読み込み
        this.load.image('ship', 'assets/CyanCardBack.png');
    }

    create() {
        this.setupGrid();
        this.createCards();

        // ターン状態表示テキスト（画面下部中央）
        this.turnStatusText = this.add.text(
            this.cameras.main.centerX,
            this.cameras.main.height - 50,
            "Your turn: choose an action",
            { fontSize: '20px', fill: '#ffffff' }
        ).setOrigin(0.5);

        // WebRTC 経由のゲームメッセージ受信
        window.addEventListener('gameMessage', this.handleGameMessage.bind(this));

        this.startTurn();
    }

    // --- グリッド描画・ヘルパー関数 ---
    setupGrid() {
        this.cols = 7;
        this.rows = 3;
        this.cellSize = 80; // 各セル 80px
        this.gridOrigin = {
            x: (this.cameras.main.width - this.cols * this.cellSize) / 2,
            y: 100
        };

        this.gridGraphics = this.add.graphics();
        this.gridGraphics.lineStyle(2, 0xffffff, 1);

        for (let c = 0; c <= this.cols; c++) {
            const x = this.gridOrigin.x + c * this.cellSize;
            this.gridGraphics.moveTo(x, this.gridOrigin.y);
            this.gridGraphics.lineTo(x, this.gridOrigin.y + this.rows * this.cellSize);
        }
        for (let r = 0; r <= this.rows; r++) {
            const y = this.gridOrigin.y + r * this.cellSize;
            this.gridGraphics.moveTo(this.gridOrigin.x, y);
            this.gridGraphics.lineTo(this.gridOrigin.x + this.cols * this.cellSize, y);
        }
        this.gridGraphics.strokePath();
    }

    getNearestGridPosition(x, y) {
        let col = Math.floor((x - this.gridOrigin.x) / this.cellSize);
        let row = Math.floor((y - this.gridOrigin.y) / this.cellSize);
        col = Phaser.Math.Clamp(col, 0, this.cols - 1);
        row = Phaser.Math.Clamp(row, 0, this.rows - 1);
        return { col, row };
    }

    getCellCenter(col, row) {
        return {
            x: this.gridOrigin.x + col * this.cellSize + this.cellSize / 2,
            y: this.gridOrigin.y + row * this.cellSize + this.cellSize / 2
        };
    }

    isCellOccupied(col, row, movingCardId) {
        return Object.values(this.cards).some(card => {
            return card.id !== movingCardId && card.col === col && card.row === row && card.hp > 0;
        });
    }

    // --- カード作成 ---
    createCards() {
        const hostColumns = [1, 3, 5];
        const remoteColumns = [1, 3, 5];

        const hostStats = [
            { id: 'host_0', hp: 3, speed: 10 },
            { id: 'host_1', hp: 3, speed: 8 },
            { id: 'host_2', hp: 3, speed: 6 }
        ];
        const remoteStats = [
            { id: 'remote_0', hp: 3, speed: 9 },
            { id: 'remote_1', hp: 3, speed: 7 },
            { id: 'remote_2', hp: 3, speed: 5 }
        ];

        hostStats.forEach((cardStat, index) => {
            const col = hostColumns[index];
            const row = 2;
            this.createCard(cardStat, col, row);
        });
        remoteStats.forEach((cardStat, index) => {
            const col = remoteColumns[index];
            const row = 0;
            this.createCard(cardStat, col, row);
        });
    }

    createCard(cardData, col, row) {
        const center = this.getCellCenter(col, row);
        const cardContainer = this.add.container(center.x, center.y);
        const cardSprite = this.add.image(0, 0, 'ship');
        const scale = (this.cellSize - 10) / cardSprite.width;
        cardSprite.setScale(scale);
        cardContainer.add(cardSprite);

        const statsText = this.add.text(-this.cellSize / 4, -this.cellSize / 4, `HP:${cardData.hp}\nSPD:${cardData.speed}`, {
            fontSize: '12px',
            fill: '#ffffff'
        });
        cardContainer.add(statsText);

        const card = {
            id: cardData.id,
            owner: cardData.id.startsWith('host') ? 'host' : 'remote',
            hp: cardData.hp,
            speed: cardData.speed,
            col: col,
            row: row,
            container: cardContainer,
            sprite: cardSprite,
            statsText: statsText
        };
        this.cards[card.id] = card;

        if (card.owner === this.localPlayer) {
            cardContainer.setSize(this.cellSize - 10, this.cellSize - 10);
            cardContainer.setInteractive();
            this.input.setDraggable(cardContainer);

            cardContainer.on('pointerdown', (pointer) => {
                if (this.turnActions[this.localPlayer]) return;
                cardContainer.startX = pointer.x;
                cardContainer.startY = pointer.y;
                cardContainer.hasMoved = false;
            });

            // ドラッグ中にスキルメニューが表示されていれば閉じる
            cardContainer.on('drag', (pointer, dragX, dragY) => {
                if (this.turnActions[this.localPlayer]) return;
                if (this.skillMenu) {
                    this.hideSkillMenu();
                }
                cardContainer.hasMoved = true;
                cardContainer.x = dragX;
                cardContainer.y = dragY;
            });

            // ドラッグ終了時は一旦元の位置へ戻し、移動先が有効なら移動アクションを登録
            cardContainer.on('dragend', (pointer) => {
                if (this.turnActions[this.localPlayer]) return;
                if (cardContainer.hasMoved) {
                    const newPos = this.getNearestGridPosition(cardContainer.x, cardContainer.y);
                    const origCenter = this.getCellCenter(card.col, card.row);
                    this.tweens.add({
                        targets: cardContainer,
                        x: origCenter.x,
                        y: origCenter.y,
                        duration: 200,
                        onComplete: () => {
                            if (!this.isCellOccupied(newPos.col, newPos.row, cardData.id) &&
                                (newPos.col !== card.col || newPos.row !== card.row)) {
                                this.registerLocalAction({
                                    cardId: card.id,
                                    actionType: 'move',
                                    destination: { col: newPos.col, row: newPos.row }
                                });
                            }
                        }
                    });
                }
            });

            // ドラッグせずにタップした場合はスキルメニューを表示
            cardContainer.on('pointerup', (pointer) => {
                if (this.turnActions[this.localPlayer]) return;
                if (!cardContainer.hasMoved) {
                    this.showSkillMenu(card, cardContainer);
                }
            });
        }
    }

    // --- スキルメニュー関連 ---
    showSkillMenu(card, cardContainer) {
        // 既にメニューが表示されている場合は閉じる
        if (this.skillMenu) {
            this.hideSkillMenu();
        }
        // オーバーレイを作成（全画面、透明度ほぼ 0 でクリックを検知）
        this.skillOverlay = this.add.rectangle(0, 0, this.cameras.main.width, this.cameras.main.height, 0x000000, 0.001)
            .setOrigin(0, 0)
            .setInteractive();
        this.skillOverlay.setDepth(5);
        this.skillOverlay.on('pointerdown', () => {
            this.hideSkillMenu();
        });

        // スキルメニューの作成
        this.skillMenu = this.add.container(cardContainer.x, cardContainer.y);
        this.skillMenu.setDepth(10);
        // スキルメニュー自体もクリック時に伝播を止める
        this.skillMenu.setInteractive();
        this.skillMenu.on('pointerdown', (pointer, localX, localY, event) => {
            event.stopPropagation();
        });
        const menuRadius = 60;
        const angle = Phaser.Math.DegToRad(-45);
        const btnX = menuRadius * Math.cos(angle);
        const btnY = menuRadius * Math.sin(angle);
        const button = this.add.circle(btnX, btnY, 20, 0xff0000);
        const buttonText = this.add.text(btnX - 15, btnY - 10, 'Atk', { fontSize: '12px', fill: '#ffffff' });
        this.skillMenu.add([button, buttonText]);

        button.setInteractive();
        button.on('pointerdown', () => {
            this.enableTargetSelection(card);
            this.hideSkillMenu();
        });
    }

    hideSkillMenu() {
        if (this.skillMenu) {
            this.skillMenu.destroy();
            this.skillMenu = null;
        }
        if (this.skillOverlay) {
            this.skillOverlay.destroy();
            this.skillOverlay = null;
        }
    }

    enableTargetSelection(card) {
        this.selectingSkillTarget = true;
        this.skillSourceCard = card;
        Object.values(this.cards).forEach(otherCard => {
            if (otherCard.owner !== this.localPlayer && otherCard.hp > 0) {
                otherCard.container.setSize(this.cellSize - 10, this.cellSize - 10);
                otherCard.container.setInteractive();
                otherCard.sprite.setTint(0xffff00);
                otherCard.container.on('pointerdown', () => {
                    this.onSkillTargetSelected(otherCard);
                });
            }
        });
    }

    onSkillTargetSelected(targetCard) {
        if (!this.selectingSkillTarget || !this.skillSourceCard) return;
        Object.values(this.cards).forEach(otherCard => {
            if (otherCard.owner !== this.localPlayer) {
                otherCard.sprite.clearTint();
                otherCard.container.disableInteractive();
                otherCard.container.removeAllListeners('pointerdown');
            }
        });
        this.registerLocalAction({
            cardId: this.skillSourceCard.id,
            actionType: 'skill',
            targetId: targetCard.id
        });
        this.selectingSkillTarget = false;
        this.skillSourceCard = null;
    }

    // --- ターン入力の制御 ---
    disableLocalCardInput() {
        Object.values(this.cards).forEach(card => {
            if (card.owner === this.localPlayer) {
                card.container.disableInteractive();
            }
        });
    }

    enableLocalCardInput() {
        Object.values(this.cards).forEach(card => {
            if (card.owner === this.localPlayer) {
                card.container.setInteractive();
            }
        });
    }

    registerLocalAction(action) {
        if (this.turnActions[this.localPlayer]) return;
        this.turnActions[this.localPlayer] = action;
        this.turnStatusText.setText("Waiting for opponent...");
        this.disableLocalCardInput();

        if (!this.isMaster) {
            sendGameMessage(JSON.stringify({ type: 'playerAction', action }));
        } else {
            if (this.turnActions[this.remotePlayer]) {
                this.resolveTurn();
            }
        }
    }

    startTurn() {
        console.log("Starting new turn");
        this.turnActions = {};
        this.turnInProgress = true;
        this.turnStatusText.setText("Your turn: choose an action");
        this.enableLocalCardInput();
    }

    // 複数の tween を順次実行するヘルパー関数
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

    resolveTurn() {
        const hostAction = this.turnActions['host'];
        const remoteAction = this.turnActions['remote'];
        if (!hostAction || !remoteAction) {
            console.log("Waiting for both actions");
            return;
        }
        const actions = [hostAction, remoteAction];
        actions.sort((a, b) => {
            const cardA = this.cards[a.cardId];
            const cardB = this.cards[b.cardId];
            return cardB.speed - cardA.speed;
        });

        const tweenConfigs = [];
        actions.forEach(action => {
            const card = this.cards[action.cardId];
            if (action.actionType === 'move') {
                const newCenter = this.getCellCenter(action.destination.col, action.destination.row);
                tweenConfigs.push({
                    targets: card.container,
                    x: newCenter.x,
                    y: newCenter.y,
                    duration: 500,
                    onComplete: () => {
                        card.col = action.destination.col;
                        card.row = action.destination.row;
                    }
                });
            } else if (action.actionType === 'skill') {
                const target = this.cards[action.targetId];
                tweenConfigs.push({
                    targets: target.container,
                    alpha: 0.5,
                    duration: 200,
                    yoyo: true,
                    onComplete: () => {
                        target.hp -= 1;
                        target.statsText.setText(`HP:${target.hp}\nSPD:${target.speed}`);
                    }
                });
            }
        });

        this.playTweenSequence(tweenConfigs, () => {
            const turnResult = {
                type: 'turnResult',
                state: {}
            };
            Object.values(this.cards).forEach(card => {
                turnResult.state[card.id] = {
                    col: card.col,
                    row: card.row,
                    hp: card.hp
                };
            });
            sendGameMessage(JSON.stringify(turnResult));
            this.checkGameOver();
            if (!this.gameOver) {
                this.startTurn();
            }
        });
    }

    checkGameOver() {
        const hostAlive = Object.values(this.cards).filter(card => card.owner === 'host' && card.hp > 0);
        const remoteAlive = Object.values(this.cards).filter(card => card.owner === 'remote' && card.hp > 0);
        if (hostAlive.length === 0 || remoteAlive.length === 0) {
            this.gameOver = true;
            const winner = hostAlive.length > 0 ? 'Host' : 'Remote';
            alert(`Game Over! Winner: ${winner}`);
        }
    }

    handleGameMessage(event) {
        const message = event.detail;
        const parsed = typeof message === 'string' ? JSON.parse(message) : message;
        if (parsed.type === 'playerAction' && this.isMaster) {
            this.turnActions[this.remotePlayer] = parsed.action;
            console.log("Received remote action:", parsed.action);
            if (this.turnActions[this.localPlayer]) {
                this.resolveTurn();
            }
        } else if (parsed.type === 'turnResult') {
            this.updateBoardState(parsed.state);
        }
    }

    updateBoardState(state) {
        Object.keys(state).forEach(cardId => {
            const card = this.cards[cardId];
            if (card) {
                const cardState = state[cardId];
                card.col = cardState.col;
                card.row = cardState.row;
                card.hp = cardState.hp;
                card.statsText.setText(`HP:${card.hp}\nSPD:${card.speed}`);
                const center = this.getCellCenter(card.col, card.row);
                this.tweens.add({
                    targets: card.container,
                    x: center.x,
                    y: center.y,
                    duration: 500
                });
            }
        });
        this.checkGameOver();
        if (!this.gameOver) {
            this.startTurn();
        }
    }

    update() {
        // 必要に応じたゲームループ処理
    }

    shutdown() {
        window.removeEventListener('gameMessage', this.handleGameMessage.bind(this));
    }
}
