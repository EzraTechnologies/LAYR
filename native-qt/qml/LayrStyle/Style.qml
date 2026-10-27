pragma Singleton
import QtQuick

QtObject {
    property bool black: false
    readonly property color bg: black ? "#000000" : "#0a0c11"
    readonly property color surface: black ? "#07080b" : "#12151c"
    readonly property color surface2: black ? "#0c0e13" : "#171b24"
    readonly property color surface3: black ? "#151922" : "#1e2330"
    readonly property color border: "#18ffffff"
    readonly property color text: "#e9edf5"
    readonly property color text2: "#b4bccc"
    readonly property color dim: "#7f889c"
    readonly property color cyan: "#3ee0f0"
    readonly property color purple: "#8b6cff"
    readonly property color ok: "#4ade80"
    readonly property color warn: "#fbbf24"
    readonly property color danger: "#fb7185"
    readonly property color heat: "#ff8a4c"

    function toneColor(tone) {
        if (tone === "ok")
            return ok
        if (tone === "warn")
            return warn
        if (tone === "danger")
            return danger
        if (tone === "purple")
            return purple
        if (tone === "dim")
            return dim
        return cyan
    }
}
