/**
 * Server-side Game Logic implementation for Firebase Functions
 * Handles turn processing, card actions, and game state management
 */
const ServerCard = require('./serverCard');

class ServerGameLogic {
    constructor() {
        // Initialize game state
        this.cards = {};
        this.traps = [];
        this.turnActions = {};
        this.turnInProgress = false;
        this.gameOver = false;
        this.turnReadyStates = { player1: false, player2: false };
    }

    /**
     * Initialize cards for a new game
     * @returns {Array} Array of initialized cards
     */
    initializeCards() {
        // Card placement columns
        const guestColumns = [0, 1, 2];
        const hostColumns = [0, 1, 2];

        // Guest/Player2 card stats
        const guestStats = [
            { id: 'guest_0', hp: 3, speed: 3 },
            { id: 'guest_1', hp: 3, speed: 2 },
            { id: 'guest_2', hp: 3, speed: 1 }
        ];

        // Host/Player1 card stats
        const hostStats = [
            { id: 'host_0', hp: 3, speed: 4 },
            { id: 'host_1', hp: 3, speed: 3 },
            { id: 'host_2', hp: 3, speed: 2 }
        ];

        const cards = [];
        this.cards = {}; // Reset cards collection
        const occupiedPositions = {}; // Track occupied positions

        // Create guest cards (top row = 0)
        guestStats.forEach((cardStat, index) => {
            const col = guestColumns[index];
            const row = 0; // Guest cards always start at the top row
            const posKey = `${col},${row}`;

            // Ensure position is not already occupied (shouldn't happen in initialization but for safety)
            if (!occupiedPositions[posKey]) {
                occupiedPositions[posKey] = cardStat.id;
                const card = this.createCardData(cardStat, col, row);
                cards.push(card);
            }
        });

        // Create host cards (bottom row = 6)
        hostStats.forEach((cardStat, index) => {
            const col = hostColumns[index];
            const row = 6; // Host cards always start at the bottom row
            const posKey = `${col},${row}`;

            // Ensure position is not already occupied (shouldn't happen in initialization but for safety)
            if (!occupiedPositions[posKey]) {
                occupiedPositions[posKey] = cardStat.id;
                const card = this.createCardData(cardStat, col, row);
                cards.push(card);
            }
        });

        // Debugging: Log all cards and their positions
        console.log("Initialized cards:", cards.map(card => ({
            id: card.id,
            owner: card.owner,
            position: `(${card.col},${card.row})`,
            hp: card.hp,
            speed: card.speed
        })));

        return cards;
    }

    /**
     * Create a new card with given stats
     */
    createCardData(cardData, col, row) {
        // Add initial stealth value to card data
        const cardInitData = {
            ...cardData,
            col,
            row,
            stealth: 3 // Initial stealth value
        };

        // Create ServerCard instance
        const card = new ServerCard(cardInitData);
        this.cards[card.id] = card;
        return card;
    }

    /**
     * Check if a cell is occupied by any card
     */
    isCellOccupied(col, row, movingCardId) {
        return Object.values(this.cards).some(card => {
            return card.id !== movingCardId && card.col === col && card.row === row && card.isAlive();
        });
    }

    /**
     * Register an action for a player
     */
    registerAction(player, action) {
        if (this.turnActions[player]) return false;
        this.turnActions[player] = action;
        return true;
    }

    /**
     * Set the ready state for a player's turn
     */
    setTurnReadyState(player, isReady) {
        this.turnReadyStates[player] = isReady;
        return this.turnReadyStates.player1 && this.turnReadyStates.player2;
    }

    /**
     * Reset turn state for a new turn
     */
    resetTurn() {
        this.turnActions = {};
        this.turnInProgress = true;
        this.turnReadyStates = { player1: false, player2: false };
    }

    /**
     * Get a card by ID
     */
    getCardById(cardId) {
        return this.cards[cardId];
    }

