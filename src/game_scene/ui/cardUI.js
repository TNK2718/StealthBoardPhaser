import Phaser from 'phaser';

export class CardUI {
    constructor(scene, gameController) {
        this.scene = scene;
        this.gameController = gameController;
    }

    /**
     * Create UI elements for a card
     * @param {Card} card - The card object
     * @param {string} localPlayer - ID of the local player
     */
    createCardUI(card, localPlayer) {
        try {
            // Validate card object
            if (!card) {
                console.error("Cannot create UI for undefined card");
                return;
            }            // Debug to check if this card should be hidden
            console.log(`Creating UI for card ${card.id}, isHidden=${card.isHidden}, owner=${card.owner}, localPlayer=${localPlayer}`);

            // Check if card already has UI
            if (card.container) {
                console.warn(`Card ${card.id} already has UI container, skipping creation`);

                // Even for existing UI, make sure owner's cards are visible
                if (card.owner === localPlayer || card.id.startsWith(localPlayer)) {
                    card.isHidden = false;
                    if (card.container) {
                        card.container.setVisible(true);
                    }
                }

                // Just update position to be safe
                this.updateCardPosition(card);
                return;
            }

            // Triple check - ensure owner cards are never hidden
            // Using multiple checks for robustness:
            // 1. Direct owner comparison
            // 2. Card ID prefix check
            // 3. Global context check
            if (card.owner === localPlayer ||
                card.id.startsWith(localPlayer) ||
                (window.gameContext && card.owner === window.gameContext.localPlayer)) {
                if (card.isHidden) {
                    console.log(`Forcing visibility for owner's card ${card.id}`);
                    card.isHidden = false;
                }
            }

            // Handle hidden cards (stealth mode) differently
            if (card.isHidden) {
                this.createHiddenCardUI(card);
                return;
            }

            // Validate card position before proceeding
            this.validateCardPosition(card);

            // Get cell center position
            let center = this.scene.getCellCenter(card.col, card.row);

            // Verify we got valid coordinates
            if (!center || isNaN(center.x) || isNaN(center.y)) {
                console.error(`Failed to get valid cell center for card ${card.id} at position (${card.col}, ${card.row})`);
                // Use fallback coordinates
                center = {
                    x: this.scene.cameras.main.centerX,
                    y: this.scene.cameras.main.centerY
                };
            }

            // Create container for card elements
            const cardContainer = this.scene.add.container(center.x, center.y);

            // Log card position for debugging
            console.log(`Creating UI for card ${card.id} at position (${card.col}, ${card.row}) with coordinates (${center.x}, ${center.y})`);

            // カードのサイズはセルサイズの80%
            const desiredCardSize = this.scene.cellSize * 0.8;

            // カードの背景（赤色の背景）
            const cardBg = this.scene.add.graphics();
            cardBg.fillStyle(0x8B0000, 1); // 濃い赤色
            cardBg.fillRect(-desiredCardSize / 2, -desiredCardSize / 2, desiredCardSize, desiredCardSize);
            cardBg.lineStyle(2, 0xFFD700); // 金色の枠線
            cardBg.strokeRect(-desiredCardSize / 2, -desiredCardSize / 2, desiredCardSize, desiredCardSize);
            cardContainer.add(cardBg);

            // キャラクターイメージ
            const cardSprite = this.scene.add.image(0, 0, 'ship');
            cardSprite.setDisplaySize(desiredCardSize * 0.8, desiredCardSize * 0.8);
            cardContainer.add(cardSprite);

            // 左上のステータス表示（HPとか）
            const topLeftValue = this.scene.add.graphics();
            topLeftValue.fillStyle(0x006400, 1); // 濃い緑色
            topLeftValue.fillCircle(-desiredCardSize / 2 + desiredCardSize / 6, -desiredCardSize / 2 + desiredCardSize / 6, desiredCardSize / 8);
            cardContainer.add(topLeftValue);

            const topLeftText = this.scene.add.text(
                -desiredCardSize / 2 + desiredCardSize / 6,
                -desiredCardSize / 2 + desiredCardSize / 6,
                `${card.hp}`,
                {
                    fontSize: '16px',
                    fontStyle: 'bold',
                    fill: '#ffffff',
                    stroke: '#000000',
                    strokeThickness: 1.5,
                    align: 'center'
                }
            );
            topLeftText.setOrigin(0.5);
            cardContainer.add(topLeftText);

            // 右下のステータス表示（攻撃力/移動力）
            const bottomRightValue = this.scene.add.graphics();
            bottomRightValue.fillStyle(0x8B0000, 1); // 濃い赤色
            bottomRightValue.fillCircle(desiredCardSize / 2 - desiredCardSize / 6, desiredCardSize / 2 - desiredCardSize / 6, desiredCardSize / 8);
            cardContainer.add(bottomRightValue);

            const bottomRightText = this.scene.add.text(
                desiredCardSize / 2 - desiredCardSize / 6,
                desiredCardSize / 2 - desiredCardSize / 6,
                `${card.speed}`,
                {
                    fontSize: '16px',
                    fontStyle: 'bold',
                    fill: '#ffffff',
                    stroke: '#000000',
                    strokeThickness: 1.5,
                    align: 'center'
                }
            );
            bottomRightText.setOrigin(0.5);
            cardContainer.add(bottomRightText);

            // ステルス値は別の場所に表示
            const stealthValue = this.scene.add.graphics();
            stealthValue.fillStyle(0x4682B4, 1); // スチールブルー
            stealthValue.fillCircle(-desiredCardSize / 2 + desiredCardSize / 6, desiredCardSize / 2 - desiredCardSize / 6, desiredCardSize / 8);
            cardContainer.add(stealthValue);

            const stealthText = this.scene.add.text(
                -desiredCardSize / 2 + desiredCardSize / 6,
                desiredCardSize / 2 - desiredCardSize / 6,
                `${card.stealth}`,
                {
                    fontSize: '16px',
                    fontStyle: 'bold',
                    fill: '#ffffff',
                    stroke: '#000000',
                    strokeThickness: 1.5,
                    align: 'center'
                }
            );
            stealthText.setOrigin(0.5);
            cardContainer.add(stealthText);
            cardContainer.setDepth(2);

            // UIオブジェクトをカードに紐づける
            card.container = cardContainer;
            card.sprite = cardSprite;
            card.hpText = topLeftText;
            card.speedText = bottomRightText;
            card.stealthText = stealthText;

            // 自分のカードの場合、入力イベントを登録
            if (card.owner === localPlayer) {
                cardContainer.setSize(desiredCardSize, desiredCardSize);
                cardContainer.setInteractive();
                this.scene.input.setDraggable(cardContainer);
                this.setupCardInputEvents(card);
            }
        } catch (error) {
            console.error(`Error creating UI for card ${card?.id || 'unknown'}:`, error);
        }
    }

