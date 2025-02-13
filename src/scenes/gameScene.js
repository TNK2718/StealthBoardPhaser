// scene/gameScene.js
import Phaser from 'phaser';
import { sendGameMessage } from '../webrtc';

export class GameScene extends Phaser.Scene {
    constructor() {
        super('GameScene');
        // インジケーターおよび罠の初期化
        this.moveIndicators = [];
        this.skillIndicators = [];
        this.traps = [];
    }

    /**
     * シーンの初期化
     * @param {Object} data - ゲーム開始時のデータ
     */
    init(data) {
        this.isMaster = data.isMaster;
        this.localPlayer = this.isMaster ? 'host' : 'guest';
        this.remotePlayer = this.isMaster ? 'guest' : 'host';

        // カード情報およびターン管理の初期化
        this.cards = {};
        this.turnActions = {};
        this.turnInProgress = false;
        this.gameOver = false;
        this.turnReadyStates = { host: false, guest: false };
        this.turnReadyTimer = null;

        // スキルメニュー用スプライト・テキスト配列
        this.skillMenuSprites = [];
        this.skillMenuTexts = [];
    }

    preload() {
        // アセット読み込み
        this.load.image('tile', 'assets/bg.png');
        this.load.image('ship', 'assets/CyanCardBack.png');
        this.load.image('skill', 'assets/skill.jpg');
    }

    create() {
        // 初期設定：グリッド作成、カード配置
        this.setupGrid();
        this.createCards();

        // ターン状態表示テキスト（画面下部中央）
        this.turnStatusText = this.add.text(
            this.cameras.main.centerX,
            this.cameras.main.height - 40,
            "Waiting for turn start...",
            { fontSize: '20px', fill: '#ffffff' }
        ).setOrigin(0.5);

        // ゲームメッセージ受信用イベント登録
        window.addEventListener('gameMessage', this.handleGameMessage.bind(this));

        // ターン開始処理の呼び出し
        this.startTurn();
    }

    // ====================================================
    // グリッド設定関連のヘルパー関数
    // ====================================================

    /**
     * グリッド設定
     * グリッドは縦7行×横3列、各セルは60px
     */
    setupGrid() {
        this.cols = 3;
        this.rows = 7;
        this.cellSize = 60;
        this.gridOrigin = {
            x: (this.cameras.main.width - this.cols * this.cellSize) / 2,
            y: 50
        };

        // グリッド背景を配置
        for (let r = 0; r < this.rows; r++) {
            for (let c = 0; c < this.cols; c++) {
                const center = this.getCellCenter(c, r);
                const tile = this.add.image(center.x, center.y, 'tile');
                tile.setDisplaySize(this.cellSize, this.cellSize);
                tile.setDepth(0); // 背景レイヤー
            }
        }
    }

    /**
     * 指定セルの中心座標を取得
     * @param {number} col - 列番号
     * @param {number} row - 行番号
     * @returns {Object} 中心座標 { x, y }
     */
    getCellCenter(col, row) {
        return {
            x: this.gridOrigin.x + col * this.cellSize + this.cellSize / 2,
            y: this.gridOrigin.y + row * this.cellSize + this.cellSize / 2
        };
    }

    /**
     * ドラッグ終了時などに最も近いグリッドセルを返す
     * @param {number} x - x座標
     * @param {number} y - y座標
     * @returns {Object} セル位置 { col, row }
     */
    getNearestGridPosition(x, y) {
        let col = Math.floor((x - this.gridOrigin.x) / this.cellSize);
        let row = Math.floor((y - this.gridOrigin.y) / this.cellSize);
        col = Phaser.Math.Clamp(col, 0, this.cols - 1);
        row = Phaser.Math.Clamp(row, 0, this.rows - 1);
        return { col, row };
    }

    /**
     * 指定セルがすでに占有されているか判定
     * @param {number} col - 列番号
     * @param {number} row - 行番号
     * @param {string} movingCardId - 動かそうとしているカードのID
     * @returns {boolean}
     */
    isCellOccupied(col, row, movingCardId) {
        return Object.values(this.cards).some(card => {
            return card.id !== movingCardId && card.col === col && card.row === row && card.hp > 0;
        });
    }

    // ====================================================
    // カード生成・管理関連
    // ====================================================

