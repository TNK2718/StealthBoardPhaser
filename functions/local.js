// Initialize Firebase Functions for local development
const admin = require('firebase-admin');
const functions = require('firebase-functions');

// Create a service account manually for local development
// For production, use the auto-populated GOOGLE_APPLICATION_CREDENTIALS
admin.initializeApp({
    projectId: 'stealth-board-phaser',
});

exports.initialize = functions.https.onRequest((req, res) => {
    res.send('Firebase Functions initialized!');
});
