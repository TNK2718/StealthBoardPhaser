import { sendGameMessage } from '../webrtc';
import { GameLogic } from './gameLogic';

export class GameController {
    constructor(scene, { isMaster, localPlayer, remotePlayer }) {
        this.scene = scene;
        this.isMaster = isMaster;
        this.localPlayer = localPlayer;
        this.remotePlayer = remotePlayer;

        // モデル（ゲームロジック）の初期化
        this.gameLogic = new GameLogic();

        // WebRTCからのメッセージハンドラの登録
        this.setupMessageHandler();

        // タイマー管理用
        this.turnReadyTimer = null;
    }

    // ---------------------------
    // 初期化・セットアップ
    // ---------------------------

    createCards() {
        // ゲームロジックからカードデータを取得
        const cards = this.gameLogic.initializeCards(this.localPlayer, this.remotePlayer);

        // 各カードのUI要素を作成
        cards.forEach(cardData => {
            this.createCardUI(cardData);
        });

        // 初期表示更新
        this.updateCardVisibility();
    }

    createCardUI(cardData) {
        const center = this.scene.getCellCenter(cardData.col, cardData.row);
        const cardContainer = this.scene.add.container(center.x, center.y);

        // カードのサイズはセルサイズの80%
        const desiredCardSize = this.scene.cellSize * 0.8;
        const cardSprite = this.scene.add.image(0, 0, 'ship');
        cardSprite.setDisplaySize(desiredCardSize, desiredCardSize);
        cardContainer.add(cardSprite);

        // カードステータス表示テキスト
        const statsText = this.scene.add.text(
            -this.scene.cellSize / 4, -this.scene.cellSize / 4,
            `HP:${cardData.hp}\nSPD:${cardData.speed}\nST:${cardData.stealth}`,
            { fontSize: '12px', fill: '#ffffff' }
        );
        cardContainer.add(statsText);
        cardContainer.setDepth(2);

        // UIオブジェクトをゲームカードに紐づける
        const card = this.gameLogic.getCardById(cardData.id);
        card.container = cardContainer;
        card.sprite = cardSprite;
        card.statsText = statsText;

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
            if (this.gameLogic.turnActions[this.localPlayer]) return;
            container.startX = pointer.x;
            container.startY = pointer.y;
            container.hasMoved = false;
            this.scene.showMoveIndicators(card);
        });

        container.on('drag', (pointer, dragX, dragY) => {
            if (this.gameLogic.turnActions[this.localPlayer]) return;
            container.hasMoved = true;
            container.x = dragX;
            container.y = dragY;
        });

        container.on('dragend', (pointer) => {
            if (this.gameLogic.turnActions[this.localPlayer]) return;
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
                        if (!this.gameLogic.isCellOccupied(newPos.col, newPos.row, card.id) &&
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
            if (this.gameLogic.turnActions[this.localPlayer]) return;
            this.scene.clearMoveIndicators();
            if (!container.hasMoved) {
                // クリック時はスキルメニューを表示
                this.scene.showSkillMenu(card);
            }
        });
    }

    /**
     * ウェブソケットメッセージハンドラ
     */
    setupMessageHandler() {
        this.handleGameMessage = (event) => {
            const parsed = typeof event.detail === 'string'
                ? JSON.parse(event.detail)
                : event.detail;

            switch (parsed.type) {
                case 'playerAction':
                    if (this.isMaster) {
                        const actionRegistered = this.gameLogic.registerAction(this.remotePlayer, parsed.action);
                        if (actionRegistered) {
                            console.log("Received remote action:", parsed.action);
                            if (this.gameLogic.turnActions[this.localPlayer]) this.resolveTurn();
                        }
                    }
                    break;
                case 'turnResult':
                    this.updateBoardState(parsed.state);
                    break;
                case 'turnAnimation':
                    this.playTurnAnimation(parsed.commands, parsed.finalState);
                    break;
                case 'turnReady':
                    const allReady = this.gameLogic.setTurnReadyState(parsed.from, true);
                    if (this.isMaster && allReady) {
                        sendGameMessage(JSON.stringify({ type: 'turnStart' }));
                        this.actualStartTurn();
                    }
                    break;
                case 'turnStart':
                    this.actualStartTurn();
                    break;
            }
        };
    }

    // ---------------------------
    // ターン管理
    // ---------------------------

    startTurn() {
        console.log("Starting turn coordination");
        this.gameLogic.resetTurn();
        this.scene.disableLocalCardInput();
        this.scene.turnStatusText.setText("Waiting for opponent to be ready...");

        if (this.isMaster) this.gameLogic.setTurnReadyState('host', true);
        this.sendTurnReady();
    }

    sendTurnReady() {
        if (this.gameLogic.turnActions[this.localPlayer]) {
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

    registerLocalAction(action) {
        const actionRegistered = this.gameLogic.registerAction(this.localPlayer, action);
        if (!actionRegistered) return;

        this.scene.turnStatusText.setText("Waiting for opponent...");
        this.scene.disableLocalCardInput();

        if (!this.isMaster) {
            sendGameMessage(JSON.stringify({ type: 'playerAction', action }));
        } else {
            if (this.gameLogic.turnActions[this.remotePlayer]) {
                this.resolveTurn();
            }
        }
    }

    resolveTurn() {
        const result = this.gameLogic.processActionPair();
        if (!result) {
            console.log("Waiting for both actions");
            return;
        }

        const { animationCommands, finalState, gameOver } = result;

        // アニメーション処理
        const tweenConfigs = this.createTweenConfigsFromCommands(animationCommands);

        this.scene.playTweenSequence(tweenConfigs, () => {
            // リモートプレイヤーにアニメーション＆最終状態を送信
            sendGameMessage(JSON.stringify({
                type: 'turnAnimation',
                commands: animationCommands,
                finalState
            }));

            // カード表示状態の更新
            this.updateCardVisibility();
            this.updateAllCardStats();

            // ゲーム終了チェック
            if (gameOver) {
                this.handleGameOver(gameOver);
            } else {
                this.startTurn();
            }
        });
    }

    // ---------------------------
    // アニメーション処理
    // ---------------------------

    createTweenConfigsFromCommands(commands) {
        const tweenConfigs = [];

        commands.forEach(cmd => {
            if (cmd.type === 'move') {
                const card = this.gameLogic.getCardById(cmd.cardId);
                if (card && card.container) {
                    const newCenter = this.scene.getCellCenter(cmd.destination.col, cmd.destination.row);
                    tweenConfigs.push({
                        targets: card.container,
                        x: newCenter.x,
                        y: newCenter.y,
                        duration: cmd.duration,
                        onComplete: () => {
                            // 移動先で罠チェックが必要な場合はここで
                        }
                    });
                }
            } else if (cmd.type === 'skill') {
                const sourceCard = this.gameLogic.getCardById(cmd.sourceCardId);
                const enemyCard = this.gameLogic.getCardById(cmd.targetCardId);

                if (sourceCard && sourceCard.container && enemyCard && enemyCard.container) {
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
                                this.updateCardStats(enemyCard);
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

                // 罠のスプライトを記録
                this.gameLogic.traps.forEach(trap => {
                    if (trap.col === cmd.destination.col && trap.row === cmd.destination.row) {
                        trap.sprite = trapSprite;
                    }
                });
            } else if (cmd.type === 'trapTriggered') {
                const card = this.gameLogic.getCardById(cmd.cardId);
                if (card && card.sprite) {
                    card.sprite.setTint(0xff0000);
                    this.scene.time.delayedCall(100, () => {
                        card.sprite.clearTint();
                        this.updateCardStats(card);
                    });
                }
            }
        });

        return tweenConfigs;
    }

    playTurnAnimation(commands, finalState) {
        const tweenConfigs = this.createTweenConfigsFromCommands(commands);

        this.scene.playTweenSequence(tweenConfigs, () => {
            this.updateBoardState(finalState);
        });
    }

    // ---------------------------
    // UI更新
    // ---------------------------

    updateBoardState(state) {
        // モデルの状態を更新
        this.gameLogic.updateBoardState(state);

        // UIの位置とステータスを更新
        Object.keys(state).forEach(cardId => {
            const card = this.gameLogic.getCardById(cardId);
            if (card && card.container) {
                const cardState = state[cardId];
                const center = this.scene.getCellCenter(cardState.col, cardState.row);

                this.scene.tweens.add({
                    targets: card.container,
                    x: center.x,
                    y: center.y,
                    duration: 500
                });

                this.updateCardStats(card);
            }
        });

        // カード可視状態の更新
        this.updateCardVisibility();

        // ゲーム終了チェック
        const winner = this.gameLogic.checkGameOver();
        if (winner) {
            this.handleGameOver(winner);
        } else {
            this.startTurn();
        }
    }

    updateCardStats(card) {
        if (card && card.statsText) {
            card.statsText.setText(`HP:${card.hp}\nSPD:${card.speed}\nST:${card.stealth}`);
        }
    }

    updateAllCardStats() {
        Object.values(this.gameLogic.cards).forEach(card => {
            this.updateCardStats(card);
        });
    }

    updateCardVisibility() {
        Object.values(this.gameLogic.cards).forEach(card => {
            if (card.container) {
                const isVisible = this.gameLogic.isCardVisible(card.id, this.localPlayer);
                card.container.setVisible(isVisible);
            }
        });
    }

    handleGameOver(winner) {
        const winnerText = winner === 'host' ? 'Host' : 'Guest';
        alert(`Game Over! Winner: ${winnerText}`);
    }

    /**
     * リソース解放
     */
    cleanup() {
        if (this.turnReadyTimer) {
            clearTimeout(this.turnReadyTimer);
            this.turnReadyTimer = null;
        }
    }
}
