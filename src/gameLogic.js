import { sendGameMessage } from './webrtc';

export class GameLogic {
    constructor(scene, { isMaster, localPlayer, remotePlayer }) {
        // UIシーンへの参照を保持
        this.scene = scene;
        this.isMaster = isMaster;
        this.localPlayer = localPlayer;
        this.remotePlayer = remotePlayer;

        // ゲーム状態の初期化
        this.cards = {};
        this.turnActions = {};
        this.turnInProgress = false;
        this.gameOver = false;
        this.turnReadyStates = { host: false, guest: false };
        this.turnReadyTimer = null;
        this.traps = [];
    }

    // ---------------------------
    // カード生成・管理
    // ---------------------------

    createCards() {
        // カード配置用カラム
        const guestColumns = [0, 1, 2];
        const hostColumns = [0, 1, 2];

        // ゲスト側カードの初期ステータス
        const guestStats = [
            { id: 'guest_0', hp: 3, speed: 3 },
            { id: 'guest_1', hp: 3, speed: 2 },
            { id: 'guest_2', hp: 3, speed: 1 }
        ];
        // ホスト側カードの初期ステータス
        const hostStats = [
            { id: 'host_0', hp: 3, speed: 4 },
            { id: 'host_1', hp: 3, speed: 3 },
            { id: 'host_2', hp: 3, speed: 2 }
        ];

        // ゲスト側：上段（row = 0）
        guestStats.forEach((cardStat, index) => {
            this.createCard(cardStat, guestColumns[index], 0);
        });

        // ホスト側：下段（row = rows-1）
        hostStats.forEach((cardStat, index) => {
            this.createCard(cardStat, hostColumns[index], this.scene.rows - 1);
        });
    }

    createCard(cardData, col, row) {
        const center = this.scene.getCellCenter(col, row);
        const cardContainer = this.scene.add.container(center.x, center.y);

        // カードのサイズはセルサイズの80%
        const desiredCardSize = this.scene.cellSize * 0.8;
        const cardSprite = this.scene.add.image(0, 0, 'ship');
        cardSprite.setDisplaySize(desiredCardSize, desiredCardSize);
        cardContainer.add(cardSprite);

        // カードステータス表示テキスト
        const statsText = this.scene.add.text(
            -this.scene.cellSize / 4, -this.scene.cellSize / 4,
            `HP:${cardData.hp}\nSPD:${cardData.speed}`,
            { fontSize: '12px', fill: '#ffffff' }
        );
        cardContainer.add(statsText);
        cardContainer.setDepth(2);

        // カードオブジェクト生成（状態とUIの両方を管理）
        const card = {
            id: cardData.id,
            owner: cardData.id.startsWith('host') ? 'host' : 'guest',
            hp: cardData.hp,
            speed: cardData.speed,
            col,
            row,
            container: cardContainer,
            sprite: cardSprite,
            statsText
        };
        this.cards[card.id] = card;

        // 自分のカードの場合、入力イベントを登録
        if (card.owner === this.localPlayer) {
            cardContainer.setSize(desiredCardSize, desiredCardSize);
            cardContainer.setInteractive();
            this.scene.input.setDraggable(cardContainer);
            this.setupCardInputEvents(card);
        }
    }

