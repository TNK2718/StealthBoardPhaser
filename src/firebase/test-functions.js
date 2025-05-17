// Test Firebase Functions
import { initializeApp } from "firebase/app";
import {
    getAuth,
    signInAnonymously,
    connectAuthEmulator
} from "firebase/auth";
import {
    getFunctions,
    httpsCallable,
    connectFunctionsEmulator
} from "firebase/functions";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
import { firebaseConfig } from "./firebaseConfig";

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const functions = getFunctions(app);
const db = getFirestore(app);

// Always connect to emulator for this test
connectAuthEmulator(auth, "http://localhost:9099");
connectFunctionsEmulator(functions, 'localhost', 5001);
connectFirestoreEmulator(db, 'localhost', 8089);

const enterMatchQueue = httpsCallable(functions, 'enterMatchQueue');

async function testMatchmaking() {
    try {
        // Sign in anonymously
        console.log("Signing in anonymously...");
        const userCredential = await signInAnonymously(auth);
        console.log("Signed in successfully:", userCredential.user.uid);

        // Call the enterMatchQueue function
        console.log("Entering match queue...");
        const result = await enterMatchQueue();
        console.log("Matchmaking result:", result.data);

    } catch (error) {
        console.error("Error in test:", error);
    }
}

// Execute the test when the script is loaded
testMatchmaking();
