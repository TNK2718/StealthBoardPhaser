export class Card {
    constructor(cardData) {
        this.id = cardData.id;

        // Make sure owner is properly assigned - it's crucial for visibility
        // Explicitly determine the owner - if provided use it, otherwise derive from ID
        if (cardData.owner) {
            this.owner = cardData.owner;
        } else {
            this.owner = cardData.id.startsWith('host') ? 'host' : 'guest';
            console.log(`Card ${cardData.id} assigned owner: ${this.owner}`);
        }

        // Handle position with safeguards
        this.setPosition(cardData);

        // Stats with defaults
        this.hp = cardData.hp || 3;
        this.maxHp = this.hp;
        this.atk = cardData.atk || 1;
        this.atkRange = cardData.atkRange || 1;
        this.speed = cardData.speed || 2;
        this.stealth = cardData.stealth !== undefined ? cardData.stealth : 3;
        this.stealthRegeneration = cardData.stealthRegeneration || 1;

        // Track whether this card is hidden due to stealth (from server)
        // Cards should never be hidden for their owner
        this.isHidden = cardData.isHidden || false;

        // UI references - will be set by CardUI
        this.container = null;
        this.sprite = null;
        this.statsText = null;
        this.hpText = null;
        this.speedText = null;
        this.stealthText = null;
    }

    /**
     * Set card position with safety checks
     * @param {Object} data - Position data
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

        // Make sure positions are within board boundaries (0-2 columns, 0-6 rows)
        this.col = Math.max(0, Math.min(Math.floor(col), 2));
        this.row = Math.max(0, Math.min(Math.floor(row), 6));

        // Log if we needed to fix positions
        if (!colIsValid || !rowIsValid || this.col !== col || this.row !== row) {
            console.log(`Card ${this.id} position fixed from (${data.col}, ${data.row}) to (${this.col}, ${this.row})`);
        }
    }

    /**
     * Update card state from server data
     * @param {Object} state - New state properties
     */
    updateState(state) {
        if (!state) return;

        // Handle position update, ensuring validation
        if (state.col !== undefined || state.row !== undefined) {
            const updateData = { col: state.col, row: state.row };
            if (state.col === undefined) updateData.col = this.col;
            if (state.row === undefined) updateData.row = this.row;
            this.setPosition(updateData);
        }

        // Update other stats
        if (state.hp !== undefined) this.hp = state.hp;
        if (state.maxHp !== undefined) this.maxHp = state.maxHp;
        if (state.atk !== undefined) this.atk = state.atk;
        if (state.atkRange !== undefined) this.atkRange = state.atkRange;
        if (state.speed !== undefined) this.speed = state.speed;
        if (state.stealth !== undefined) this.stealth = state.stealth;
        if (state.stealthRegeneration !== undefined) this.stealthRegeneration = state.stealthRegeneration;

        // Update hidden state - but ensure own cards are never hidden
        // This is a critical check to ensure owner's cards always remain visible
        if (state.isHidden !== undefined) {
            // Only apply isHidden=true for non-owner cards
            if (state.isHidden === true && this.owner !== window.gameContext?.localPlayer) {
                this.isHidden = true;
            } else if (state.isHidden === false) {
                this.isHidden = false;
            }

            // Debug log for visibility changes
            console.log(`Card ${this.id} visibility updated: isHidden=${this.isHidden} (server value was ${state.isHidden})`);
        }
    }

    /**
     * Check if this card is visible to the specified player
     * Cards are visible if:
     * 1. They belong to the viewer
     * 2. OR their stealth value is 0 or less
     * @param {string} viewer - Player ID checking visibility
     * @returns {boolean} - Whether the card is visible
     */
    isVisibleTo(viewer) {
        // Debug logging
        console.log(`Checking if ${this.id} (owner: ${this.owner}) is visible to ${viewer}`);

        // Own cards are always visible
        if (this.owner === viewer) {
            console.log(`${this.id} is owned by ${viewer}, always visible`);
            return true;
        }

        // If marked as hidden by server, respect that for non-owners
        if (this.isHidden) {
            console.log(`${this.id} is hidden from ${viewer}`);
            return false;
        }

        // Cards with stealth 0 or less are visible to enemies
        const visible = this.stealth <= 0;
        console.log(`${this.id} has stealth ${this.stealth}, visible to enemies: ${visible}`);
        return visible;
    }

    /**
     * Check if the card is alive (HP > 0)
     * @returns {boolean} - True if card is alive
     */
    isAlive() {
        return this.hp > 0;
    }

    /**
     * Get a human-readable string of the card stats
     * @returns {string} - Stats string for UI display
     */
    getStatsString() {
        if (this.isHidden) return "";
        return `HP: ${this.hp}/${this.maxHp}\nSpeed: ${this.speed}\nStealth: ${this.stealth}`;
    }
}