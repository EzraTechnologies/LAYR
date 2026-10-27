import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

Item {
    id: page
    property string draftUrl: bridge.moonrakerUrl
    property string draftName: bridge.displayName
    property string activeField: ""

    onVisibleChanged: {
        if (visible) {
            draftUrl = bridge.moonrakerUrl
            draftName = bridge.displayName
        }
    }

    Flickable {
        id: flick
        anchors.fill: parent
        anchors.leftMargin: win.pad
        anchors.rightMargin: win.pad
        anchors.bottomMargin: keyboard.visible ? keyboard.height + 8 : win.pad
        contentWidth: width
        contentHeight: column.implicitHeight
        clip: true

        ColumnLayout {
            id: column
            width: parent.width
            spacing: win.gap

            Text {
                text: "The name below is only a label on this screen. It does not change the Pi hostname."
                color: win.ink2
                wrapMode: Text.Wrap
                Layout.fillWidth: true
            }

            Text { text: "PRINTER NAME"; color: win.dim; font.pixelSize: 11; font.weight: Font.DemiBold; font.letterSpacing: 0.8 }
            TextField {
                id: nameField
                Layout.fillWidth: true
                implicitHeight: win.touch
                text: page.draftName
                placeholderText: "Klipper host name"
                onTextChanged: page.draftName = text
                onActiveFocusChanged: page.activeField = activeFocus ? "name" : (page.activeField === "name" ? "" : page.activeField)
                background: Rectangle { color: "#10141c"; radius: 12; border.color: nameField.activeFocus ? win.cyan : win.cardEdge }
                color: win.ink
            }

            Text { text: "MOONRAKER URL"; color: win.dim; font.pixelSize: 11; font.weight: Font.DemiBold; font.letterSpacing: 0.8 }
            TextField {
                id: urlField
                Layout.fillWidth: true
                implicitHeight: win.touch
                text: page.draftUrl
                placeholderText: "http://localhost:7125"
                inputMethodHints: Qt.ImhNoAutoUppercase | Qt.ImhUrlCharactersOnly
                onTextChanged: page.draftUrl = text
                onActiveFocusChanged: page.activeField = activeFocus ? "url" : (page.activeField === "url" ? "" : page.activeField)
                background: Rectangle { color: "#10141c"; radius: 12; border.color: urlField.activeFocus ? win.cyan : win.cardEdge }
                color: win.ink
            }

            Text {
                visible: bridge.formError !== ""
                text: bridge.formError
                color: win.danger
                wrapMode: Text.Wrap
                Layout.fillWidth: true
            }
            Text {
                visible: bridge.notice !== ""
                text: bridge.notice
                color: win.ok
                wrapMode: Text.Wrap
                Layout.fillWidth: true
            }

            RowLayout {
                Layout.fillWidth: true
                spacing: 8
                Button {
                    text: "Save"
                    implicitHeight: win.touch
                    implicitWidth: 120
                    onClicked: bridge.saveSettings(page.draftUrl, page.draftName)
                }
                Button {
                    text: "Reconnect"
                    implicitHeight: win.touch
                    implicitWidth: 140
                    onClicked: bridge.reconnect()
                }
            }

            RowLayout {
                Layout.fillWidth: true
                spacing: 12
                Switch {
                    checked: bridge.hideCursor
                    onToggled: bridge.setHideCursor(checked)
                }
                Text { text: "Hide pointer (touch still works, and a mouse can still click)"; color: win.ink2; wrapMode: Text.Wrap; Layout.fillWidth: true }
            }

            RowLayout {
                Layout.fillWidth: true
                spacing: 8
                Button {
                    text: bridge.themeName === "black" ? "Theme: black" : "Theme: midnight"
                    implicitHeight: win.touch
                    onClicked: bridge.setTheme(bridge.themeName === "black" ? "midnight" : "black")
                }
                Button { text: "1024×600"; implicitHeight: win.touch; onClicked: bridge.resizeTo(1024, 600) }
                Button { text: "800×480"; implicitHeight: win.touch; onClicked: bridge.resizeTo(800, 480) }
            }

            Text {
                Layout.fillWidth: true
                color: win.dim
                wrapMode: Text.Wrap
                font.pixelSize: 12
                text: "Trusted clients on this Pi should allow 127.0.0.1 in Moonraker. An API key is read from LAYR_QT_API_KEY if you set it in the environment. It is not saved in preferences.\n\nPerf log: " + (bridge.perfPath || "not written in screenshot mode")
            }
        }
    }

    Keyboard {
        id: keyboard
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.bottom: parent.bottom
        visible: page.activeField !== ""
        onTyped: function(value) {
            var field = page.activeField === "url" ? urlField : nameField
            if (value === "\b") field.text = field.text.slice(0, -1)
            else field.text = field.text + value
        }
    }
}
