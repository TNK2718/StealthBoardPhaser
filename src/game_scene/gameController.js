import firebaseService from '../firebase/firebaseService';
import { GameLogic } from './gameLogic';
import { CardUI } from './ui/cardUI';

export class GameController {
    constructor(scene, { gameId, playerRole, localPlayer, remotePlayer }) {
        this.scene = scene;
        this.gameId = gameId;
        this.playerRole = playerRole;
        this.localPlayer = localPlayer;
        this.remotePlayer = remotePlayer;
        this.initialized = false;
        this.currentAction = null;
        this.currentTurnNumber = 1; // Start at turn 1

        // Flag to prevent duplicate card creation
        this.cardsCreated = false;

        // Initialize game logic
        this.gameLogic = new GameLogic();

        // Initialize card UI manager
        this.cardUI = new CardUI(scene, this);

        // Setup Firebase listeners
        this.setupFirebaseListeners();
    }

    // ---------------------------
    // Initialization & Setup
    // ---------------------------

    /**
     * Setup Firebase game state listeners
     */
    setupFirebaseListeners() {
        // Game state change listener
        firebaseService.onGameStateChanged((gameData) => {
            if (!gameData) return;

            console.log("Game state updated:", gameData);

            // Initialize game state on first update
            if (!this.initialized && gameData.state) {
                this.initializeFromFirebase(gameData);
                this.initialized = true;
            } else {
                // Update existing game state
                this.updateGameFromFirebase(gameData);
            }
        });

        // Start listening to the game data
        firebaseService.startListeningToGame(this.gameId);
    }

    /**
     * Initialize from Firebase game state
     */
    initializeFromFirebase(gameData) {
        if (!gameData) {
            console.error("Game data is null or undefined");
            return;
        }

        if (!gameData.state) {
            console.warn("Game state is missing, using default initialization");
            // We'll create default cards in createCards method
            return;
        }

        console.log("Initializing from Firebase state:", gameData.state);

        // Initialize card data from Firebase state if cards haven't been created yet
        if (!this.cardsCreated) {
            this.createCardsFromFirebase(gameData.state);
        } else {
            // If cards already exist, just update them
            this.updateBoardState(gameData.state);
        }

        // Update turn status
        this.updateTurnStatus(gameData);
    }

    /**
     * Create cards from Firebase game state
     * @param {Object} gameState - Game state from Firebase
     * @returns {Array} - Array of created cards
     */
    createCardsFromFirebase(gameState) {
        try {
            console.log("Creating cards from Firebase state:", gameState);

            // If cards are already created, just update them
            if (this.cardsCreated) {
                console.log("Cards already created, updating state instead");
                this.updateBoardState(gameState);
                return [];
            }

            // Create a normalized state with required structure
            let normalizedState = gameState;

            // Check if we need to convert from old format to new format
            if (gameState && !gameState.cards) {
                // Convert legacy format to new format
                normalizedState = { cards: {} };

                Object.keys(gameState).forEach(key => {
                    // Skip non-card properties
                    if (key === 'traps' || key === 'gameOver' || key === 'turn') return;

                    // Add to cards collection
                    normalizedState.cards[key] = gameState[key];
                });

                // Copy other state properties
                if (gameState.traps) normalizedState.traps = gameState.traps;
                if (gameState.gameOver !== undefined) normalizedState.gameOver = gameState.gameOver;
            }

            // Verify scene and grid is initialized before creating cards
            if (!this.scene || !this.scene.gridOrigin || !this.scene.gridInitialized) {
                console.warn("Game scene or grid not fully initialized, delaying card creation");
                // Schedule card creation for next frame when scene should be ready
                this.scene.time.delayedCall(200, () => {
                    this.createCardsFromFirebase(gameState);
                });
                return [];
            }

            // Initialize cards from normalized state
            const cards = this.gameLogic.initializeCards(
                this.localPlayer,
                this.remotePlayer,
                normalizedState
            );

            console.log(`Created ${cards.length} cards from Firebase state`);

            // Fix any host cards that might be incorrectly marked as hidden
            cards.forEach(card => {
                if (card.owner === this.localPlayer) {
                    card.isHidden = false;
                }
            });

            // Create UI elements for each card
            cards.forEach(card => {
                try {
                    // Create UI for card - use the fixed isHidden value
                    if (card.isHidden && card.owner !== this.localPlayer) {
                        this.cardUI.createHiddenCardUI(card);
                    } else {
                        this.cardUI.createCardUI(card, this.localPlayer);
                    }
                } catch (uiError) {
                    console.error(`Failed to create UI for card ${card.id}:`, uiError);
                }
            });

            // Update initial visibility
            this.updateCardVisibility();

            // Mark cards as created
            this.cardsCreated = true;

            return cards;
        } catch (error) {
            console.error("Error creating cards from Firebase:", error);
            return [];
        }
    }

