import { initializeApp } from "firebase/app";
import {
    getAuth,
    signInAnonymously,
    GoogleAuthProvider,
    signInWithPopup,
    connectAuthEmulator
} from "firebase/auth";
import {
    getFirestore,
    doc,
    collection,
    setDoc,
    getDoc,
    onSnapshot,
    updateDoc,
    connectFirestoreEmulator
} from "firebase/firestore";
import {
    getFunctions,
    httpsCallable,
    connectFunctionsEmulator
} from "firebase/functions";
import { firebaseConfig } from "./firebaseConfig";

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const functions = getFunctions(app);

// Connect to emulators if in development mode
const useEmulator = process.env.NODE_ENV === 'development' && process.env.USE_FIREBASE_EMULATOR === 'true';
if (useEmulator) {
    console.log('Using Firebase emulators for local development');
    connectAuthEmulator(auth, "http://localhost:9099");
    connectFirestoreEmulator(db, 'localhost', 8089); // Updated Firestore emulator port
    connectFunctionsEmulator(functions, 'localhost', 5001);
}

// Cloud Functions references
const enterMatchQueue = httpsCallable(functions, 'enterMatchQueue');
const submitMove = httpsCallable(functions, 'submitMove');
const notifyAnimationCompleteFunc = httpsCallable(functions, 'notifyAnimationComplete');

class FirebaseService {
    constructor() {
        this.user = null;
        this.gameId = null;
        this.gameListeners = [];
        this.gameStateChangedCallbacks = [];
        this.matchStartedCallbacks = [];
    }

    // Authentication methods
    async signInAnonymously() {
        try {
            const userCredential = await signInAnonymously(auth);
            this.user = userCredential.user;
            return this.user;
        } catch (error) {
            console.error("Anonymous authentication failed:", error);
            throw error;
        }
    }

    async signInWithGoogle() {
        try {
            const provider = new GoogleAuthProvider();
            const userCredential = await signInWithPopup(auth, provider);
            this.user = userCredential.user;
            return this.user;
        } catch (error) {
            console.error("Google authentication failed:", error);
            throw error;
        }
    }

    // Check if user is authenticated
    isAuthenticated() {
        return !!auth.currentUser;
    }

    getCurrentUser() {
        return auth.currentUser;
    }    // Matchmaking
    async joinMatchQueue() {
        try {
            if (!this.isAuthenticated()) {
                throw new Error("User must be authenticated to join a match queue");
            }

            const result = await enterMatchQueue();
            console.log("Match queue result:", result.data);

            if (result.data.matchStarted) {
                // Match found immediately
                this.gameId = result.data.gameId;
                this.startListeningToGame(this.gameId);
                this.notifyMatchStarted(result.data);
            } else if (result.data.queueEntryId) {
                // Wait for match to be found
                this.startListeningForMatchmaking(result.data.queueEntryId);
            } else {
                console.error("Unexpected response format:", result.data);
                throw new Error("Invalid response from matchmaking service");
            }

            return result.data;
        } catch (error) {
            console.error("Failed to join match queue:", error);
            throw error;
        }
    } startListeningForMatchmaking(queueEntryId) {
        console.log(`Starting to listen for matchmaking updates on entry: ${queueEntryId}`);

        // Listen to the queue entry document
        const queueEntryRef = doc(db, "matchmaking_queue", queueEntryId);

        const unsubscribe = onSnapshot(queueEntryRef, (snapshot) => {
            console.log(`Queue entry update received`);

            if (!snapshot.exists()) {
                console.log(`Queue entry ${queueEntryId} does not exist`);
                return;
            }

            const data = snapshot.data();
            console.log(`Queue entry data:`, data);

            if (data && data.gameId) {
                console.log(`Match found with game ID: ${data.gameId}`);
                // Match found, we have a game ID
                this.gameId = data.gameId;
                unsubscribe(); // Stop listening to queue entry

                // Start listening to the game
                this.startListeningToGame(this.gameId);
                this.notifyMatchStarted(data);
            } else {
                console.log(`Still waiting for a match...`);
            }
        });
    }

