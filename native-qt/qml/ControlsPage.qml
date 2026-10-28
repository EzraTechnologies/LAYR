import QtQuick
import LayrStyle

Item {
    id: page
    property var view: ({})
    property bool compact: false
    property real step: 10
    property real xySpeed: 100

    function gate() { return page.view.gate || ({}) }
    function move() { return page.view.move || ({}) }
    function overrides() { return page.view.overrides || ({}) }
    function busy(group) {
        var list = page.gate().busy || []
        return list.indexOf(group) >= 0
    }
    function canMove() {
        return page.gate().ready === true && page.move().canJog === true && !page.busy("motion")
    }

    Flickable {
        id: scroller
        anchors.fill: parent
        anchors.margins: page.compact ? 8 : 12
        contentWidth: width
        contentHeight: column.implicitHeight
        clip: true
        boundsBehavior: Flickable.StopAtBounds

        Column {
            id: column
            width: scroller.width
            spacing: 8

            Rectangle {
                width: parent.width
                radius: 12
                color: page.gate().ready === true ? "#224ade80" : "#22fbbf24"
                border.color: Style.border
                height: reason.implicitHeight + 16
                Text {
                    id: reason
                    anchors.left: parent.left
                    anchors.right: parent.right
                    anchors.verticalCenter: parent.verticalCenter
                    anchors.margins: 10
                    wrapMode: Text.WordWrap
                    color: page.gate().ready === true ? Style.ok : Style.warn
                    font.pixelSize: 13
                    text: page.gate().ready === true
                          ? (page.gate().printing || page.gate().paused
                             ? "A print is active. Jogging is locked. Z babystep is the only move."
                             : "Homed axes can jog inside the configured travel. Z does not go below 0.")
                          : (page.gate().reason || "Controls are off until Klipper is ready.")
                }
            }

            Row {
                width: parent.width
                spacing: 8
                Rectangle {
                    width: (parent.width - 8) / 2
                    height: page.compact ? 64 : 72
                    radius: 14
                    color: Style.surface
                    border.color: Style.border
                    Column {
                        anchors.centerIn: parent
                        spacing: 2
                        Text { text: "HOMED"; color: Style.dim; font.pixelSize: 11; font.bold: true; anchors.horizontalCenter: parent.horizontalCenter }
                        Text { text: page.move().homed || "—"; color: Style.text; font.pixelSize: 18; font.bold: true; anchors.horizontalCenter: parent.horizontalCenter }
                    }
                }
                Rectangle {
                    width: (parent.width - 8) / 2
                    height: page.compact ? 64 : 72
                    radius: 14
                    color: Style.surface
                    border.color: Style.border
                    Column {
                        anchors.centerIn: parent
                        spacing: 2
                        Text { text: "POSITION"; color: Style.dim; font.pixelSize: 11; font.bold: true; anchors.horizontalCenter: parent.horizontalCenter }
                        Text { text: page.move().position || "—"; color: Style.cyan; font.pixelSize: page.compact ? 13 : 16; font.bold: true; anchors.horizontalCenter: parent.horizontalCenter }
                        Text { text: "Z offset " + (page.move().zOffset || "—"); color: Style.text2; font.pixelSize: 12; anchors.horizontalCenter: parent.horizontalCenter }
                    }
                }
            }

            Row {
                width: parent.width
                spacing: 8
                Tap { width: (parent.width - 32) / 5; label: "Home all"; enabled: page.gate().ready === true && page.move().canHome === true && !page.busy("motion"); onTapped: bridge.home("all") }
                Tap { width: (parent.width - 32) / 5; label: "Home X"; enabled: page.gate().ready === true && page.move().canHome === true && !page.busy("motion"); onTapped: bridge.home("x") }
                Tap { width: (parent.width - 32) / 5; label: "Home Y"; enabled: page.gate().ready === true && page.move().canHome === true && !page.busy("motion"); onTapped: bridge.home("y") }
                Tap { width: (parent.width - 32) / 5; label: "Home Z"; enabled: page.gate().ready === true && page.move().canHome === true && !page.busy("motion"); onTapped: bridge.home("z") }
                Tap { width: (parent.width - 32) / 5; label: "Motors"; enabled: page.move().canMotors === true && !page.busy("motion"); onTapped: bridge.motorsOff() }
            }

            Row {
                width: parent.width
                spacing: 8
                Text {
                    width: 36
                    height: 48
                    verticalAlignment: Text.AlignVCenter
                    text: "STEP"
                    color: Style.dim
                    font.pixelSize: 11
                    font.bold: true
                }
                Repeater {
                    model: page.move().steps || [0.1, 1, 10, 25, 50]
                    delegate: Tap {
                        required property var modelData
                        width: page.compact ? 48 : 58
                        label: String(modelData)
                        fill: page.step === modelData ? Style.cyan : Style.surface3
                        ink: page.step === modelData ? "#061016" : Style.text
                        onTapped: page.step = modelData
                    }
                }
                Item { width: 8; height: 48 }
                Text {
                    width: 28
                    height: 48
                    verticalAlignment: Text.AlignVCenter
                    text: "XY"
                    color: Style.dim
                    font.pixelSize: 11
                    font.bold: true
                }
                Repeater {
                    model: page.move().xySpeeds || [25, 50, 100, 150]
                    delegate: Tap {
                        required property var modelData
                        width: page.compact ? 52 : 64
                        label: modelData + ""
                        fill: page.xySpeed === modelData ? Style.cyan : Style.surface3
                        ink: page.xySpeed === modelData ? "#061016" : Style.text
                        onTapped: page.xySpeed = modelData
                    }
                }
            }

            Item {
                width: parent.width
                height: page.compact ? 168 : 184
                visible: !(page.gate().printing || page.gate().paused)

                Tap {
                    width: 72; height: 56
                    anchors.horizontalCenter: parent.horizontalCenter
                    anchors.top: parent.top
                    label: "Y+"
                    enabled: page.canMove()
                    onTapped: bridge.jog("y", page.step, page.xySpeed)
                }
                Tap {
                    width: 72; height: 56
                    anchors.right: parent.horizontalCenter
                    anchors.rightMargin: 48
                    anchors.verticalCenter: parent.verticalCenter
                    label: "X-"
                    enabled: page.canMove()
                    onTapped: bridge.jog("x", -page.step, page.xySpeed)
                }
                Tap {
                    width: 72; height: 56
                    anchors.left: parent.horizontalCenter
                    anchors.leftMargin: 48
                    anchors.verticalCenter: parent.verticalCenter
                    label: "X+"
                    enabled: page.canMove()
                    onTapped: bridge.jog("x", page.step, page.xySpeed)
                }
                Tap {
                    width: 72; height: 56
                    anchors.horizontalCenter: parent.horizontalCenter
                    anchors.bottom: parent.bottom
                    label: "Y-"
                    enabled: page.canMove()
                    onTapped: bridge.jog("y", -page.step, page.xySpeed)
                }
                Column {
                    anchors.right: parent.right
                    anchors.verticalCenter: parent.verticalCenter
                    spacing: 8
                    Tap {
                        width: 88
                        label: "Z+"
                        enabled: page.canMove()
                        onTapped: bridge.jog("z", page.step, page.move().zSpeed || 10)
                    }
                    Tap {
                        width: 88
                        label: "Z-"
                        enabled: page.canMove()
                        onTapped: bridge.jog("z", -page.step, page.move().zSpeed || 10)
                    }
                }
            }

            Column {
                width: parent.width
                visible: page.gate().printing === true || page.gate().paused === true
                spacing: 8
                Text { text: "Z BABYSTEP"; color: Style.dim; font.pixelSize: 11; font.bold: true }
                Row {
                    spacing: 8
                    Repeater {
                        model: page.move().babySteps || [0.01, 0.05]
                        delegate: Row {
                            required property var modelData
                            spacing: 8
                            Tap {
                                width: 110
                                label: "Z -" + modelData
                                enabled: page.move().canBaby === true && !page.busy("zoffset")
                                onTapped: bridge.babyStep(-modelData)
                            }
                            Tap {
                                width: 110
                                label: "Z +" + modelData
                                enabled: page.move().canBaby === true && !page.busy("zoffset")
                                onTapped: bridge.babyStep(modelData)
                            }
                        }
                    }
                }
            }

            Text {
                width: parent.width
                wrapMode: Text.WordWrap
                text: "M220 " + (page.overrides().speed || "—") + "    M221 " + (page.overrides().flow || "—") + ". " + (page.overrides().note || "")
                color: Style.text2
                font.pixelSize: 13
            }
            Row {
                spacing: 8
                Tap {
                    width: page.compact ? 88 : 100
                    label: "M220 −"
                    enabled: page.gate().ready === true && !page.busy("feedrate")
                    onTapped: bridge.setSpeedFactor((page.overrides().speedNumber || 100) - 10)
                }
                Tap {
                    width: page.compact ? 88 : 100
                    label: "M220 +"
                    enabled: page.gate().ready === true && !page.busy("feedrate")
                    onTapped: bridge.setSpeedFactor((page.overrides().speedNumber || 100) + 10)
                }
                Tap {
                    width: page.compact ? 88 : 100
                    label: "M221 −"
                    enabled: page.gate().ready === true && !page.busy("feedrate")
                    onTapped: bridge.setExtrudeFactor((page.overrides().flowNumber || 100) - 10)
                }
                Tap {
                    width: page.compact ? 88 : 100
                    label: "M221 +"
                    enabled: page.gate().ready === true && !page.busy("feedrate")
                    onTapped: bridge.setExtrudeFactor((page.overrides().flowNumber || 100) + 10)
                }
            }
        }
    }
}
