# USBee

A GNOME-native, glanceable answer to "is this the fast port?" and "why is my
laptop charging slowly?" — without opening a terminal. USBee is a Quick
Settings indicator companion to the [usbeehive](https://github.com/) daemon.

## Installing

Install the usbeehive daemon (sibling project).

    systemctl --user enable --now usbeehive

Install the USBee extension from extensions.gnome.org or
`gnome-extensions install --force usbee@bitcreed.us.shell-extension.zip`.

## Requirements

GNOME Shell 46, 47, or 48; usbeehive running on the session bus as
`org.usbeehive.Devices1`.

## License

GPL-3.0-or-later — see [COPYING](./COPYING).
