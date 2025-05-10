export class Card {
    constructor(cardData) {
        this.id = cardData.id;
        this.owner = cardData.id.startsWith('host') ? 'host' : 'guest';
        this.hp = cardData.hp;
        this.speed = cardData.speed;
        this.col = cardData.col;
        this.row = cardData.row;
        this.stealth = cardData.stealth || 3; // 初期隠密値

        // UI references - will be set by CardUI
        this.container = null;
        this.sprite = null;
        this.statsText = null;
    }

    /**
     * カード状態の更新
     */
    updateState(state) {
        if (state.col !== undefined) this.col = state.col;
        if (state.row !== undefined) this.row = state.row;
        if (state.hp !== undefined) this.hp = state.hp;
        if (state.stealth !== undefined) this.stealth = state.stealth;
    }

    /**
     * 相手カードが可視か判定（隠密値が0以下で可視）
     */
    isVisibleTo(viewer) {
        // 自分のカードは常に表示
        if (this.owner === viewer) return true;

        // 隠密値が0以下なら表示
        return this.stealth <= 0;
    }

    /**
     * カードが生きているかどうか
     */
    isAlive() {
        return this.hp > 0;
    }
}