    /**
     * Update game from Firebase state changes
     * サーバーからの状態更新に基づいてゲームを更新
     */
    updateGameFromFirebase(gameData) {
        if (!gameData.state) return;

        console.log("Received game update from Firebase:", gameData);

        // Handle turn transition from server
        const previousTurn = this.currentTurnNumber;
        this.currentTurnNumber = gameData.turnNumber || 1;

        // Check if this is a new turn notification from server
        const isNewTurn = previousTurn !== undefined && this.currentTurnNumber > previousTurn;

        // Update traps and card states
        this.updateBoardState(gameData.state);

        // Play animations if needed
        if (gameData.lastAction && gameData.lastAction.commands) {
            console.log("Playing turn animation from server commands");
            this.playTurnAnimation(gameData.lastAction.commands, gameData.state);
        }

        // Handle explicit turn start notification from server
        if (gameData.turnState === 'new' || isNewTurn) {
            console.log(`Server initiating new turn: ${this.currentTurnNumber}`);
            this.currentAction = null; // Reset current action
            this.scene.enableLocalCardInput(); // Allow input for new turn
        }

        // Update turn status UI
        this.updateTurnStatus(gameData);

        // Check for game over
        if (gameData.finished) {
            this.handleGameOver(gameData);
        }
    }

    /**
     * Update turn status UI based on server game state
     * @param {Object} gameData - Game data from Firebase
     */
    updateTurnStatus(gameData) {
        if (!this.scene.turnStatusText) return;

        const currentTurnActions = gameData.currentTurnActions || {};
        const turnState = gameData.turnState || 'waiting'; // サーバーからのターン状態
        const myRole = this.playerRole; // 'player1' or 'player2'
        const opponentRole = this.playerRole === 'player1' ? 'player2' : 'player1';

        const myActionSubmitted = !!currentTurnActions[myRole];
        const opponentActionSubmitted = !!currentTurnActions[opponentRole];

        // Update the current turn number from server
        this.currentTurnNumber = gameData.turnNumber || this.currentTurnNumber || 1;
        const turnNumber = this.currentTurnNumber;

        // Game over state check from server and client as backup
        if (gameData.finished || this.gameLogic.gameOver) {
            // ゲーム終了状態 - サーバーから勝者情報を取得
            const winner = gameData.winner || (gameData.state && gameData.state.gameOver);
            const isWinner = (winner === 'player1' && this.playerRole === 'player1') ||
                (winner === 'player2' && this.playerRole === 'player2');

            this.scene.turnStatusText.setText(isWinner ? "You Win!" : "You Lose!");
            this.scene.turnStatusText.setStyle({ fontSize: '32px', fill: '#ff0000' });
            this.scene.disableLocalCardInput();
            return;
        }

        // Handle various turn states from server
        switch (turnState) {
            case 'waiting_for_animations':
                // アニメーション待機状態
                this.scene.turnStatusText.setText(`Turn ${turnNumber}: Waiting for animations...`);
                this.scene.turnStatusText.setStyle({ fill: '#cccccc' });
                this.scene.disableLocalCardInput();
                break;

            case 'processing':
                // サーバー処理中
                this.scene.turnStatusText.setText(`Turn ${turnNumber}: Server processing turn...`);
                this.scene.turnStatusText.setStyle({ fill: '#cccccc' });
                this.scene.disableLocalCardInput();
                break;

            case 'new':
                // 新しいターンが始まった
                if (this.currentAction || myActionSubmitted) {
                    // 既に行動を提出済み（通常はないはず）
                    this.scene.turnStatusText.setText(`Turn ${turnNumber}: Action already submitted`);
                    this.scene.turnStatusText.setStyle({ fill: '#ffff00' });
                    this.scene.disableLocalCardInput();
                } else {
                    // 新ターン - 行動を選択可能
                    this.scene.turnStatusText.setText(`Turn ${turnNumber}: Select a card to make your move`);
                    this.scene.turnStatusText.setStyle({ fill: '#00ff00' });
                    this.scene.enableLocalCardInput();
                }
                break;

            default:
                // デフォルト - 通常のターン進行
                if (this.currentAction || myActionSubmitted) {
                    // プレイヤーがアクションを提出済みで相手の行動を待機中
                    const statusText = `Turn ${turnNumber}: Action registered, waiting for opponent...`;
                    this.scene.turnStatusText.setText(statusText);
                    this.scene.turnStatusText.setStyle({ fill: '#ffff00' });
                    this.scene.disableLocalCardInput();
                } else {
                    // プレイヤーがアクションを選択可能
                    const statusText = `Turn ${turnNumber}: Select a card to make your move`;
                    this.scene.turnStatusText.setText(statusText);
                    this.scene.turnStatusText.setStyle({ fill: '#00ff00' });
                    this.scene.enableLocalCardInput();
                }
        }

        // デバッグ情報
        console.log(`Turn status: ${turnNumber}, state: ${turnState}, myAction: ${myActionSubmitted}, opponentAction: ${opponentActionSubmitted}`);
    }

