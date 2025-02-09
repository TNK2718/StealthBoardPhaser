// scene/gameScene.js
import Phaser from 'phaser';
import { sendGameMessage } from '../webrtc';

export class GameScene extends Phaser.Scene {
    constructor() {
        super('GameScene');
    }

    init(data) {
        this.isMaster = data.isMaster;
        // ホストの場合は 'host'、ゲストの場合は 'guest'
        this.localPlayer = this.isMaster ? 'host' : 'guest';
        this.remotePlayer = this.isMaster ? 'guest' : 'host';

        // 各カードの状態を保持
        this.cards = {};
        // 各ターンの行動（1ターンにつき1回の入力）
        this.turnActions = {};
        this.turnInProgress = false;
        this.gameOver = false;

        // ターン開始前の準備状態（turnReady/turnStart 通信用）
        this.turnReadyStates = { host: false, guest: false };
        this.turnReadyTimer = null;

        // スキル発動用：発動元カードの参照、スキルメニュー画像および上部テキストの参照
        this.skillSourceCard = null;
        this.skillMenuSprite = null;
        this.skillMenuText = null;
    }

    preload() {
        this.load.image('ship', 'assets/CyanCardBack.png');
        this.load.image('skill', 'assets/skill.jpg');
    }

    create() {
        this.setupGrid();
        this.createCards();

        // ターン状態表示用テキスト（画面下部中央）
        this.turnStatusText = this.add.text(
            this.cameras.main.centerX,
            this.cameras.main.height - 40,
            "Waiting for turn start...",
            { fontSize: '20px', fill: '#ffffff' }
        ).setOrigin(0.5);

        // WebRTC 経由のゲームメッセージ受信
        window.addEventListener('gameMessage', this.handleGameMessage.bind(this));

        // ターン開始の通信処理を開始
        this.startTurn();
    }

