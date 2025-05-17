/**
 * Server-side implementation of Card class for Firebase Functions
 * This version removes UI dependencies and is optimized for backend processing
 */
class ServerCard {
    constructor(cardData) {
        this.id = cardData.id;
        this.owner = cardData.owner || (cardData.id.startsWith('host') ? 'host' : 'guest');

        // Set position with defaults if needed
        this.setPosition(cardData);

        this.hp = cardData.hp;
        this.maxHp = cardData.hp;
        this.atk = cardData.atk || 1; // Default attack value
        this.atkRange = cardData.atkRange || 1; // Default attack range
        this.speed = cardData.speed;
        this.stealth = cardData.stealth;
        this.stealthRegeneration = cardData.stealthRegeneration || 0;
    }

    /**
     * Set position with defaults based on card ID if needed
     */
    setPosition(data) {
        // Default starting positions based on card ID
        let defaultRow = this.id.startsWith('host') ? 6 : 0;
        let defaultCol = 0;

        // Extract column number from card ID (e.g., 'host_1' -> col 1)
        if (this.id.includes('_')) {
            const idNum = parseInt(this.id.split('_')[1], 10);
            if (!isNaN(idNum) && idNum >= 0 && idNum <= 2) {
                defaultCol = idNum;
            }
        }

        // Check if we received valid numeric values
        const colIsValid = data.col !== undefined &&
            data.col !== null &&
            !isNaN(Number(data.col));

        const rowIsValid = data.row !== undefined &&
            data.row !== null &&
            !isNaN(Number(data.row));

        // Set positions with fallbacks
        const col = colIsValid ? Number(data.col) : defaultCol;
        const row = rowIsValid ? Number(data.row) : defaultRow;

        // Ensure positions are within board boundaries (0-2 columns, 0-6 rows)
        this.col = Math.max(0, Math.min(Math.floor(col), 2));
        this.row = Math.max(0, Math.min(Math.floor(row), 6));

        // Log if we needed to fix positions
        if (!colIsValid || !rowIsValid || this.col !== col || this.row !== row) {
            console.log(`Card ${this.id} position fixed from (${data.col}, ${data.row}) to (${this.col}, ${this.row})`);
        } else {
            // Debug position
            console.log(`Card ${this.id} position set to (${this.col},${this.row})`);
        }
    }

    /**
     * Update card state with new values
     */
    updateState(state) {
        if (state.col !== undefined) this.col = state.col;
        if (state.row !== undefined) this.row = state.row;
        if (state.hp !== undefined) this.hp = state.hp;
        if (state.speed !== undefined) this.speed = state.speed;
        if (state.stealth !== undefined) this.stealth = state.stealth;
        if (state.stealthRegeneration !== undefined) this.stealthRegeneration = state.stealthRegeneration;
    }

    /**
     * Check if card is visible to a specific player
     */
    isVisibleTo(viewer) {
        // Own cards are always visible
        if (this.owner === viewer) return true;

        // Cards with stealth 0 or less are visible to opponents
        return this.stealth <= 0;
    }

    /**
     * Check if card is alive
     */
    isAlive() {
        return this.hp > 0;
    }    /**
     * Convert to plain object for Firestore
     */
    toFirestoreObject() {
        return {
            id: this.id,
            owner: this.owner,
            row: this.row,
            col: this.col,
            hp: this.hp,
            maxHp: this.maxHp,
            atk: this.atk,
            atkRange: this.atkRange,
            speed: this.speed,
            stealth: this.stealth,
            stealthRegeneration: this.stealthRegeneration,
            // Explicitly set isHidden to false - client will determine visibility
            // This ensures player's own cards are always visible to them
            isHidden: false
        };
    }

    /**
     * Create a ServerCard instance from Firestore data
     */
    static fromFirestore(data) {
        return new ServerCard(data);
    }

    /**
     * Create a deep clone of the card
     */
    clone() {
        return new ServerCard(this.toFirestoreObject());
    }
}

module.exports = ServerCard;
