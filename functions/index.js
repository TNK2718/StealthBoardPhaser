const functions = require('firebase-functions');
const admin = require('firebase-admin');
const cors = require('cors')({ origin: true });
admin.initializeApp();

// Import server-side game logic classes
const ServerGameLogic = require('./serverGameLogic');
const ServerCard = require('./serverCard');

// Debug Firebase Admin initialization
console.log('Firebase Admin initialized with features:',
    {
        firestore: typeof admin.firestore === 'function',
        auth: typeof admin.auth === 'function',
        storage: typeof admin.storage === 'function'
    });

const db = admin.firestore();

/**
 * Cloud Function to enter the matchmaking queue
 * This function handles the matchmaking logic by either:
 * 1. Finding an existing opponent and creating a game
 * 2. Adding the player to the queue if no opponent is available
 */
exports.enterMatchQueue = functions.https.onCall(async (data, context) => {
    try {
        console.log("enterMatchQueue function called");

        // Authentication check
        if (!context.auth) {
            console.log("Authentication failed");
            throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated to join queue');
        } console.log(`enterMatchQueue called by user: ${context.auth.uid}`);

        const userId = context.auth.uid;
        // Use the current date as timestamp instead of serverTimestamp()
        const timestamp = new Date();
        // Check if player is already in queue
        const existingQueueEntryRef = db.collection('matchmaking_queue').doc(userId);
        const existingQueueEntry = await existingQueueEntryRef.get();

        if (existingQueueEntry.exists) {
            console.log(`User ${userId} already in queue, refreshing timestamp`);
            // Update the timestamp to refresh their position
            await existingQueueEntryRef.update({ timestamp });
            return {
                success: true,
                status: 'waiting',
                queueEntryId: userId,
                message: 'Already in queue, position refreshed'
            };
        }// Look for an available opponent
        const queueRef = db.collection('matchmaking_queue');
        const snapshot = await queueRef
            .where('status', '==', 'waiting')
            .orderBy('timestamp')
            .limit(1)
            .get();

        if (!snapshot.empty) {
            // Found an opponent - Create a game
            const opponent = snapshot.docs[0].data();
            const opponentId = opponent.userId;
            const queueEntryId = snapshot.docs[0].id;

            console.log(`Found opponent: ${opponentId}, queue entry: ${queueEntryId}`);            // Create a new game document
            const gameRef = db.collection('games').doc();
            const gameId = gameRef.id;

            // Initialize the game state with cards
            const gameLogic = new ServerGameLogic();
            gameLogic.initializeCards();
            const initialState = gameLogic.toFirestoreObject();

            await gameRef.set({
                player1: opponentId,   // First in queue becomes player1
                player2: userId,       // Current user becomes player2
                state: initialState,
                turn: 'player1',       // First player starts
                turnCounter: 0,
                finished: false,
                createdAt: timestamp,
                lastUpdated: timestamp
            });// Update opponent's queue entry with the game ID
            await db.collection('matchmaking_queue').doc(queueEntryId).update({
                gameId,
                status: 'matched',
                matchedWith: userId
            });

            // Add current player to the queue with matched status
            await db.collection('matchmaking_queue').doc(userId).set({
                userId,
                status: 'matched',
                gameId,
                matchedWith: opponentId,
                timestamp
            });

            // Return game ID and match details
            return {
                success: true,
                status: 'matched',
                gameId,
                matchStarted: true,
                player1: opponentId,
                player2: userId
            };
        } else {            // No opponent found - Add to queue
            // Use userId as document ID for consistent retrieval
            console.log(`No opponent found. Adding user ${userId} to queue`);
            await queueRef.doc(userId).set({
                userId,
                status: 'waiting',
                timestamp
            });

            console.log(`Added user ${userId} to matchmaking queue`);

            // Return queue entry ID (same as userId for consistency)
            return {
                success: true,
                status: 'waiting',
                queueEntryId: userId,
                matchStarted: false,
                message: 'Added to matchmaking queue'
            };
        }
    } catch (error) {
        console.error('Error entering matchmaking queue:', error);
        throw new functions.https.HttpsError('internal', 'Failed to enter matchmaking queue');
    }
});

/**
 * Cloud Function to submit a player's move
 * This function processes the player's move and updates the game state
 * In simultaneous turn system, both players submit their actions
 * and they are processed together when both have submitted
 */
