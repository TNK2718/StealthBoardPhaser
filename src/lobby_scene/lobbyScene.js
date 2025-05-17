import Phaser from 'phaser';
import firebaseService from '../firebase/firebaseService';

export class LobbyScene extends Phaser.Scene {
    constructor() {
        super('LobbyScene');
        this.statusText = null;
        this.findMatchButton = null;
        this.cancelButton = null;
        this.isSearching = false;
    }

    init() {
        // Ensure user is authenticated before proceeding
        if (!firebaseService.isAuthenticated()) {
            this.scene.start('AuthScene');
            return;
        }
    }

    create() {
        this.add.text(400, 50, 'Stealth Board Game', { fontSize: '32px', fill: '#ffffff' }).setOrigin(0.5);

        const user = firebaseService.getCurrentUser();
        const displayName = user.displayName || 'Anonymous Player';

        this.add.text(400, 100, `Welcome, ${displayName}!`, { fontSize: '18px', fill: '#ffffff' }).setOrigin(0.5);
        this.statusText = this.add.text(400, 150, 'Ready to play', { fontSize: '18px', fill: '#ffffff' }).setOrigin(0.5);

        // Find Match Button
        this.findMatchButton = this.add.text(400, 250, 'Find a Match', { fontSize: '18px', fill: '#ffffff' })
            .setOrigin(0.5)
            .setInteractive({ useHandCursor: true })
            .on('pointerdown', () => this.findMatch())
            .on('pointerover', () => this.findMatchButton.setStyle({ fill: '#ff0' }))
            .on('pointerout', () => this.findMatchButton.setStyle({ fill: '#ffffff' }));

        // Cancel Button (hidden initially)
        this.cancelButton = this.add.text(400, 300, 'Cancel', { fontSize: '18px', fill: '#ffffff' })
            .setOrigin(0.5)
            .setInteractive({ useHandCursor: true })
            .on('pointerdown', () => this.cancelMatchmaking())
            .on('pointerover', () => this.cancelButton.setStyle({ fill: '#ff0' }))
            .on('pointerout', () => this.cancelButton.setStyle({ fill: '#ffffff' }))
            .setVisible(false);

        // Set up listeners for game state changes
        this.setupFirebaseListeners();
    }

    setupFirebaseListeners() {
        // Listen for match started events
        firebaseService.onMatchStarted((matchData) => {
            this.updateStatus('Match found! Starting game...');
            this.isSearching = false;
            this.updateMatchmakingUI();

            // Start the game scene with the match data
            this.scene.start('GameScene', {
                gameId: matchData.gameId,
                playerRole: firebaseService.getPlayerRole(matchData)
            });
        });
    }

    async findMatch() {
        if (this.isSearching) return;

        this.isSearching = true;
        this.updateMatchmakingUI();
        this.updateStatus('Looking for a match...');

        try {
            const result = await firebaseService.joinMatchQueue();

            // If we don't get an immediate match, continue showing searching UI
            if (!result.matchStarted) {
                this.updateStatus('Waiting for opponent...');
            }
        } catch (error) {
            this.isSearching = false;
            this.updateMatchmakingUI();
            this.updateStatus(`Error finding match: ${error.message}`);
        }
    }

    cancelMatchmaking() {
        // Currently doesn't do anything as Firebase Functions doesn't support cancelling
        // You would need to implement this in the backend
        this.isSearching = false;
        this.updateMatchmakingUI();
        this.updateStatus('Match search cancelled');
    }

    updateMatchmakingUI() {
        if (this.findMatchButton) {
            this.findMatchButton.setVisible(!this.isSearching);
        }
        if (this.cancelButton) {
            this.cancelButton.setVisible(this.isSearching);
        }
    }

    updateStatus(message) {
        if (!this.sys.isActive()) {
            console.warn('Cannot update status, scene is not active');
            return;
        }
        this.statusText.setText(message);
        console.log(message);
    }
}

