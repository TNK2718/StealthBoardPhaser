import { sendGameMessage } from '../webrtc';

export class GameLogic {
    constructor() {
        // ゲーム状態の初期化
        this.cards = {};
        this.turnActions = {};
        this.turnInProgress = false;
        this.gameOver = false;
        this.turnReadyStates = { host: false, guest: false };
        this.traps = [];
    }

    // ---------------------------
    // カード初期化・管理
    // ---------------------------

    initializeCards(localPlayer, remotePlayer) {
        this.localPlayer = localPlayer;
        this.remotePlayer = remotePlayer;

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

        const cards = [];

        // ゲスト側：上段（row = 0）
        guestStats.forEach((cardStat, index) => {
            cards.push(this.createCardData(cardStat, guestColumns[index], 0));
        });

        // ホスト側：下段（row = rows-1）
        hostStats.forEach((cardStat, index) => {
            cards.push(this.createCardData(cardStat, hostColumns[index], 6)); // rows-1 = 6
        });

        return cards;
    }

    createCardData(cardData, col, row) {
        // カードのデータモデルのみを作成
        const card = {
            id: cardData.id,
            owner: cardData.id.startsWith('host') ? 'host' : 'guest',
            hp: cardData.hp,
            speed: cardData.speed,
            col,
            row,
            stealth: 3 // 初期隠密値
        };
        this.cards[card.id] = card;
        return card;
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

    registerAction(player, action) {
        if (this.turnActions[player]) return false;
        this.turnActions[player] = action;
        return true;
    }

    setTurnReadyState(player, isReady) {
        this.turnReadyStates[player] = isReady;
        return this.turnReadyStates.host && this.turnReadyStates.guest;
    }

    resetTurn() {
        this.turnActions = {};
        this.turnInProgress = true;
        this.turnReadyStates = { host: false, guest: false };
    }

    getCardById(cardId) {
        return this.cards[cardId];
    }

    processActionPair() {
        const hostAction = this.turnActions['host'];
        const guestAction = this.turnActions['guest'];
        if (!hostAction || !guestAction) {
            return null;
        }

        // 速度の高いカードからアクション実行
        const actions = [hostAction, guestAction].sort((a, b) => {
            const cardA = this.cards[a.cardId];
            const cardB = this.cards[b.cardId];
            return cardB.speed - cardA.speed;
        });

        const animationCommands = [];
        const updatedCards = {};

        actions.forEach(action => {
            const card = this.cards[action.cardId];
            if (action.actionType === 'move') {
                // 移動アクション
                card.col = action.destination.col;
                card.row = action.destination.row;

                // 移動コマンドを記録
                animationCommands.push({
                    type: 'move',
                    cardId: card.id,
                    destination: action.destination,
                    duration: 500
                });

                // 移動先で罠チェック
                this.checkForTrap(card, animationCommands);

            } else if (action.actionType === 'skill') {
                if (action.skillSubtype === 'atk') {
                    // 攻撃スキル
                    const targetGrid = action.destination;
                    const enemyCard = Object.values(this.cards).find(c =>
                        c.owner !== card.owner &&
                        c.col === targetGrid.col &&
                        c.row === targetGrid.row &&
                        c.hp > 0
                    );

                    if (enemyCard) {
                        // ダメージと隠密値低下を適用
                        enemyCard.hp -= 1;
                        enemyCard.stealth -= 1;

                        // 攻撃アニメーションコマンドを記録
                        animationCommands.push({
                            type: 'skill',
                            sourceCardId: card.id,
                            targetCardId: enemyCard.id,
                            bulletDuration: 300,
                            flashDuration: 100
                        });
                    }
                } else if (action.skillSubtype === 'trap') {
                    // 罠スキル
                    const targetGrid = action.destination;
                    this.traps.push({ col: targetGrid.col, row: targetGrid.row });

                    // 罠設置アニメーションコマンドを記録
                    animationCommands.push({
                        type: 'trap',
                        cardId: card.id,
                        destination: targetGrid,
                        duration: 300
                    });
                }
            }

            // 更新されたカード情報を記録
            updatedCards[card.id] = { ...card };
        });

        // ターン終了時、隠密チェック
        this.updateStealthProximity();

        // 各カードの最終状態を記録
        const finalState = {};
        Object.values(this.cards).forEach(card => {
            finalState[card.id] = {
                col: card.col,
                row: card.row,
                hp: card.hp,
                stealth: card.stealth
            };
        });

        // ゲーム終了チェック
        const gameOver = this.checkGameOver();

        return {
            animationCommands,
            finalState,
            gameOver
        };
    }

    checkForTrap(card, animationCommands) {
        const trapIndex = this.traps.findIndex(trap => trap.col === card.col && trap.row === card.row);
        if (trapIndex !== -1) {
            // 罠効果の適用
            card.hp -= 1;
            card.stealth -= 1;

            // 罠発動アニメーションコマンドを追加（必要に応じて）
            animationCommands.push({
                type: 'trapTriggered',
                cardId: card.id,
                position: { col: card.col, row: card.row }
            });

            // 罠を除去
            this.traps.splice(trapIndex, 1);
        }
    }

    /**
     * 敵カードの正面の近くにいる場合、対象カードの隠密値を低下させる
     */
    updateStealthProximity() {
        Object.values(this.cards).forEach(card => {
            // 敵側カードを調べる
            const enemyOwner = card.owner === 'host' ? 'guest' : 'host';
            Object.values(this.cards).forEach(enemy => {
                if (enemy.owner === enemyOwner) {
                    // 敵カードの正面セルを計算
                    const frontRow = enemy.owner === 'host' ? enemy.row - 1 : enemy.row + 1;
                    if (card.col === enemy.col && card.row === frontRow) {
                        // 複数の敵が正面にいれば複数回低下する可能性あり
                        card.stealth -= 1;
                    }
                }
            });
        });
    }

    /**
     * 相手カードが可視か判定（隠密値が0以下で可視）
     */
    isCardVisible(cardId, viewer) {
        const card = this.cards[cardId];
        if (!card) return false;

        // 自分のカードは常に表示
        if (card.owner === viewer) return true;

        // 隠密値が0以下なら表示
        return card.stealth <= 0;
    }

    updateBoardState(state) {
        Object.keys(state).forEach(cardId => {
            const card = this.cards[cardId];
            if (card) {
                const cardState = state[cardId];
                card.col = cardState.col;
                card.row = cardState.row;
                card.hp = cardState.hp;
                card.stealth = cardState.stealth;
            }
        });
    }

    checkGameOver() {
        const hostAlive = Object.values(this.cards).filter(card => card.owner === 'host' && card.hp > 0);
        const guestAlive = Object.values(this.cards).filter(card => card.owner === 'guest' && card.hp > 0);

        if (hostAlive.length === 0 || guestAlive.length === 0) {
            this.gameOver = true;
            return hostAlive.length > 0 ? 'host' : 'guest';
        }

        return null; // ゲーム続行
    }
}