    /**
     * Create a special UI for hidden enemy cards (stealth mode)
     * @param {Card} card - The hidden card to create UI for
     */
    createHiddenCardUI(card) {
        try {
            // Validate card position before proceeding
            this.validateCardPosition(card);

            // Get cell center position
            const center = this.scene.getCellCenter(card.col, card.row);

            // Create container for card elements
            const cardContainer = this.scene.add.container(center.x, center.y);

            // Log card position for debugging
            console.log(`Creating hidden UI for card ${card.id} at position (${card.col}, ${card.row})`);

            // カードのサイズはセルサイズの80%
            const desiredCardSize = this.scene.cellSize * 0.8;

            // ステルスカードの背景（青色の背景）
            const cardBg = this.scene.add.graphics();
            cardBg.fillStyle(0x000066, 1); // 濃い青色
            cardBg.fillRect(-desiredCardSize / 2, -desiredCardSize / 2, desiredCardSize, desiredCardSize);
            cardBg.lineStyle(2, 0x4682B4); // スチールブルーの枠線
            cardBg.strokeRect(-desiredCardSize / 2, -desiredCardSize / 2, desiredCardSize, desiredCardSize);
            cardContainer.add(cardBg);

            // ステルスカードのアイコン
            const questionMark = this.scene.add.text(
                0, 0,
                "?",
                {
                    fontSize: '32px',
                    fontStyle: 'bold',
                    fill: '#ffffff',
                    align: 'center'
                }
            );
            questionMark.setOrigin(0.5);
            cardContainer.add(questionMark);

            // ステルステキスト
            const stealthText = this.scene.add.text(
                0, desiredCardSize / 4,
                "Stealth",
                {
                    fontSize: '12px',
                    fill: '#cccccc',
                    align: 'center'
                }
            );
            stealthText.setOrigin(0.5);
            cardContainer.add(stealthText);

            // Set container depth
            cardContainer.setDepth(2);

            // UIオブジェクトをカードに紐づける
            card.container = cardContainer;
            card.sprite = questionMark;
            card.stealthText = stealthText;

            // Hidden cards don't need input events
            cardContainer.disableInteractive();
        } catch (error) {
            console.error(`Error creating hidden UI for card ${card?.id || 'unknown'}:`, error);
        }
    }

