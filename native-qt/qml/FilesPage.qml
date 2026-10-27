import QtQuick
import LayrStyle

Item {
    id: page
    property var view: ({})
    property bool compact: false

    function files() {
        return page.view.files || ({})
    }

    Row {
        anchors.fill: parent
        anchors.margins: page.compact ? 10 : 14
        spacing: page.compact ? 8 : 12

        Rectangle {
            id: listCard
            width: page.files().selected ? parent.width * 0.56 : parent.width
            height: parent.height
            radius: 16
            color: Style.surface
            border.color: Style.border

            Column {
                anchors.fill: parent
                anchors.margins: 12
                spacing: 8

                Row {
                    width: parent.width
                    height: 48
                    spacing: 8
                    Rectangle {
                        visible: page.files().path && page.files().path.length > 0
                        width: 88
                        height: 48
                        radius: 12
                        color: Style.surface3
                        Text { anchors.centerIn: parent; text: "Up"; color: Style.text; font.bold: true }
                        MouseArea {
                            anchors.fill: parent
                            cursorShape: page.view.hideCursor ? Qt.BlankCursor : Qt.PointingHandCursor
                            onClicked: {
                                var path = page.files().path || ""
                                var slash = path.lastIndexOf("/")
                                bridge.openDirectory(slash < 0 ? "" : path.substring(0, slash))
                            }
                        }
                    }
                    Text {
                        anchors.verticalCenter: parent.verticalCenter
                        text: (page.files().path && page.files().path.length > 0) ? page.files().path : "G-code"
                        color: Style.text
                        font.bold: true
                        font.pixelSize: 18
                    }
                }

                Text {
                    visible: page.files().error && page.files().error.length > 0
                    text: page.files().error
                    color: Style.danger
                    width: parent.width
                }

                Flickable {
                    width: parent.width
                    height: parent.height - y
                    contentHeight: column.height
                    clip: true
                    boundsBehavior: Flickable.StopAtBounds
                    Column {
                        id: column
                        width: parent.width
                        spacing: 6
                        Repeater {
                            model: page.files().dirs || []
                            delegate: Rectangle {
                                required property var modelData
                                width: column.width
                                height: 56
                                radius: 12
                                color: Style.surface3
                                Text {
                                    anchors.verticalCenter: parent.verticalCenter
                                    anchors.left: parent.left
                                    anchors.leftMargin: 14
                                    text: modelData.name
                                    color: Style.cyan
                                    font.bold: true
                                }
                                MouseArea {
                                    anchors.fill: parent
                                    cursorShape: page.view.hideCursor ? Qt.BlankCursor : Qt.PointingHandCursor
                                    onClicked: bridge.openDirectory(modelData.path)
                                }
                            }
                        }
                        Repeater {
                            model: page.files().files || []
                            delegate: Rectangle {
                                required property var modelData
                                width: column.width
                                height: 64
                                radius: 12
                                color: modelData.selected ? "#223ee0f0" : Style.surface2
                                border.color: Style.border
                                Column {
                                    anchors.verticalCenter: parent.verticalCenter
                                    anchors.left: parent.left
                                    anchors.leftMargin: 14
                                    anchors.right: parent.right
                                    spacing: 2
                                    Text { text: modelData.name; color: Style.text; font.bold: true; font.pixelSize: 16; elide: Text.ElideRight; width: parent.width }
                                    Text { text: modelData.detail || ""; color: Style.dim; font.pixelSize: 12; elide: Text.ElideRight; width: parent.width }
                                }
                                MouseArea {
                                    anchors.fill: parent
                                    cursorShape: page.view.hideCursor ? Qt.BlankCursor : Qt.PointingHandCursor
                                    onClicked: bridge.selectFile(modelData.path)
                                }
                            }
                        }
                        Text {
                            visible: (page.files().dirs || []).length === 0 && (page.files().files || []).length === 0 && !(page.files().error && page.files().error.length)
                            text: "No G-code in this folder."
                            color: Style.dim
                            font.pixelSize: 14
                        }
                    }
                }
            }
        }

        Rectangle {
            visible: page.files().selected
            width: parent.width - listCard.width - parent.spacing
            height: parent.height
            radius: 16
            color: Style.surface
            border.color: Style.border

            Column {
                anchors.fill: parent
                anchors.margins: 16
                spacing: 10
                Text { text: "FILE"; color: Style.dim; font.pixelSize: 11; font.bold: true; font.letterSpacing: 1 }
                Text {
                    width: parent.width
                    wrapMode: Text.WordWrap
                    text: page.files().selected ? page.files().selected.name : ""
                    color: Style.text
                    font.bold: true
                    font.pixelSize: 20
                }
                Text { text: "Slicer  " + (page.files().selected ? page.files().selected.slicer : "—"); color: Style.text2 }
                Text { text: "Estimate  " + (page.files().selected ? page.files().selected.estimated : "—"); color: Style.text2 }
                Text { text: "Filament  " + (page.files().selected ? page.files().selected.filament : "—"); color: Style.text2 }
                Text {
                    width: parent.width
                    wrapMode: Text.WordWrap
                    text: page.files().selected ? page.files().selected.note : ""
                    color: Style.warn
                }
            }
        }
    }
}