    /**
     * Process actions from both players
     * @returns {Object} Result containing animation commands, final state, and game over status
     */
    processActionPair(player1Action, player2Action) {
        if (!player1Action || !player2Action) {
            return null;
        }

        // Map player roles to owners for compatibility
        const actionWithOwner1 = {
            ...player1Action,
            owner: 'host'  // player1 is always 'host'
        };

        const actionWithOwner2 = {
            ...player2Action,
            owner: 'guest' // player2 is always 'guest'
        };

        // Sort actions by card speed (faster cards go first)
        const actions = [actionWithOwner1, actionWithOwner2].sort((a, b) => {
            const cardA = this.cards[a.cardId];
            const cardB = this.cards[b.cardId];
            return (cardB.speed || 0) - (cardA.speed || 0);
        });

        const animationCommands = [];
        const updatedCards = {};

        // Track occupied positions for this turn
        const occupiedPositions = {};

        // Initialize occupied positions with current card positions
        Object.values(this.cards).forEach(card => {
            if (card.isAlive()) {
                const posKey = `${card.col},${card.row}`;
                occupiedPositions[posKey] = card.id;
            }
        });

        // Process each action in order of card speed
        actions.forEach(action => {
            const card = this.cards[action.cardId];
            if (!card || !card.isAlive()) return;

            // Record original position
            const originalPosition = {
                col: card.col,
                row: card.row
            };
            const originalPosKey = `${originalPosition.col},${originalPosition.row}`;

            // Handle different action types
            if (action.action === 'move' || action.actionType === 'move') {
                // Check if destination is valid
                const destinationCol = action.destination.col;
                const destinationRow = action.destination.row;
                const destinationKey = `${destinationCol},${destinationRow}`;

                // Clear original position from occupied map since the card is moving
                delete occupiedPositions[originalPosKey];

                // Check if the destination is already occupied by another card
                if (occupiedPositions[destinationKey]) {
                    // Destination is occupied, move fails
                    console.log(`Move failed for card ${card.id}: Destination ${destinationKey} is occupied by ${occupiedPositions[destinationKey]}`);

                    // Add card back to original position in occupied map
                    occupiedPositions[originalPosKey] = card.id;

                    // Record animation for failed move
                    animationCommands.push({
                        type: 'blockedMove',
                        cardId: card.id,
                        attemptedDestination: action.destination,
                        actualDestination: originalPosition,
                        duration: 300
                    });
                } else {
                    // Destination is free, move succeeds
                    card.col = destinationCol;
                    card.row = destinationRow;

                    // Mark the new position as occupied
                    occupiedPositions[destinationKey] = card.id;

                    // Record animation command
                    animationCommands.push({
                        type: 'move',
                        cardId: card.id,
                        destination: action.destination,
                        duration: 500
                    });

                    // Check for trap at destination
                    this.checkForTrap(card, animationCommands);
                }
            } else if (action.action === 'skill' || action.actionType === 'skill') {
                if (action.skillSubtype === 'atk') {
                    // Attack skill
                    const targetGrid = action.destination;
                    const enemyCard = Object.values(this.cards).find(c =>
                        c.owner !== card.owner &&
                        c.col === targetGrid.col &&
                        c.row === targetGrid.row &&
                        c.isAlive()
                    );

                    if (enemyCard) {
                        // Apply damage and reduce stealth
                        enemyCard.hp -= 1;
                        enemyCard.stealth = Math.max(0, enemyCard.stealth - 1);

                        // Record attack animation
                        animationCommands.push({
                            type: 'skill',
                            sourceCardId: card.id,
                            targetCardId: enemyCard.id,
                            bulletDuration: 300,
                            flashDuration: 100
                        });
                    }
                } else if (action.skillSubtype === 'trap') {
                    // Place trap
                    const targetGrid = action.destination;
                    this.traps.push({ col: targetGrid.col, row: targetGrid.row });

                    // Record trap animation
                    animationCommands.push({
                        type: 'trap',
                        cardId: card.id,
                        destination: targetGrid,
                        duration: 300
                    });
                }
            }

            // Record updated card state
            updatedCards[card.id] = { ...card };
        });

        // Update stealth values at end of turn
        this.updateStealthProximity();

        // Record final state of all cards
        const finalState = {};
        Object.values(this.cards).forEach(card => {
            finalState[card.id] = {
                col: card.col,
                row: card.row,
                hp: card.hp,
                stealth: card.stealth
            };
        });

        // Check for game over condition
        const gameOver = this.checkGameOver();

        return {
            animationCommands,
            finalState,
            gameOver
        };
    }

