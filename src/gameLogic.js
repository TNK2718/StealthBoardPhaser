// not in use now
import { sendGameMessage } from './webrtc';

export class GameLogic {
    constructor() {
        // 各プレイヤーの入力を保持するためのオブジェクト
        this.pendingMoves = {};
        // ゲームの全体状態：各カードの状態（位置、HP、速度、所属プレイヤーなど）
        this.gameState = { cards: {} };
        // UI 更新通知用コールバック（gameScene から設定）
        this.updateCallback = null;
    }

    setUpdateCallback(callback) {
        this.updateCallback = callback;
    }

    /**
     * ホスト側で初期状態を設定する。
     * @param {Array<object>} cards - 各カードの初期状態（cardId, player, col, row, hp, speed）
     */
    initializeState(cards) {
        cards.forEach(card => {
            this.gameState.cards[card.cardId] = card;
        });
        console.log("Initialized game state:", this.gameState);
    }

    /**
     * ホスト側でプレイヤーの入力（moveData）を受信する
     * @param {string} playerId "player1"（ホスト）または "player2"（ゲスト）
     * @param {object} moveData 送信された入力データ
     * @returns {object|null} 両プレイヤーの入力が揃った場合、ターン結果オブジェクトを返す
     */
    receiveMove(playerId, moveData) {
        this.pendingMoves[playerId] = moveData;
        console.log(`Received move from ${playerId}:`, moveData);

        if (this.isTurnReady()) {
            return this.processTurn();
        }
        return null;
    }

    isTurnReady() {
        return this.pendingMoves["player1"] && this.pendingMoves["player2"];
    }

    /**
     * 両プレイヤーの入力を処理し、カードの状態（位置・HP など）を更新する
     * @returns {object} ターン結果オブジェクト（更新後のゲーム状態と各アクション結果）
     */
    processTurn() {
        // 両プレイヤーの入力を配列にまとめ、カードの speed で降順にソート
        let moves = [this.pendingMoves["player1"], this.pendingMoves["player2"]];
        moves.sort((a, b) => b.card.speed - a.card.speed);

        let actionResults = [];
        moves.forEach(move => {
            const cardId = move.cardId;
            let cardState = this.gameState.cards[cardId];
            if (!cardState) {
                // もし初期化されていなければ、moveData の情報で新規作成（通常は初期化済み）
                cardState = {
                    cardId: cardId,
                    player: move.player,
                    col: move.target ? move.target.col : null,
                    row: move.target ? move.target.row : null,
                    hp: 100,
                    speed: move.card.speed
                };
                this.gameState.cards[cardId] = cardState;
            }
            if (move.actionType === "move") {
                // 移動の場合、位置を更新
                cardState.col = move.target.col;
                cardState.row = move.target.row;
                actionResults.push({
                    player: move.player,
                    actionType: "move",
                    cardId: cardId,
                    target: move.target,
                    speed: move.card.speed
                });
            } else if (move.actionType === "skill") {
                // スキルの場合、例として HP を 10 減少させる
                cardState.hp -= 10;
                actionResults.push({
                    player: move.player,
                    actionType: "skill",
                    cardId: cardId,
                    newHp: cardState.hp,
                    speed: move.card.speed
                });
            }
        });

        // ターン処理後は入力待ち状態をリセット
        this.pendingMoves = {};
        console.log("Processed turn results:", actionResults);
        // turnResult には、処理結果と更新後のゲーム状態を含める
        return { type: "turnResult", results: actionResults, updatedState: this.gameState };
    }

    /**
     * プレイヤーの行動を処理する
     * @param {string} playerId "player1"（ホスト）または "player2"（ゲスト）
     * @param {object} moveData 送信された入力データ
     */
    processPlayerMove(playerId, moveData) {
        if (playerId === "player1") { // ホストの場合
            const turnResult = this.receiveMove(playerId, moveData);
            if (turnResult) {
                // ホストはターン結果をデータチャンネル経由で送信
                sendGameMessage(turnResult);
                if (this.updateCallback) this.updateCallback(turnResult);
            }
        } else { // ゲストの場合
            // ゲストは行動情報をホストに送信
            sendGameMessage(moveData);
        }
    }

    /**
     * 通信経由で受信したメッセージを処理する
     * @param {object} message 受信メッセージ
     * @param {boolean} isMaster ゲームシーンから渡される isMaster フラグ
     */
    handleIncomingMessage(message, isMaster) {
        if (message.type === "turnResult") {
            // 更新後の状態を内部に反映
            this.gameState = message.updatedState;
            if (this.updateCallback) this.updateCallback(message);
        } else if (message.type === "playerMove" && isMaster) {
            // ホスト側はゲストからの行動を受け取りターン処理を実施
            const turnResult = this.receiveMove("player2", message);
            if (turnResult) {
                sendGameMessage(turnResult);
                if (this.updateCallback) this.updateCallback(turnResult);
            }
        }
    }
}