    // Game state management
    startListeningToGame(gameId) {
        if (!gameId) {
            console.error("No game ID provided");
            return;
        }

        const gameRef = doc(db, "games", gameId);

        const unsubscribe = onSnapshot(gameRef, (snapshot) => {
            const gameData = snapshot.data();
            if (gameData) {
                this.notifyGameStateChanged(gameData);
            }
        });

        // Store the unsubscribe function so we can stop listening later
        this.gameListeners.push(unsubscribe);
    } async submitPlayerMove(moveData) {
        try {
            if (!this.gameId || !this.isAuthenticated()) {
                throw new Error("No active game or user not authenticated");
            }

            console.log(`Submitting move for game ${this.gameId}:`, moveData);

            const result = await submitMove({
                gameId: this.gameId,
                moveData: moveData
            });

            console.log("Move submission result:", result.data);

            return result.data;
        } catch (error) {
            console.error("Failed to submit move:", error);
            throw error;
        }
    }

    // For compatibility with the current game
    getCurrentGameData() {
        return this._currentGameData;
    }

    // Event Listeners
    onGameStateChanged(callback) {
        this.gameStateChangedCallbacks.push(callback);
    }

    onMatchStarted(callback) {
        this.matchStartedCallbacks.push(callback);
    }

    notifyGameStateChanged(gameData) {
        this.gameStateChangedCallbacks.forEach(callback => callback(gameData));
    }

    notifyMatchStarted(matchData) {
        this.matchStartedCallbacks.forEach(callback => callback(matchData));
    }

    // Cleanup
    cleanup() {
        // Unsubscribe from all Firestore listeners
        this.gameListeners.forEach(unsubscribe => unsubscribe());
        this.gameListeners = [];
    }    // Determine if the current user is player1 or player2
    getPlayerRole(gameData) {
        if (!gameData || !this.user) return null;

        if (gameData.player1 === this.user.uid) {
            return 'player1';
        } else if (gameData.player2 === this.user.uid) {
            return 'player2';
        }

        return null; // Not a player in this game
    }    // Get current game state from Firebase - uses the getGameState Cloud Function
    // which returns player-specific filtered state (hiding stealth cards)
    async getGameState(gameId) {
        try {
            if (!gameId) {
                console.warn("No game ID provided to getGameState");
                return null;
            }

            // Call the Cloud Function to get player-specific state
            const getGameStateFn = httpsCallable(functions, 'getGameState');
            const result = await getGameStateFn({ gameId });

            if (result.data && result.data.success) {
                console.log('Retrieved player-specific game state:', result.data);
                return result.data.state;
            }

            // Fall back to direct Firestore access if function fails
            console.warn("Falling back to direct Firestore access for game state");
            const gameDoc = doc(db, "games", gameId);
            const snapshot = await getDoc(gameDoc);

            if (!snapshot.exists()) {
                console.warn(`Game ${gameId} does not exist`);
                return null;
            }

            const gameData = snapshot.data();
            return gameData.state || null;
        } catch (error) {
            console.error("Failed to get game state:", error);
            return null;
        }
    }// Notify server that client animation is complete and ready for next turn
    async notifyAnimationComplete(gameId, playerRole) {
        try {
            if (!gameId || !this.isAuthenticated()) {
                console.warn("No game ID or not authenticated");
                return false;
            }

            console.log(`Notifying animation complete for game ${gameId}`);

            // Use the Cloud Function instead of direct document update
            const result = await notifyAnimationCompleteFunc({ gameId });
            console.log("Animation notification result:", result.data);
            return result.data.success;
        } catch (error) {
            console.error("Failed to notify animation complete:", error);
            return false;
        }
    }

    // Check if it's the current player's turn
    isMyTurn(gameData) {
        const role = this.getPlayerRole(gameData);
        return role === gameData.turn;
    }
}

// Create and export a singleton instance
const firebaseService = new FirebaseService();
export default firebaseService;
