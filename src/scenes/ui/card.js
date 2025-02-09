// not in use now
import Phaser from "phaser";

export class Card extends Phaser.GameObjects.Container {
    /**
     * @param {Phaser.Scene} scene - シーン
     * @param {number} x - コンテナのx座標
     * @param {number} y - コンテナのy座標
     * @param {string} cardTexture - カードのテクスチャキー
     * @param {string} cardName - カード名
     * @param {number} hp - HP値
     * @param {number} gridCellSize - グリッドセルのサイズ（例: 80）
     */
    constructor(scene, x, y, cardTexture, cardName, hp, gridCellSize) {
        super(scene, x, y);

        this.dragX = 0;
        this.dragY = 0;

        // グリッドセルサイズを元にカードサイズを計算（セルより少し小さくする）
        const cardMarginRatio = 0.1; // グリッドセルサイズの何割をマージンとするか（10%）
        const margin = gridCellSize * cardMarginRatio;
        const cardWidth = gridCellSize - margin;
        const cardHeight = gridCellSize - margin;

        // 影の設定：カードサイズに合わせ、余白は margin の半分
        const shadowPadding = margin * 0.5;
        const shadow = scene.add.graphics();
        shadow.fillStyle(0x000000, 0.5);
        shadow.fillRoundedRect(
            -cardWidth / 2 - shadowPadding,
            -cardHeight / 2 - shadowPadding,
            cardWidth + 2 * shadowPadding,
            cardHeight + 2 * shadowPadding,
            5
        );
        this.add(shadow);

        // カードの背景画像：グリッドセルのサイズに合わせる
        this.cardImage = scene.add.image(0, 0, cardTexture)
            .setDisplaySize(cardWidth, cardHeight);
        this.add(this.cardImage);

        // テキストのオフセットはカードサイズに応じて計算
        const textOffset = cardHeight * 0.5 + margin * 0.5;

        // カード名のテキスト：カードの上部に配置（フォントサイズもカードサイズに連動）
        this.cardName = scene.add.text(
            0,
            -textOffset,
            cardName,
            {
                fontSize: `${Math.round(cardHeight * 0.2)}px`,
                fontStyle: "bold",
                color: "#fff",
                backgroundColor: "#333",
                padding: {
                    left: Math.round(margin * 0.2),
                    right: Math.round(margin * 0.2),
                    top: Math.round(margin * 0.1),
                    bottom: Math.round(margin * 0.1)
                },
            }
        ).setOrigin(0.5);
        this.add(this.cardName);

        // HPのテキスト：カードの下部に配置
        this.cardHP = scene.add.text(
            0,
            textOffset,
            `HP: ${hp}`,
            {
                fontSize: `${Math.round(cardHeight * 0.18)}px`,
                fontStyle: "bold",
                color: "#ff0000",
                backgroundColor: "#000",
                padding: {
                    left: Math.round(margin * 0.2),
                    right: Math.round(margin * 0.2),
                    top: Math.round(margin * 0.1),
                    bottom: Math.round(margin * 0.1)
                },
            }
        ).setOrigin(0.5);
        this.add(this.cardHP);

        // コンテナサイズをカードサイズに合わせる
        this.setSize(cardWidth, cardHeight);
        this.setInteractive();

        // ドラッグ関連のイベント登録
        this.on("pointerdown", this.onDragStart, this);
        this.on("drag", this.onDrag, this);
        this.on("dragend", this.onDragEnd, this);

        scene.input.setDraggable(this);
        scene.add.existing(this);
    }

    onDragStart(pointer) {
        this.dragX = this.x - pointer.x;
        this.dragY = this.y - pointer.y;
        this.setScale(1.1);
        this.scene.children.bringToTop(this);
    }

    onDrag(pointer, dragX, dragY) {
        this.x = pointer.x + this.dragX;
        this.y = pointer.y + this.dragY;
    }

    onDragEnd() {
        this.setScale(1);
    }

    // Container には直接 setTint/clearTint がないため、内部の画像に対してラップする
    setTint(tint) {
        this.cardImage.setTint(tint);
        return this;
    }

    clearTint() {
        this.cardImage.clearTint();
        return this;
    }
}
