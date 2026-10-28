import QtQuick
import QtQuick.Controls
import LayrStyle

Item {
    id: page
    objectName: "filament-page"
    property var view: ({})
    property bool compact: false
    property string draft: ""
    property bool keyboardOn: false
    property bool shiftActive: false
    readonly property int spoolRowHeight: page.compact ? 64 : 80
    readonly property int listHeight: {
        var room = scroller.height - header.implicitHeight - footer.height - 12
        return room >= page.spoolRowHeight ? room : page.spoolRowHeight
    }

    function spool() {
        return page.view.spoolman || ({})
    }
    function focusRow() {
        return page.spool().focus || ({})
    }

    onViewChanged: {
        if (!keyboardOn)
            draft = page.spool().search || ""
    }

    Flickable {
        id: scroller
        anchors.fill: parent
        anchors.margins: page.compact ? 8 : 12
        anchors.bottomMargin: keyboard.visible ? keyboard.height + 8 : (page.compact ? 8 : 12)
        contentWidth: width
        contentHeight: body.implicitHeight
        clip: true
        boundsBehavior: Flickable.StopAtBounds
        flickableDirection: Flickable.VerticalFlick
        interactive: contentHeight > height + 1

        Column {
            id: body
            width: scroller.width
            spacing: 6

        Column {
            id: header
            width: parent.width
            spacing: 6

            Text {
                width: parent.width
                text: (page.spool().printerLabel || "This printer") + "  ·  " + (page.spool().printerKey || "")
                color: Style.dim
                font.pixelSize: 12
                elide: Text.ElideRight
            }
            Text {
                width: parent.width
                wrapMode: Text.WordWrap
                maximumLineCount: 4
                elide: Text.ElideRight
                visible: (page.spool().help || "").length > 0 || (page.spool().message || "").length > 0
                text: page.spool().help || page.spool().message || ""
                color: Style.text2
                font.pixelSize: page.compact ? 13 : 14
            }

            Rectangle {
                width: parent.width
                height: page.compact ? 120 : 146
                radius: 14
                color: Style.surface
                border.color: page.focusRow().active ? Style.cyan : Style.border
                visible: page.spool().phase === "ready" || (page.focusRow().name || "").length > 0

                Row {
                    anchors.fill: parent
                    anchors.margins: 8
                    spacing: 8
                    SpoolArt {
                        id: art
                        width: page.compact ? 72 : 96
                        height: width
                        colors: page.focusRow().colors || []
                        imageKey: page.focusRow().imageKey || ""
                        active: page.focusRow().active === true
                    }
                    Column {
                        width: parent.width - art.width - actions.width - 16
                        spacing: 2
                        anchors.verticalCenter: parent.verticalCenter
                        Text {
                            width: parent.width
                            text: page.focusRow().name || page.spool().activeText || "No spool selected"
                            color: Style.text
                            font.bold: true
                            font.pixelSize: page.compact ? 16 : 18
                            elide: Text.ElideRight
                        }
                        Text {
                            width: parent.width
                            text: page.spool().activeText || ""
                            color: Style.text2
                            font.pixelSize: 13
                            elide: Text.ElideRight
                            visible: (page.focusRow().name || "").length > 0 && page.focusRow().active !== true
                        }
                        Text {
                            width: parent.width
                            text: [
                                page.focusRow().material || "Material unknown",
                                page.focusRow().vendor || "Vendor unknown"
                            ].join("  ·  ")
                            color: Style.text2
                            font.pixelSize: 13
                            elide: Text.ElideRight
                        }
                        Text {
                            width: parent.width
                            text: page.focusRow().weightLine || "Weight not reported"
                            color: Style.text
                            font.pixelSize: 13
                            elide: Text.ElideRight
                        }
                        Text {
                            width: parent.width
                            text: page.spool().lockReason || page.focusRow().location || ""
                            color: page.spool().locked ? Style.warn : Style.dim
                            font.pixelSize: 12
                            elide: Text.ElideRight
                        }
                    }
                    Column {
                        id: actions
                        width: page.compact ? 146 : 176
                        spacing: 6
                        anchors.verticalCenter: parent.verticalCenter
                        Tap {
                            width: parent.width
                            label: "Set active"
                            enabled: page.spool().canSet === true
                            fill: page.spool().canSet === true ? Style.cyan : Style.surface3
                            ink: page.spool().canSet === true ? "#061016" : Style.text
                            onTapped: bridge.setActiveSpool(page.spool().selectedId || 0)
                        }
                        Tap {
                            width: parent.width
                            label: "Clear active"
                            enabled: page.spool().canClear === true
                            onTapped: bridge.clearActiveSpool()
                        }
                    }
                }
            }

            Flickable {
                id: filters
                width: parent.width
                height: 44
                contentWidth: filterRow.width
                contentHeight: height
                clip: true
                boundsBehavior: Flickable.StopAtBounds
                flickableDirection: Flickable.HorizontalFlick
                interactive: contentWidth > width + 1

                Row {
                    id: filterRow
                    spacing: 6
                    height: 40
                    Repeater {
                        model: [
                            { "kind": "status", "id": "available", "label": "Available" },
                            { "kind": "status", "id": "all", "label": "All" },
                            { "kind": "status", "id": "active", "label": "Active" },
                            { "kind": "status", "id": "archived", "label": "Archived" },
                            { "kind": "status", "id": "empty", "label": "Empty" }
                        ]
                        delegate: filterChip
                    }
                    Repeater {
                        model: page.spool().materials || []
                        delegate: Rectangle {
                            required property var modelData
                            width: labelText.width + 20
                            height: 40
                            radius: 12
                            color: page.spool().material === modelData ? "#223ee0f0" : Style.surface3
                            border.color: page.spool().material === modelData ? Style.cyan : Style.border
                            Text { id: labelText; anchors.centerIn: parent; text: modelData; color: Style.text; font.bold: true; font.pixelSize: 13 }
                            MouseArea {
                                anchors.fill: parent
                                cursorShape: page.view.hideCursor ? Qt.BlankCursor : Qt.PointingHandCursor
                                onClicked: bridge.setSpoolFilter(page.draft, page.spool().material === modelData ? "" : modelData, page.spool().vendor || "", page.spool().status || "available", page.spool().color || "")
                            }
                        }
                    }
                    Repeater {
                        model: page.spool().vendors || []
                        delegate: Rectangle {
                            required property var modelData
                            width: vendorText.width + 20
                            height: 40
                            radius: 12
                            color: page.spool().vendor === modelData ? "#223ee0f0" : Style.surface3
                            border.color: page.spool().vendor === modelData ? Style.cyan : Style.border
                            Text { id: vendorText; anchors.centerIn: parent; text: modelData; color: Style.text; font.bold: true; font.pixelSize: 13 }
                            MouseArea {
                                anchors.fill: parent
                                cursorShape: page.view.hideCursor ? Qt.BlankCursor : Qt.PointingHandCursor
                                onClicked: bridge.setSpoolFilter(page.draft, page.spool().material || "", page.spool().vendor === modelData ? "" : modelData, page.spool().status || "available", page.spool().color || "")
                            }
                        }
                    }
                    Repeater {
                        model: ["red", "orange", "yellow", "green", "cyan", "blue", "purple", "white", "black", "grey"]
                        delegate: Rectangle {
                            required property var modelData
                            width: colorText.width + 20
                            height: 40
                            radius: 12
                            color: page.spool().color === modelData ? "#223ee0f0" : Style.surface3
                            border.color: page.spool().color === modelData ? Style.cyan : Style.border
                            Text { id: colorText; anchors.centerIn: parent; text: modelData; color: Style.text; font.bold: true; font.pixelSize: 13 }
                            MouseArea {
                                anchors.fill: parent
                                cursorShape: page.view.hideCursor ? Qt.BlankCursor : Qt.PointingHandCursor
                                onClicked: bridge.setSpoolFilter(page.draft, page.spool().material || "", page.spool().vendor || "", page.spool().status || "available", page.spool().color === modelData ? "" : modelData)
                            }
                        }
                    }
                }
            }

            TextField {
                id: search
                width: parent.width
                height: 44
                text: page.draft
                placeholderText: "Search name, vendor, material"
                color: Style.text
                font.pixelSize: 16
                leftPadding: 12
                onTextChanged: {
                    page.draft = text
                    bridge.setSpoolFilter(text, page.spool().material || "", page.spool().vendor || "", page.spool().status || "available", page.spool().color || "")
                }
                onActiveFocusChanged: {
                    if (activeFocus) {
                        page.keyboardOn = true
                        Qt.callLater(function() { page.revealSearch() })
                    }
                }
                background: Rectangle { color: Style.surface3; radius: 12; border.color: search.activeFocus ? Style.cyan : Style.border }
            }

            Flickable {
                width: parent.width
                height: 44
                visible: (page.spool().unloadMacros || []).length > 0 && page.spool().locked !== true
                contentWidth: unloadRow.width
                contentHeight: height
                clip: true
                boundsBehavior: Flickable.StopAtBounds
                flickableDirection: Flickable.HorizontalFlick
                Row {
                    id: unloadRow
                    spacing: 6
                    Repeater {
                        model: page.spool().unloadMacros || []
                        delegate: Tap {
                            required property var modelData
                            width: Math.min(220, Math.max(120, modelData.name.length * 10))
                            label: "Unload " + modelData.name
                            enabled: page.spool().canUnload === true
                            onTapped: bridge.unloadAndClear(modelData.name)
                        }
                    }
                }
            }
            Text {
                width: parent.width
                wrapMode: Text.WordWrap
                maximumLineCount: page.compact ? 2 : 4
                elide: Text.ElideRight
                visible: (page.spool().unloadMacros || []).length === 0 && page.spool().phase === "ready"
                text: page.spool().unloadHint || ""
                color: Style.dim
                font.pixelSize: 12
            }
        }

        ListView {
            id: list
            width: parent.width
            height: page.listHeight
            clip: true
            boundsBehavior: Flickable.StopAtBounds
            interactive: !scroller.dragging
            spacing: 6
            model: page.spool().rows || []
            delegate: Rectangle {
                required property var modelData
                width: list.width
                height: page.spoolRowHeight
                radius: 12
                color: modelData.id === page.spool().selectedId ? "#223ee0f0" : Style.surface2
                border.color: modelData.active ? Style.cyan : Style.border
                Row {
                    anchors.fill: parent
                    anchors.margins: 8
                    spacing: 8
                    SpoolArt {
                        width: page.compact ? 52 : 64
                        height: width
                        colors: modelData.colors || []
                        imageKey: modelData.imageKey || ""
                        active: modelData.active === true
                    }
                    Column {
                        width: parent.width - 80
                        anchors.verticalCenter: parent.verticalCenter
                        spacing: 2
                        Text {
                            width: parent.width
                            text: (modelData.active ? "Active  ·  " : "") + (modelData.name || "Unnamed spool")
                            color: Style.text
                            font.bold: true
                            font.pixelSize: page.compact ? 14 : 16
                            elide: Text.ElideRight
                        }
                        Text {
                            width: parent.width
                            text: (modelData.material || "Material unknown") + "  ·  " + (modelData.vendor || "Vendor unknown")
                            color: Style.text2
                            font.pixelSize: 13
                            elide: Text.ElideRight
                        }
                        Text {
                            width: parent.width
                            text: modelData.weightLine || "Weight not reported"
                            color: Style.dim
                            font.pixelSize: 12
                            elide: Text.ElideRight
                        }
                    }
                }
                MouseArea {
                    anchors.fill: parent
                    cursorShape: page.view.hideCursor ? Qt.BlankCursor : Qt.PointingHandCursor
                    onClicked: bridge.selectSpool(modelData.id)
                }
            }
        }

        Row {
            id: footer
            width: parent.width
            height: 48
            spacing: 8
            Tap {
                width: 120
                label: "Previous"
                enabled: (page.spool().page || 0) > 0
                onTapped: bridge.moveSpoolPage(-1)
            }
            Text {
                width: Math.max(48, parent.width - 392)
                anchors.verticalCenter: parent.verticalCenter
                horizontalAlignment: Text.AlignHCenter
                text: page.spool().range || ""
                color: Style.dim
                elide: Text.ElideRight
            }
            Tap {
                width: 120
                label: "Next"
                enabled: (page.spool().page || 0) + 1 < (page.spool().pages || 1)
                onTapped: bridge.moveSpoolPage(1)
            }
            Tap {
                width: 120
                label: "Refresh"
                enabled: page.view.fixture !== true && page.view.transport === "connected"
                onTapped: bridge.refreshSpools()
            }
        }
        }
    }

    Component {
        id: filterChip
        Rectangle {
            required property var modelData
            width: chipText.width + 20
            height: 40
            radius: 12
            color: page.spool().status === modelData.id ? "#223ee0f0" : Style.surface3
            border.color: page.spool().status === modelData.id ? Style.cyan : Style.border
            Text { id: chipText; anchors.centerIn: parent; text: modelData.label; color: Style.text; font.bold: true; font.pixelSize: 13 }
            MouseArea {
                anchors.fill: parent
                cursorShape: page.view.hideCursor ? Qt.BlankCursor : Qt.PointingHandCursor
                onClicked: bridge.setSpoolFilter(page.draft, page.spool().material || "", page.spool().vendor || "", modelData.id, page.spool().color || "")
            }
        }
    }

    function revealSearch() {
        var pos = search.mapToItem(body, 0, 0)
        var bottom = pos.y + search.height + 12
        if (bottom > scroller.contentY + scroller.height)
            scroller.contentY = Math.max(0, bottom - scroller.height)
        if (pos.y < scroller.contentY)
            scroller.contentY = Math.max(0, pos.y - 8)
    }

    Rectangle {
        id: keyboard
        visible: page.keyboardOn
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.bottom: parent.bottom
        height: 240
        color: "#f0101218"
        border.color: Style.border
        z: 2

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
                            Text {
                                anchors.centerIn: parent
                                text: page.shiftActive ? glyph.toUpperCase() : glyph
                                color: Style.text
                                font.bold: true
                            }
                            MouseArea {
                                anchors.fill: parent
                                cursorShape: page.view.hideCursor ? Qt.BlankCursor : Qt.PointingHandCursor
                                onClicked: {
                                    search.insert(search.cursorPosition, page.shiftActive ? glyph.toUpperCase() : glyph)
                                    page.shiftActive = false
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
                    width: 100
                    height: 40
                    radius: 8
                    color: page.shiftActive ? Style.purple : Style.surface3
                    Text { anchors.centerIn: parent; text: "Shift ↑"; color: page.shiftActive ? "#061016" : Style.text; font.bold: true }
                    MouseArea {
                        anchors.fill: parent
                        cursorShape: page.view.hideCursor ? Qt.BlankCursor : Qt.PointingHandCursor
                        onClicked: page.shiftActive = !page.shiftActive
                    }
                }
                Rectangle {
                    width: 120
                    height: 40
                    radius: 8
                    color: Style.surface3
                    Text { anchors.centerIn: parent; text: "Space"; color: Style.text }
                    MouseArea {
                        anchors.fill: parent
                        cursorShape: page.view.hideCursor ? Qt.BlankCursor : Qt.PointingHandCursor
                        onClicked: search.insert(search.cursorPosition, " ")
                    }
                }
                Rectangle {
                    width: 120
                    height: 40
                    radius: 8
                    color: Style.surface3
                    Text { anchors.centerIn: parent; text: "Delete"; color: Style.text }
                    MouseArea {
                        anchors.fill: parent
                        cursorShape: page.view.hideCursor ? Qt.BlankCursor : Qt.PointingHandCursor
                        onClicked: if (search.cursorPosition > 0) search.remove(search.cursorPosition - 1, search.cursorPosition)
                    }
                }
                Rectangle {
                    width: 120
                    height: 40
                    radius: 8
                    color: Style.cyan
                    Text { anchors.centerIn: parent; text: "Done"; color: "#061016"; font.bold: true }
                    MouseArea {
                        anchors.fill: parent
                        cursorShape: page.view.hideCursor ? Qt.BlankCursor : Qt.PointingHandCursor
                        onClicked: page.keyboardOn = false
                    }
                }
            }
        }
    }
}
