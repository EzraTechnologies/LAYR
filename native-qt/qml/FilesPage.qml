import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

Item {
    property string selected: ""
    property var entries: (bridge.files && bridge.files.entries) ? bridge.files.entries : []

    RowLayout {
        anchors.fill: parent
        anchors.leftMargin: win.pad
        anchors.rightMargin: win.pad
        anchors.bottomMargin: win.pad
        spacing: win.gap

        Rectangle {
            Layout.fillWidth: true
            Layout.fillHeight: true
            Layout.preferredWidth: 3
            radius: 16
            color: win.card
            border.color: win.cardEdge

            ColumnLayout {
                anchors.fill: parent
                anchors.margins: 10
                spacing: 8

                RowLayout {
                    Layout.fillWidth: true
                    Button {
                        text: "Up"
                        implicitHeight: win.touch
                        implicitWidth: 72
                        enabled: bridge.files && bridge.files.directory
                        onClicked: bridge.openParent()
                    }
                    Text {
                        Layout.fillWidth: true
                        text: (bridge.files && bridge.files.directory) ? ("gcodes/" + bridge.files.directory) : "gcodes"
                        color: win.ink2
                        elide: Text.ElideLeft
                    }
                }

                Text {
                    visible: bridge.files && bridge.files.message
                    text: bridge.files ? bridge.files.message : ""
                    color: win.warn
                    font.pixelSize: 12
                }

                ListView {
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    clip: true
                    spacing: 6
                    model: entries
                    delegate: Rectangle {
                        required property var modelData
                        required property int index
                        width: ListView.view.width
                        height: Math.max(win.touch, 52)
                        radius: 12
                        color: selected === modelData.path ? "#3ee0f014" : "#10141c"
                        border.color: win.cardEdge
                        RowLayout {
                            anchors.fill: parent
                            anchors.leftMargin: 12
                            anchors.rightMargin: 12
                            Text {
                                text: modelData.kind === "dir" ? "DIR" : "G"
                                color: modelData.kind === "dir" ? win.purple : win.cyan
                                font.pixelSize: 11
                                font.weight: Font.DemiBold
                            }
                            ColumnLayout {
                                Layout.fillWidth: true
                                spacing: 0
                                Text { text: modelData.name; color: win.ink; elide: Text.ElideRight; Layout.fillWidth: true; font.weight: Font.Medium }
                                Text { text: modelData.meta || ""; color: win.dim; font.pixelSize: 11; elide: Text.ElideRight; Layout.fillWidth: true }
                            }
                        }
                        MouseArea {
                            anchors.fill: parent
                            onClicked: {
                                win.notePress("file-row")
                                if (modelData.kind === "dir") {
                                    selected = ""
                                    win.openDirectory(modelData.path)
                                } else {
                                    selected = modelData.path
                                }
                            }
                        }
                    }
                }
            }
        }

        Rectangle {
            Layout.fillWidth: true
            Layout.fillHeight: true
            Layout.preferredWidth: 2
            radius: 16
            color: win.card
            border.color: win.cardEdge
            ColumnLayout {
                anchors.fill: parent
                anchors.margins: 14
                spacing: 8
                Text { text: "FILE"; color: win.dim; font.pixelSize: 11; font.weight: Font.DemiBold; font.letterSpacing: 1 }
                Text {
                    Layout.fillWidth: true
                    text: selected || "Select a file"
                    color: win.ink
                    wrapMode: Text.Wrap
                    font.pixelSize: win.compact ? 14 : 16
                    font.weight: Font.DemiBold
                }
                Text {
                    Layout.fillWidth: true
                    text: "Starting a print and deleting files are disabled in this prototype."
                    color: win.ink2
                    wrapMode: Text.Wrap
                    font.pixelSize: 13
                }
                Item { Layout.fillHeight: true }
            }
        }
    }
}