exports.submitMove = functions.https.onCall(async (data, context) => {
    // Authentication check
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated to submit a move');
    }

    const { gameId, moveData } = data;
    const userId = context.auth.uid;

    if (!gameId) {
        throw new functions.https.HttpsError('invalid-argument', 'Game ID must be provided');
    }

    // Get the game document
    const gameRef = db.collection('games').doc(gameId);

    // Use transaction to safely handle concurrent moves
    try {
        const result = await db.runTransaction(async (transaction) => {
            const gameSnapshot = await transaction.get(gameRef);

            if (!gameSnapshot.exists) {
                throw new functions.https.HttpsError('not-found', 'Game not found');
            }

            const game = gameSnapshot.data();

            // Check if the game is already finished
            if (game.finished) {
                throw new functions.https.HttpsError('failed-precondition', 'Game is already finished');
            }

            // Check if the user is a player in this game
            let playerRole = null;
            if (game.player1 === userId) {
                playerRole = 'player1';
            } else if (game.player2 === userId) {
                playerRole = 'player2';
            } else {
                throw new functions.https.HttpsError('permission-denied', 'User is not a player in this game');
            }

            // Initialize the current turn actions if not exist
            const currentTurnActions = game.currentTurnActions || {};

            // Check if player already submitted an action for this turn
            if (currentTurnActions[playerRole]) {
                throw new functions.https.HttpsError('already-exists', 'Action already submitted for this turn');
            }

            // Store the player's action
            currentTurnActions[playerRole] = moveData;

            // Update the game document with the new action
            transaction.update(gameRef, {
                currentTurnActions: currentTurnActions,
                lastUpdated: new Date()
            });

            // Check if both players have submitted their actions
            const bothActionsSubmitted =
                currentTurnActions.player1 && currentTurnActions.player2;

            if (bothActionsSubmitted) {
                console.log("Both actions submitted, processing turn");

                // Process both actions simultaneously using ServerGameLogic
                const player1Action = currentTurnActions.player1;
                const player2Action = currentTurnActions.player2;

                // Create or load game logic from current state
                const gameLogic = ServerGameLogic.fromFirestore(game.state);

                // Process both moves with the server game logic
                const result = gameLogic.processActionPair(player1Action, player2Action);
                const updatedState = gameLogic.toFirestoreObject();
                const animationCommands = result.animationCommands;

                // Check for game-ending conditions
                const gameStatus = checkGameStatus(updatedState);

                // Update the game document with the new state and reset actions
                transaction.update(gameRef, {
                    state: updatedState,
                    currentTurnActions: {},
                    lastAction: {
                        commands: animationCommands,
                        player1: player1Action,
                        player2: player2Action
                    },
                    turnCounter: game.turnCounter + 1,
                    finished: gameStatus.gameOver,
                    winner: gameStatus.gameOver ? gameStatus.winner : null,
                    lastUpdated: new Date()
                });

                return {
                    success: true,
                    state: updatedState,
                    turnCompleted: true,
                    gameOver: gameStatus.gameOver,
                    winner: gameStatus.winner
                };
            }

            // Only one player has submitted, wait for the other
            return {
                success: true,
                turnCompleted: false,
                waitingForOpponent: true
            };
        });

        return result;
    } catch (error) {
        console.error("Error processing move:", error);
        throw new functions.https.HttpsError('internal', error.message);
    }
});

/**
 * Cloud Function to notify that client animation is complete
 * Players call this after their animations finish to indicate they're ready for the next turn
 */
exports.notifyAnimationComplete = functions.https.onCall(async (data, context) => {
    // Authentication check
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated to notify animation completion');
    }

    const { gameId } = data;
    const userId = context.auth.uid;

    if (!gameId) {
        throw new functions.https.HttpsError('invalid-argument', 'Game ID must be provided');
    }

    // Get the game document
    const gameRef = db.collection('games').doc(gameId);

    try {
        // Use transaction to safely handle concurrent notifications
        const result = await db.runTransaction(async (transaction) => {
            const gameSnapshot = await transaction.get(gameRef);

            if (!gameSnapshot.exists) {
                throw new functions.https.HttpsError('not-found', 'Game not found');
            }

            const game = gameSnapshot.data();

            // Check if the game is already finished
            if (game.finished) {
                throw new functions.https.HttpsError('failed-precondition', 'Game is already finished');
            }

            // Check if the user is a player in this game
            let playerRole = null;
            if (game.player1 === userId) {
                playerRole = 'player1';
            } else if (game.player2 === userId) {
                playerRole = 'player2';
            } else {
                throw new functions.https.HttpsError('permission-denied', 'User is not a player in this game');
            }

            // Initialize animation status if not exist
            const animationComplete = game.animationComplete || {};

            // Update this player's animation status
            animationComplete[playerRole] = true;

            // Update the game document with the new animation status
            transaction.update(gameRef, {
                animationComplete: animationComplete,
                lastUpdated: new Date()
            });

            // Check if both players' animations are complete
            const bothAnimationsComplete =
                animationComplete.player1 && animationComplete.player2;

            if (bothAnimationsComplete) {
                console.log("Both animations complete, preparing for next turn");

                // Reset animation status and prepare for next turn
                transaction.update(gameRef, {
                    animationComplete: {
                        player1: false,
                        player2: false
                    },
                    turnReady: true,
                    lastUpdated: new Date()
                });

                return {
                    success: true,
                    nextTurnReady: true
                };
            }

            return {
                success: true,
                nextTurnReady: false,
                waitingForOpponent: true
            };
        });

        return result;
    } catch (error) {
        console.error("Error processing animation completion:", error);
        throw new functions.https.HttpsError('internal', error.message);
    }
});

