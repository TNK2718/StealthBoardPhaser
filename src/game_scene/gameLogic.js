import { Card } from './logic/card/card';

/**
 * GameLogic class - Simplified for Firebase implementation
 * Acts as a client-side model to store and manage card state
 * All game logic is processed on the server side
 */
export class GameLogic {
    constructor() {
        // Card collection
        this.cards = {};
        // Local player and remote player identifiers
        this.localPlayer = null;
        this.remotePlayer = null;
        // Game state flags
        this.gameOver = false;
        this.traps = []; // For UI rendering only
    }

    // ---------------------------
    // Card Management
    // ---------------------------    
    /**
    * Initialize card data based on server state
    * @param { string } localPlayer - Local player ID
    * @param { string } remotePlayer - Remote player ID
    * @param { Object } serverState - Server game state
    * @returns { Array } - Array of initialized cards
    */
    initializeCards(localPlayer, remotePlayer, serverState = null) {
        this.localPlayer = localPlayer;
        this.remotePlayer = remotePlayer;
        this.cards = {}; // Reset cards collection

        const cards = [];
        const occupiedPositions = new Map(); // To track occupied positions

        // Initialize cards from server state
        if (serverState && serverState.cards) {
            console.log("Initializing cards from server state:", serverState.cards);

            // First pass: Create all cards with their data
            Object.keys(serverState.cards).forEach(cardId => {
                const cardData = serverState.cards[cardId];
                const card = new Card({
                    id: cardId,
                    ...cardData
                });
                this.cards[cardId] = card;
                cards.push(card);
            });

            // Second pass: Fix any overlapping positions
            cards.forEach(card => {
                const posKey = `${card.col},${card.row}`;

                if (occupiedPositions.has(posKey)) {
                    // Position is already taken, find a new position
                    console.warn(`Card ${card.id} position (${card.col},${card.row}) is already occupied by ${occupiedPositions.get(posKey)}, finding alternative`);

                    // Get the default row based on owner (host/guest)
                    const defaultRow = card.owner === 'host' ? 6 : 0;

                    // Try to find a free position in the default row
                    for (let col = 0; col < 3; col++) {
                        const testPosKey = `${col},${defaultRow}`;
                        if (!occupiedPositions.has(testPosKey)) {
                            card.col = col;
                            card.row = defaultRow;
                            occupiedPositions.set(testPosKey, card.id);
                            console.log(`Relocated card ${card.id} to available position (${col},${defaultRow})`);
                            break;
                        }
                    }

                    // If we couldn't find a free position in the default row, try other rows
                    if (occupiedPositions.get(posKey) === card.id) {
                        const startRow = card.owner === 'host' ? 5 : 1;
                        const direction = card.owner === 'host' ? -1 : 1;

                        for (let row = startRow; (card.owner === 'host' ? row >= 1 : row <= 5); row += direction) {
                            for (let col = 0; col < 3; col++) {
                                const testPosKey = `${col},${row}`;
                                if (!occupiedPositions.has(testPosKey)) {
                                    card.col = col;
                                    card.row = row;
                                    occupiedPositions.set(testPosKey, card.id);
                                    console.log(`Relocated card ${card.id} to fallback position (${col},${row})`);
                                    break;
                                }
                            }

                            // Break out of the outer loop if we found a position
                            if (occupiedPositions.get(posKey) !== card.id) break;
                        }
                    }
                } else {
                    // Position is free, mark it as occupied
                    occupiedPositions.set(posKey, card.id);
                }
            });

            // Verify no cards are overlapping
            const finalPositions = new Map();
            let hasOverlaps = false;

            cards.forEach(card => {
                const posKey = `${card.col},${card.row}`;
                if (finalPositions.has(posKey)) {
                    console.error(`OVERLAP DETECTED: Cards ${finalPositions.get(posKey)} and ${card.id} are both at position (${card.col},${card.row})`);
                    hasOverlaps = true;
                } else {
                    finalPositions.set(posKey, card.id);
                }
            });

            if (!hasOverlaps) {
                console.log("Card initialization successful - no position overlaps detected");
            } else {
                console.error("Card initialization failed - overlapping positions detected");
            }

            // Also initialize traps if available
            if (serverState.traps) {
                this.traps = [...serverState.traps];
            }
        }

        // If no cards were created, create default cards
        if (cards.length === 0) {
            console.warn("No cards in server state, creating defaults");

            // Create guest cards (opponent)
            for (let i = 0; i < 3; i++) {
                const card = this.createCardData({
                    id: `${this.remotePlayer}_${i}`,
                    hp: 3,
                    speed: 3 - i,
                    stealth: 3
                }, i, 0);
                cards.push(card);
            }

            // Create host cards (player)
            for (let i = 0; i < 3; i++) {
                const card = this.createCardData({
                    id: `${this.localPlayer}_${i}`,
                    hp: 3,
                    speed: 4 - i,
                    stealth: 3
                }, i, 6);
                cards.push(card);
            }
        }

        return cards;
    }

