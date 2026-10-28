import QtQuick
import QtQuick.Controls
import LayrStyle

Item {
    id: page
    property var view: ({})
    property bool compact: false
    property string draft: ""
    property bool keyboardOn: false

    function gate() { return page.view.gate || ({}) }
    function busy(group) {
        var list = page.gate().busy || []
        return list.indexOf(group) >= 0
    }

    onViewChanged: {
        if (!keyboardOn && page.view.consoleDraft)
            draft = page.view.consoleDraft
    }

    Flickable {
        id: scroller
        anchors.fill: parent
        anchors.leftMargin: page.compact ? 8 : 12
        anchors.rightMargin: page.compact ? 8 : 12
        anchors.topMargin: page.compact ? 8 : 12
        anchors.bottomMargin: keyboard.visible ? keyboard.height + 8 : (page.compact ? 8 : 12)
        contentWidth: width
        contentHeight: column.implicitHeight
        clip: true
        boundsBehavior: Flickable.StopAtBounds
        interactive: contentHeight > height + 1

        Column {
            id: column
            width: scroller.width
            spacing: 8

            Text { text: "MACROS"; color: Style.dim; font.pixelSize: 11; font.bold: true }
            Text {
                width: parent.width
                wrapMode: Text.WordWrap
                color: Style.text2
                font.pixelSize: 13
                text: "Discovered from this printer. Names are not hard-coded. A macro that needs parameters opens the console instead of running empty."
            }
            Tap {
                width: 180
                visible: (page.view.hiddenMacros || 0) > 0
                label: page.view.showHidden ? "Hide private" : "Show private"
                onTapped: bridge.toggleHidden()
            }
            Flow {
                width: parent.width
                spacing: 8
                Repeater {
                    model: page.view.macros || []
                    delegate: Tap {
                        required property var modelData
                        width: Math.min(220, parent.width)
                        label: modelData.name
                        enabled: page.gate().ready === true && !page.busy("macro:" + modelData.name)
                        onTapped: bridge.runMacro(modelData.name)
                    }
                }
            }
            Text {
                visible: (page.view.macros || []).length === 0
                text: page.gate().ready === true ? "No macros reported." : (page.gate().reason || "Macros appear when Klipper is ready.")
                color: Style.dim
            }

            Text { text: "CONSOLE"; color: Style.dim; font.pixelSize: 11; font.bold: true }
            Text {
                width: parent.width
                wrapMode: Text.WordWrap
                color: Style.text2
                font.pixelSize: 13
                text: "One line, confirmed before it is sent. Nothing is sent just by being typed."
            }
            Rectangle {
                width: parent.width
                height: page.compact ? 72 : 90
                radius: 12
                color: Style.surface
                border.color: Style.border
                Flickable {
                    anchors.fill: parent
                    anchors.margins: 8
                    contentHeight: log.implicitHeight
                    clip: true
                    Column {
                        id: log
                        width: parent.width
                        spacing: 2
                        Repeater {
                            model: page.view.console || []
                            delegate: Text {
                                required property var modelData
                                width: log.width
                                text: modelData.text || ""
                                color: modelData.kind === "error" ? Style.danger : Style.text2
                                font.pixelSize: 13
                                wrapMode: Text.WordWrap
                            }
                        }
                    }
                }
            }
            TextField {
                id: line
                width: parent.width
                height: 48
                text: page.draft
                placeholderText: "G-code, one line"
                color: Style.text
                font.pixelSize: 16
                leftPadding: 12
                onTextChanged: page.draft = text
                onActiveFocusChanged: {
                    if (activeFocus) {
                        page.keyboardOn = true
                        Qt.callLater(function() { page.reveal(line) })
                    }
                }
                background: Rectangle { color: Style.surface3; radius: 12; border.color: line.activeFocus ? Style.cyan : Style.border }
            }
            Row {
                spacing: 8
                Tap {
                    width: 140
                    label: "Review"
                    enabled: page.draft.length > 0 && !page.busy("console")
                    fill: Style.cyan
                    ink: "#061016"
                    onTapped: bridge.consoleSend(page.draft)
                }
                Tap {
                    width: 160
                    label: "Restart Klipper"
                    enabled: page.gate().host === true && !page.busy("restart")
                    onTapped: bridge.restartKlipper()
                }
                Tap {
                    width: 180
                    label: "Firmware restart"
                    enabled: page.gate().host === true && !page.busy("restart")
                    onTapped: bridge.firmwareRestart()
                }
            }
        }
    }

    function reveal(item) {
        var pos = item.mapToItem(column, 0, 0)
        var bottom = pos.y + item.height + 12
        if (bottom > scroller.contentY + scroller.height)
            scroller.contentY = Math.max(0, bottom - scroller.height)
    }

    Rectangle {
        id: keyboard
        visible: page.keyboardOn
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.bottom: parent.bottom
        // Five 40px key rows, four 6px gaps, plus margins. Matches Settings.
        height: 240
        color: "#f0101218"
        border.color: Style.border

        Column {
            anchors.fill: parent
            anchors.margins: 8
            spacing: 6
            Repeater {
                model: ["1234567890-.", "qwertyuiop", "asdfghjkl:", "zxcvbnm_/"]
                delegate: Row {
                    id: keyRow
                    required property string modelData
                    spacing: 4
                    anchors.horizontalCenter: parent.horizontalCenter
                    Repeater {
                        model: modelData.length
                        delegate: Tap {
                            required property int index
                            width: page.compact ? 36 : 44
                            label: keyRow.modelData.charAt(index)
                            onTapped: line.insert(line.cursorPosition, label)
                        }
                    }
                }
            }
            Row {
                spacing: 8
                anchors.horizontalCenter: parent.horizontalCenter
                Tap { width: 120; label: "Space"; onTapped: line.insert(line.cursorPosition, " ") }
                Tap {
                    width: 120
                    label: "Delete"
                    onTapped: if (line.cursorPosition > 0) line.remove(line.cursorPosition - 1, line.cursorPosition)
                }
                Tap {
                    width: 120
                    label: "Done"
                    fill: Style.cyan
                    ink: "#061016"
                    onTapped: page.keyboardOn = false
                }
            }
        }
    }
}
