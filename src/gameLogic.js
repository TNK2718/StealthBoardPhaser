export class GameLogic {
    constructor() {
        this.gameState = {
            grid: Array(5).fill().map(() => Array(5).fill(null)),
        };
    }

    placeShip(x, y) {
        if (!this.gameState.grid[y][x]) {
            this.gameState.grid[y][x] = 'ship';
            return { x, y };
        }
        return null;
    }

    handleGameMessage(message) {
        if (message.type === 'placeShip') {
            return this.placeShip(message.x, message.y);
        }
    }
}