    /**
     * Create a card instance from data
     * @param {Object} cardData - Card data
     * @param {number} col - Column position (optional, uses cardData.col if not provided)
     * @param {number} row - Row position (optional, uses cardData.row if not provided)
     * @returns {Card} - Card instance
     */
    createCardData(cardData, col, row) {
        // Ensure card data has valid position
        if ((col === undefined || col === null) && (cardData.col === undefined || cardData.col === null)) {
            console.error("Card is missing column position:", cardData);
            // Provide default position to avoid errors
            col = cardData.id.includes('_0') ? 0 : cardData.id.includes('_1') ? 1 : 2;
        }

        if ((row === undefined || row === null) && (cardData.row === undefined || cardData.row === null)) {
            console.error("Card is missing row position:", cardData);
            // Provide default position to avoid errors
            row = cardData.id.startsWith('host') ? 6 : 0;
        }

        // Use provided position or fall back to cardData values with defaults
        const cardInitData = {
            ...cardData,
            col: col !== undefined ? col : cardData.col,
            row: row !== undefined ? row : cardData.row,
            stealth: cardData.stealth !== undefined ? cardData.stealth : 3
        };

        // Create Card class instance
        const card = new Card(cardInitData);
        this.cards[card.id] = card;
        return card;
    }

    /**
     * Check if a cell is occupied by any card
     * Used for UI interactions and move validation
     */
    isCellOccupied(col, row, movingCardId) {
        return Object.values(this.cards).some(card => {
            return card.id !== movingCardId && card.col === col && card.row === row && card.isAlive();
        });
    }

    /**
     * Get a card by ID
     * @param {string} cardId - Card ID
     * @returns {Card|undefined} - Card instance or undefined if not found
     */
    getCardById(cardId) {
        return this.cards[cardId];
    }

    /**
     * Store a player action for submission to server
     * This no longer processes the action, just stores it for Firebase
     * @param {string} player - Player ID
     * @param {Object} action - Action data
     * @returns {boolean} - Success status
     */
    registerAction(player, action) {
        // We don't actually need to store the action since it's sent directly to Firebase
        // but we keep this method for compatibility with existing code
        return true;
    }

    /**
     * Reset turn state - called at the beginning of a new turn
     * Only handles UI state reset, actual game state comes from server
     */
    resetTurn() {
        // No game logic processing here - just UI state reset
        // This is called to prepare the UI for a new turn

        // Reset any UI-specific state if needed
        Object.values(this.cards).forEach(card => {
            // Reset any card UI properties that are turn-specific
            if (card.container) {
                card.container.setAlpha(1); // Reset any visual effects
                card.container.hasMoved = false; // Reset movement tracking for UI
            }
        });
    }

