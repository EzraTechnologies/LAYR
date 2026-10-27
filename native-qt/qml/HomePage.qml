import QtQuick
import LayrStyle

Item {
    id: page
    property var view: ({})
    property bool compact: false

    function motion() {
        return page.view.motion || ({})
    }
    function job() {
        return page.view.job || ({})
    }

    Row {
        anchors.fill: parent
        anchors.margins: page.compact ? 10 : 14
        spacing: page.compact ? 8 : 12

        Rectangle {
            id: hero
            width: parent.width * 0.60
            height: parent.height
            radius: page.compact ? 14 : 18
            color: Style.surface
            border.color: Style.border

            Column {
                anchors.fill: parent
                anchors.margins: page.compact ? 10 : 16
                spacing: page.compact ? 8 : 12

                Row {
                    width: parent.width
                    spacing: 12
                    Image {
                        width: page.compact ? 48 : 64
                        height: width
                        source: (page.job().thumbnailKey && page.job().thumbnailKey.length > 0)
                                ? "image://thumbs/" + encodeURIComponent(page.job().thumbnailKey) + "?v=" + bridge.thumbToken
                                : ""
                        fillMode: Image.PreserveAspectCrop
                        visible: source !== ""
                        asynchronous: false
                        cache: false
                    }
                    Rectangle {
                        visible: !((page.job().thumbnailKey && page.job().thumbnailKey.length > 0))
                        width: page.compact ? 48 : 64
                        height: width
                        radius: 10
                        color: Style.surface3
                        Text {
                            anchors.centerIn: parent
                            text: "G"
                            color: Style.dim
                            font.bold: true
                            font.pixelSize: 18
                        }
                    }
                    Column {
                        width: parent.width - 80
                        spacing: 2
                        Text {
                            text: page.job().visible ? "CURRENT JOB" : "PRINTER"
                            color: Style.dim
                            font.pixelSize: 11
                            font.bold: true
                            font.letterSpacing: 1
                        }
                        Text {
                            width: parent.width
                            text: page.job().visible ? page.job().displayName : (page.view.connectionTitle || "Printer")
                            color: Style.text
                            font.pixelSize: page.compact ? 18 : 22
                            font.bold: true
                            elide: Text.ElideRight
                        }
                        Text {
                            width: parent.width
                            text: page.job().visible ? (page.job().headline || "") : (page.view.statusDetail || "")
                            color: Style.text2
                            font.pixelSize: page.compact ? 12 : 14
                            elide: Text.ElideRight
                        }
                    }
                }

                Item {
                    width: parent.width
                    height: Math.max(96, parent.height - (page.compact ? 176 : 210))
                    visible: page.job().visible

                    Ring {
                        id: ring
                        anchors.left: parent.left
                        anchors.verticalCenter: parent.verticalCenter
                        width: Math.min(page.compact ? 132 : 176, parent.height)
                        height: width
                        progress: page.job().progress || 0
                        center: page.job().progressText || "—"
                        accent: Style.toneColor(page.view.tone || "cyan")
                    }

                    Column {
                        anchors.left: ring.right
                        anchors.leftMargin: page.compact ? 10 : 16
                        anchors.right: parent.right
                        anchors.verticalCenter: parent.verticalCenter
                        spacing: page.compact ? 6 : 10

                        Grid {
                            columns: 2
                            rowSpacing: page.compact ? 6 : 10
                            columnSpacing: page.compact ? 12 : 18
                            width: parent.width

                            Text { text: "Elapsed"; color: Style.dim; font.pixelSize: 12 }
                            Text { text: page.job().elapsed || "—"; color: Style.text; font.bold: true; font.pixelSize: page.compact ? 14 : 16 }
                            Text { text: "Remaining"; color: Style.dim; font.pixelSize: 12 }
                            Text {
                                text: (page.job().remaining || "—") + (page.job().remainingNote ? "  " + page.job().remainingNote : "")
                                color: Style.text
                                font.bold: true
                                font.pixelSize: page.compact ? 14 : 16
                            }
                            Text { text: "ETA"; color: Style.dim; font.pixelSize: 12 }
                            Text { text: page.job().eta || "—"; color: Style.text; font.bold: true; font.pixelSize: page.compact ? 14 : 16 }
                            Text { text: "Layer"; color: Style.dim; font.pixelSize: 12 }
                            Text { text: page.job().layer || "—"; color: Style.text; font.bold: true; font.pixelSize: page.compact ? 14 : 16 }
                        }

                        Text {
                            text: "Filament " + (page.job().filament || "—")
                            color: Style.text2
                            font.pixelSize: 12
                        }
                    }
                }

                Column {
                    visible: !page.job().visible
                    width: parent.width
                    spacing: 8
                    Text {
                        width: parent.width
                        wrapMode: Text.WordWrap
                        color: Style.text2
                        font.pixelSize: page.compact ? 13 : 15
                        text: page.view.status === "ready"
                              ? "No job is loaded. Open Files to look at G-code. This prototype cannot start a print."
                              : "Live temperatures and motion stay blank until Moonraker and Klipper are both up. Nothing here is sample data."
                    }
                    Rectangle {
                        visible: page.view.status === "ready"
                        width: 140
                        height: 48
                        radius: 12
                        color: Style.cyan
                        Text { anchors.centerIn: parent; text: "Files"; color: "#061016"; font.bold: true }
                        MouseArea {
                            anchors.fill: parent
                            cursorShape: page.view.hideCursor ? Qt.BlankCursor : Qt.PointingHandCursor
                            onClicked: bridge.openPage("files")
                        }
                    }
                }

                Row {
                    width: parent.width
                    spacing: 8
                    Rectangle {
                        width: (parent.width - 8) / 2
                        height: page.compact ? 64 : 76
                        radius: 12
                        color: Style.surface3
                        Column {
                            anchors.centerIn: parent
                            spacing: 2
                            Text { text: "SPEED"; color: Style.dim; font.pixelSize: 11; font.bold: true; anchors.horizontalCenter: parent.horizontalCenter }
                            Text {
                                text: (!page.motion().speedText || page.motion().speedText === "—") ? "—" : page.motion().speedText + " mm/s"
                                color: Style.cyan
                                font.pixelSize: page.compact ? 20 : 26
                                font.bold: true
                                anchors.horizontalCenter: parent.horizontalCenter
                            }
                            Text {
                                text: page.motion().speedCaption || ""
                                color: Style.dim
                                font.pixelSize: 11
                                anchors.horizontalCenter: parent.horizontalCenter
                            }
                        }
                    }
                    Rectangle {
                        width: (parent.width - 8) / 2
                        height: page.compact ? 64 : 76
                        radius: 12
                        color: Style.surface3
                        Column {
                            anchors.centerIn: parent
                            spacing: 2
                            Text { text: "FLOW"; color: Style.dim; font.pixelSize: 11; font.bold: true; anchors.horizontalCenter: parent.horizontalCenter }
                            Text {
                                text: (!page.motion().flowText || page.motion().flowText === "—") ? "—" : page.motion().flowText + " mm³/s" + (page.motion().retracting ? "  retract" : "")
                                color: page.motion().retracting ? Style.warn : Style.purple
                                font.pixelSize: page.compact ? 18 : 22
                                font.bold: true
                                anchors.horizontalCenter: parent.horizontalCenter
                            }
                            Text {
                                text: page.motion().diameterText || page.motion().flowCaption || ""
                                color: Style.dim
                                font.pixelSize: 11
                                anchors.horizontalCenter: parent.horizontalCenter
                            }
                        }
                    }
                }
            }
        }

        Column {
            width: parent.width - hero.width - parent.spacing
            height: parent.height
            spacing: page.compact ? 8 : 12

            Repeater {
                model: page.view.temps || []
                delegate: TempCard {
                    required property var modelData
                    width: parent.width
                    height: {
                        var fans = (page.view.fans && page.view.fans.length) ? 1 : 0
                        var rows = 3 + fans
                        return (parent.height - parent.spacing * (rows - 1)) / rows
                    }
                    compact: page.compact
                    reading: modelData
                }
            }

            Rectangle {
                visible: page.view.fans && page.view.fans.length > 0
                width: parent.width
                height: {
                    var rows = 4
                    return (parent.height - parent.spacing * (rows - 1)) / rows
                }
                radius: 14
                color: Style.surface2
                border.color: Style.border
                Text {
                    anchors.centerIn: parent
                    text: {
                        if (!page.view.fans || page.view.fans.length === 0)
                            return ""
                        var fan = page.view.fans[0]
                        return fan.label + "  " + fan.text
                    }
                    color: Style.text2
                    font.bold: true
                }
            }
        }
    }
}