    /**
     * カードを初期配置する（ホストは下段、ゲストは上段）
     */
    createCards() {
        // カラム配置
        const guestColumns = [0, 1, 2];
        const hostColumns = [0, 1, 2];

        // 各カードの初期ステータス
        const guestStats = [
            { id: 'guest_0', hp: 3, speed: 3 },
            { id: 'guest_1', hp: 3, speed: 2 },
            { id: 'guest_2', hp: 3, speed: 1 }
        ];
        const hostStats = [
            { id: 'host_0', hp: 3, speed: 4 },
            { id: 'host_1', hp: 3, speed: 3 },
            { id: 'host_2', hp: 3, speed: 2 }
        ];

        // ゲスト側カード配置（上段：row = 0）
        guestStats.forEach((cardStat, index) => {
            this.createCard(cardStat, guestColumns[index], 0);
        });

        // ホスト側カード配置（下段：row = rows-1）
        hostStats.forEach((cardStat, index) => {
            this.createCard(cardStat, hostColumns[index], this.rows - 1);
        });
    }

    /**
     * 単一カードの作成と入力処理の登録
     * @param {Object} cardData - カード情報（id, hp, speed）
     * @param {number} col - グリッド上の列位置
     * @param {number} row - グリッド上の行位置
     */
    createCard(cardData, col, row) {
        const center = this.getCellCenter(col, row);
        const cardContainer = this.add.container(center.x, center.y);

        // カードサイズ（セルサイズの80%）
        const desiredCardSize = this.cellSize * 0.8;
        const cardSprite = this.add.image(0, 0, 'ship');
        cardSprite.setDisplaySize(desiredCardSize, desiredCardSize);
        cardContainer.add(cardSprite);

        // ステータス表示テキスト
        const statsText = this.add.text(
            -this.cellSize / 4, -this.cellSize / 4,
            `HP:${cardData.hp}\nSPD:${cardData.speed}`,
            { fontSize: '12px', fill: '#ffffff' }
        );
        cardContainer.add(statsText);
        cardContainer.setDepth(2);

        // カードオブジェクト生成
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

        // 自分のカードの場合、入力イベントを有効化
        if (card.owner === this.localPlayer) {
            cardContainer.setSize(desiredCardSize, desiredCardSize);
            cardContainer.setInteractive();
            this.input.setDraggable(cardContainer);
            this.setupCardInputEvents(card);
        }
    }

