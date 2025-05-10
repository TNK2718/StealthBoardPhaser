export class CardUI {
    constructor(scene, gameController) {
        this.scene = scene;
        this.gameController = gameController;
    }

    /**
     * カードのUI要素を作成
     */
    createCardUI(card, localPlayer) {
        const center = this.scene.getCellCenter(card.col, card.row);
        const cardContainer = this.scene.add.container(center.x, center.y);

        // カードのサイズはセルサイズの80%
        const desiredCardSize = this.scene.cellSize * 0.8;
        const cardSprite = this.scene.add.image(0, 0, 'ship');
        cardSprite.setDisplaySize(desiredCardSize, desiredCardSize);
        cardContainer.add(cardSprite);

        // カードステータス表示テキスト
        const statsText = this.scene.add.text(
            -this.scene.cellSize / 4, -this.scene.cellSize / 4,
            `HP:${card.hp}\nSPD:${card.speed}\nST:${card.stealth}`,
            { fontSize: '12px', fill: '#ffffff' }
        );
        cardContainer.add(statsText);
        cardContainer.setDepth(2);

        // UIオブジェクトをカードに紐づける
        card.container = cardContainer;
        card.sprite = cardSprite;
        card.statsText = statsText;

        // 自分のカードの場合、入力イベントを登録
        if (card.owner === localPlayer) {
            cardContainer.setSize(desiredCardSize, desiredCardSize);
            cardContainer.setInteractive();
            this.scene.input.setDraggable(cardContainer);
            this.setupCardInputEvents(card);
        }
    }

    /**
     * カード入力イベントのセットアップ
     */
    setupCardInputEvents(card) {
        const container = card.container;

        container.on('pointerdown', (pointer) => {
            if (this.gameController.isActionRegistered()) return;
            container.startX = pointer.x;
            container.startY = pointer.y;
            container.hasMoved = false;
            this.scene.showMoveIndicators(card);
        });

        container.on('drag', (pointer, dragX, dragY) => {
            if (this.gameController.isActionRegistered()) return;
            container.hasMoved = true;
            container.x = dragX;
            container.y = dragY;
        });

        container.on('dragend', (pointer) => {
            if (this.gameController.isActionRegistered()) return;
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
                        if (!this.gameController.isCellOccupied(newPos.col, newPos.row, card.id) &&
                            (newPos.col !== card.col || newPos.row !== card.row) &&
                            (newPos.col === card.col || newPos.row === card.row)) {
                            this.gameController.registerLocalAction({
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
            if (this.gameController.isActionRegistered()) return;
            this.scene.clearMoveIndicators();
            if (!container.hasMoved) {
                // クリック時はスキルメニューを表示
                this.scene.showSkillMenu(card);
            }
        });
    }

    /**
     * カードステータスの表示を更新
     */
    updateCardStats(card) {
        if (card && card.statsText) {
            card.statsText.setText(`HP:${card.hp}\nSPD:${card.speed}\nST:${card.stealth}`);
        }
    }

    /**
     * 指定カードの位置を更新する
     */
    updateCardPosition(card, animationDuration = 500) {
        if (card && card.container) {
            const center = this.scene.getCellCenter(card.col, card.row);
            this.scene.tweens.add({
                targets: card.container,
                x: center.x,
                y: center.y,
                duration: animationDuration
            });
        }
    }

    /**
     * カードの攻撃アニメーションを実行
     */
    playAttackAnimation(sourceCard, targetCard, bulletDuration, flashDuration) {
        if (!sourceCard.container || !targetCard.container) return;

        const sourceCenter = this.scene.getCellCenter(sourceCard.col, sourceCard.row);
        const targetCenter = this.scene.getCellCenter(targetCard.col, targetCard.row);
        const bullet = this.scene.add.circle(sourceCenter.x, sourceCenter.y, 5, 0xffff00);

        this.scene.tweens.add({
            targets: bullet,
            x: targetCenter.x,
            y: targetCenter.y,
            duration: bulletDuration,
            onComplete: () => {
                bullet.destroy();
                targetCard.sprite.setTint(0xff0000);
                this.scene.time.delayedCall(flashDuration, () => {
                    targetCard.sprite.clearTint();
                    this.updateCardStats(targetCard);
                });
            }
        });
    }

    /**
     * 罠設置アニメーションを実行
     */
    playTrapAnimation(card, destination, duration) {
        const center = this.scene.getCellCenter(destination.col, destination.row);
        const trapSprite = this.scene.add.image(center.x, center.y, 'skill');
        trapSprite.setDisplaySize(this.scene.cellSize, this.scene.cellSize);
        trapSprite.setDepth(1);

        this.scene.tweens.add({
            targets: trapSprite,
            alpha: { from: 0, to: 1 },
            duration: duration
        });

        return trapSprite;
    }

    /**
     * 罠発動アニメーションを実行
     */
    playTrapTriggeredAnimation(card) {
        if (!card || !card.sprite) return;

        card.sprite.setTint(0xff0000);
        this.scene.time.delayedCall(100, () => {
            card.sprite.clearTint();
            this.updateCardStats(card);
        });
    }
}