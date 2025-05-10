import { sendGameMessage } from '../webrtc';
import { GameLogic } from './gameLogic';
import { CardUI } from './ui/cardUI';

export class GameController {
    constructor(scene, { isMaster, localPlayer, remotePlayer }) {
        this.scene = scene;
        this.isMaster = isMaster;
        this.localPlayer = localPlayer;
        this.remotePlayer = remotePlayer;

        // モデル（ゲームロジック）の初期化
        this.gameLogic = new GameLogic();

        // カードUI管理クラスの初期化
        this.cardUI = new CardUI(scene, this);

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
            this.cardUI.createCardUI(cardData, this.localPlayer);
        });

        // 初期表示更新
        this.updateCardVisibility();
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

    // アクションが既に登録されているか確認するヘルパー関数
    isActionRegistered() {
        return !!this.gameLogic.turnActions[this.localPlayer];
    }

    // セルが占有されているか確認する関数をゲームロジックに委譲
    isCellOccupied(col, row, cardId) {
        return this.gameLogic.isCellOccupied(col, row, cardId);
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
                    // 攻撃アニメーションをCardUIに委譲
                    this.cardUI.playAttackAnimation(
                        sourceCard,
                        enemyCard,
                        cmd.bulletDuration,
                        cmd.flashDuration
                    );
                    // tweenConfigsにはpushしない（CardUI内で完結）
                }
            } else if (cmd.type === 'trap') {
                const card = this.gameLogic.getCardById(cmd.cardId);
                if (card) {
                    // 罠設置アニメーションをCardUIに委譲
                    const trapSprite = this.cardUI.playTrapAnimation(
                        card,
                        cmd.destination,
                        cmd.duration
                    );

                    // 罠のスプライトを記録
                    this.gameLogic.traps.forEach(trap => {
                        if (trap.col === cmd.destination.col && trap.row === cmd.destination.row) {
                            trap.sprite = trapSprite;
                        }
                    });
                }
            } else if (cmd.type === 'trapTriggered') {
                const card = this.gameLogic.getCardById(cmd.cardId);
                if (card) {
                    // 罠起動アニメーションをCardUIに委譲
                    this.cardUI.playTrapTriggeredAnimation(card);
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
                // カード位置更新をCardUIに委譲
                this.cardUI.updateCardPosition(card);
                // カードステータス更新をCardUIに委譲
                this.cardUI.updateCardStats(card);
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
        this.cardUI.updateCardStats(card);
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