    // グリッドは縦7行×横3列（縦長）の構成
    setupGrid() {
        this.cols = 3;
        this.rows = 7;
        // セルサイズを60pxに変更
        this.cellSize = 60;
        // gridOrigin.y を50に設定（画面上部から余白を少なめに）
        this.gridOrigin = {
            x: (this.cameras.main.width - this.cols * this.cellSize) / 2,
            y: 50
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

    // カード配置：ゲスト側は上段（row = 0）、ホスト側は下段（row = rows-1 ＝6）
    createCards() {
        const guestColumns = [0, 1, 2];
        const hostColumns = [0, 1, 2];

        const guestStats = [
            { id: 'guest_0', hp: 3, speed: 9 },
            { id: 'guest_1', hp: 3, speed: 7 },
            { id: 'guest_2', hp: 3, speed: 5 }
        ];
        const hostStats = [
            { id: 'host_0', hp: 3, speed: 10 },
            { id: 'host_1', hp: 3, speed: 8 },
            { id: 'host_2', hp: 3, speed: 6 }
        ];

        guestStats.forEach((cardStat, index) => {
            const col = guestColumns[index];
            const row = 0;
            this.createCard(cardStat, col, row);
        });

        hostStats.forEach((cardStat, index) => {
            const col = hostColumns[index];
            const row = this.rows - 1; // row 6
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
            owner: cardData.id.startsWith('host') ? 'host' : 'guest',
            hp: cardData.hp,
            speed: cardData.speed,
            col: col,
            row: row,
            container: cardContainer,
            sprite: cardSprite,
            statsText: statsText
        };
        this.cards[card.id] = card;

        // 自分が操作するカードのみ、入力を有効化
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

            cardContainer.on('drag', (pointer, dragX, dragY) => {
                if (this.turnActions[this.localPlayer]) return;
                cardContainer.hasMoved = true;
                cardContainer.x = dragX;
                cardContainer.y = dragY;
            });

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

            cardContainer.on('pointerup', (pointer) => {
                if (this.turnActions[this.localPlayer]) return;
                if (!cardContainer.hasMoved) {
                    this.showSkillMenu(card, cardContainer);
                }
            });
        }
    }

    // スキルメニューの表示：カードの右上または左上にオフセットして表示し、上部に「Atk」の文字を追加
    showSkillMenu(card, cardContainer) {
        if (this.skillMenuSprite) {
            this.skillMenuSprite.destroy();
            this.skillMenuSprite = null;
        }
        if (this.skillMenuText) {
            this.skillMenuText.destroy();
            this.skillMenuText = null;
        }
        let offsetX = 40, offsetY = -40;
        if (cardContainer.x > this.cameras.main.centerX) {
            offsetX = -40;
        }
        const menuX = cardContainer.x + offsetX;
        const menuY = cardContainer.y + offsetY;
        this.skillMenuSprite = this.add.image(menuX, menuY, 'skill');
        const desiredSize = (this.cellSize - 10) * 0.5;
        const scale = desiredSize / this.skillMenuSprite.width;
        this.skillMenuSprite.setScale(scale);
        this.skillMenuSprite.setInteractive();
        this.input.setDraggable(this.skillMenuSprite);

        // 「Atk」テキストをメニューの上部に表示
        this.skillMenuText = this.add.text(menuX, menuY - (desiredSize / 2) - 5, 'Atk', {
            fontSize: '12px',
            fill: '#ffffff'
        }).setOrigin(0.5);

        this.skillMenuSprite.on('drag', (pointer, dragX, dragY) => {
            this.skillMenuSprite.x = dragX;
            this.skillMenuSprite.y = dragY;
            this.skillMenuText.x = dragX;
            this.skillMenuText.y = dragY - (desiredSize / 2) - 5;
        });

        this.skillMenuSprite.on('dragend', (pointer) => {
            const targetPos = this.getNearestGridPosition(this.skillMenuSprite.x, this.skillMenuSprite.y);
            const center = this.getCellCenter(targetPos.col, targetPos.row);
            this.tweens.add({
                targets: [this.skillMenuSprite, this.skillMenuText],
                x: center.x,
                y: center.y - (desiredSize / 2) - 5,
                duration: 200,
                onComplete: () => {
                    this.registerLocalAction({
                        cardId: card.id,
                        actionType: 'skill',
                        destination: { col: targetPos.col, row: targetPos.row }
                    });
                    this.skillMenuSprite.destroy();
                    this.skillMenuText.destroy();
                    this.skillMenuSprite = null;
                    this.skillMenuText = null;
                }
            });
        });

        // メニュー以外がクリックされた場合、メニューを破棄する処理（once リスナー）
        this.time.delayedCall(1, () => {
            this.input.once('pointerdown', (pointer, currentlyOver) => {
                if (!currentlyOver || !currentlyOver.includes(this.skillMenuSprite)) {
                    if (this.skillMenuSprite) {
                        this.skillMenuSprite.destroy();
                        this.skillMenuText && this.skillMenuText.destroy();
                        this.skillMenuSprite = null;
                        this.skillMenuText = null;
                    }
                }
            });
        });
    }

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

    // ターン開始の準備通信
    sendTurnReady() {
        sendGameMessage(JSON.stringify({ type: 'turnReady', from: this.localPlayer }));
        if (!this.isMaster) {
            if (this.turnReadyTimer) clearTimeout(this.turnReadyTimer);
            this.turnReadyTimer = this.time.delayedCall(3000, () => {
                this.sendTurnReady();
            });
        }
    }

    actualStartTurn() {
        console.log("Turn started");
        this.turnStatusText.setText("Your turn: choose an action");
        this.enableLocalCardInput();
        if (this.turnReadyTimer) {
            clearTimeout(this.turnReadyTimer);
            this.turnReadyTimer = null;
        }
    }

    // ターン開始要求
    startTurn() {
        console.log("Starting turn coordination");
        this.turnActions = {};
        this.turnInProgress = true;
        this.turnReadyStates = { host: false, guest: false };
        this.disableLocalCardInput();
        this.turnStatusText.setText("Waiting for opponent to be ready...");
        if (this.isMaster) {
            this.turnReadyStates.host = true;
        }
        this.sendTurnReady();
    }

    // ターン行動の登録（1ターン1回）
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

    // ターン解決（ホスト側で実行）
    resolveTurn() {
        const hostAction = this.turnActions['host'];
        const guestAction = this.turnActions['guest'];
        if (!hostAction || !guestAction) {
            console.log("Waiting for both actions");
            return;
        }
        const actions = [hostAction, guestAction];
        actions.sort((a, b) => {
            const cardA = this.cards[a.cardId];
            const cardB = this.cards[b.cardId];
            return cardB.speed - cardA.speed;
        });

        const tweenConfigs = [];
        const animationCommands = [];
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
                animationCommands.push({
                    type: 'move',
                    cardId: card.id,
                    destination: action.destination,
                    duration: 500
                });
            } else if (action.actionType === 'skill') {
                const targetGrid = action.destination;
                const enemyCard = Object.values(this.cards).find(c =>
                    c.owner !== card.owner &&
                    c.col === targetGrid.col &&
                    c.row === targetGrid.row &&
                    c.hp > 0
                );
                if (enemyCard) {
                    const sourceCenter = this.getCellCenter(card.col, card.row);
                    const targetCenter = this.getCellCenter(enemyCard.col, enemyCard.row);
                    // 弾のアニメーション（黄色い弾）
                    let bullet = this.add.circle(sourceCenter.x, sourceCenter.y, 5, 0xffff00);
                    tweenConfigs.push({
                        targets: bullet,
                        x: targetCenter.x,
                        y: targetCenter.y,
                        duration: 300,
                        onComplete: () => {
                            bullet.destroy();
                            // 敵カードの sprite を赤く点滅させる
                            enemyCard.sprite.setTint(0xff0000);
                            this.time.delayedCall(100, () => {
                                enemyCard.sprite.clearTint();
                                enemyCard.hp -= 1;
                                enemyCard.statsText.setText(`HP:${enemyCard.hp}\nSPD:${enemyCard.speed}`);
                            });
                        }
                    });
                    animationCommands.push({
                        type: 'skill',
                        sourceCardId: card.id,
                        targetCardId: enemyCard.id,
                        bulletDuration: 300,
                        flashDuration: 100
                    });
                }
            }
        });

