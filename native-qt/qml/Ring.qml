import QtQuick
import LayrStyle

Item {
    id: ring
    property real progress: 0
    property color accent: Style.cyan
    property string center: "—"

    Canvas {
        id: canvas
        anchors.fill: parent
        onPaint: {
            var ctx = getContext("2d")
            ctx.reset()
            var side = Math.min(width, height)
            var line = Math.max(8, side * 0.075)
            var radius = (side - line) / 2 - 1
            var cx = width / 2
            var cy = height / 2
            ctx.lineWidth = line
            ctx.lineCap = "round"
            ctx.strokeStyle = "#14ffffff"
            ctx.beginPath()
            ctx.arc(cx, cy, radius, 0, Math.PI * 2)
            ctx.stroke()
            var amount = Math.max(0, Math.min(1, ring.progress))
            if (amount > 0) {
                ctx.strokeStyle = ring.accent
                ctx.beginPath()
                var start = -Math.PI / 2
                ctx.arc(cx, cy, radius, start, start + amount * Math.PI * 2)
                ctx.stroke()
            }
        }
    }

    onProgressChanged: canvas.requestPaint()
    onAccentChanged: canvas.requestPaint()
    onWidthChanged: canvas.requestPaint()
    onHeightChanged: canvas.requestPaint()
    Component.onCompleted: canvas.requestPaint()

    Row {
        anchors.centerIn: parent
        spacing: 1
        Text {
            text: ring.center
            color: Style.text
            font.pixelSize: ring.width < 150 ? 28 : 36
            font.bold: true
        }
        Text {
            visible: ring.center !== "—"
            text: "%"
            color: Style.text2
            font.pixelSize: ring.width < 150 ? 14 : 16
            font.bold: true
            anchors.baseline: parent.children[0].baseline
        }
    }
}