    /**
     * Setup input events for cards
     * @param {Card} card - The card to setup events for
     */
    setupCardInputEvents(card) {
        const container = card.container;
        if (!container) return;

        container.on('pointerdown', (pointer) => {
            // Only allow interaction if we haven't already submitted an action
            if (this.gameController.isActionRegistered()) return;

            console.log(`Card ${card.id} selected`);

            // Show move indicators if this card hasn't moved yet
            if (!container.hasMoved && this.scene.showMoveIndicators) {
                this.scene.showMoveIndicators(card);
            }
        });

        container.on('drag', (pointer, dragX, dragY) => {
            // Only allow dragging if we haven't already submitted an action
            if (this.gameController.isActionRegistered()) return;

            // Move the container with the pointer
            container.x = dragX;
            container.y = dragY;
        });

        container.on('dragend', (pointer) => {
            // Only allow interaction if we haven't already submitted an action
            if (this.gameController.isActionRegistered()) return;

            // Get nearest grid position
            const gridPosition = this.scene.getNearestGridPosition(container.x, container.y);

            // Check if position is valid (not occupied by another card)
            const isValidMove = !this.gameController.isCellOccupied(
                gridPosition.col,
                gridPosition.row,
                card.id
            );

            if (isValidMove && (gridPosition.col !== card.col || gridPosition.row !== card.row)) {
                // Position changed and is valid - register move action
                console.log(`Card ${card.id} moved to (${gridPosition.col}, ${gridPosition.row})`);

                // Register the move action with the game controller
                const action = {
                    actionType: 'move',
                    cardId: card.id,
                    source: { col: card.col, row: card.row },
                    destination: gridPosition
                };

                this.gameController.registerLocalAction(action);

                // Mark as moved to prevent additional moves
                container.hasMoved = true;
            } else {
                // Invalid move or no change - snap back to original position
                this.updateCardPosition(card);
            }

            // Clear any move indicators
            if (this.scene.clearMoveIndicators) {
                this.scene.clearMoveIndicators();
            }
        });

        container.on('pointerup', () => {
            // Clear any move indicators if the user just clicks without dragging
            if (this.scene.clearMoveIndicators) {
                this.scene.clearMoveIndicators();
            }
        });
    }

    /**
     * Update card stats display
     * @param {Card} card - The card to update
     */
    updateCardStats(card) {
        if (!card) return;

        // Update UI elements if they exist
        if (card.container) {
            if (card.hpText) card.hpText.setText(`${card.hp}`);
            if (card.speedText) card.speedText.setText(`${card.speed}`);
            if (card.stealthText) card.stealthText.setText(`${card.stealth}`);

            // Optional: Highlight cards with low HP
            if (card.hp <= 1 && card.sprite) {
                card.sprite.setTint(0xff0000);
            } else if (card.sprite) {
                card.sprite.clearTint();
            }
        }
    }

