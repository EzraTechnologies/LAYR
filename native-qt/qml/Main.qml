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
                        id: estop
                        height: 44
                        width: root.compact ? 72 : 88
                        radius: 12
                        color: estopHold.running ? Style.danger : "#33fb7185"
                        border.color: Style.danger
                        opacity: (root.view.gate && root.view.gate.host) ? 1 : 0.35
                        Text {
                            anchors.centerIn: parent
                            text: estopHold.running ? "Hold" : "STOP"
                            color: estopHold.running ? "#1a0a10" : Style.danger
                            font.bold: true
                            font.pixelSize: 14
                        }
                        Timer {
                            id: estopHold
                            interval: 800
                            onTriggered: bridge.emergencyStop()
                        }
                        MouseArea {
                            anchors.fill: parent
                            enabled: root.view.gate && root.view.gate.host === true
                            cursorShape: Qt.BlankCursor
                            onPressed: estopHold.start()
                            onReleased: estopHold.stop()
                            onCanceled: estopHold.stop()
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
                            text: root.view.modeLabel || (root.view.fixture ? "Fixture" : "Offline")
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
                visible: root.view.page === "move"
                view: root.view
                compact: root.compact
            }
            HeatPage {
                anchors.top: bar.bottom
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.bottom: parent.bottom
                visible: root.view.page === "heat"
                view: root.view
                compact: root.compact
            }
            MorePage {
                anchors.top: bar.bottom
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.bottom: parent.bottom
                visible: root.view.page === "more"
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

    Rectangle {
        visible: root.view.toast && root.view.toast.text
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.bottom: parent.bottom
        anchors.margins: 12
        radius: 12
        height: toastText.implicitHeight + 20
        color: "#f012151c"
        border.color: Style.toneColor((root.view.toast && root.view.toast.tone) || "warn")
        z: 5
        Text {
            id: toastText
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            anchors.margins: 12
            wrapMode: Text.WordWrap
            color: Style.text
            font.pixelSize: 14
            text: (root.view.toast && root.view.toast.text) ? root.view.toast.text : ""
        }
        MouseArea {
            anchors.fill: parent
            onClicked: bridge.dismissToast()
        }
    }

    Rectangle {
        visible: root.view.confirm && root.view.confirm.title
        anchors.fill: parent
        color: "#cc07080c"
        z: 6
        MouseArea { anchors.fill: parent }
        Rectangle {
            width: Math.min(parent.width - 48, 520)
            height: confirmBody.implicitHeight + 120
            anchors.centerIn: parent
            radius: 16
            color: Style.surface
            border.color: Style.border
            Column {
                anchors.fill: parent
                anchors.margins: 16
                spacing: 10
                Text {
                    id: confirmTitle
                    width: parent.width
                    wrapMode: Text.WordWrap
                    text: (root.view.confirm && root.view.confirm.title) ? root.view.confirm.title : ""
                    color: Style.text
                    font.bold: true
                    font.pixelSize: 20
                }
                Text {
                    id: confirmBody
                    width: parent.width
                    wrapMode: Text.WordWrap
                    text: (root.view.confirm && root.view.confirm.body) ? root.view.confirm.body : ""
                    color: Style.text2
                    font.pixelSize: 15
                }
                Row {
                    spacing: 8
                    Tap {
                        width: 160
                        label: (root.view.confirm && root.view.confirm.cancelLabel) ? root.view.confirm.cancelLabel : "Go back"
                        onTapped: bridge.dismissPending()
                    }
                    Tap {
                        width: 180
                        label: (root.view.confirm && root.view.confirm.confirmLabel) ? root.view.confirm.confirmLabel : "Confirm"
                        fill: (root.view.confirm && root.view.confirm.tone === "danger") ? Style.danger : Style.cyan
                        ink: "#061016"
                        onTapped: bridge.confirmPending()
                    }
                }
            }
        }
    }
    }
}
