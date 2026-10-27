import QtQuick
import QtQuick.Layouts

Item {
    Flickable {
        anchors.fill: parent
        anchors.leftMargin: win.pad
        anchors.rightMargin: win.pad
        anchors.bottomMargin: win.pad
        contentWidth: width
        contentHeight: column.implicitHeight
        clip: true

        ColumnLayout {
            id: column
            width: parent.width
            spacing: win.gap

            Rectangle {
                Layout.fillWidth: true
                radius: 16
                color: "#3b2a12"
                border.color: win.warn
                implicitHeight: banner.implicitHeight + 20
                Text {
                    id: banner
                    anchors.fill: parent
                    anchors.margins: 12
                    text: "Read-only prototype. Motors, heaters, macros, and emergency stop are not sent. Confirm a later review before any live control."
                    color: win.warn
                    wrapMode: Text.Wrap
                    font.pixelSize: 13
                }
            }

            GridLayout {
                Layout.fillWidth: true
                columns: win.compact ? 1 : 2
                columnSpacing: win.gap
                rowSpacing: win.gap

                Repeater {
                    model: [
                        { k: "Position", v: win.state ? win.state.positionText : "—" },
                        { k: "Homed axes", v: win.state ? win.state.homedText : "—" },
                        { k: "M220 speed factor", v: win.state ? win.state.speedFactorText : "—" },
                        { k: "M221 extrude factor", v: win.state ? win.state.extrudeFactorText : "—" },
                        { k: "Live speed", v: win.state ? (win.state.speedText + " mm/s") : "—" },
                        { k: "Live flow", v: win.state ? (win.state.flowText + " mm³/s") : "—" },
                        { k: "Can extrude", v: !win.state || win.state.canExtrude === "" ? "—" : (win.state.canExtrude === "yes" ? "Yes" : "Below minimum temperature") }
                    ]
                    delegate: Rectangle {
                        required property var modelData
                        Layout.fillWidth: true
                        implicitHeight: Math.max(win.touch + 8, 64)
                        radius: 14
                        color: win.card
                        border.color: win.cardEdge
                        Column {
                            anchors.verticalCenter: parent.verticalCenter
                            anchors.left: parent.left
                            anchors.leftMargin: 14
                            anchors.right: parent.right
                            anchors.rightMargin: 14
                            spacing: 2
                            Text { text: modelData.k.toUpperCase(); color: win.dim; font.pixelSize: 10; font.weight: Font.DemiBold; font.letterSpacing: 0.8 }
                            Text { text: modelData.v; color: win.ink; font.pixelSize: 16; font.weight: Font.Medium; elide: Text.ElideRight; width: parent.width }
                        }
                    }
                }
            }

            Text {
                text: "M220 and M221 are override multipliers. They are not the mm/s or mm³/s readouts."
                color: win.dim
                font.pixelSize: 12
                wrapMode: Text.Wrap
                Layout.fillWidth: true
            }

            Repeater {
                model: (win.state && win.state.fans) ? win.state.fans : []
                delegate: Rectangle {
                    required property var modelData
                    Layout.fillWidth: true
                    implicitHeight: win.touch
                    radius: 12
                    color: win.card
                    border.color: win.cardEdge
                    RowLayout {
                        anchors.fill: parent
                        anchors.leftMargin: 14
                        anchors.rightMargin: 14
                        Text { text: modelData.label; color: win.ink2; Layout.fillWidth: true }
                        Text { text: modelData.value; color: win.ink; font.weight: Font.DemiBold }
                    }
                }
            }

            RowLayout {
                Layout.fillWidth: true
                spacing: 8
                Repeater {
                    model: ["Home all", "Set nozzle", "Motors off"]
                    delegate: Rectangle {
                        required property string modelData
                        Layout.fillWidth: true
                        Layout.preferredHeight: win.touch
                        radius: 12
                        color: "#141820"
                        opacity: 0.55
                        border.color: win.cardEdge
                        Text { anchors.centerIn: parent; text: modelData; color: win.dim; font.pixelSize: 13 }
                    }
                }
            }
        }
    }
}
