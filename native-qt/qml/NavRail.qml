import QtQuick
import LayrStyle

Rectangle {
    id: rail
    property var view: ({})
    property bool compact: false
    color: "#990a0c11"
    border.color: Style.border
    border.width: 0

    readonly property var entries: [
        { "id": "home", "label": "Home" },
        { "id": "move", "label": "Move" },
        { "id": "heat", "label": "Heat" },
        { "id": "files", "label": "Files" },
        { "id": "filament", "label": "Filament" },
        { "id": "more", "label": "More" },
        { "id": "settings", "label": "Setup" }
    ]

    Column {
        anchors.fill: parent
        anchors.topMargin: compact ? 8 : 12
        anchors.bottomMargin: compact ? 8 : 12
        spacing: compact ? 4 : 8

        Column {
            width: parent.width
            spacing: 2
            Rectangle { width: 22; height: 3; radius: 2; color: Style.cyan; anchors.horizontalCenter: parent.horizontalCenter }
            Rectangle { width: 16; height: 3; radius: 2; color: "#67b4f2"; anchors.horizontalCenter: parent.horizontalCenter }
            Rectangle { width: 11; height: 3; radius: 2; color: Style.purple; anchors.horizontalCenter: parent.horizontalCenter }
            Text {
                text: "LAYR"
                color: Style.text2
                font.pixelSize: 11
                font.bold: true
                font.letterSpacing: 2
                anchors.horizontalCenter: parent.horizontalCenter
            }
        }

        Item { width: 1; height: compact ? 4 : 8 }

        Repeater {
            model: rail.entries
            delegate: Rectangle {
                required property var modelData
                width: rail.width - 12
                height: Math.max(44, (rail.height - 92) / rail.entries.length)
                anchors.horizontalCenter: parent.horizontalCenter
                radius: 12
                color: (rail.view.page || "home") === modelData.id ? "#223ee0f0" : "transparent"
                border.color: (rail.view.page || "home") === modelData.id ? "#553ee0f0" : "transparent"

                Text {
                    anchors.centerIn: parent
                    text: modelData.label
                    color: (rail.view.page || "home") === modelData.id ? Style.text : Style.dim
                    font.pixelSize: rail.compact ? 12 : 13
                    font.bold: true
                }

                MouseArea {
                    anchors.fill: parent
                    cursorShape: rail.view.hideCursor ? Qt.BlankCursor : Qt.PointingHandCursor
                    onClicked: bridge.openPage(modelData.id)
                }
            }
        }
    }
}
