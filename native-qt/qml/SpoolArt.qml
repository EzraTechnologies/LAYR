import QtQuick
import LayrStyle

Item {
    id: art
    property var colors: []
    property string imageKey: ""
    property bool active: false

    Rectangle {
        anchors.fill: parent
        radius: 10
        color: "transparent"
        border.width: art.active ? 2 : 0
        border.color: Style.cyan
    }

    Image {
        anchors.fill: parent
        anchors.margins: 4
        visible: art.imageKey.length > 0
        source: art.imageKey.length > 0
               ? "image://thumbs/" + encodeURIComponent(art.imageKey) + "?v=" + bridge.thumbToken
               : ""
        fillMode: Image.PreserveAspectFit
        asynchronous: false
        cache: false
    }

    Item {
        anchors.fill: parent
        anchors.margins: 4
        visible: art.imageKey.length === 0

        Rectangle {
            width: parent.width * 0.18
            height: parent.height
            radius: width / 2
            color: "#2c3344"
            anchors.left: parent.left
        }
        Rectangle {
            width: parent.width * 0.18
            height: parent.height
            radius: width / 2
            color: "#2c3344"
            anchors.right: parent.right
        }
        Row {
            anchors.centerIn: parent
            width: parent.width * 0.64
            height: parent.height * 0.62
            spacing: 0
            Repeater {
                model: (art.colors && art.colors.length > 0) ? art.colors : ["#3a4154"]
                delegate: Rectangle {
                    required property var modelData
                    width: parent.width / Math.max(1, ((art.colors && art.colors.length > 0) ? art.colors.length : 1))
                    height: parent.height
                    color: modelData
                }
            }
        }
    }
}