    /**
     * Submit player action to Firebase
     */
    async submitAction(action) {
        // Store action locally
        this.currentAction = action;

        try {
            // Format move data for Firebase
            const moveData = {
                action: action.actionType,
                cardId: action.cardId,
                ...action
            };

            // Disable input during processing
            this.scene.disableLocalCardInput();

            // Show waiting UI
            if (this.scene.turnStatusText) {
                this.scene.turnStatusText.setText("Action registered, waiting for opponent...");
                this.scene.turnStatusText.setStyle({ fill: '#ffff00' });
            }

            // Submit to Firebase
            const result = await firebaseService.submitPlayerMove(moveData);
            console.log("Move submitted:", result);

            if (result.turnCompleted) {
                // Both players submitted actions and turn is processed
                console.log("Turn completed with result:", result);

                // Reset the action for next turn
                this.currentAction = null;

                // If turn was processed immediately, we may get animation commands directly
                if (result.commands && result.commands.length > 0) {
                    console.log("Processing immediate turn animation");
                    this.playTurnAnimation(result.commands, result.finalState);
                } else {
                    console.log("Waiting for turn results via Firebase listener");
                    // Game state updates will come through Firebase listeners
                }
            } else {
                console.log("Waiting for opponent's move");
                // Keep current action registered until opponent submits and 
                // server processes both actions simultaneously
            }

            return true;
        } catch (error) {
            console.error("Failed to submit move:", error);
            this.currentAction = null;

            // Re-enable input in case of error
            this.scene.enableLocalCardInput();

            if (this.scene.turnStatusText) {
                this.scene.turnStatusText.setText("Error submitting move. Try again.");
                this.scene.turnStatusText.setStyle({ fill: '#ff0000' });
            }

            return false;
        }
    }

    /**
     * Check if action is registered
     */
    isActionRegistered() {
        return !!this.currentAction;
    }