    /**
     * Update card position on the board
     * @param {Card} card - The card to update
     * @param {number} animationDuration - Duration of move animation in ms (0 for instant)
     */
    updateCardPosition(card, animationDuration = 500) {
        if (!card) {
            console.warn("Attempted to update position of null/undefined card");
            return;
        }

        if (!card.container) {
            console.warn(`Card ${card.id} has no container, can't update position`);
            return;
        }

        // Validate and fix card position if needed
        this.validateCardPosition(card);

        try {
            // Calculate new position
            const cellCenter = this.scene.getCellCenter(card.col, card.row);

            if (!cellCenter || isNaN(cellCenter.x) || isNaN(cellCenter.y)) {
                console.error(`Invalid cell center for card ${card.id} at (${card.col}, ${card.row})`);
                return;
            }

            // Move immediately or animate
            if (animationDuration <= 0) {
                card.container.x = cellCenter.x;
                card.container.y = cellCenter.y;
            } else {
                this.scene.tweens.add({
                    targets: card.container,
                    x: cellCenter.x,
                    y: cellCenter.y,
                    duration: animationDuration,
                    ease: 'Power2'
                });
            }
        } catch (error) {
            console.error(`Error updating card ${card.id} position:`, error);
        }
    }

    /**
     * Validate a card's position and fix if needed
     * @param {Card} card - Card to validate
     */
    validateCardPosition(card) {
        if (!card) return;

        // Check for valid positions
        if (card.col === undefined || card.row === undefined ||
            isNaN(Number(card.col)) || isNaN(Number(card.row))) {

            console.error(`Invalid position for card ${card.id}: (${card.col}, ${card.row})`);

            // Set default position based on card ID
            const defaultRow = card.owner === 'host' ? 6 : 0;
            const defaultCol = card.id.includes('_1') ? 1 : (card.id.includes('_2') ? 2 : 0);

            card.col = defaultCol;
            card.row = defaultRow;

            console.log(`Reset card ${card.id} to position (${card.col}, ${card.row})`);
        } else {
            // Ensure position is within board boundaries (0-2 columns, 0-6 rows)
            const oldCol = card.col;
            const oldRow = card.row;

            card.col = Math.max(0, Math.min(Math.floor(Number(card.col)), 2));
            card.row = Math.max(0, Math.min(Math.floor(Number(card.row)), 6));

            // Log if we needed to fix the position
            if (card.col !== oldCol || card.row !== oldRow) {
                console.warn(`Fixed position of card ${card.id} from (${oldCol}, ${oldRow}) to (${card.col}, ${card.row})`);
            }
        }
    }

    /**
     * Play attack animation between two cards
     * @param {Card} sourceCard - The attacking card
     * @param {Card} targetCard - The target card
     * @param {number} bulletDuration - Duration of bullet animation in ms
     * @param {number} flashDuration - Duration of flash effect in ms
     */
    playAttackAnimation(sourceCard, targetCard, bulletDuration = 300, flashDuration = 100) {
        if (!sourceCard?.container || !targetCard?.container) {
            console.warn("Cannot play attack animation: missing container for source or target card");
            return;
        }

        // Get cell centers
        const sourceCenter = this.scene.getCellCenter(sourceCard.col, sourceCard.row);
        const targetCenter = this.scene.getCellCenter(targetCard.col, targetCard.row);

        if (!sourceCenter || !targetCenter) {
            console.error("Could not get valid cell centers for attack animation");
            return;
        }

        // Create bullet
        const bullet = this.scene.add.circle(sourceCenter.x, sourceCenter.y, 5, 0xffff00);
        bullet.setDepth(3);

        // Animate bullet
        this.scene.tweens.add({
            targets: bullet,
            x: targetCenter.x,
            y: targetCenter.y,
            duration: bulletDuration,
            onComplete: () => {
                // Bullet hit effect
                bullet.destroy();

                // Flash the target card
                if (targetCard.sprite) {
                    targetCard.sprite.setTint(0xff0000);

                    // Remove tint after flash duration
                    this.scene.time.delayedCall(flashDuration, () => {
                        if (targetCard.sprite) {
                            // Reset tint unless HP is critical
                            if (targetCard.hp > 1) {
                                targetCard.sprite.clearTint();
                            }
                        }
                    });
                }
            }
        });
    }

