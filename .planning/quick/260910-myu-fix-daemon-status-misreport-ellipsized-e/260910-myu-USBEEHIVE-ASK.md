# What usbeehive should change — D-Bus activation

Written from USBee quick task 260910-myu, 2026-09-10. Nothing in this file
was implemented; it is the upstream half of a fork USBee deliberately did
not build in the extension.

## The ask, in one paragraph

`usbeehived --install-service` should also write a D-Bus **service
activation file** so that dbus-daemon starts the daemon on demand, the first
time anything calls a method on `org.usbeehive.Devices`. Today the systemd
unit is already `Type=dbus` with `BusName=org.usbeehive.Devices`, which is
the systemd half of activation — the D-Bus half is simply missing. Adding it
makes "the daemon is not running" a state that mostly stops existing.

## Evidence that it is missing

Verified on a machine with usbeehive 0.12.0 installed, enabled and active:

```
$ ls ~/.local/share/dbus-1/services/ /usr/share/dbus-1/services/ | grep -i usbee
(nothing)
$ systemctl --user show usbeehived.service -p FragmentPath -p UnitFileState -p ActiveState
ActiveState=active
FragmentPath=/home/blk/.config/systemd/user/usbeehived.service
UnitFileState=enabled
```

`install_service()` in `src/bin/usbeehived.rs` writes the unit into
`user_unit_dir()` (`$XDG_CONFIG_HOME/systemd/user`) and runs
`systemctl --user daemon-reload`. It writes nothing under `dbus-1/services`.

## The concrete change

Write `$XDG_DATA_HOME/dbus-1/services/org.usbeehive.Devices.service`
(default `~/.local/share/dbus-1/services/`) alongside the systemd unit:

```ini
[D-BUS Service]
Name=org.usbeehive.Devices
Exec=/absolute/path/to/usbeehived
SystemdService=usbeehived.service
```

`Exec` should be the same canonicalized `current_exe()` path
`install_service()` already computes for `ExecStart`. `SystemdService=` is
what makes dbus-daemon hand the activation to systemd rather than forking
the binary itself, so the daemon still gets the unit's `Restart=on-failure`,
its journal identity, and a single instance.

`uninstall_service()` should remove the file symmetrically. A
`systemctl --user daemon-reload` is already run; dbus-daemon re-scans the
services directory on demand, so no extra reload is needed.

Worth an accompanying test beside the existing `render_unit` one — the
current suite already asserts `unit.contains("BusName={BUS_NAME}\n")`, so an
equivalent assertion over the rendered activation file fits the established
shape.

## Why this is the right layer

USBee's project rule is that heavy lifting belongs in usbeehive, and this is
a clean example: the daemon knows its own bus name, its own binary path and
its own unit name, and it already writes one of the two files. Every
consumer of `org.usbeehive.Devices` — USBee, `busctl`, a future GTK app —
gets on-demand start for free, with no per-client code and no per-client
"the daemon is not running" empty state.

## What it does NOT retire, and why USBee shipped its own fix anyway

1. **It helps nobody until they upgrade.** Users on 0.12.0 and earlier have
   no activation file and will not get one until they upgrade usbeehive and
   re-run `--install-service`. USBee has to serve them now.
2. **Activation fires on a method call.** USBee watches the bus name with
   `Gio.bus_watch_name` and deliberately never calls into an unowned name.
   Calling speculatively to trigger activation is a different design with
   its own cost (waking the daemon whenever the popover opens, journal
   noise, battery). Adopting activation on the USBee side would be its own
   decision, taken after the daemon supports it.
3. **The state vocabulary was wrong independently.** USBee reported
   "usbeehive not installed" for a correctly installed but stopped daemon,
   because its unit-file probe missed `$XDG_CONFIG_HOME/systemd/user` — the
   very directory `user_unit_dir()` returns. That is a USBee bug with or
   without activation, and it is fixed in 260910-myu.
4. **Activation cannot explain a daemon that fails to start.** A user whose
   daemon exits on startup needs to be told so and pointed at the journal.
   USBee's Start button now does that.

So: land the activation file upstream as the durable fix, and treat USBee's
Start button as the affordance that covers the installed-but-stopped case on
every version of usbeehive that exists today.