/**
 * Get the latest game state - this function returns player-specific states
 * that hide stealth cards from opponents
 */
exports.getGameState = functions.https.onCall(async (data, context) => {
    try {
        // Ensure user is authenticated
        if (!context.auth) {
            throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
        }

        const { gameId } = data;
        const userId = context.auth.uid;

        if (!gameId) {
            throw new functions.https.HttpsError('invalid-argument', 'Game ID is required');
        }

        // Get game document
        const gameRef = db.collection('games').doc(gameId);
        const gameDoc = await gameRef.get();

        if (!gameDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'Game not found');
        }

        const gameData = gameDoc.data();

        // Verify user is a player in the game
        if (gameData.player1 !== userId && gameData.player2 !== userId) {
            throw new functions.https.HttpsError('permission-denied', 'User is not a player in this game');
        }

        // Determine player role
        const playerRole = gameData.player1 === userId ? 'player1' : 'player2';

        // Create game logic instance from the full game state
        const gameLogic = ServerGameLogic.fromFirestore(gameData.state);

        // Generate player-specific filtered state
        const playerVisibleState = gameLogic.getPlayerVisibleState(playerRole);

        // Return filtered state along with other game data
        return {
            success: true,
            playerRole,
            state: playerVisibleState,
            turn: gameData.turn,
            turnCounter: gameData.turnCounter,
            finished: gameData.finished,
            winner: gameData.winner,
            lastAction: gameData.lastAction
        };
    } catch (error) {
        console.error('Error in getGameState:', error);
        throw new functions.https.HttpsError('internal', error.message);
    }
});

/**
 * Process both players' moves simultaneously and update the game state
 * This function is now a wrapper around the ServerGameLogic implementation
 */
function processTurn(currentState, player1Action, player2Action) {
    // Create a game logic instance from the current state
    const gameLogic = ServerGameLogic.fromFirestore(currentState);

    // Process the turn using the server game logic
    const result = gameLogic.processActionPair(player1Action, player2Action);

    // Return the updated state and animation commands
    return {
        state: gameLogic.toFirestoreObject(),
        animationCommands: result.animationCommands
    };
}

/**
 * Process a single player's move (used for backward compatibility)
 */
function processMove(currentState, playerRole, moveData) {
    // Clone the current state to avoid direct mutations
    const newState = JSON.parse(JSON.stringify(currentState));

    // Apply the move to the state (this is where your game-specific logic goes)
    if (moveData.action === 'move') {
        const { cardId, destination } = moveData;
        // Update card position
        if (newState.cards[cardId]) {
            newState.cards[cardId].col = destination.col;
            newState.cards[cardId].row = destination.row;
        }

        // Check for trap at destination
        checkForTraps(newState, cardId);
    }
    else if (moveData.action === 'attack') {
        const { sourceCardId, targetCardId } = moveData;
        // Apply attack damage
        if (newState.cards[targetCardId]) {
            newState.cards[targetCardId].hp -= 1;
        }
    }
    else if (moveData.action === 'placeTrap') {
        const { col, row } = moveData;
        // Add trap to the state
        newState.traps.push({ col, row });
    }

    // Update stealth values based on proximity
    updateStealthValues(newState);

    return newState;
}

/**
 * Check if there's a trap at the card's position and apply effects
 * This function is now a wrapper around the ServerGameLogic implementation
 * @deprecated Use ServerGameLogic's checkForTrap method instead
 */
function checkForTraps(state, cardId) {
    // Create a temporary game logic instance
    const gameLogic = ServerGameLogic.fromFirestore(state);
    const card = gameLogic.getCardById(cardId);

    if (!card) return { triggered: false };

    // Use the animationCommands array to capture any trap animations
    const animationCommands = [];
    const result = gameLogic.checkForTrap(card, animationCommands);

    // Update the state with the modified game logic state
    Object.assign(state, gameLogic.toFirestoreObject());

    return result;
}

/**
 * Update stealth values based on proximity to enemy cards
 * This function is now a wrapper around the ServerGameLogic implementation
 * @deprecated Use ServerGameLogic's updateStealthProximity method instead
 */
function updateStealthValues(state) {
    // Create a temporary game logic instance
    const gameLogic = ServerGameLogic.fromFirestore(state);

    // Update stealth values using the game logic
    gameLogic.updateStealthProximity();

    // Update the state with the modified game logic state
    Object.assign(state, gameLogic.toFirestoreObject());
}

/**
 * Check if the game is over and determine the winner
 * This function is now a wrapper around the ServerGameLogic implementation
 */
function checkGameStatus(state) {
    // Create a temporary game logic instance
    const gameLogic = ServerGameLogic.fromFirestore(state);

    // Check game over condition
    const winner = gameLogic.checkGameOver();

    if (winner) {
        return {
            gameOver: true,
            winner: winner
        };
    }

    return {
        gameOver: false,
        winner: null
    };
}
