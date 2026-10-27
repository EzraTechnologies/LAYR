import QtQuick
import LayrStyle

Rectangle {
    id: tap
    property string label: ""
    property color fill: Style.surface3
    property color ink: Style.text
    signal tapped()
    implicitHeight: 48
    height: 48
    radius: 12
    color: fill
    opacity: enabled ? 1 : 0.38

    Text {
        anchors.centerIn: parent
        width: parent.width - 8
        horizontalAlignment: Text.AlignHCenter
        elide: Text.ElideRight
        text: tap.label
        color: tap.ink
        font.bold: true
        font.pixelSize: 15
    }

    MouseArea {
        anchors.fill: parent
        enabled: tap.enabled
        cursorShape: Qt.BlankCursor
        onClicked: tap.tapped()
    }
}
