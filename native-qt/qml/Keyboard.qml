import QtQuick
import QtQuick.Layouts

Rectangle {
    id: board
    signal typed(string value)
    implicitHeight: win.compact ? 168 : 188
    color: "#0c1018"
    border.color: win.cardEdge

    property var rows: [
        ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
        ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
        ["a", "s", "d", "f", "g", "h", "j", "k", "l", "-"],
        ["z", "x", "c", "v", "b", "n", "m", ".", ":", "/"]
    ]

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 6
        spacing: 4
        Repeater {
            model: board.rows
            delegate: RowLayout {
                required property var modelData
                Layout.fillWidth: true
                spacing: 4
                Repeater {
                    model: modelData
                    delegate: Rectangle {
                        required property string modelData
                        Layout.fillWidth: true
                        Layout.fillHeight: true
                        Layout.preferredHeight: win.compact ? 36 : 40
                        radius: 8
                        color: hit.pressed ? win.cyan : win.surface3
                        Text { anchors.centerIn: parent; text: modelData; color: hit.pressed ? "#041316" : win.ink; font.pixelSize: 14 }
                        MouseArea {
                            id: hit
                            anchors.fill: parent
                            onClicked: board.typed(modelData)
                        }
                    }
                }
            }
        }
        RowLayout {
            Layout.fillWidth: true
            spacing: 4
            Rectangle {
                Layout.fillWidth: true
                Layout.preferredHeight: win.compact ? 36 : 40
                radius: 8
                color: spaceHit.pressed ? win.cyan : win.surface3
                Text { anchors.centerIn: parent; text: "space"; color: win.ink2; font.pixelSize: 12 }
                MouseArea { id: spaceHit; anchors.fill: parent; onClicked: board.typed(" ") }
            }
            Rectangle {
                Layout.preferredWidth: 96
                Layout.preferredHeight: win.compact ? 36 : 40
                radius: 8
                color: backHit.pressed ? win.cyan : win.surface3
                Text { anchors.centerIn: parent; text: "delete"; color: win.ink2; font.pixelSize: 12 }
                MouseArea { id: backHit; anchors.fill: parent; onClicked: board.typed("\b") }
            }
        }
    }
}
