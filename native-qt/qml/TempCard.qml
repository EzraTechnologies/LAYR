import QtQuick
import LayrStyle

Rectangle {
    id: card
    property var reading: ({})
    property bool compact: false
    radius: compact ? 12 : 16
    color: Style.surface2
    border.color: Style.border
    border.width: 1

    Column {
        anchors.fill: parent
        anchors.margins: compact ? 8 : 12
        spacing: 2

        Text {
            text: (card.reading && card.reading.label) ? card.reading.label : ""
            color: Style.dim
            font.pixelSize: compact ? 11 : 12
            font.bold: true
            font.capitalization: Font.AllUppercase
        }
        Text {
            text: (card.reading && card.reading.value) ? card.reading.value : "—"
            color: Style.text
            font.pixelSize: compact ? 28 : 36
            font.bold: true
        }
        Text {
            text: {
                if (!card.reading)
                    return ""
                if (card.reading.missing && card.reading.missing.length > 0 && card.reading.value === "—")
                    return card.reading.missing
                return card.reading.target || ""
            }
            color: Style.text2
            font.pixelSize: compact ? 11 : 13
            elide: Text.ElideRight
            width: parent.width
        }
        Rectangle {
            width: parent.width
            height: 4
            radius: 2
            color: "#14ffffff"
            visible: card.reading && card.reading.target && card.reading.target.length > 0
            Rectangle {
                width: parent.width * Math.max(0, Math.min(1, card.reading ? card.reading.power : 0))
                height: parent.height
                radius: 2
                color: Style.heat
            }
        }
    }
}
