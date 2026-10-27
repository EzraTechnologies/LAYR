import QtQuick
import QtQuick.Controls
import LayrStyle

Item {
    id: page
    property var view: ({})
    property bool compact: false
    property string draftHeater: ""
    property string draftTarget: ""
    property bool keypadOn: false
    property real extrudeLength: 10
    property real extrudeSpeed: 5

    function gate() { return page.view.gate || ({}) }
    function heat() { return page.view.heat || ({}) }
    function busy(group) {
        var list = page.gate().busy || []
        return list.indexOf(group) >= 0
    }

    Flickable {
        id: scroller
        anchors.fill: parent
        anchors.leftMargin: page.compact ? 8 : 12
        anchors.rightMargin: page.compact ? 8 : 12
        anchors.topMargin: page.compact ? 8 : 12
        anchors.bottomMargin: page.keypadOn ? keypad.height + 8 : (page.compact ? 8 : 12)
        contentWidth: width
        contentHeight: column.implicitHeight
        clip: true
        boundsBehavior: Flickable.StopAtBounds
        interactive: contentHeight > height + 1

        Column {
            id: column
            width: scroller.width
            spacing: 8

            Text {
                width: parent.width
                wrapMode: Text.WordWrap
                color: page.gate().ready === true ? Style.text2 : Style.warn
                font.pixelSize: 13
                text: page.gate().ready === true
                      ? "Targets stay inside this printer's Klipper limits. High temperatures, and changes during a print, ask first."
                      : (page.gate().reason || "Heaters are off until Klipper is ready.")
            }

            Repeater {
                model: page.heat().heaters || []
                delegate: Rectangle {
                    id: card
                    required property var modelData
                    width: column.width
                    radius: 14
                    color: Style.surface
                    border.color: Style.border
                    height: body.implicitHeight + 20

                    Column {
                        id: body
                        anchors.left: parent.left
                        anchors.right: parent.right
                        anchors.top: parent.top
                        anchors.margins: 10
                        spacing: 6
                        Text {
                            text: card.modelData.label + "  " + card.modelData.value + "°   target " + (card.modelData.target === "" ? "off" : card.modelData.target + "°")
                            color: Style.text
                            font.bold: true
                            font.pixelSize: 16
                        }
                        Text {
                            text: card.modelData.min + "–" + card.modelData.max + " °C, or off"
                            color: Style.dim
                            font.pixelSize: 12
                        }
                        Flow {
                            width: parent.width
                            spacing: 6
                            Repeater {
                                model: card.modelData.presets || []
                                delegate: Tap {
                                    required property var modelData
                                    width: 64
                                    label: String(modelData)
                                    enabled: page.gate().ready === true && !page.busy("temp:" + card.modelData.object)
                                    onTapped: bridge.setHeater(card.modelData.object, modelData)
                                }
                            }
                            Tap {
                                width: 72
                                label: "Off"
                                enabled: page.gate().ready === true && !page.busy("temp:" + card.modelData.object)
                                onTapped: bridge.setHeater(card.modelData.object, 0)
                            }
                            Tap {
                                width: 88
                                label: "Set"
                                enabled: page.gate().ready === true
                                onTapped: {
                                    page.draftHeater = card.modelData.object
                                    page.draftTarget = card.modelData.target || ""
                                    page.keypadOn = true
                                    Qt.callLater(function() { page.reveal(card) })
                                }
                            }
                        }
                    }
                }
            }

            Text { text: "EXTRUDE"; color: Style.dim; font.pixelSize: 11; font.bold: true }
            Text {
                width: parent.width
                wrapMode: Text.WordWrap
                color: page.heat().canExtrude === true ? Style.text2 : Style.warn
                font.pixelSize: 13
                text: page.heat().canExtrude === true ? "Cold extrusion stays locked." : (page.heat().extrudeReason || "Extrusion is locked.")
            }
            Row {
                spacing: 6
                Repeater {
                    model: page.heat().extrudeLengths || []
                    delegate: Tap {
                        required property var modelData
                        width: 56
                        label: String(modelData)
                        fill: page.extrudeLength === modelData ? Style.cyan : Style.surface3
                        ink: page.extrudeLength === modelData ? "#061016" : Style.text
                        onTapped: page.extrudeLength = modelData
                    }
                }
            }
            Row {
                spacing: 8
                Tap {
                    width: 120
                    label: "Extrude"
                    enabled: page.heat().canExtrude === true && !page.busy("extrude")
                    onTapped: bridge.extrude(page.extrudeLength, page.extrudeSpeed)
                }
                Tap {
                    width: 120
                    label: "Retract"
                    enabled: page.heat().canExtrude === true && !page.busy("extrude")
                    onTapped: bridge.extrude(-page.extrudeLength, page.extrudeSpeed)
                }
                Tap {
                    visible: (page.heat().loadMacro || "").length > 0
                    width: 130
                    label: "Load"
                    enabled: page.gate().ready === true && !page.busy("macro:" + page.heat().loadMacro)
                    onTapped: bridge.runMacro(page.heat().loadMacro)
                }
                Tap {
                    visible: (page.heat().unloadMacro || "").length > 0
                    width: 130
                    label: "Unload"
                    enabled: page.gate().ready === true && !page.busy("macro:" + page.heat().unloadMacro)
                    onTapped: bridge.runMacro(page.heat().unloadMacro)
                }
            }

            Text { text: "FANS"; color: Style.dim; font.pixelSize: 11; font.bold: true }
            Repeater {
                model: page.heat().fans || []
                delegate: Row {
                    required property var modelData
                    width: column.width
                    spacing: 8
                    Text {
                        width: 140
                        anchors.verticalCenter: parent.verticalCenter
                        text: modelData.label + "  " + modelData.percent + "%"
                        color: Style.text
                        elide: Text.ElideRight
                    }
                    Tap {
                        width: 64
                        label: "Off"
                        enabled: modelData.controllable === true && page.gate().ready === true && !page.busy("fan:" + modelData.object)
                        onTapped: bridge.setFan(modelData.object, 0)
                    }
                    Tap {
                        width: 64
                        label: "50%"
                        enabled: modelData.controllable === true && page.gate().ready === true && !page.busy("fan:" + modelData.object)
                        onTapped: bridge.setFan(modelData.object, 0.5)
                    }
                    Tap {
                        width: 72
                        label: "100%"
                        enabled: modelData.controllable === true && page.gate().ready === true && !page.busy("fan:" + modelData.object)
                        onTapped: bridge.setFan(modelData.object, 1)
                    }
                    Text {
                        visible: modelData.controllable !== true
                        anchors.verticalCenter: parent.verticalCenter
                        text: "Automatic"
                        color: Style.dim
                    }
                }
            }

            Text { text: "LIGHTS"; color: Style.dim; font.pixelSize: 11; font.bold: true }
            Text {
                visible: (page.heat().lights || []).length === 0
                text: "No light objects were discovered."
                color: Style.dim
            }
            Repeater {
                model: page.heat().lights || []
                delegate: Row {
                    required property var modelData
                    width: column.width
                    spacing: 8
                    Text {
                        width: 140
                        anchors.verticalCenter: parent.verticalCenter
                        text: modelData.label
                        color: Style.text
                        elide: Text.ElideRight
                    }
                    Tap {
                        width: 64
                        label: "Off"
                        enabled: page.gate().ready === true && !page.busy("light:" + modelData.object)
                        onTapped: bridge.setLight(modelData.object, 0)
                    }
                    Tap {
                        width: 72
                        label: "On"
                        enabled: page.gate().ready === true && !page.busy("light:" + modelData.object)
                        onTapped: bridge.setLight(modelData.object, 1)
                    }
                }
            }
        }
    }

    function reveal(item) {
        var pos = item.mapToItem(column, 0, 0)
        var bottom = pos.y + item.height + 12
        if (bottom > scroller.contentY + scroller.height)
            scroller.contentY = Math.max(0, bottom - scroller.height)
        if (pos.y < scroller.contentY)
            scroller.contentY = Math.max(0, pos.y - 8)
    }

    Rectangle {
        id: keypad
        visible: page.keypadOn
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.bottom: parent.bottom
        height: 200
        color: "#f0101218"
        border.color: Style.border

        Column {
            anchors.fill: parent
            anchors.margins: 8
            spacing: 6
            Text {
                text: "Target " + page.draftTarget
                color: Style.text
                font.bold: true
            }
            Row {
                spacing: 4
                Repeater {
                    model: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"]
                    delegate: Tap {
                        required property var modelData
                        width: page.compact ? 36 : 44
                        label: modelData
                        onTapped: page.draftTarget = (page.draftTarget + modelData).slice(0, 4)
                    }
                }
            }
            Row {
                spacing: 8
                Tap {
                    width: 100
                    label: "Delete"
                    onTapped: page.draftTarget = page.draftTarget.slice(0, -1)
                }
                Tap {
                    width: 120
                    label: "Apply"
                    fill: Style.cyan
                    ink: "#061016"
                    onTapped: {
                        var value = Number(page.draftTarget)
                        if (page.draftTarget.length > 0 && !isNaN(value))
                            bridge.setHeater(page.draftHeater, value)
                        page.keypadOn = false
                    }
                }
                Tap {
                    width: 100
                    label: "Done"
                    onTapped: page.keypadOn = false
                }
            }
        }
    }
}