    /**
     * Handle game over state
     */
    handleGameOver(gameData) {
        const winner = gameData.winner;
        let message = "Game Over!";

        if ((winner === 'player1' && this.playerRole === 'player1') ||
            (winner === 'player2' && this.playerRole === 'player2')) {
            message += " You Win!";
        } else {
            message += " You Lose!";
        }

        if (this.scene.turnStatusText) {
            this.scene.turnStatusText.setText(message);
            this.scene.turnStatusText.setStyle({ fontSize: '32px', fill: '#ff0000' });
        }

        this.scene.disableLocalCardInput();
    }

    // ---------------------------
    // Game State Management
    // ---------------------------
    /**
     * Update board state from server or Firebase
     * @param { Object } state - New game state
     */
    updateBoardState(state) {
        try {
            if (!state) {
                console.warn("Attempted to update board with null/undefined state");
                return;
            }

            // Log state for debugging
            console.log("Updating board state:", state);

            // Update traps
            if (state.traps) {
                this.gameLogic.traps = [...state.traps];
            }

            // Ensure local player cards are never hidden
            if (state.cards) {
                Object.keys(state.cards).forEach(cardId => {
                    // If this is a local player card, ensure it's not hidden
                    const isLocalCard = cardId.startsWith(this.localPlayer);
                    if (isLocalCard && state.cards[cardId]) {
                        state.cards[cardId].isHidden = false;
                    }
                });
            }

            // Update game logic state
            this.gameLogic.updateBoardState(state);

            // Fix any card visibility issues after the update
            Object.values(this.gameLogic.cards).forEach(card => {
                if (card.owner === this.localPlayer) {
                    card.isHidden = false;
                }
            });

            // Check if we need to create UI for any cards
            Object.values(this.gameLogic.cards).forEach(card => {
                if (!card.container) {
                    console.log(`Creating missing UI for card ${card.id}`);
                    if (card.isHidden && card.owner !== this.localPlayer) {
                        this.cardUI.createHiddenCardUI(card);
                    } else {
                        this.cardUI.createCardUI(card, this.localPlayer);
                    }
                }
            });

            // Update card UI if we have cards
            if (this.gameLogic.cards) {
                Object.values(this.gameLogic.cards).forEach(card => {
                    try {
                        // Update card position
                        this.cardUI.updateCardPosition(card);

                        // Update card stats
                        this.cardUI.updateCardStats(card);
                    } catch (cardError) {
                        console.error(`Error updating card ${card.id}:`, cardError);
                    }
                });
            }

            // Update card visibility
            this.updateCardVisibility();

            // Check for game over
            if (state.gameOver) {
                this.gameLogic.gameOver = true;
            }
        } catch (error) {
            console.error("Error updating board state:", error);
        }
    }

