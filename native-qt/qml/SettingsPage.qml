import QtQuick
import QtQuick.Controls
import LayrStyle

Item {
    id: page
    property var view: ({})
    property bool compact: false
    property string draftName: ""
    property string draftUrl: ""
    property string draftTheme: "midnight"
    property bool draftHide: true
    property int draftDim: 0
    property Item keyboardTarget: null
    readonly property int controlHeight: page.compact ? 44 : 48
    readonly property bool split: width >= 680

    function settings() {
        return page.view.settings || ({})
    }

    function pull() {
        draftName = page.settings().displayName || ""
        draftUrl = page.settings().moonrakerUrl || ""
        draftTheme = page.settings().theme || "midnight"
        draftHide = page.settings().hideCursor !== false
        draftDim = page.settings().dimAfterMinutes || 0
    }

    Component.onCompleted: pull()
    onViewChanged: {
        if (keyboardTarget === null)
            pull()
    }

    Flickable {
        id: scroller
        anchors.fill: parent
        anchors.margins: page.compact ? 10 : 14
        contentWidth: width
        contentHeight: Math.max(height, form.implicitHeight)
        clip: true
        boundsBehavior: Flickable.StopAtBounds
        interactive: contentHeight > height + 1

        Item {
            id: form
            width: scroller.width
            implicitHeight: page.split ? Math.max(fields.implicitHeight, aside.implicitHeight) : (fields.implicitHeight + aside.implicitHeight + 10)
            height: implicitHeight

            Column {
                id: fields
                width: page.split ? parent.width * 0.58 : parent.width
                spacing: page.compact ? 6 : 8

                Text { text: "PRINTER NAME"; color: Style.dim; font.pixelSize: 11; font.bold: true }
                TextField {
                    id: nameField
                    width: parent.width
                    height: page.controlHeight
                    text: page.draftName
                    placeholderText: "Leave empty to use the Klipper host name"
                    color: Style.text
                    font.pixelSize: 16
                    leftPadding: 12
                    onTextChanged: page.draftName = text
                    onActiveFocusChanged: if (activeFocus) page.keyboardTarget = nameField
                    background: Rectangle { color: Style.surface3; radius: 12; border.color: nameField.activeFocus ? Style.cyan : Style.border }
                }

                Text { text: "MOONRAKER URL"; color: Style.dim; font.pixelSize: 11; font.bold: true }
                TextField {
                    id: urlField
                    width: parent.width
                    height: page.controlHeight
                    text: page.draftUrl
                    placeholderText: "http://localhost:7125"
                    color: Style.text
                    font.pixelSize: 16
                    leftPadding: 12
                    inputMethodHints: Qt.ImhUrlCharactersOnly
                    onTextChanged: page.draftUrl = text
                    onActiveFocusChanged: if (activeFocus) page.keyboardTarget = urlField
                    background: Rectangle { color: Style.surface3; radius: 12; border.color: urlField.activeFocus ? Style.cyan : Style.border }
                }

                Text {
                    visible: page.settings().error && page.settings().error.length > 0
                    text: page.settings().error || ""
                    color: Style.danger
                    width: parent.width
                    wrapMode: Text.WordWrap
                }

                Row {
                    spacing: 8
                    Rectangle {
                        width: 140
                        height: page.controlHeight
                        radius: 12
                        color: page.draftTheme === "midnight" ? Style.cyan : Style.surface3
                        Text { anchors.centerIn: parent; text: "Midnight"; color: page.draftTheme === "midnight" ? "#061016" : Style.text; font.bold: true }
                        MouseArea { anchors.fill: parent; onClicked: page.draftTheme = "midnight" }
                    }
                    Rectangle {
                        width: 140
                        height: page.controlHeight
                        radius: 12
                        color: page.draftTheme === "black" ? Style.cyan : Style.surface3
                        Text { anchors.centerIn: parent; text: "Black"; color: page.draftTheme === "black" ? "#061016" : Style.text; font.bold: true }
                        MouseArea { anchors.fill: parent; onClicked: page.draftTheme = "black" }
                    }
                }

                Rectangle {
                    width: parent.width
                    height: page.controlHeight
                    radius: 12
                    color: Style.surface3
                    Text {
                        anchors.verticalCenter: parent.verticalCenter
                        anchors.left: parent.left
                        anchors.right: parent.right
                        anchors.leftMargin: 14
                        anchors.rightMargin: 14
                        text: page.draftHide ? "Pointer hidden  ·  touch still works" : "Pointer visible"
                        color: Style.text
                        font.bold: true
                        elide: Text.ElideRight
                    }
                    MouseArea { anchors.fill: parent; onClicked: page.draftHide = !page.draftHide }
                }

                Text { text: "DIM AFTER"; color: Style.dim; font.pixelSize: 11; font.bold: true }
                Row {
                    spacing: 8
                    Repeater {
                        model: [0, 1, 5, 10, 30]
                        delegate: Rectangle {
                            required property int modelData
                            width: page.compact ? 56 : 64
                            height: page.controlHeight
                            radius: 12
                            color: page.draftDim === modelData ? Style.purple : Style.surface3
                            Text {
                                anchors.centerIn: parent
                                text: modelData === 0 ? "Off" : modelData + "m"
                                color: page.draftDim === modelData ? "#061016" : Style.text
                                font.bold: true
                            }
                            MouseArea { anchors.fill: parent; onClicked: page.draftDim = modelData }
                        }
                    }
                }

                Row {
                    spacing: 8
                    Rectangle {
                        width: 160
                        height: page.controlHeight
                        radius: 12
                        color: Style.cyan
                        Text { anchors.centerIn: parent; text: "Save"; color: "#061016"; font.bold: true }
                        MouseArea {
                            anchors.fill: parent
                            onClicked: {
                                page.keyboardTarget = null
                                bridge.saveSettings(page.draftName, page.draftUrl, page.draftTheme, page.draftHide, page.draftDim)
                            }
                        }
                    }
                    Rectangle {
                        width: 160
                        height: page.controlHeight
                        radius: 12
                        color: Style.surface3
                        border.color: Style.border
                        Text { anchors.centerIn: parent; text: "Reconnect"; color: Style.text; font.bold: true }
                        MouseArea { anchors.fill: parent; onClicked: bridge.reconnect() }
                    }
                }
            }

            Column {
                id: aside
                x: page.split ? fields.width + 16 : 0
                y: page.split ? 0 : fields.implicitHeight + 10
                width: page.split ? parent.width - fields.width - 16 : parent.width
                spacing: 8

                Text {
                    text: "Shown on this panel only. Saving does not change the Linux hostname."
                    color: Style.text2
                    width: parent.width
                    wrapMode: Text.WordWrap
                    font.pixelSize: 14
                }
                Text {
                    text: page.settings().hostnameHint || ""
                    color: Style.dim
                    width: parent.width
                    wrapMode: Text.WordWrap
                    font.pixelSize: 13
                }
                Rectangle {
                    width: parent.width
                    radius: 14
                    color: Style.surface2
                    border.color: Style.border
                    height: perfCol.implicitHeight + 28
                    Column {
                        id: perfCol
                        anchors.left: parent.left
                        anchors.right: parent.right
                        anchors.top: parent.top
                        anchors.margins: 14
                        spacing: 6
                        Text { text: "THIS PROCESS"; color: Style.dim; font.pixelSize: 11; font.bold: true }
                        Text {
                            width: parent.width
                            wrapMode: Text.WordWrap
                            color: Style.text2
                            font.pixelSize: 14
                            text: "Startup " + page._num(page.view.perf, "startupMs", "ms")
                                  + "    RSS " + page._num(page.view.perf, "rssMb", "MB")
                                  + "    CPU " + page._num(page.view.perf, "cpuPercent", "%")
                        }
                        Text {
                            width: parent.width
                            wrapMode: Text.WordWrap
                            color: Style.text2
                            font.pixelSize: 14
                            text: "Touch " + page._num(page.view.perf, "touchMs", "ms")
                                  + "    p50 " + page._num(page.view.perf, "touchP50Ms", "ms")
                        }
                        Text {
                            width: parent.width
                            wrapMode: Text.WordWrap
                            color: Style.dim
                            font.pixelSize: 12
                            text: (page.view.perf && page.view.perf.note) ? page.view.perf.note : "Not a comparison with Chromium."
                        }
                    }
                }
            }
        }
    }

    function _num(perf, key, unit) {
        if (!perf || perf[key] === undefined || perf[key] === null)
            return "—"
        return perf[key] + unit
    }

    Rectangle {
        id: keyboard
        visible: keyboardTarget !== null
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.bottom: parent.bottom
        height: page.compact ? 188 : 210
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
                        delegate: Rectangle {
                            required property int index
                            width: page.compact ? 36 : 44
                            height: 40
                            radius: 8
                            color: Style.surface3
                            property string glyph: keyRow.modelData.charAt(index)
                            Text { anchors.centerIn: parent; text: glyph; color: Style.text; font.bold: true }
                            MouseArea {
                                anchors.fill: parent
                                onClicked: {
                                    if (page.keyboardTarget)
                                        page.keyboardTarget.insert(page.keyboardTarget.cursorPosition, glyph)
                                }
                            }
                        }
                    }
                }
            }
            Row {
                spacing: 8
                anchors.horizontalCenter: parent.horizontalCenter
                Rectangle {
                    width: 120
                    height: 40
                    radius: 8
                    color: Style.surface3
                    Text { anchors.centerIn: parent; text: "Space"; color: Style.text }
                    MouseArea { anchors.fill: parent; onClicked: if (page.keyboardTarget) page.keyboardTarget.insert(page.keyboardTarget.cursorPosition, " ") }
                }
                Rectangle {
                    width: 120
                    height: 40
                    radius: 8
                    color: Style.surface3
                    Text { anchors.centerIn: parent; text: "Delete"; color: Style.text }
                    MouseArea {
                        anchors.fill: parent
                        onClicked: {
                            if (page.keyboardTarget && page.keyboardTarget.cursorPosition > 0)
                                page.keyboardTarget.remove(page.keyboardTarget.cursorPosition - 1, page.keyboardTarget.cursorPosition)
                        }
                    }
                }
                Rectangle {
                    width: 120
                    height: 40
                    radius: 8
                    color: Style.cyan
                    Text { anchors.centerIn: parent; text: "Done"; color: "#061016"; font.bold: true }
                    MouseArea { anchors.fill: parent; onClicked: page.keyboardTarget = null }
                }
            }
        }
    }
}
