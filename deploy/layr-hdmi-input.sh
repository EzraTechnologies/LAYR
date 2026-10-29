#!/usr/bin/env bash
# Opt-in ignore for Raspberry Pi vc4-hdmi phantom pointing sticks.
#
#   ./deploy/layr-hdmi-input.sh status
#   ./deploy/layr-hdmi-input.sh apply [--yes] [--dry-run] [--restart-kiosk]
#   ./deploy/layr-hdmi-input.sh remove [--yes] [--dry-run] [--restart-kiosk]
#   ./deploy/layr-hdmi-input.sh restore [--yes] [--dry-run] [--restart-kiosk]
#
# status is the default and changes nothing. apply writes a udev rule only when a
# device is named vc4-hdmi-<digits> and udev reports ID_INPUT_POINTINGSTICK=1.
# Event numbers are never used to decide what to ignore. Touchscreens, mice, and
# any other name are not matched. HDMI-CEC keys on the ignored devices stop working.
#
# A rule file this script did not write is left in place, including a hand-written
# Pi rule. remove deletes only a LAYR-managed file. Nothing here restarts Klipper
# or Moonraker. --restart-kiosk restarts layr-kiosk.service only when it is already active.
#
# Test seams (leave unset on a Pi):
#   LAYR_INPUT_FIXTURE    directory of eventN/{name,properties} instead of sysfs
#   LAYR_UDEV_RULES_PATH  rule file path instead of /etc/udev/rules.d/
#   LAYR_UDEV_CMD_LOG     record udevadm commands here instead of running them
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=deploy/lib.sh
. "$HERE/lib.sh"

RULE_MARKER='# LAYR-owned: 99-layr-ignore-hdmi-pointers.rules'
HDMI_STATE="${LAYR_HDMI_STATE:-$LAYR_STATE/hdmi-pointer}"
RESTART_KIOSK=0

usage() {
  cat <<'EOF'
Usage: deploy/layr-hdmi-input.sh status|apply|remove|restore [--yes] [--dry-run] [--restart-kiosk]

status   List input devices and whether a vc4-hdmi pointing stick is present. Changes nothing.
apply    With consent, install a narrow udev rule for those devices only.
remove   Delete a rule this script wrote, then reload udev for those event nodes.
restore  Put back the last removed or previous LAYR-managed copy. Does not replace a foreign file.

--yes             Skip the confirmation prompt. This is the unattended opt-in.
--dry-run         Print the rule and the udev commands. Write nothing.
--restart-kiosk   Restart layr-kiosk.service only if it is already active.
EOF
}

