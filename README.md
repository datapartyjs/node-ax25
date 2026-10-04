# This project has been archived.

## I have no plans on returning to work on this project. If I ever do, it'll be a total rewrite.

The packet parsing/encoding stuff works, so I guess you could use this as the basis for something else, especially UI stuff like APRS.

The Session object is pretty broken, so I wouldn't try to do any connected-mode stuff without basically redoing that.

## KISS TNC helpers (MeshTNC)

`kissTNC` escapes FEND/FESC in outgoing frames and keeps its KISS parser state across serial reads. For MeshTNC it also has:

 * `sendAckMode(id, data)` - send a data frame as ACKMODE (`0x0C`); the TNC's ack arrives as a `frame` event with command `kissDefs.ACKMODE` and data `[id_hi, id_lo]`, plus a status byte if sending failed
 * `enterCLI()` - leave KISS mode and get to the TNC's command line; resolves with `{ wasKISS, responsive }`
 * `command(text)` - send a CLI command and resolve with the reply text; `get(name)` resolves with the value of `get <name>`
 * `enterKISS()` - back to KISS mode; `assumeKISS()` parses input as KISS again without asking the TNC
 * `sendRaw(command, data)` - any KISS command with a raw body
 * received RX info frames (MeshTNC `set kiss rxinfo on`) arrive as `frame` events with command `kissDefs.RXINFO`
