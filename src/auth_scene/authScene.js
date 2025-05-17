import Phaser from 'phaser';
import firebaseService from '../firebase/firebaseService';

export class AuthScene extends Phaser.Scene {
    constructor() {
        super('AuthScene');
    }

    create() {
        this.add.text(400, 50, 'Stealth Board Game', { fontSize: '32px', fill: '#ffffff' })
            .setOrigin(0.5);

        this.statusText = this.add.text(400, 100, 'Please sign in to continue', { fontSize: '18px', fill: '#ffffff' })
            .setOrigin(0.5);

        // Anonymous login button
        this.anonymousButton = this.add.text(400, 200, 'Sign in Anonymously', { fontSize: '18px', fill: '#ffffff' })
            .setOrigin(0.5)
            .setInteractive({ useHandCursor: true })
            .on('pointerdown', () => this.signInAnonymously())
            .on('pointerover', () => this.anonymousButton.setStyle({ fill: '#ff0' }))
            .on('pointerout', () => this.anonymousButton.setStyle({ fill: '#ffffff' }));

        // Google login button
        this.googleButton = this.add.text(400, 250, 'Sign in with Google', { fontSize: '18px', fill: '#ffffff' })
            .setOrigin(0.5)
            .setInteractive({ useHandCursor: true })
            .on('pointerdown', () => this.signInWithGoogle())
            .on('pointerover', () => this.googleButton.setStyle({ fill: '#ff0' }))
            .on('pointerout', () => this.googleButton.setStyle({ fill: '#ffffff' }));
    }

    async signInAnonymously() {
        this.updateStatus('Signing in anonymously...');
        try {
            await firebaseService.signInAnonymously();
            this.proceedToLobby();
        } catch (error) {
            this.updateStatus(`Error: ${error.message}`);
        }
    }

    async signInWithGoogle() {
        this.updateStatus('Signing in with Google...');
        try {
            await firebaseService.signInWithGoogle();
            this.proceedToLobby();
        } catch (error) {
            this.updateStatus(`Error: ${error.message}`);
        }
    }

    updateStatus(message) {
        this.statusText.setText(message);
        console.log(message);
    }

    proceedToLobby() {
        const user = firebaseService.getCurrentUser();
        this.updateStatus(`Signed in as ${user.uid}`);
        this.scene.start('LobbyScene');
    }
}