        // ホスト側でアニメーション実行後、"turnAnimation" を送信
        this.playTweenSequence(tweenConfigs, () => {
            const turnResult = { state: {} };
            Object.values(this.cards).forEach(card => {
                turnResult.state[card.id] = {
                    col: card.col,
                    row: card.row,
                    hp: card.hp
                };
            });
            sendGameMessage(JSON.stringify({
                type: 'turnAnimation',
                commands: animationCommands,
                finalState: turnResult.state
            }));
            this.checkGameOver();
            if (!this.gameOver) {
                this.startTurn();
            }
        });
    }

    // ゲスト側：受信した turnAnimation を再現
    playTurnAnimation(commands, finalState) {
        const tweenConfigs = [];
        commands.forEach(cmd => {
            if (cmd.type === 'move') {
                const card = this.cards[cmd.cardId];
                if (card) {
                    const newCenter = this.getCellCenter(cmd.destination.col, cmd.destination.row);
                    tweenConfigs.push({
                        targets: card.container,
                        x: newCenter.x,
                        y: newCenter.y,
                        duration: cmd.duration,
                        onComplete: () => {
                            card.col = cmd.destination.col;
                            card.row = cmd.destination.row;
                        }
                    });
                }
            } else if (cmd.type === 'skill') {
                const sourceCard = this.cards[cmd.sourceCardId];
                const enemyCard = this.cards[cmd.targetCardId];
                if (sourceCard && enemyCard) {
                    const sourceCenter = this.getCellCenter(sourceCard.col, sourceCard.row);
                    const targetCenter = this.getCellCenter(enemyCard.col, enemyCard.row);
                    let bullet = this.add.circle(sourceCenter.x, sourceCenter.y, 5, 0xffff00);
                    tweenConfigs.push({
                        targets: bullet,
                        x: targetCenter.x,
                        y: targetCenter.y,
                        duration: cmd.bulletDuration,
                        onComplete: () => {
                            bullet.destroy();
                            enemyCard.sprite.setTint(0xff0000);
                            this.time.delayedCall(cmd.flashDuration, () => {
                                enemyCard.sprite.clearTint();
                                enemyCard.hp -= 1;
                                enemyCard.statsText.setText(`HP:${enemyCard.hp}\nSPD:${enemyCard.speed}`);
                            });
                        }
                    });
                }
            }
        });
        this.playTweenSequence(tweenConfigs, () => {
            this.updateBoardState(finalState);
        });
    }

    checkGameOver() {
        const hostAlive = Object.values(this.cards).filter(card => card.owner === 'host' && card.hp > 0);
        const guestAlive = Object.values(this.cards).filter(card => card.owner === 'guest' && card.hp > 0);
        if (hostAlive.length === 0 || guestAlive.length === 0) {
            this.gameOver = true;
            const winner = hostAlive.length > 0 ? 'Host' : 'Guest';
            alert(`Game Over! Winner: ${winner}`);
        }
    }

    // 通信メッセージ処理
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
        } else if (parsed.type === 'turnAnimation') {
            this.playTurnAnimation(parsed.commands, parsed.finalState);
        } else if (parsed.type === 'turnReady') {
            this.turnReadyStates[parsed.from] = true;
            if (this.isMaster) {
                if (this.turnReadyStates.host && this.turnReadyStates.guest) {
                    sendGameMessage(JSON.stringify({ type: 'turnStart' }));
                    this.actualStartTurn();
                }
            }
        } else if (parsed.type === 'turnStart') {
            this.actualStartTurn();
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