    setupCardInputEvents(card) {
        const container = card.container;

        container.on('pointerdown', (pointer) => {
            if (this.turnActions[this.localPlayer]) return;
            container.startX = pointer.x;
            container.startY = pointer.y;
            container.hasMoved = false;
            this.scene.showMoveIndicators(card);
        });

        container.on('drag', (pointer, dragX, dragY) => {
            if (this.turnActions[this.localPlayer]) return;
            container.hasMoved = true;
            container.x = dragX;
            container.y = dragY;
        });

        container.on('dragend', (pointer) => {
            if (this.turnActions[this.localPlayer]) return;
            this.scene.clearMoveIndicators();
            if (container.hasMoved) {
                const newPos = this.scene.getNearestGridPosition(container.x, container.y);
                const origCenter = this.scene.getCellCenter(card.col, card.row);
                this.scene.tweens.add({
                    targets: container,
                    x: origCenter.x,
                    y: origCenter.y,
                    duration: 200,
                    onComplete: () => {
                        // 移動は縦横のみ許可かつセルが空の場合に登録
                        if (!this.isCellOccupied(newPos.col, newPos.row, card.id) &&
                            (newPos.col !== card.col || newPos.row !== card.row) &&
                            (newPos.col === card.col || newPos.row === card.row)) {
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

        container.on('pointerup', () => {
            if (this.turnActions[this.localPlayer]) return;
            this.scene.clearMoveIndicators();
            if (!container.hasMoved) {
                // クリック時はスキルメニューを表示
                this.scene.showSkillMenu(card);
            }
        });
    }

    /**
     * 指定セルが占有されているかどうかを判定
     */
    isCellOccupied(col, row, movingCardId) {
        return Object.values(this.cards).some(card => {
            return card.id !== movingCardId && card.col === col && card.row === row && card.hp > 0;
        });
    }

    // ---------------------------
    // ターン・アクション処理
    // ---------------------------

    registerLocalAction(action) {
        if (this.turnActions[this.localPlayer]) return;
        this.turnActions[this.localPlayer] = action;
        this.scene.turnStatusText.setText("Waiting for opponent...");
        this.scene.disableLocalCardInput();

        if (!this.isMaster) {
            sendGameMessage(JSON.stringify({ type: 'playerAction', action }));
        } else {
            if (this.turnActions[this.remotePlayer]) {
                this.resolveTurn();
            }
        }
    }

    sendTurnReady() {
        if (this.turnActions[this.localPlayer]) {
            if (this.turnReadyTimer) {
                clearTimeout(this.turnReadyTimer);
                this.turnReadyTimer = null;
            }
            return;
        }
        sendGameMessage(JSON.stringify({ type: 'turnReady', from: this.localPlayer }));
        if (!this.isMaster) {
            if (this.turnReadyTimer) clearTimeout(this.turnReadyTimer);
            this.turnReadyTimer = this.scene.time.delayedCall(3000, () => this.sendTurnReady());
        }
    }

    actualStartTurn() {
        console.log("Turn started");
        this.scene.turnStatusText.setText("Your turn: choose an action");
        this.scene.enableLocalCardInput();
        if (this.turnReadyTimer) {
            clearTimeout(this.turnReadyTimer);
            this.turnReadyTimer = null;
        }
    }

    startTurn() {
        console.log("Starting turn coordination");
        this.turnActions = {};
        this.turnInProgress = true;
        this.turnReadyStates = { host: false, guest: false };
        this.scene.disableLocalCardInput();
        this.scene.turnStatusText.setText("Waiting for opponent to be ready...");
        if (this.isMaster) this.turnReadyStates.host = true;
        this.sendTurnReady();
    }

    resolveTurn() {
        const hostAction = this.turnActions['host'];
        const guestAction = this.turnActions['guest'];
        if (!hostAction || !guestAction) {
            console.log("Waiting for both actions");
            return;
        }

        // 速度の高いカードからアクション実行
        const actions = [hostAction, guestAction].sort((a, b) => {
            const cardA = this.cards[a.cardId];
            const cardB = this.cards[b.cardId];
            return cardB.speed - cardA.speed;
        });

        const tweenConfigs = [];
        const animationCommands = [];

        actions.forEach(action => {
            const card = this.cards[action.cardId];
            if (action.actionType === 'move') {
                const newCenter = this.scene.getCellCenter(action.destination.col, action.destination.row);
                tweenConfigs.push({
                    targets: card.container,
                    x: newCenter.x,
                    y: newCenter.y,
                    duration: 500,
                    onComplete: () => {
                        card.col = action.destination.col;
                        card.row = action.destination.row;
                        // 移動先で罠チェック
                        this.checkForTrap(card);
                    }
                });
                animationCommands.push({
                    type: 'move',
                    cardId: card.id,
                    destination: action.destination,
                    duration: 500
                });
            } else if (action.actionType === 'skill') {
                if (action.skillSubtype === 'atk') {
                    // 攻撃スキル：対象の敵カードを検索
                    const targetGrid = action.destination;
                    const enemyCard = Object.values(this.cards).find(c =>
                        c.owner !== card.owner &&
                        c.col === targetGrid.col &&
                        c.row === targetGrid.row &&
                        c.hp > 0
                    );
                    if (enemyCard) {
                        const sourceCenter = this.scene.getCellCenter(card.col, card.row);
                        const targetCenter = this.scene.getCellCenter(enemyCard.col, enemyCard.row);
                        const bullet = this.scene.add.circle(sourceCenter.x, sourceCenter.y, 5, 0xffff00);
                        tweenConfigs.push({
                            targets: bullet,
                            x: targetCenter.x,
                            y: targetCenter.y,
                            duration: 300,
                            onComplete: () => {
                                bullet.destroy();
                                enemyCard.sprite.setTint(0xff0000);
                                this.scene.time.delayedCall(100, () => {
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
                } else if (action.skillSubtype === 'trap') {
                    // 罠スキル：グリッド上に罠を配置
                    const targetGrid = action.destination;
                    const center = this.scene.getCellCenter(targetGrid.col, targetGrid.row);
                    const trapSprite = this.scene.add.image(center.x, center.y, 'skill');
                    trapSprite.setDisplaySize(this.scene.cellSize, this.scene.cellSize);
                    trapSprite.setDepth(1);
                    this.scene.tweens.add({
                        targets: trapSprite,
                        alpha: { from: 0, to: 1 },
                        duration: 300
                    });
                    this.traps.push({ col: targetGrid.col, row: targetGrid.row, sprite: trapSprite });
                    animationCommands.push({
                        type: 'trap',
                        cardId: card.id,
                        destination: targetGrid,
                        duration: 300
                    });
                }
            }
        });

        this.scene.playTweenSequence(tweenConfigs, () => {
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
            if (!this.gameOver) this.startTurn();
        });
    }

    playTurnAnimation(commands, finalState) {
        const tweenConfigs = [];
        commands.forEach(cmd => {
            if (cmd.type === 'move') {
                const card = this.cards[cmd.cardId];
                if (card) {
                    const newCenter = this.scene.getCellCenter(cmd.destination.col, cmd.destination.row);
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
                    const sourceCenter = this.scene.getCellCenter(sourceCard.col, sourceCard.row);
                    const targetCenter = this.scene.getCellCenter(enemyCard.col, enemyCard.row);
                    const bullet = this.scene.add.circle(sourceCenter.x, sourceCenter.y, 5, 0xffff00);
                    tweenConfigs.push({
                        targets: bullet,
                        x: targetCenter.x,
                        y: targetCenter.y,
                        duration: cmd.bulletDuration,
                        onComplete: () => {
                            bullet.destroy();
                            enemyCard.sprite.setTint(0xff0000);
                            this.scene.time.delayedCall(cmd.flashDuration, () => {
                                enemyCard.sprite.clearTint();
                                enemyCard.hp -= 1;
                                enemyCard.statsText.setText(`HP:${enemyCard.hp}\nSPD:${enemyCard.speed}`);
                            });
                        }
                    });
                }
            } else if (cmd.type === 'trap') {
                const center = this.scene.getCellCenter(cmd.destination.col, cmd.destination.row);
                const trapSprite = this.scene.add.image(center.x, center.y, 'skill');
                trapSprite.setDisplaySize(this.scene.cellSize, this.scene.cellSize);
                trapSprite.setDepth(1);
                this.scene.tweens.add({
                    targets: trapSprite,
                    alpha: { from: 0, to: 1 },
                    duration: cmd.duration
                });
                this.traps.push({ col: cmd.destination.col, row: cmd.destination.row, sprite: trapSprite });
            }
        });
        this.scene.playTweenSequence(tweenConfigs, () => this.updateBoardState(finalState));
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
                const center = this.scene.getCellCenter(card.col, card.row);
                this.scene.tweens.add({
                    targets: card.container,
                    x: center.x,
                    y: center.y,
                    duration: 500
                });
            }
        });
        this.checkGameOver();
        if (!this.gameOver) this.startTurn();
    }

    checkForTrap(card) {
        const trapIndex = this.traps.findIndex(trap => trap.col === card.col && trap.row === card.row);
        if (trapIndex !== -1) {
            const trap = this.traps[trapIndex];
            card.sprite.setTint(0xff0000);
            this.scene.time.delayedCall(100, () => {
                card.sprite.clearTint();
                card.hp -= 1;
                card.statsText.setText(`HP:${card.hp}\nSPD:${card.speed}`);
            });
            trap.sprite.destroy();
            this.traps.splice(trapIndex, 1);
        }
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

    // ---------------------------
    // ゲームメッセージの受信処理
    // ---------------------------

    handleGameMessage(event) {
        const parsed = typeof event.detail === 'string'
            ? JSON.parse(event.detail)
            : event.detail;

        switch (parsed.type) {
            case 'playerAction':
                if (this.isMaster) {
                    this.turnActions[this.remotePlayer] = parsed.action;
                    console.log("Received remote action:", parsed.action);
                    if (this.turnActions[this.localPlayer]) this.resolveTurn();
                }
                break;
            case 'turnResult':
                this.updateBoardState(parsed.state);
                break;
            case 'turnAnimation':
                this.playTurnAnimation(parsed.commands, parsed.finalState);
                break;
            case 'turnReady':
                this.turnReadyStates[parsed.from] = true;
                if (this.isMaster && this.turnReadyStates.host && this.turnReadyStates.guest) {
                    sendGameMessage(JSON.stringify({ type: 'turnStart' }));
                    this.actualStartTurn();
                }
                break;
            case 'turnStart':
                this.actualStartTurn();
                break;
        }
    }
}