rules_need_sudo() {
  case "$1" in
    /etc | /etc/*) return 0 ;;
    *) return 1 ;;
  esac
}

valid_device_name() {
  printf '%s\n' "$1" | grep -Eq '^vc4-hdmi-[0-9]+$'
}

valid_event_node() {
  case "$1" in
    event[0-9] | event[0-9][0-9] | event[0-9][0-9][0-9]) return 0 ;;
    *) return 1 ;;
  esac
}

valid_action_line() {
  printf '%s\n' "$1" | grep -Eq '^ACTION!="remove", SUBSYSTEM=="input", KERNEL=="event\[0-9\]\*", ATTRS\{name\}=="vc4-hdmi-[0-9]+", ENV\{LIBINPUT_IGNORE_DEVICE\}="1"$'
}

list_events() {
  local root node base restore=0
  if [ -n "${LAYR_INPUT_FIXTURE:-}" ]; then
    root=$LAYR_INPUT_FIXTURE
  else
    root=/sys/class/input
  fi
  [ -d "$root" ] || return 0
  if ! shopt -q nullglob; then
    shopt -s nullglob
    restore=1
  fi
  for node in "$root"/event*; do
    [ -d "$node" ] || continue
    base=$(basename "$node")
    if valid_event_node "$base"; then
      printf '%s\n' "$base"
    fi
  done
  if [ "$restore" = 1 ]; then
    shopt -u nullglob
  fi
}

input_device_name() {
  local event=$1 file
  if [ -n "${LAYR_INPUT_FIXTURE:-}" ]; then
    file=$LAYR_INPUT_FIXTURE/$event/name
  else
    file=/sys/class/input/$event/device/name
  fi
  if [ ! -r "$file" ]; then
    printf '\n'
    return 0
  fi
  tr -d '\000\r\n' <"$file"
}

input_device_properties() {
  local event=$1
  if [ -n "${LAYR_INPUT_FIXTURE:-}" ]; then
    if [ -r "$LAYR_INPUT_FIXTURE/$event/properties" ]; then
      cat "$LAYR_INPUT_FIXTURE/$event/properties"
    fi
    return 0
  fi
  if command -v udevadm >/dev/null 2>&1; then
    udevadm info -q property -n "/dev/input/$event" 2>/dev/null || true
  fi
}

prop_get() {
  local props=$1 key=$2 line
  while IFS= read -r line; do
    case "$line" in
      "$key"=*)
        printf '%s\n' "${line#"$key"=}"
        return 0
        ;;
    esac
  done <<<"$props"
  return 1
}

# A phantom pointer is a Raspberry Pi HDMI-CEC input that libinput treats as a pointing stick.
# The touchscreen on a BTT HDMI7 is a different name and is rejected even if it also reports
# ID_INPUT_POINTINGSTICK. A vc4-hdmi device that is only a keyboard is not ignored.
device_is_phantom() {
  local name=$1 props=$2 stick touch
  if ! valid_device_name "$name"; then
    return 1
  fi
  stick=$(prop_get "$props" ID_INPUT_POINTINGSTICK || true)
  if [ "$stick" != "1" ]; then
    return 1
  fi
  touch=$(prop_get "$props" ID_INPUT_TOUCHSCREEN || true)
  if [ "$touch" = "1" ]; then
    return 1
  fi
  return 0
}

list_phantom_names() {
  local event name props
  while IFS= read -r event; do
    [ -n "$event" ] || continue
    name=$(input_device_name "$event")
    props=$(input_device_properties "$event")
    if device_is_phantom "$name" "$props"; then
      printf '%s\n' "$name"
    fi
  done < <(list_events)
}

list_phantom_events() {
  local event name props
  while IFS= read -r event; do
    [ -n "$event" ] || continue
    name=$(input_device_name "$event")
    props=$(input_device_properties "$event")
    if device_is_phantom "$name" "$props"; then
      printf '%s\n' "$event"
    fi
  done < <(list_events)
}

render_rule() {
  local name
  [ "$#" -ge 1 ] || return 1
  for name in "$@"; do
    if ! valid_device_name "$name"; then
      echo "refusing to write a rule for unexpected device name: $name" >&2
      return 1
    fi
  done
  cat <<EOF
$RULE_MARKER
# Managed by deploy/layr-hdmi-input.sh. Do not edit this file.
# Ignores Raspberry Pi vc4-hdmi virtual pointing sticks only.
# HDMI-CEC remote and keyboard events on those devices are ignored too.
# Touchscreens, mice, and other input devices are not matched.
# Remove with: deploy/layr-hdmi-input.sh remove
EOF
  for name in "$@"; do
    printf 'ACTION!="remove", SUBSYSTEM=="input", KERNEL=="event[0-9]*", ATTRS{name}=="%s", ENV{LIBINPUT_IGNORE_DEVICE}="1"\n' "$name"
  done
}

is_known_header_line() {
  case "$1" in
    "$RULE_MARKER" | \
      '# Managed by deploy/layr-hdmi-input.sh. Do not edit this file.' | \
      '# Ignores Raspberry Pi vc4-hdmi virtual pointing sticks only.' | \
      '# HDMI-CEC remote and keyboard events on those devices are ignored too.' | \
      '# Touchscreens, mice, and other input devices are not matched.' | \
      '# Remove with: deploy/layr-hdmi-input.sh remove')
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

is_layr_managed_rule() {
  local file=$1 line first=1
  [ -f "$file" ] || return 1
  while IFS= read -r line || [ -n "$line" ]; do
    if [ "$first" = 1 ]; then
      [ "$line" = "$RULE_MARKER" ] || return 1
      first=0
      continue
    fi
    case "$line" in
      '') continue ;;
      '#'*) is_known_header_line "$line" || return 1 ;;
      *) valid_action_line "$line" || return 1 ;;
    esac
  done <"$file"
  [ "$first" = 0 ]
}

file_covers_names() {
  local file=$1 line name
  shift
  [ -f "$file" ] || return 1
  [ "$#" -ge 1 ] || return 1
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      '' | '#'*) continue ;;
    esac
    valid_action_line "$line" || return 1
  done <"$file"
  for name in "$@"; do
    grep -F -q -- "ATTRS{name}==\"${name}\"" "$file" || return 1
  done
}

load_phantom_names() {
  PHANTOM_NAMES=()
  local name
  while IFS= read -r name; do
    [ -n "$name" ] || continue
    PHANTOM_NAMES+=("$name")
  done < <(list_phantom_names | LC_ALL=C sort -u -V)
}

write_rule_file() {
  local src=$1 dest=$2
  if [ "$DRY_RUN" = 1 ]; then
    echo "refusing to write a udev rule during dry-run" >&2
    return 1
  fi
  if rules_need_sudo "$dest"; then
    sudo install -m 644 "$src" "$dest"
  else
    mkdir -p "$(dirname "$dest")"
    install -m 644 "$src" "$dest"
  fi
}

delete_rule_file() {
  local dest=$1
  if [ "$DRY_RUN" = 1 ]; then
    echo "refusing to delete a udev rule during dry-run" >&2
    return 1
  fi
  if rules_need_sudo "$dest"; then
    sudo rm -f -- "$dest"
  else
    rm -f -- "$dest"
  fi
}

udev_reload() {
  local event
  if [ "$DRY_RUN" = 1 ]; then
    echo "refusing to reload udev during dry-run" >&2
    return 1
  fi
  if [ -n "${LAYR_UDEV_CMD_LOG:-}" ]; then
    mkdir -p "$(dirname "$LAYR_UDEV_CMD_LOG")"
    printf 'udevadm control --reload-rules\n' >>"$LAYR_UDEV_CMD_LOG"
    while IFS= read -r event; do
      [ -n "$event" ] || continue
      if ! valid_event_node "$event"; then
        echo "refusing to trigger unexpected input node: $event" >&2
        return 1
      fi
      printf 'udevadm trigger --subsystem-match=input --action=change --sysname-match=%s\n' "$event" >>"$LAYR_UDEV_CMD_LOG"
    done < <(list_phantom_events | LC_ALL=C sort -V)
    return 0
  fi
  sudo udevadm control --reload-rules
  while IFS= read -r event; do
    [ -n "$event" ] || continue
    if ! valid_event_node "$event"; then
      echo "refusing to trigger unexpected input node: $event" >&2
      return 1
    fi
    sudo udevadm trigger --subsystem-match=input --action=change --sysname-match="$event"
  done < <(list_phantom_events | LC_ALL=C sort -V)
}

print_live_ignore_state() {
  local event name props ignore touch
  while IFS= read -r event; do
    [ -n "$event" ] || continue
    name=$(input_device_name "$event")
    props=$(input_device_properties "$event")
    ignore=$(prop_get "$props" LIBINPUT_IGNORE_DEVICE || true)
    touch=$(prop_get "$props" ID_INPUT_TOUCHSCREEN || true)
    if device_is_phantom "$name" "$props" || [ "$touch" = "1" ]; then
      echo "live: $event name=$name ID_INPUT_TOUCHSCREEN=${touch:--} LIBINPUT_IGNORE_DEVICE=${ignore:--}"
    fi
  done < <(list_events | LC_ALL=C sort -V)
}

print_hdmi_warning() {
  local event name props
  echo "Matching vc4-hdmi pointing sticks:"
  while IFS= read -r event; do
    [ -n "$event" ] || continue
    name=$(input_device_name "$event")
    props=$(input_device_properties "$event")
    if device_is_phantom "$name" "$props"; then
      echo "  $name (kernel node $event; the rule matches the name, not this number)"
    fi
  done < <(list_events | LC_ALL=C sort -V)
  cat <<'EOF'
The udev rule sets LIBINPUT_IGNORE_DEVICE=1 for those names only.
A touchscreen, a USB mouse, and any other input device are left alone.
HDMI-CEC remote and keyboard events on the listed vc4-hdmi devices are ignored too.
The rule persists across reboot. remove deletes a rule this script wrote.
Klipper and Moonraker are not restarted.
EOF
}

kiosk_followup() {
  if [ "$RESTART_KIOSK" = 1 ]; then
    reload_active_kiosk
    return 0
  fi
  echo "This command does not restart the kiosk unless you pass --restart-kiosk."
  echo "Cage can keep a cursor it already created until layr-kiosk starts again."
  echo "Restart only that unit with: sudo systemctl restart layr-kiosk"
  echo "That does not restart Klipper or Moonraker."
}

cmd_status() {
  local event name props stick touch mouse key phantom dest count joined name_item
  dest=$HDMI_POINTER_RULE_PATH
  echo "rule-path: $dest"
  if [ -f "$dest" ]; then
    echo "rule-present: yes"
    if is_layr_managed_rule "$dest"; then
      echo "rule-managed: yes"
    else
      echo "rule-managed: no"
    fi
  else
    echo "rule-present: no"
    echo "rule-managed: absent"
  fi
  while IFS= read -r event; do
    [ -n "$event" ] || continue
    name=$(input_device_name "$event")
    props=$(input_device_properties "$event")
    stick=$(prop_get "$props" ID_INPUT_POINTINGSTICK || true)
    touch=$(prop_get "$props" ID_INPUT_TOUCHSCREEN || true)
    mouse=$(prop_get "$props" ID_INPUT_MOUSE || true)
    key=$(prop_get "$props" ID_INPUT_KEY || true)
    if device_is_phantom "$name" "$props"; then
      phantom=yes
    else
      phantom=no
    fi
    echo "device: $event"
    echo "  name: $name"
    echo "  ID_INPUT_POINTINGSTICK: ${stick:--}"
    echo "  ID_INPUT_TOUCHSCREEN: ${touch:--}"
    echo "  ID_INPUT_MOUSE: ${mouse:--}"
    echo "  ID_INPUT_KEY: ${key:--}"
    echo "  phantom-hdmi-pointer: $phantom"
  done < <(list_events | LC_ALL=C sort -V)
  load_phantom_names
  count=${#PHANTOM_NAMES[@]}
  joined=""
  if [ "$count" -gt 0 ]; then
    for name_item in "${PHANTOM_NAMES[@]}"; do
      joined="${joined:+$joined }$name_item"
    done
  fi
  if [ -n "$joined" ]; then
    echo "phantom-names: $joined"
  else
    echo "phantom-names:"
  fi
  echo "phantom-count: $count"
  if [ "$count" -gt 0 ]; then
    echo "mitigation-offered: yes"
  else
    echo "mitigation-offered: no"
  fi
  if [ "$count" -eq 0 ] || [ ! -f "$dest" ]; then
    echo "rule-covers-phantoms: n/a"
  elif file_covers_names "$dest" "${PHANTOM_NAMES[@]}"; then
    echo "rule-covers-phantoms: yes"
  else
    echo "rule-covers-phantoms: no"
  fi
  echo "note: status does not change input devices, udev rules, or services."
}

cmd_apply() {
  local dest tmp event
  dest=$HDMI_POINTER_RULE_PATH
  load_phantom_names
  if [ "${#PHANTOM_NAMES[@]}" -eq 0 ]; then
    echo "No vc4-hdmi pointing stick found. No udev rule was written."
    echo "mitigation-applied: no"
    return 0
  fi
  print_hdmi_warning
  echo "Rule path: $dest"
  if [ "$DRY_RUN" = 1 ]; then
    echo "Dry run. No file, udev device, or service was changed."
    echo "Would write $dest:"
    render_rule "${PHANTOM_NAMES[@]}"
    echo "Would run: udevadm control --reload-rules"
    while IFS= read -r event; do
      [ -n "$event" ] || continue
      echo "Would run: udevadm trigger --subsystem-match=input --action=change --sysname-match=$event"
    done < <(list_phantom_events | LC_ALL=C sort -V)
    echo "mitigation-applied: no"
    return 0
  fi
  if [ "$ASSUME_YES" != 1 ]; then
    confirm "Install the vc4-hdmi ignore rule?" || die "Cancelled. No input device was changed."
  fi
  tmp=$(mktemp)
  if ! render_rule "${PHANTOM_NAMES[@]}" >"$tmp"; then
    rm -f "$tmp"
    die "Could not render a udev rule. No file was written."
  fi
  if [ -f "$dest" ] && cmp -s "$tmp" "$dest"; then
    rm -f "$tmp"
    info "Rule already matches. The file was not rewritten."
    echo "before:"
    print_live_ignore_state
    udev_reload
    echo "after:"
    print_live_ignore_state
    echo "mitigation-applied: unchanged"
    kiosk_followup
    return 0
  fi
  if [ -f "$dest" ] && is_layr_managed_rule "$dest"; then
    mkdir -p "$HDMI_STATE"
    cp -a "$dest" "$HDMI_STATE/previous-managed.rules"
    write_rule_file "$tmp" "$dest"
    rm -f "$tmp"
    cp -a "$dest" "$HDMI_STATE/managed.rules"
    printf '%s\n' "${PHANTOM_NAMES[@]}" >"$HDMI_STATE/matched-names"
    info "Updated the LAYR-managed rule at $dest. The previous copy is $HDMI_STATE/previous-managed.rules."
  elif [ -f "$dest" ] && file_covers_names "$dest" "${PHANTOM_NAMES[@]}"; then
    rm -f "$tmp"
    warn "Left $dest unchanged. It already ignores these vc4-hdmi pointing sticks and was not written by LAYR."
    echo "A hand-written Pi rule is preserved. remove will not delete it."
    echo "before:"
    print_live_ignore_state
    udev_reload
    echo "after:"
    print_live_ignore_state
    echo "mitigation-applied: unchanged"
    kiosk_followup
    return 0
  elif [ -f "$dest" ]; then
    rm -f "$tmp"
    die "Refusing to overwrite $dest. It is not a LAYR-managed rule for these vc4-hdmi devices. No file was changed."
  else
    write_rule_file "$tmp" "$dest"
    rm -f "$tmp"
    mkdir -p "$HDMI_STATE"
    cp -a "$dest" "$HDMI_STATE/managed.rules"
    printf '%s\n' "${PHANTOM_NAMES[@]}" >"$HDMI_STATE/matched-names"
    info "Installed $dest. It persists across reboot."
  fi
  echo "Confirm on the panel that the ghost pointer is gone, the touchscreen still taps, and a physical mouse still clicks."
  echo "HDMI-CEC input on the ignored vc4-hdmi devices will not work while this rule is installed."
  echo "before:"
  print_live_ignore_state
  udev_reload
  echo "after:"
  print_live_ignore_state
  echo "mitigation-applied: yes"
  kiosk_followup
}

cmd_remove() {
  local dest
  dest=$HDMI_POINTER_RULE_PATH
  if [ ! -f "$dest" ]; then
    info "No rule at $dest. Nothing to remove."
    return 0
  fi
  if ! is_layr_managed_rule "$dest"; then
    die "Refusing to remove $dest because LAYR did not write it. The file was not changed."
  fi
  echo "This removes the LAYR vc4-hdmi ignore rule. Those pointing sticks become visible to libinput again."
  echo "A touchscreen or mouse is not modified. Klipper and Moonraker are not restarted."
  if [ "$DRY_RUN" = 1 ]; then
    echo "Dry run. Would remove $dest and reload udev for the vc4-hdmi pointing-stick event nodes only."
    return 0
  fi
  if [ "$ASSUME_YES" != 1 ]; then
    confirm "Remove the LAYR HDMI pointer rule?" || die "Cancelled. The rule was left in place."
  fi
  mkdir -p "$HDMI_STATE"
  cp -a "$dest" "$HDMI_STATE/removed.rules"
  delete_rule_file "$dest"
  udev_reload
  echo "Removed $dest. A copy is in $HDMI_STATE/removed.rules."
  echo "If a running session still ignores the device, reboot, or restart only layr-kiosk after the pointer returns."
  kiosk_followup
}

cmd_restore() {
  local dest backup=""
  dest=$HDMI_POINTER_RULE_PATH
  if [ -f "$dest" ] && ! is_layr_managed_rule "$dest"; then
    die "Refusing to overwrite $dest because LAYR did not write it. Nothing was restored."
  fi
  if [ ! -f "$dest" ] && [ -f "$HDMI_STATE/removed.rules" ]; then
    backup=$HDMI_STATE/removed.rules
  elif [ -f "$HDMI_STATE/previous-managed.rules" ]; then
    backup=$HDMI_STATE/previous-managed.rules
  fi
  if [ -z "$backup" ]; then
    die "No LAYR-managed rule is saved to restore. A foreign rule was not created."
  fi
  if ! is_layr_managed_rule "$backup"; then
    die "Saved rule is not a LAYR-managed file. Nothing was restored."
  fi
  if [ -f "$dest" ] && cmp -s "$dest" "$backup"; then
    info "Rule already matches the saved copy. The file was not rewritten."
    return 0
  fi
  echo "This restores a LAYR-managed vc4-hdmi ignore rule from $backup."
  echo "HDMI-CEC input on those devices is ignored again. Klipper and Moonraker are not restarted."
  if [ "$DRY_RUN" = 1 ]; then
    echo "Dry run. Would write $dest from $backup."
    return 0
  fi
  if [ "$ASSUME_YES" != 1 ]; then
    confirm "Restore the LAYR HDMI pointer rule?" || die "Cancelled. No file was changed."
  fi
  write_rule_file "$backup" "$dest"
  mkdir -p "$HDMI_STATE"
  cp -a "$dest" "$HDMI_STATE/managed.rules"
  udev_reload
  info "Restored $dest from $backup."
  kiosk_followup
}

ACTION=status
if [ $# -gt 0 ]; then
  case "$1" in
    status | apply | remove | restore)
      ACTION=$1
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      die "Unknown action: $1 (status, apply, remove, restore)"
      ;;
  esac
fi

while [ $# -gt 0 ]; do
  case "$1" in
    --yes) ASSUME_YES=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --restart-kiosk) RESTART_KIOSK=1; shift ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      die "Unknown option: $1"
      ;;
  esac
done

case "$ACTION" in
  status) cmd_status ;;
  apply | remove | restore)
    require_not_root
    "cmd_${ACTION}"
    ;;
  *)
    die "Unknown action: $ACTION"
    ;;
esac
