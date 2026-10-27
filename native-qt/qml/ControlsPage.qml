import QtQuick
import LayrStyle

Item {
    id: page
    property var view: ({})
    property bool compact: false

    function tool() {
        return page.view.toolhead || ({})
    }
    function overrides() {
        return page.view.overrides || ({})
    }

    Column {
        anchors.fill: parent
        anchors.margins: page.compact ? 10 : 14
        spacing: page.compact ? 8 : 12

        Rectangle {
            width: parent.width
            height: page.compact ? 72 : 84
            radius: 16
            color: "#22fbbf24"
            border.color: "#55fbbf24"
            Text {
                anchors.fill: parent
                anchors.margins: 14
                verticalAlignment: Text.AlignVCenter
                wrapMode: Text.WordWrap
                color: Style.warn
                font.pixelSize: page.compact ? 13 : 15
                text: "Read only. Jog, homing, heaters, fans, pause, and cancel are not connected, so a tap on this page cannot move or heat the printer."
            }
        }

        Row {
            width: parent.width
            height: page.compact ? 120 : 150
            spacing: 12
            Rectangle {
                width: (parent.width - 12) / 2
                height: parent.height
                radius: 16
                color: Style.surface
                border.color: Style.border
                Column {
                    anchors.centerIn: parent
                    spacing: 6
                    Text { text: "HOMED"; color: Style.dim; font.pixelSize: 11; font.bold: true; anchors.horizontalCenter: parent.horizontalCenter }
                    Text { text: page.tool().homed || "—"; color: Style.text; font.pixelSize: 22; font.bold: true; anchors.horizontalCenter: parent.horizontalCenter }
                    Text { text: page.tool().maxVelocity || ""; color: Style.text2; font.pixelSize: 13; anchors.horizontalCenter: parent.horizontalCenter }
                }
            }
            Rectangle {
                width: (parent.width - 12) / 2
                height: parent.height
                radius: 16
                color: Style.surface
                border.color: Style.border
                Column {
                    anchors.fill: parent
                    anchors.margins: 16
                    spacing: 8
                    Text { text: "POSITION"; color: Style.dim; font.pixelSize: 11; font.bold: true }
                    Text { text: page.tool().position || "—"; color: Style.cyan; font.pixelSize: page.compact ? 16 : 20; font.bold: true; width: parent.width; elide: Text.ElideRight }
                }
            }
        }

        Rectangle {
            width: parent.width
            height: page.compact ? 130 : 160
            radius: 16
            color: Style.surface
            border.color: Style.border
            Column {
                anchors.fill: parent
                anchors.margins: 16
                spacing: 8
                Text { text: "OVERRIDES"; color: Style.dim; font.pixelSize: 11; font.bold: true; font.letterSpacing: 1 }
                Text {
                    width: parent.width
                    wrapMode: Text.WordWrap
                    text: page.overrides().note || ""
                    color: Style.text2
                    font.pixelSize: 13
                }
                Row {
                    spacing: 18
                    Text { text: "M220 speed factor  " + (page.overrides().speed || "—"); color: Style.text; font.bold: true; font.pixelSize: 16 }
                    Text { text: "M221 extrude factor  " + (page.overrides().flow || "—"); color: Style.text; font.bold: true; font.pixelSize: 16 }
                }
            }
        }
    }
}