    /**
     * Play trap placement animation
     * @param {Card} card - The card placing the trap
     * @param {Object} destination - The trap position {col, row}
     * @param {number} duration - Animation duration in ms
     * @returns {Phaser.GameObjects.Image} - The trap sprite
     */
    playTrapAnimation(card, destination, duration = 300) {
        const center = this.scene.getCellCenter(destination.col, destination.row);
        if (!center) return null;

        const trapSprite = this.scene.add.image(center.x, center.y, 'skill');
        trapSprite.setDisplaySize(this.scene.cellSize, this.scene.cellSize);
        trapSprite.setDepth(1);
        trapSprite.setAlpha(0);

        // Fade in the trap sprite
        this.scene.tweens.add({
            targets: trapSprite,
            alpha: 1,
            duration: duration,
            ease: 'Power2'
        });

        return trapSprite;
    }

    /**
     * Play trap triggered animation
     * @param {Card} card - The card that triggered the trap
     */
    playTrapTriggeredAnimation(card) {
        if (!card || !card.sprite) return;

        // Flash red
        card.sprite.setTint(0xff0000);

        // Clear tint after short delay
        this.scene.time.delayedCall(150, () => {
            if (card.sprite) {
                card.sprite.clearTint();
            }
        });

        // Add explosion effect if we have one
        const center = this.scene.getCellCenter(card.col, card.row);
        if (center) {
            const explosion = this.scene.add.graphics();
            explosion.fillStyle(0xff0000, 0.7);
            explosion.fillCircle(0, 0, this.scene.cellSize * 0.6);
            explosion.x = center.x;
            explosion.y = center.y;
            explosion.setDepth(3);

            // Animate and destroy
            this.scene.tweens.add({
                targets: explosion,
                alpha: 0,
                scale: 1.5,
                duration: 300,
                onComplete: () => explosion.destroy()
            });
        }
    }

    /**
     * Play a blocked move animation
     * Shows the card attempting to move but then returning to its original position
     */
    playBlockedMoveAnimation(card, attemptedDestination, duration = 300) {
        if (!card || !card.container) {
            console.warn("Cannot play blocked move animation: missing card or container");
            return;
        }

        // Validate attempted destination
        if (!attemptedDestination ||
            attemptedDestination.col === undefined ||
            attemptedDestination.row === undefined) {
            console.error("Invalid destination for blocked move animation");
            return;
        }

        // Ensure we have valid card positions
        this.validateCardPosition(card);

        // Get the cell positions
        let currentPos = this.scene.getCellCenter(card.col, card.row);
        let attemptedPos = this.scene.getCellCenter(attemptedDestination.col, attemptedDestination.row);

        // Fallback if positions are invalid
        if (!currentPos || isNaN(currentPos.x) || isNaN(currentPos.y)) {
            currentPos = { x: card.container.x, y: card.container.y };
        }

        if (!attemptedPos || isNaN(attemptedPos.x) || isNaN(attemptedPos.y)) {
            console.error("Invalid attempted position, canceling animation");
            return;
        }

        // Two-part animation: first move toward target, then back to original position
        const halfDuration = Math.floor(duration / 2);

        // Move toward destination
        this.scene.tweens.add({
            targets: card.container,
            x: attemptedPos.x,
            y: attemptedPos.y,
            duration: halfDuration,
            ease: 'Power1',
            onComplete: () => {
                // Show blocked effect
                const blockIndicator = this.scene.add.text(
                    attemptedPos.x,
                    attemptedPos.y,
                    "🚫",
                    { fontSize: '32px' }
                ).setOrigin(0.5);
                blockIndicator.setDepth(5);

                // Return to original position
                this.scene.tweens.add({
                    targets: card.container,
                    x: currentPos.x,
                    y: currentPos.y,
                    duration: halfDuration,
                    ease: 'Bounce',
                    delay: 100,
                    onComplete: () => {
                        // Fade out and remove block indicator
                        this.scene.tweens.add({
                            targets: blockIndicator,
                            alpha: 0,
                            duration: 300,
                            onComplete: () => blockIndicator.destroy()
                        });
                    }
                });
            }
        });
    }
}