    /**
     * Play turn animations
     */
    playTurnAnimation(commands, finalState) {
        if (!commands || commands.length === 0) return;

        let delay = 0;
        const delayStep = 500;

        commands.forEach(cmd => {
            this.scene.time.delayedCall(delay, () => {
                if (cmd.type === 'move') {
                    // Move animation
                    const card = this.gameLogic.getCardById(cmd.cardId);
                    if (card) {
                        // First update position in game logic
                        if (cmd.destination) {
                            card.col = cmd.destination.col;
                            card.row = cmd.destination.row;
                        }
                        // Then animate the UI
                        this.cardUI.updateCardPosition(card, cmd.duration);
                    }
                } else if (cmd.type === 'blockedMove') {
                    // Blocked move animation - card tries to move but returns to original position
                    const card = this.gameLogic.getCardById(cmd.cardId);
                    if (card) {
                        this.cardUI.playBlockedMoveAnimation(card, cmd.attemptedDestination, cmd.duration);
                    }
                } else if (cmd.type === 'attack' || cmd.type === 'skill') {
                    // Attack animation
                    const sourceCard = this.gameLogic.getCardById(cmd.sourceCardId);
                    const targetCard = this.gameLogic.getCardById(cmd.targetCardId);
                    if (sourceCard && targetCard) {
                        this.cardUI.playAttackAnimation(sourceCard, targetCard, cmd.duration || 300, 100);
                    }
                } else if (cmd.type === 'trapPlaced' || cmd.type === 'trap') {
                    // Trap placement animation
                    const card = this.gameLogic.getCardById(cmd.cardId);
                    if (card) {
                        this.cardUI.playTrapAnimation(card, cmd.position || cmd.destination, cmd.duration || 300);
                    }
                } else if (cmd.type === 'trapTriggered') {
                    // Trap triggered animation
                    const card = this.gameLogic.getCardById(cmd.cardId);
                    if (card) {
                        this.cardUI.playTrapTriggeredAnimation(card);
                    }
                }
            });

            delay += delayStep;
        });

        // After animations complete, update to final state - don't auto-start new turn
        this.scene.time.delayedCall(delay, async () => {
            // Update card states after all animations
            this.updateBoardState(finalState);
            console.log("Animation completed, waiting for server to initiate next turn");

            // Notify server we're ready for next turn (if game is not over)
            if (finalState && !finalState.gameOver) {
                try {
                    const result = await firebaseService.notifyAnimationComplete(this.gameId);
                    console.log("Animation completion notification result:", result);
                } catch (err) {
                    console.error("Failed to notify animation complete:", err);
                }
            }
        });
    }    /**
     * Update card visibility
     */
    updateCardVisibility() {
        console.log("Updating card visibility, localPlayer:", this.localPlayer);

        Object.values(this.gameLogic.cards).forEach(card => {
            // Always ensure player's own cards are not hidden
            // Using multiple checks for robustness
            const isOwner = (
                card.owner === this.localPlayer ||
                card.id.startsWith(this.localPlayer) ||
                (window.gameContext && card.owner === window.gameContext.localPlayer)
            );

            if (isOwner) {
                if (card.isHidden) {
                    console.log(`Forcing visibility for owner's card ${card.id}`);
                    card.isHidden = false;
                }

                // Make sure UI is visible
                if (card.container) {
                    card.container.setVisible(true);

                    // If it's showing as a hidden card but should be visible, recreate it
                    if (card.container.children.length === 2) { // Hidden cards have fewer elements
                        console.log(`Recreating UI for owner's card ${card.id} that was incorrectly shown as hidden`);
                        card.container.destroy();
                        card.container = null;
                        this.cardUI.createCardUI(card, this.localPlayer);
                    }
                }
            }

            // If the card is marked as hidden (enemy stealth card)
            if (card.isHidden) {
                // Show it but with the hidden UI (it's visible but doesn't show details)
                if (card.container) {
                    card.container.setVisible(true);
                } else {
                    // Create hidden UI representation if it doesn't exist yet
                    this.cardUI.createHiddenCardUI(card);
                }
                return;
            }

            // Normal visibility rules for regular cards
            // Owner's cards are always visible (redundant check but for clarity)
            const isVisible = isOwner ||
                this.gameLogic.isCardVisible(card.id, this.localPlayer);

            console.log(`Card ${card.id}, owner=${card.owner}, isVisible=${isVisible}`);

            if (card.container) {
                card.container.setVisible(isVisible);
            } else if (isVisible) {
                // If the card should be visible but doesn't have a container,
                // create UI for it - this can happen when visibility changes
                this.cardUI.createCardUI(card, this.localPlayer);
            }
        });
    }

    /**
     * Check if cell is occupied
     */
    isCellOccupied(col, row, movingCardId) {
        return this.gameLogic.isCellOccupied(col, row, movingCardId);
    }

    /**
     * Register a local action and submit to Firebase
     */
    registerLocalAction(action) {
        // Store action locally
        this.currentAction = action;

        // In simultaneous turn system, submit action immediately
        this.submitAction(action);

        return true;
    }

