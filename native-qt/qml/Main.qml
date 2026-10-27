import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

ApplicationWindow {
    id: win
    width: 1024
    height: 600
    visible: true
    title: "LAYR Qt"
    color: bridge.themeName === "black" ? "#000000" : "#0a0c11"

    property bool compact: width <= 900 || height <= 540
    property int railW: compact ? 76 : 88
    property int barH: compact ? 52 : 60
    property int pad: compact ? 10 : 14
    property int gap: compact ? 8 : 12
    property int touch: compact ? 46 : 48
    property color ink: "#e9edf5"
    property color ink2: "#b4bccc"
    property color dim: "#7f889c"
    property color cyan: "#3ee0f0"
    property color purple: "#8b6cff"
    property color ok: "#4ade80"
    property color warn: "#fbbf24"
    property color danger: "#fb7185"
    property color heat: "#ff8a4c"
    property color card: bridge.themeName === "black" ? "#0c0e13" : "#171b24"
    property color surface3: bridge.themeName === "black" ? "#151922" : "#1e2330"
    property color cardEdge: "#2a3142"
    property var state: bridge.state
    property string currentPage: bridge.page
    property int pageIndex: currentPage === "files" ? 1 : currentPage === "controls" ? 2 : currentPage === "settings" ? 3 : 0

    function notePress(name) { bridge.notePress(name) }
    function openPage(key) { bridge.openPage(key) }
    function openDirectory(path) { bridge.openDirectory(path) }

    font.family: Qt.application.font.family
    font.pixelSize: compact ? 14 : 15

    function toneColor(tone) {
        if (tone === "ok") return ok
        if (tone === "cyan") return cyan
        if (tone === "warn") return warn
        if (tone === "danger") return danger
        if (tone === "purple") return purple
        return dim
    }

    RowLayout {
        anchors.fill: parent
        spacing: 0

        Rectangle {
            Layout.preferredWidth: win.railW
            Layout.fillHeight: true
            color: bridge.themeName === "black" ? "#050506" : "#0d1016"

            ColumnLayout {
                anchors.fill: parent
                anchors.topMargin: 10
                anchors.bottomMargin: 10
                spacing: 6

                Item {
                    Layout.fillWidth: true
                    Layout.preferredHeight: win.compact ? 36 : 44
                    Text {
                        anchors.centerIn: parent
                        text: "LAYR"
                        color: win.cyan
                        font.pixelSize: win.compact ? 13 : 15
                        font.weight: Font.DemiBold
                        font.letterSpacing: 1.4
                    }
                }

                Repeater {
                    model: [
                        { key: "home", label: "Home" },
                        { key: "files", label: "Files" },
                        { key: "controls", label: "Controls" },
                        { key: "settings", label: "Settings" }
                    ]
                    delegate: Rectangle {
                        required property var modelData
                        Layout.fillWidth: true
                        Layout.leftMargin: 8
                        Layout.rightMargin: 8
                        Layout.preferredHeight: Math.max(win.touch, 54)
                        radius: 12
                        color: win.currentPage === modelData.key ? "#3ee0f01f" : (area.pressed ? "#ffffff10" : "transparent")
                        border.color: win.currentPage === modelData.key ? "#3ee0f066" : "transparent"
                        border.width: 1

                        Column {
                            anchors.centerIn: parent
                            spacing: 2
                            Rectangle {
                                anchors.horizontalCenter: parent.horizontalCenter
                                width: 18
                                height: 3
                                radius: 2
                                color: win.currentPage === modelData.key ? win.cyan : win.dim
                            }
                            Text {
                                anchors.horizontalCenter: parent.horizontalCenter
                                text: modelData.label
                                color: win.currentPage === modelData.key ? win.ink : win.ink2
                                font.pixelSize: win.compact ? 11 : 12
                                font.weight: Font.Medium
                            }
                        }

                        MouseArea {
                            id: area
                            anchors.fill: parent
                            onPressed: win.notePress("nav-" + modelData.key)
                            onClicked: win.openPage(modelData.key)
                        }
                    }
                }

                Item { Layout.fillHeight: true }

                Text {
                    Layout.alignment: Qt.AlignHCenter
                    text: "READ\nONLY"
                    horizontalAlignment: Text.AlignHCenter
                    color: win.dim
                    font.pixelSize: 10
                    font.weight: Font.DemiBold
                    font.letterSpacing: 0.8
                }
            }
        }

        ColumnLayout {
            Layout.fillWidth: true
            Layout.fillHeight: true
            spacing: 0

            Rectangle {
                Layout.fillWidth: true
                Layout.preferredHeight: win.barH
                color: "transparent"

                RowLayout {
                    anchors.fill: parent
                    anchors.leftMargin: win.pad
                    anchors.rightMargin: win.pad
                    spacing: 10

                    ColumnLayout {
                        Layout.fillWidth: true
                        spacing: 0
                        Text {
                            text: (win.state && win.state.printerName) ? win.state.printerName : "LAYR"
                            color: win.ink
                            font.pixelSize: win.compact ? 16 : 18
                            font.weight: Font.DemiBold
                            elide: Text.ElideRight
                            Layout.fillWidth: true
                        }
                        Text {
                            visible: bridge.fixtureMode || (win.state && win.state.statusDetail)
                            text: bridge.fixtureMode ? "Fixture data — not a live printer" : (win.state.statusDetail || "")
                            color: bridge.fixtureMode ? win.warn : win.dim
                            font.pixelSize: 11
                            elide: Text.ElideRight
                            Layout.fillWidth: true
                        }
                    }

                    Rectangle {
                        Layout.preferredHeight: 32
                        Layout.preferredWidth: pill.implicitWidth + 22
                        radius: 16
                        color: Qt.rgba(win.toneColor(win.state ? win.state.statusTone : "dim").r,
                                       win.toneColor(win.state ? win.state.statusTone : "dim").g,
                                       win.toneColor(win.state ? win.state.statusTone : "dim").b, 0.14)
                        border.color: win.toneColor(win.state ? win.state.statusTone : "dim")
                        border.width: 1
                        Text {
                            id: pill
                            anchors.centerIn: parent
                            text: (win.state && win.state.statusLabel) ? win.state.statusLabel : "Offline"
                            color: win.toneColor(win.state ? win.state.statusTone : "dim")
                            font.pixelSize: 12
                            font.weight: Font.DemiBold
                        }
                    }
                }
            }

            StackLayout {
                Layout.fillWidth: true
                Layout.fillHeight: true
                currentIndex: win.pageIndex
                HomePage { }
                FilesPage { }
                ControlsPage { }
                SettingsPage { }
            }
        }
    }
}
