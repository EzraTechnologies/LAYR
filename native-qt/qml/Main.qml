import QtQuick
import QtQuick.Window
import LayrStyle

Window {
    id: root
    objectName: "layr-root"
    width: 1024
    height: 600
    visible: true
    color: Style.bg
    title: view.fixture ? "LAYR Qt fixture" : "LAYR"

    property string rawView: bridge.viewJson
    property var view: ({})
    property bool compact: width < 900 || height < 540

    function refresh() {
        try {
            view = JSON.parse(rawView)
        } catch (error) {
            view = ({})
        }
        Style.black = view.theme === "black"
    }

    onRawViewChanged: refresh()
    Component.onCompleted: refresh()

    Item {
        id: shell
        anchors.fill: parent

    Canvas {
        id: glow
        anchors.fill: parent
        onPaint: {
            var ctx = getContext("2d")
            ctx.reset()
            ctx.fillStyle = Style.black ? "#000000" : "#0a0c11"
            ctx.fillRect(0, 0, width, height)
            if (Style.black)
                return
            var purple = ctx.createRadialGradient(width * 0.9, 0, 10, width * 0.9, 0, width * 0.55)
            purple.addColorStop(0, "#148b6cff")
            purple.addColorStop(1, "#008b6cff")
            ctx.fillStyle = purple
            ctx.fillRect(0, 0, width, height)
            var cyan = ctx.createRadialGradient(0, height, 10, 0, height, width * 0.45)
            cyan.addColorStop(0, "#123ee0f0")
            cyan.addColorStop(1, "#003ee0f0")
            ctx.fillStyle = cyan
            ctx.fillRect(0, 0, width, height)
        }
        onWidthChanged: requestPaint()
        onHeightChanged: requestPaint()
        Component.onCompleted: requestPaint()
    }

    Row {
        anchors.fill: parent
        NavRail {
            id: nav
            width: root.compact ? 76 : 88
            height: parent.height
            view: root.view
            compact: root.compact
        }
        Item {
            width: parent.width - nav.width
            height: parent.height

            Rectangle {
                id: bar
                width: parent.width
                height: root.compact ? 52 : 60
                color: "transparent"
                Text {
                    anchors.verticalCenter: parent.verticalCenter
                    anchors.left: parent.left
                    anchors.leftMargin: root.compact ? 10 : 14
                    text: root.view.printerName || "LAYR"
                    color: Style.text
                    font.pixelSize: root.compact ? 18 : 22
                    font.bold: true
                }
                Row {
                    anchors.verticalCenter: parent.verticalCenter
                    anchors.right: parent.right
                    anchors.rightMargin: root.compact ? 10 : 14
                    spacing: 8
                    Rectangle {
                        height: 32
                        width: statusText.width + 20
                        radius: 16
                        color: "#221e2330"
                        border.color: Style.toneColor(root.view.tone || "dim")
                        Text {
                            id: statusText
                            anchors.centerIn: parent
                            text: root.view.statusLabel || "Offline"
                            color: Style.toneColor(root.view.tone || "dim")
                            font.bold: true
                            font.pixelSize: 13
                        }
                    }
                    Rectangle {
                        height: 32
                        width: lockText.width + 20
                        radius: 16
                        color: "#221e2330"
                        border.color: Style.border
                        Text {
                            id: lockText
                            anchors.centerIn: parent
                            text: root.view.fixture ? "Fixture" : "Read only"
                            color: Style.text2
                            font.bold: true
                            font.pixelSize: 13
                        }
                    }
                }
            }

            HomePage {
                anchors.top: bar.bottom
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.bottom: parent.bottom
                visible: (root.view.page || "home") === "home"
                view: root.view
                compact: root.compact
            }
            FilesPage {
                anchors.top: bar.bottom
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.bottom: parent.bottom
                visible: root.view.page === "files"
                view: root.view
                compact: root.compact
            }
            ControlsPage {
                anchors.top: bar.bottom
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.bottom: parent.bottom
                visible: root.view.page === "controls"
                view: root.view
                compact: root.compact
            }
            SettingsPage {
                anchors.top: bar.bottom
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.bottom: parent.bottom
                visible: root.view.page === "settings"
                view: root.view
                compact: root.compact
            }
        }
    }

    Rectangle {
        anchors.fill: parent
        visible: root.view.dimmed === true
        color: "#b3000000"
        MouseArea {
            anchors.fill: parent
            onPressed: bridge.wake()
        }
    }
    }
}