    /**
     * Check if opponent's card is visible (stealth value is 0 or less)
     * @param {string} cardId - Card ID to check visibility
     * @param {string} viewer - Player ID checking visibility
     * @returns {boolean} - Whether card is visible to viewer
     */
    isCardVisible(cardId, viewer) {
        const card = this.cards[cardId];
        if (!card) return false;
        return card.isVisibleTo(viewer);
    }

    /**
     * Update board state from Firebase/server state object
     * @param {Object} state - New state for cards and traps
     */
    updateBoardState(state) {
        if (!state) {
            console.error("Cannot update board state: state is null or undefined");
            return;
        }

        // Track position occupancy to prevent overlap
        const occupiedPositions = new Map();

        // Update card states
        if (state.cards) {
            // First pass: Ensure local player cards are never hidden
            Object.keys(state.cards).forEach(cardId => {
                // If card belongs to local player, ensure it's not hidden
                if (window.gameContext?.localPlayer && cardId.startsWith(window.gameContext.localPlayer)) {
                    if (state.cards[cardId]) {
                        state.cards[cardId].isHidden = false;
                        console.log(`Ensuring local player card ${cardId} is visible`);
                    }
                }
            });

            // Second pass: Update cards with corrected visibility
            Object.keys(state.cards).forEach(cardId => {
                try {
                    const cardData = state.cards[cardId];

                    // Validate card data
                    if (!cardData) {
                        console.warn(`Card ${cardId} has no data in update`);
                        return;
                    }

                    // Get existing card or create new one
                    let card = this.cards[cardId];

                    if (card) {
                        // Get pre-update position for collision detection
                        const oldPos = { col: card.col, row: card.row };

                        // Calculate new position (or keep old)
                        const newCol = cardData.col !== undefined ? Number(cardData.col) : card.col;
                        const newRow = cardData.row !== undefined ? Number(cardData.row) : card.row;

                        // Check for position collision before updating
                        const posKey = `${newCol},${newRow}`;

                        // If the position changed and is now occupied by another card
                        if ((newCol !== oldPos.col || newRow !== oldPos.row) &&
                            occupiedPositions.has(posKey) &&
                            occupiedPositions.get(posKey) !== cardId) {

                            console.warn(`Position conflict detected: Card ${cardId} cannot move to (${newCol},${newRow}) as it's occupied by ${occupiedPositions.get(posKey)}`);
                        } else {
                            // Position is valid or unchanged, update the card
                            occupiedPositions.set(posKey, cardId);

                            // Update card data from server
                            card.updateState(cardData);
                        }
                    } else {
                        // Create a new card if it doesn't exist
                        card = this.createCardData(cardData);

                        // Mark position as occupied
                        if (card.col !== undefined && card.row !== undefined) {
                            const posKey = `${card.col},${card.row}`;
                            occupiedPositions.set(posKey, cardId);
                        }
                    }
                } catch (err) {
                    console.error(`Error updating card ${cardId}:`, err);
                }
            });
        } else {
            // Handle legacy format where state might be a simple card collection
            Object.keys(state).forEach(cardId => {
                // Skip non-card properties
                if (cardId === 'traps' || cardId === 'gameOver' || cardId === 'turn') return;

                const cardData = state[cardId];

                // Update existing card or create new one
                let card = this.cards[cardId];
                if (card) {
                    card.updateState(cardData);
                } else {
                    this.createCardData(cardData);
                }
            });
        }

        // Update traps state if available
        if (state.traps) {
            this.traps = [...state.traps];
        }

        // Update game over state if available
        if (state.gameOver) {
            this.gameOver = true;
        }
    }

    /**
     * Check for game over condition and determine winner
     * This is a client-side only check, the actual result comes from server
     * @returns {string|null} Winner ID ('player1', 'player2') or null if game continues
     */
    checkGameOver() {
        // This is just a placeholder - actual game over determination is done on server
        return this.gameOver ? 'player1' : null;
    }
}