    /**
     * カードに対するドラッグ／クリックなどの入力イベントを登録
     * @param {Object} card - カードオブジェクト
     */
    setupCardInputEvents(card) {
        const container = card.container;

        container.on('pointerdown', (pointer) => {
            if (this.turnActions[this.localPlayer]) return;
            container.startX = pointer.x;
            container.startY = pointer.y;
            container.hasMoved = false;
            this.showMoveIndicators(card);
        });

        container.on('drag', (pointer, dragX, dragY) => {
            if (this.turnActions[this.localPlayer]) return;
            container.hasMoved = true;
            container.x = dragX;
            container.y = dragY;
        });

        container.on('dragend', (pointer) => {
            if (this.turnActions[this.localPlayer]) return;
            this.clearMoveIndicators();
            if (container.hasMoved) {
                const newPos = this.getNearestGridPosition(container.x, container.y);
                const origCenter = this.getCellCenter(card.col, card.row);
                this.tweens.add({
                    targets: container,
                    x: origCenter.x,
                    y: origCenter.y,
                    duration: 200,
                    onComplete: () => {
                        // 縦横移動のみ許可（斜めは不可）かつ目的セルが空いている場合に移動登録
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
            this.clearMoveIndicators();
            if (!container.hasMoved) {
                // カードクリック時はスキルメニューを表示
                this.showSkillMenu(card);
            }
        });
    }

    // ====================================================
    // インジケーター表示関連
    // ====================================================

    /**
     * 移動可能セル（同じ行・列で空いているセル）を青色でハイライト
     * @param {Object} card - 対象のカード
     */
    showMoveIndicators(card) {
        this.clearMoveIndicators();
        const indicators = [];

        // 同じ行の空セル
        for (let col = 0; col < this.cols; col++) {
            if (col !== card.col && !this.isCellOccupied(col, card.row, card.id)) {
                const center = this.getCellCenter(col, card.row);
                indicators.push(this.add.rectangle(center.x, center.y, this.cellSize, this.cellSize, 0x0000ff, 0.3));
            }
        }
        // 同じ列の空セル
        for (let row = 0; row < this.rows; row++) {
            if (row !== card.row && !this.isCellOccupied(card.col, row, card.id)) {
                const center = this.getCellCenter(card.col, row);
                indicators.push(this.add.rectangle(center.x, center.y, this.cellSize, this.cellSize, 0x0000ff, 0.3));
            }
        }
        this.moveIndicators = indicators;
    }

    /**
     * すべての移動インジケーターを除去
     */
    clearMoveIndicators() {
        this.moveIndicators.forEach(indicator => indicator.destroy());
        this.moveIndicators = [];
    }

    /**
     * スキル使用可能範囲（マンハッタン距離2以内）を赤色でハイライト
     * @param {Object} card - 対象のカード
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
     * すべてのスキルインジケーターを除去
     */
    clearSkillIndicators() {
        this.skillIndicators.forEach(indicator => indicator.destroy());
        this.skillIndicators = [];
    }

    // ====================================================
    // スキルメニュー関連
    // ====================================================

    /**
     * 攻撃と罠のスキルメニューを表示する
     * @param {Object} card - スキル使用元のカード
     */
    showSkillMenu(card) {
        this.clearSkillMenu();
        this.clearMoveIndicators();
        this.showSkillIndicators(card);

        const desiredSize = (this.cellSize * 0.8) * 0.5; // カードサイズの50%
        // 攻撃スキル（右上に配置）
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

        // 罠スキル（左上に配置）
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

        // スキルメニューのオブジェクトを保持
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
            // グリッド外の場合はキャンセル
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
                    this.registerLocalAction({
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
     * スキルメニューのオブジェクトをすべて削除
     */
    clearSkillMenu() {
        this.skillMenuSprites.forEach(sprite => sprite.destroy());
        this.skillMenuSprites = [];
        this.skillMenuTexts.forEach(text => text.destroy());
        this.skillMenuTexts = [];
    }

    // ====================================================
    // ターン・アクション処理
    // ====================================================

    /**
     * ローカル側のカードアクションを登録し、メッセージ送信する
     * @param {Object} action - アクション情報
     */
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

    /**
     * ターン準備状態を相手に通知する
     */
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
            this.turnReadyTimer = this.time.delayedCall(3000, () => this.sendTurnReady());
        }
    }

    /**
     * ターン開始（操作可能状態）に切り替える
     */
    actualStartTurn() {
        console.log("Turn started");
        this.turnStatusText.setText("Your turn: choose an action");
        this.enableLocalCardInput();
        if (this.turnReadyTimer) {
            clearTimeout(this.turnReadyTimer);
            this.turnReadyTimer = null;
        }
    }

    /**
     * ターンの開始調整
     */
    startTurn() {
        console.log("Starting turn coordination");
        this.turnActions = {};
        this.turnInProgress = true;
        this.turnReadyStates = { host: false, guest: false };
        this.disableLocalCardInput();
        this.turnStatusText.setText("Waiting for opponent to be ready...");
        if (this.isMaster) this.turnReadyStates.host = true;
        this.sendTurnReady();
    }

    /**
     * ターン内アクションのアニメーション実行後に状態を更新・再ターン開始する
     */
    resolveTurn() {
        const hostAction = this.turnActions['host'];
        const guestAction = this.turnActions['guest'];
        if (!hostAction || !guestAction) {
            console.log("Waiting for both actions");
            return;
        }

        // 速度順でアクション実行（速いカード優先）
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
                const newCenter = this.getCellCenter(action.destination.col, action.destination.row);
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
                        const sourceCenter = this.getCellCenter(card.col, card.row);
                        const targetCenter = this.getCellCenter(enemyCard.col, enemyCard.row);
                        const bullet = this.add.circle(sourceCenter.x, sourceCenter.y, 5, 0xffff00);
                        tweenConfigs.push({
                            targets: bullet,
                            x: targetCenter.x,
                            y: targetCenter.y,
                            duration: 300,
                            onComplete: () => {
                                bullet.destroy();
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
                } else if (action.skillSubtype === 'trap') {
                    // 罠スキル：グリッドに罠を配置
                    const targetGrid = action.destination;
                    const center = this.getCellCenter(targetGrid.col, targetGrid.row);
                    const trapSprite = this.add.image(center.x, center.y, 'skill');
                    trapSprite.setDisplaySize(this.cellSize, this.cellSize);
                    trapSprite.setDepth(1);
                    this.tweens.add({
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

        // アニメーション実行後、状態更新と相手への通知
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
            if (!this.gameOver) this.startTurn();
        });
    }

    /**
     * 連続アニメーションを順次実行する
     * @param {Array} tweenConfigs - アニメーション設定の配列
     * @param {Function} onComplete - 完了時のコールバック
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
     * 指定カードが罠セルに到達した場合の処理
     * @param {Object} card - カードオブジェクト
     */
    checkForTrap(card) {
        const trapIndex = this.traps.findIndex(trap => trap.col === card.col && trap.row === card.row);
        if (trapIndex !== -1) {
            const trap = this.traps[trapIndex];
            card.sprite.setTint(0xff0000);
            this.time.delayedCall(100, () => {
                card.sprite.clearTint();
                card.hp -= 1;
                card.statsText.setText(`HP:${card.hp}\nSPD:${card.speed}`);
            });
            trap.sprite.destroy();
            this.traps.splice(trapIndex, 1);
        }
    }

    // ====================================================
    // ゲームメッセージ受信・再現処理
    // ====================================================

    /**
     * ゲスト側：受信したターンアニメーションを再現する
     * @param {Array} commands - アニメーションコマンド配列
     * @param {Object} finalState - ターン後の最終状態
     */
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
                    const bullet = this.add.circle(sourceCenter.x, sourceCenter.y, 5, 0xffff00);
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
            } else if (cmd.type === 'trap') {
                const center = this.getCellCenter(cmd.destination.col, cmd.destination.row);
                const trapSprite = this.add.image(center.x, center.y, 'skill');
                trapSprite.setDisplaySize(this.cellSize, this.cellSize);
                trapSprite.setDepth(1);
                this.tweens.add({
                    targets: trapSprite,
                    alpha: { from: 0, to: 1 },
                    duration: cmd.duration
                });
                this.traps.push({ col: cmd.destination.col, row: cmd.destination.row, sprite: trapSprite });
            }
        });
        this.playTweenSequence(tweenConfigs, () => this.updateBoardState(finalState));
    }

    /**
     * ボード状態を更新し、必要ならゲーム終了処理または新ターン開始
     * @param {Object} state - カードの最終状態
     */
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
        if (!this.gameOver) this.startTurn();
    }

    /**
     * ゲームオーバーチェック：どちらかのプレイヤーのカードが全滅した場合
     */
    checkGameOver() {
        const hostAlive = Object.values(this.cards).filter(card => card.owner === 'host' && card.hp > 0);
        const guestAlive = Object.values(this.cards).filter(card => card.owner === 'guest' && card.hp > 0);
        if (hostAlive.length === 0 || guestAlive.length === 0) {
            this.gameOver = true;
            const winner = hostAlive.length > 0 ? 'Host' : 'Guest';
            alert(`Game Over! Winner: ${winner}`);
        }
    }

    /**
     * ローカルカードの入力を無効化
     */
    disableLocalCardInput() {
        Object.values(this.cards).forEach(card => {
            if (card.owner === this.localPlayer) {
                card.container.disableInteractive();
            }
        });
    }

    /**
     * ローカルカードの入力を有効化
     */
    enableLocalCardInput() {
        Object.values(this.cards).forEach(card => {
            if (card.owner === this.localPlayer) {
                card.container.setInteractive();
            }
        });
    }

    // ====================================================
    // ゲームメッセージの受信処理
    // ====================================================

    /**
     * ゲームメッセージ受信時の処理
     * @param {Event} event - イベントオブジェクト
     */
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

    // ====================================================
    // Phaserライフサイクル
    // ====================================================

    update() {
        // ゲームループ内の更新処理（必要に応じて実装）
    }

    shutdown() {
        window.removeEventListener('gameMessage', this.handleGameMessage.bind(this));
    }
}
