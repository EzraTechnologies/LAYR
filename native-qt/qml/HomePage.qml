import QtQuick
import QtQuick.Layouts

Item {
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
            radius: win.compact ? 14 : 18
            color: win.card
            border.color: win.cardEdge
            border.width: 1

            ColumnLayout {
                anchors.fill: parent
                anchors.margins: win.compact ? 10 : 14
                spacing: win.gap

                RowLayout {
                    Layout.fillWidth: true
                    spacing: 10
                    Rectangle {
                        Layout.preferredWidth: win.compact ? 52 : 64
                        Layout.preferredHeight: win.compact ? 52 : 64
                        radius: 12
                        color: win.surface3
                        border.color: win.cardEdge
                        Image {
                            anchors.fill: parent
                            anchors.margins: 4
                            source: bridge.thumbnailUrl
                            fillMode: Image.PreserveAspectFit
                            asynchronous: false
                            visible: bridge.thumbnailUrl !== ""
                        }
                        Text {
                            anchors.centerIn: parent
                            visible: bridge.thumbnailUrl === ""
                            text: "LAYR"
                            color: win.dim
                            font.pixelSize: 11
                            font.weight: Font.DemiBold
                        }
                    }
                    ColumnLayout {
                        Layout.fillWidth: true
                        spacing: 2
                        Text {
                            text: (win.state && win.state.showJob) ? "CURRENT JOB" : "PRINTER"
                            color: win.dim
                            font.pixelSize: 11
                            font.weight: Font.DemiBold
                            font.letterSpacing: 1.1
                        }
                        Text {
                            Layout.fillWidth: true
                            text: (win.state && win.state.showJob) ? win.state.filename : (win.state ? win.state.statusLabel : "Offline")
                            color: win.ink
                            font.pixelSize: win.compact ? 16 : 20
                            font.weight: Font.DemiBold
                            elide: Text.ElideRight
                        }
                    }
                }

                RowLayout {
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    spacing: win.gap

                    Item {
                        Layout.preferredWidth: win.compact ? 120 : 156
                        Layout.fillHeight: true
                        Canvas {
                            id: ring
                            anchors.centerIn: parent
                            width: Math.min(parent.width, parent.height)
                            height: width
                            property real progress: (win.state && win.state.showJob) ? win.state.progress : 0
                            onProgressChanged: requestPaint()
                            onWidthChanged: requestPaint()
                            onPaint: {
                                var ctx = getContext("2d")
                                ctx.reset()
                                var radius = width / 2 - 8
                                ctx.lineWidth = win.compact ? 7 : 9
                                ctx.strokeStyle = "#1e2330"
                                ctx.beginPath()
                                ctx.arc(width / 2, height / 2, radius, 0, Math.PI * 2)
                                ctx.stroke()
                                ctx.strokeStyle = "#3ee0f0"
                                ctx.lineCap = "round"
                                ctx.beginPath()
                                ctx.arc(width / 2, height / 2, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0, Math.min(1, progress)))
                                ctx.stroke()
                            }
                        }
                        Column {
                            anchors.centerIn: parent
                            spacing: 0
                            Text {
                                anchors.horizontalCenter: parent.horizontalCenter
                                text: (win.state && win.state.showJob) ? win.state.progressText : "—"
                                color: win.ink
                                font.pixelSize: win.compact ? 22 : 28
                                font.weight: Font.Medium
                            }
                            Text {
                                anchors.horizontalCenter: parent.horizontalCenter
                                text: "%"
                                color: win.dim
                                font.pixelSize: 11
                            }
                        }
                    }

                    GridLayout {
                        Layout.fillWidth: true
                        Layout.fillHeight: true
                        columns: 2
                        rowSpacing: 6
                        columnSpacing: 10

                        Repeater {
                            model: [
                                { k: "Elapsed", v: win.state ? win.state.elapsedText : "—" },
                                { k: "Remaining", v: win.state ? win.state.remainingText : "—" },
                                { k: "Layer", v: win.state ? win.state.layerText : "—" },
                                { k: "Estimate", v: (win.state && win.state.remainingSource === "slicer") ? "Slicer" : (win.state && win.state.remainingSource === "progress") ? "Progress" : "—" }
                            ]
                            delegate: Column {
                                required property var modelData
                                Layout.fillWidth: true
                                spacing: 1
                                Text { text: modelData.k.toUpperCase(); color: win.dim; font.pixelSize: 10; font.weight: Font.DemiBold; font.letterSpacing: 0.8 }
                                Text { text: modelData.v; color: win.ink; font.pixelSize: win.compact ? 14 : 16; font.weight: Font.Medium }
                            }
                        }
                    }
                }

                RowLayout {
                    Layout.fillWidth: true
                    spacing: win.gap

                    Rectangle {
                        Layout.fillWidth: true
                        Layout.preferredHeight: Math.max(win.touch, win.compact ? 52 : 64)
                        radius: 12
                        color: "#10141c"
                        border.color: areaS.pressed ? win.cyan : win.cardEdge
                        Column {
                            anchors.verticalCenter: parent.verticalCenter
                            anchors.left: parent.left
                            anchors.leftMargin: 12
                            spacing: 1
                            Text { text: "SPEED"; color: win.dim; font.pixelSize: 10; font.weight: Font.DemiBold; font.letterSpacing: 0.8 }
                            Text {
                                text: (win.state ? win.state.speedText : "—") + " mm/s"
                                color: win.ink
                                font.pixelSize: win.compact ? 16 : 18
                                font.weight: Font.DemiBold
                            }
                        }
                        MouseArea { id: areaS; anchors.fill: parent; onPressed: bridge.notePress("speed-readout") }
                    }

                    Rectangle {
                        Layout.fillWidth: true
                        Layout.preferredHeight: Math.max(win.touch, win.compact ? 52 : 64)
                        radius: 12
                        color: "#10141c"
                        border.color: areaF.pressed ? win.purple : win.cardEdge
                        Column {
                            anchors.verticalCenter: parent.verticalCenter
                            anchors.left: parent.left
                            anchors.leftMargin: 12
                            anchors.right: parent.right
                            anchors.rightMargin: 8
                            spacing: 1
                            Text { text: "FLOW"; color: win.dim; font.pixelSize: 10; font.weight: Font.DemiBold; font.letterSpacing: 0.8 }
                            Text {
                                text: (win.state ? win.state.flowText : "—") + " mm³/s"
                                color: (win.state && win.state.flowText && win.state.flowText.charAt(0) === "-") ? win.warn : win.ink
                                font.pixelSize: win.compact ? 16 : 18
                                font.weight: Font.DemiBold
                            }
                            Text {
                                text: win.state ? win.state.flowCaption : ""
                                color: win.dim
                                font.pixelSize: 10
                                elide: Text.ElideRight
                                width: parent.width
                            }
                        }
                        MouseArea { id: areaF; anchors.fill: parent; onPressed: bridge.notePress("flow-readout") }
                    }
                }
            }
        }

        ColumnLayout {
            Layout.fillWidth: true
            Layout.fillHeight: true
            Layout.preferredWidth: 2
            spacing: win.gap
            TempCard {
                Layout.fillWidth: true
                Layout.fillHeight: true
                label: "Nozzle"
                temp: win.state && win.state.nozzle ? win.state.nozzle.temp : "—"
                target: win.state && win.state.nozzle ? win.state.nozzle.target : ""
                accent: win.heat
            }
            TempCard {
                Layout.fillWidth: true
                Layout.fillHeight: true
                label: "Bed"
                temp: win.state && win.state.bed ? win.state.bed.temp : "—"
                target: win.state && win.state.bed ? win.state.bed.target : ""
                accent: win.purple
            }
            TempCard {
                Layout.fillWidth: true
                Layout.fillHeight: true
                label: "Chamber"
                temp: win.state && win.state.chamber ? win.state.chamber.temp : "—"
                target: win.state && win.state.chamber ? win.state.chamber.target : ""
                accent: win.cyan
            }
        }
    }
}