    /**
     * Create cards using the game state from Firebase
     * This should be called after Firebase connection is established
     * Falls back to default values if Firebase is not ready
     */
    async createCards() {
        try {
            // If cards are already created, don't create them again
            if (this.cardsCreated) {
                console.log("Cards already created, skipping");
                return [];
            }

            // Try to get game state from Firebase
            let gameState = null;

            if (this.gameId) {
                try {
                    console.log("Fetching game state from Firebase");
                    gameState = await firebaseService.getGameState(this.gameId);
                    console.log("Game state from Firebase:", gameState);
                } catch (fbError) {
                    console.warn("Failed to get game state from Firebase:", fbError);
                }
            }

            // If no game state from Firebase, use defaults
            if (!gameState || !gameState.cards) {
                console.log("Using default card initialization");
                gameState = {
                    cards: {
                        'guest_0': { id: 'guest_0', hp: 3, speed: 3, col: 0, row: 0, stealth: 3 },
                        'guest_1': { id: 'guest_1', hp: 3, speed: 2, col: 1, row: 0, stealth: 3 },
                        'guest_2': { id: 'guest_2', hp: 3, speed: 1, col: 2, row: 0, stealth: 3 },
                        'host_0': { id: 'host_0', hp: 3, speed: 4, col: 0, row: 6, stealth: 3 },
                        'host_1': { id: 'host_1', hp: 3, speed: 3, col: 1, row: 6, stealth: 3 },
                        'host_2': { id: 'host_2', hp: 3, speed: 2, col: 2, row: 6, stealth: 3 }
                    }
                };
            }

            // Ensure local player cards are not hidden
            if (gameState.cards) {
                Object.keys(gameState.cards).forEach(cardId => {
                    if (cardId.startsWith(this.localPlayer) && gameState.cards[cardId]) {
                        gameState.cards[cardId].isHidden = false;
                    }
                });
            }

            // Initialize with state (either from Firebase or defaults)
            const cards = this.gameLogic.initializeCards(this.localPlayer, this.remotePlayer, gameState);

            // Fix any cards that are incorrectly set
            cards.forEach(card => {
                // Make sure local player's cards are never hidden
                if (card.owner === this.localPlayer) {
                    card.isHidden = false;
                }

                // Debug log for each card
                console.log(`Card initialized: ${card.id}, owner=${card.owner}, isHidden=${card.isHidden}, pos=(${card.col},${card.row})`);
            });

            // Create UI elements for each card
            cards.forEach(card => {
                if (card.isHidden && card.owner !== this.localPlayer) {
                    this.cardUI.createHiddenCardUI(card);
                } else {
                    this.cardUI.createCardUI(card, this.localPlayer);
                }
            });

            // Update visibility based on stealth
            this.updateCardVisibility();

            // Mark cards as created
            this.cardsCreated = true;

            return cards;
        } catch (error) {
            console.error("Error creating cards:", error);
            return [];
        }
    }

    /**
     * Reset turn state (UI only - actual turn state managed by server)
     * @param {Object} turnData - Optional turn data from server
     */
    startTurn(turnData = null) {
        console.log("Preparing UI for new turn:", turnData);

        // Reset local tracking
        this.currentAction = null;

        // Reset client-side UI state - game logic reset comes from server
        this.gameLogic.resetTurn();

        // Get turn number if provided
        const turnNumber = turnData?.turnNumber || this.currentTurnNumber || 1;

        // Enable input for card selection
        this.scene.enableLocalCardInput();

        // Show new turn message
        if (this.scene.turnStatusText) {
            this.scene.turnStatusText.setText(`Turn ${turnNumber} - Select a card to make your move`);
            this.scene.turnStatusText.setStyle({ fill: '#00ff00' });
        }
    }

    /**
     * Cleanup resources
     */
    cleanup() {
        // Remove Firebase listeners and cleanup resources
        firebaseService.cleanup();
    }
}