    /**
     * Check if a card has landed on a trap and apply effects
     */
    checkForTrap(card, animationCommands) {
        const trapIndex = this.traps.findIndex(trap => trap.col === card.col && trap.row === card.row);
        if (trapIndex !== -1) {
            // Apply trap effects
            card.hp -= 1;
            card.stealth -= 1;

            // Record trap trigger animation
            animationCommands.push({
                type: 'trapTriggered',
                cardId: card.id,
                position: { col: card.col, row: card.row }
            });

            // Remove triggered trap
            this.traps.splice(trapIndex, 1);

            return {
                triggered: true,
                position: { col: card.col, row: card.row }
            };
        }

        return { triggered: false };
    }

    /**
     * Update stealth values based on enemy card proximity
     */
    updateStealthProximity() {
        Object.values(this.cards).forEach(card => {
            // Check against enemy cards
            const enemyOwner = card.owner === 'host' ? 'guest' : 'host';
            Object.values(this.cards).forEach(enemy => {
                if (enemy.owner === enemyOwner) {
                    // Calculate front cell based on owner
                    const frontRow = enemy.owner === 'host' ? enemy.row - 1 : enemy.row + 1;
                    if (card.col === enemy.col && card.row === frontRow) {
                        // Reduce stealth when in front of enemy
                        card.stealth -= 1;
                    }
                }
            });

            // Ensure stealth doesn't go below 0
            if (card.stealth < 0) card.stealth = 0;
        });
    }

    /**
     * Check if a card is visible to a specific player
     */
    isCardVisible(cardId, viewer) {
        const card = this.cards[cardId];
        if (!card) return false;
        return card.isVisibleTo(viewer);
    }

    /**
     * Update board state with new card values
     */
    updateBoardState(state) {
        Object.keys(state).forEach(cardId => {
            const card = this.cards[cardId];
            if (card) {
                card.updateState(state[cardId]);
            }
        });
    }

    /**
     * Check if the game is over and determine the winner
     */
    checkGameOver() {
        const hostAlive = Object.values(this.cards).filter(card => card.owner === 'host' && card.isAlive());
        const guestAlive = Object.values(this.cards).filter(card => card.owner === 'guest' && card.isAlive());

        if (hostAlive.length === 0 || guestAlive.length === 0) {
            this.gameOver = true;
            return hostAlive.length > 0 ? 'player1' : 'player2';
        }

        return null; // Game continues
    }

    /**
     * Convert the current game state to a Firestore-compatible object
     */
    toFirestoreObject() {
        const cardsObject = {};
        Object.values(this.cards).forEach(card => {
            cardsObject[card.id] = card.toFirestoreObject();
        });

        return {
            cards: cardsObject,
            traps: this.traps,
            gameOver: this.gameOver
        };
    }

    /**
     * Create a filtered game state for a specific player
     * This removes hidden enemy cards (stealth) from the game state
     * @param {string} playerRole - The player role (player1/player2) to filter for
     * @returns {Object} - Filtered game state object
     */
    getPlayerVisibleState(playerRole) {
        const playerOwner = playerRole === 'player1' ? 'host' : 'guest';
        const cardsObject = {};

        // Filter cards based on visibility
        Object.values(this.cards).forEach(card => {
            // Include if it's the player's card or if it's visible to them
            if (card.owner === playerOwner || card.isVisibleTo(playerOwner)) {
                const cardObj = card.toFirestoreObject();
                // Explicitly ensure player's own cards are never hidden
                if (card.owner === playerOwner) {
                    cardObj.isHidden = false;
                }
                cardsObject[card.id] = cardObj;
            } else {
                // For hidden enemy cards, only include minimal position info
                // so client knows something is there but not what it is
                cardsObject[card.id] = {
                    id: card.id,
                    owner: card.owner,
                    col: card.col,
                    row: card.row,
                    isHidden: true,
                    hp: 0,  // Placeholder values
                    speed: 0,
                    stealth: 0
                };
            }
        });

        return {
            cards: cardsObject,
            traps: this.traps,
            gameOver: this.gameOver
        };
    }

    /**
     * Create a ServerGameLogic instance from Firestore data
     */
    static fromFirestore(data) {
        const gameLogic = new ServerGameLogic();

        if (data.cards) {
            Object.keys(data.cards).forEach(cardId => {
                gameLogic.cards[cardId] = ServerCard.fromFirestore(data.cards[cardId]);
            });
        }

        if (data.traps) {
            gameLogic.traps = [...data.traps];
        }

        gameLogic.gameOver = data.gameOver || false;

        return gameLogic;
    }
}

module.exports = ServerGameLogic;
