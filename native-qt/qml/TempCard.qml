import QtQuick
import QtQuick.Layouts

Rectangle {
    id: card
    property string label: "Nozzle"
    property string temp: "—"
    property string target: ""
    property color accent: win.cyan
    radius: win.compact ? 12 : 16
    color: win.card
    border.color: win.cardEdge
    border.width: 1
    implicitHeight: win.touch

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: win.compact ? 8 : 12
        spacing: 0

        Text {
            text: card.label.toUpperCase()
            color: win.dim
            font.pixelSize: win.compact ? 10 : 11
            font.weight: Font.DemiBold
            font.letterSpacing: 1.1
        }
        Item { Layout.fillHeight: true; Layout.minimumHeight: 2 }
        Text {
            text: card.temp
            color: card.temp === "—" ? win.dim : win.ink
            font.pixelSize: win.compact ? 28 : 36
            font.weight: Font.Medium
            font.family: Qt.application.font.family
        }
        Text {
            text: card.target || " "
            color: card.accent
            font.pixelSize: win.compact ? 11 : 12
            font.weight: Font.Medium
        }
    }
}
