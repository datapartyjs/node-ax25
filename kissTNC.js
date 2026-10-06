var util		= require("util");
var events		= require("events");
//var SerialPort	= require("serialport").SerialPort;
var ax25		= require("./index.js");

var kissTNC = function(args) {

	var self = this;
	events.EventEmitter.call(this);

	var properties = {
		'serialPort'	: 0,
		'activePort'  : 0,
		'baudRate'		: 0,
		'txDelay'		: 50,
		'persistence'	: 63,
		'slotTime'		: 10,
		'txTail'		: 1,
		'fullDuplex'	: false
	}

	this.__defineSetter__(
		"serialPort",
		function(serialPort) {
			if(typeof serialPort != "string")
				throw "kissTNC: Invalid or no serialPort argument provided.";
			properties.serialPort = serialPort;
		}
	);
	
	this.__defineGetter__(
		"serialPort",
		function() {
			return properties.serialPort;
		}
	);
	
	this.__defineSetter__(
		"baudRate",
		function(baudRate) {
			if(typeof baudRate != "number")
				throw "kissTNC: Invalid or no baudRate argument provided.";
			properties.baudRate = baudRate;
		}
	);
	
	this.__defineGetter__(
		"baudRate",
		function() {
			return properties.baudRate;
		}
	);

	this.__defineSetter__(
		"txDelay",
		function(txDelay) {
			if(	typeof txDelay != "number"
				||
				txDelay < 0
				||
				txDelay > 255
			) {
				throw "kissTNC: Invalid txDelay";
			}
			properties.txDelay = txDelay / 10;
			sendFrame(ax25.kissDefs.TXDELAY, [properties.txDelay]);
		}
	);
	
	this.__defineGetter__(
		"txDelay",
		function() {
			return properties.txDelay * 10;
		}
	);

	this.__defineSetter__(
		"persistence",
		function(persistence) {
			if(	typeof persistence != "number"
				||
				persistence < 0
				||
				persistence > 1
			) {
				throw "kissTNC: Invalid persistence";
			}
			properties.persistence = (persistence * 256) - 1;
			sendFrame(ax25.kissDefs.PERSISTENCE, [properties.persistence]);
		}
	);
	
	this.__defineGetter__(
		"persistence",
		function() {
			return (properties.persistence / 256) + 1;
		}
	);

	this.__defineSetter__(
		"slotTime",
		function(slotTime) {
			if(	typeof slotTime != "number"
				||
				slotTime < 0
				||
				slotTime > 255
			) {
				throw "kissTNC: Invalid slotTime";
			}
			properties.slotTime = slotTime / 10;
			sendFrame(ax25.kissDefs.SLOTTIME, [properties.slotTime]);
		}
	);
	
	this.__defineGetter__(
		"slotTime",
		function() {
			return properties.slotTime * 10;
		}
	);
	
	this.__defineSetter__(
		"txTail",
		function(txTail) {
			if(	typeof txTail != "number"
				||
				txTail < 0
				||
				txTail > 255
			)
				throw "kissTNC: Invalid txTail";
			properties.txTail = txTail / 10;
			sendFrame(ax25.kissDefs.TXTAIL, [properties.txTail]);
		}
	);
	
	this.__defineGetter__(
		"txTail",
		function() {
			return properties.txTail * 10;
		}
	);

	this.__defineSetter__(
		"fullDuplex",
		function(fullDuplex) {
			if(typeof fullDuplex != "boolean")
				throw "kissTNC: fullDuplex must be boolean";
			properties.fullDuplex = fullDuplex;
			sendFrame(
				ax25.kissDefs.FULLDUPLEX,
				[(properties.fullDuplex) ? 1 : 0]
			);
		}
	);
	
	this.__defineGetter__(
		"fullDuplex",
		function() {
			return (properties.fullDuplex == 1) ? true : false;
		}
	);
	
	this.serialPort		= args.serialPort;
	this.baudRate		= args.baudRate;
	this.serialHandle = args.serialHandle
	
	var dataBuffer = [];
	var escaped = false;		// KISS escape state, kept across serial reads

	// 'kiss': serial data is parsed as KISS frames. 'cli': it's parsed as text lines (the
	// TNC's command line, see enterCLI() / command() / enterKISS()).
	var mode = (args.mode == "cli") ? "cli" : "kiss";

	// Wake-up run for TNCs that sleep between frames (MeshTNC 'set powersave on'): when
	// nothing has been written for wakeIdleMs, a KISS frame goes out after wakePreamble FEND
	// bytes. The TNC loses the bytes that wake it; FENDs on their own are empty frames that
	// any KISS TNC ignores. Off unless wakePreamble > 0. Text (CLI) writes never get one.
	var wakePreamble = Math.max(0, args.wakePreamble | 0);
	var wakeIdleMs = (args.wakeIdleMs === undefined) ? 150 : Number(args.wakeIdleMs);
	var lastWriteAt = 0;
	var lineBuffer = "";
	var lineWaiters = [];		// pending { match(line) -> bool, resolve, reject, timer }
	var commandChain = Promise.resolve();	// CLI operations run one at a time

	this.__defineGetter__("mode", function() { return mode; });
	
	/**
 * Creates a new Uint8Array based on two different Uint8Array
 *
 * @private
 * @param {Uint8Array} buffer1 The first buffer.
 * @param {Uint8Array} buffer2 The second buffer.
 * @return {Uint8Array} The new ArrayBuffer created out of the two.
 */
function _appendBuffer(buffer1, buffer2) {
  var tmp = new Uint8Array(buffer1.length + buffer2.length);
  tmp.set(buffer1, 0);
  tmp.set(buffer2, buffer1.length);
  return tmp;
};

	// KISS-escape a frame body: FEND -> FESC TFEND, FESC -> FESC TFESC. (This used to be
	// skipped, so any frame containing 0xC0 or 0xDB was cut short or corrupted at the TNC.)
	var escapeKISS = function(data) {
		var out = [];
		for(var i = 0; i < data.length; i++) {
			var b = data[i];
			if(b == ax25.kissDefs.FEND) {
				out.push(ax25.kissDefs.FESC, ax25.kissDefs.TFEND);
			} else if(b == ax25.kissDefs.FESC) {
				out.push(ax25.kissDefs.FESC, ax25.kissDefs.TFESC);
			} else {
				out.push(b);
			}
		}
		return Uint8Array.from(out);
	}

	var writeSerial = (bytes) => {
		lastWriteAt = Date.now();
		this.serialHandle.write(
			bytes,
			function(err, result) {
				if(err)
					self.emit("error", "kissTNC: Send error: " + err);
			}
		);
	}

	var sendFrame = (command, data, port=null)=>{
		//if(!(data instanceof Uint8Array))
	//		throw "ax25.kissTNC: Invalid send data";
		/*data.unshift(command);
		data.unshift(ax25.kissDefs.FEND);
		data.push(ax25.kissDefs.FEND);*/

		if(port==null){
			port = properties.activePort
		}

		let front = new Uint8Array([ax25.kissDefs.FEND, command])
		let back = new Uint8Array([ax25.kissDefs.FEND])
		let finalData = _appendBuffer(front, _appendBuffer(escapeKISS(data), back))

		let now = Date.now()
		if(wakePreamble > 0 && now - lastWriteAt > wakeIdleMs)
			finalData = _appendBuffer(new Uint8Array(wakePreamble).fill(ax25.kissDefs.FEND), finalData)
		lastWriteAt = now

		this.serialHandle.write(
			finalData,
			function(err, result) {
				if(err)
					self.emit("error", "kissTNC: Send error: " + err);
				if(typeof result != "undefined")
					self.emit("sent", "kissTNC: Send result: " + result);
			}
		);
	}
	
	var resetKISS = function() {
		dataBuffer = [];
		escaped = false;
	}

	// one byte of KISS input. The escape state survives across serial reads, and every
	// unescaped FEND ends the current frame, so stray bytes never leak into the next one.
	var kissByte = function(b) {
		if(escaped) {
			escaped = false;
			if(b == ax25.kissDefs.TFEND)
				dataBuffer.push(ax25.kissDefs.FEND);
			else if(b == ax25.kissDefs.TFESC)
				dataBuffer.push(ax25.kissDefs.FESC);
			// any other escaped byte is invalid: dropped
			return;
		}
		if(b == ax25.kissDefs.FESC) {
			escaped = true;
			return;
		}
		if(b == ax25.kissDefs.FEND) {
			if(dataBuffer.length > 1) {
				self.emit("frame", {
					port: (dataBuffer[0] >> 4) & 0xf,
					command: dataBuffer[0] & 0xf,
					data: dataBuffer.slice(1)
				});
			}
			dataBuffer = [];
			return;
		}
		dataBuffer.push(b);
	}

	// a complete CLI text line
	var handleLine = function(line) {
		self.emit("line", line);
		for(var i = 0; i < lineWaiters.length; i++) {
			var w = lineWaiters[i];
			if(w.match(line)) {
				lineWaiters.splice(i, 1);
				clearTimeout(w.timer);
				w.resolve(line);
				break;
			}
		}
	}

	var dataHandler = (data=null) => {
		if(!data && this.serialHandle.readBytes){
			let value = this.serialHandle.readBytes()
			data = value
		}
		if(!data) return;

		for(var d = 0; d < data.length; d++) {
			var b = data[d];
			if(mode == "kiss") {
				kissByte(b);
				continue;
			}
			// cli: text lines ending in \r and/or \n
			if(b == 0x0a || b == 0x0d) {
				if(lineBuffer.length > 0) {
					var line = lineBuffer;
					lineBuffer = "";
					handleLine(line);	// may switch mode to "kiss" (enterKISS)
				}
			} else if(b >= 0x20 && b < 0x7f) {
				lineBuffer += String.fromCharCode(b);
				if(lineBuffer.length > 1024) lineBuffer = lineBuffer.slice(-1024);
			}
			// other bytes (e.g. late KISS frames after leaving KISS mode) are ignored
		}
	}

	// resolves with the first CLI line for which match(line) is true, rejects on timeout
	var waitForLine = function(match, timeout, what) {
		return new Promise(function(resolve, reject) {
			var w = { match: match, resolve: resolve, reject: reject, timer: null };
			w.timer = setTimeout(function() {
				var i = lineWaiters.indexOf(w);
				if(i >= 0) lineWaiters.splice(i, 1);
				reject(new Error("kissTNC: timed out waiting for " + what));
			}, timeout);
			lineWaiters.push(w);
		});
	}

	// run CLI operations one after another
	var serialize = function(fn) {
		var p = commandChain.then(fn, fn);
		commandChain = p.catch(function() {});
		return p;
	}

	var isReply = function(line) { return line.indexOf("  -> ") == 0; }
	var replyText = function(line) { return line.slice(5); }
	
	/*var serialHandle = new SerialPort(
		{
			path: properties.serialPort,
			'baudRate' : properties.baudRate
		}
	);*/
	
	this.serialHandle.on(
		"error",
		function(err) {
			self.emit("error", "kissTNC: Serial port error: " + err);
		}
	);
	
	this.serialHandle.on(
		"open",
		function() {
			for(var a in args) {
				if(	a == "serialPort"
					||
					a == "baudRate"
					||
					typeof self[a] == "undefined"
					||
					typeof self[a] == "function"
				) {
					continue;
				}
				self[a] = args[a];
			}
			self.emit("opened");
		}
	);
	
	this.serialHandle.on(
		"close",
		function() {
			self.emit("closed");
		}
	);
		
	this.serialHandle.on(
		"data",
		(data)=> {
			dataHandler(data);
		}
	);

	/*	Leave KISS mode and get to the TNC's command line (MeshTNC). Sends the KISS
		return frame (C0 FF C0), waits for the TNC to confirm, then sends a bare CR so
		that, if the TNC was already in CLI mode, the three return bytes it took as text
		don't end up in front of the next command. Resolves with { wasKISS, responsive }:
		wasKISS is false if no exit confirmation arrived (it was already in CLI mode),
		responsive is false if the TNC didn't answer at all. */
	this.enterCLI = function(opts) {
		opts = opts || {};
		var timeout = opts.timeout || 1500;
		return serialize(function() {
			mode = "cli";
			lineBuffer = "";
			resetKISS();
			var exited = waitForLine(
				function(l) { return l.indexOf("Exiting KISS mode") >= 0; },
				timeout, "KISS exit"
			).then(function() { return true; }, function() { return false; });
			sendFrame(ax25.kissDefs.RETURN, []);
			return exited.then(function(wasKISS) {
				// the CR makes the CLI reply once (to an empty line, or to stray bytes
				// still in its buffer): consume that reply so it can't be mistaken for
				// the answer to the next command
				var flushed = waitForLine(isReply, opts.flushTimeout || 1000, "flush reply")
					.then(function() { return true; }, function() { return false; });
				writeSerial(Buffer.from("\r"));
				return flushed.then(function(answered) {
					return { wasKISS: wasKISS, responsive: wasKISS || answered };
				});
			});
		});
	}

	/*	Send one CLI command (without line ending) and resolve with the reply text, i.e.
		the first "  -> " line, without that prefix. Rejects on timeout or if not in CLI
		mode. Replies to "get" commands start with "> ". */
	this.command = function(text, opts) {
		opts = opts || {};
		var timeout = opts.timeout || 2000;
		return serialize(function() {
			if(mode != "cli")
				return Promise.reject(new Error("kissTNC.command: not in CLI mode (call enterCLI() first)"));
			var reply = waitForLine(isReply, timeout, "reply to '" + text + "'");
			writeSerial(Buffer.from(text + "\r"));
			return reply.then(replyText);
		});
	}

	/*	Like command(), but for "get" commands: resolves with the value after "> ",
		or rejects with the reply (e.g. "Unknown command") if there was no value. */
	this.get = function(name, opts) {
		return this.command("get " + name, opts).then(function(r) {
			if(r.indexOf("> ") == 0) return r.slice(2);
			throw new Error("kissTNC.get " + name + ": " + r);
		});
	}

	//	Back to KISS mode ("serial mode kiss"). From the confirmation on, input is KISS.
	this.enterKISS = function(opts) {
		opts = opts || {};
		var timeout = opts.timeout || 2000;
		return serialize(function() {
			if(mode == "kiss") return Promise.resolve();
			var entered = waitForLine(
				function(l) {
					if(l.indexOf("Entering KISS mode") < 0) return false;
					mode = "kiss";		// switch now: what follows this line is KISS
					resetKISS();
					return true;
				},
				timeout, "KISS mode confirmation"
			);
			writeSerial(Buffer.from("serial mode kiss\r"));
			return entered.then(function() {});
		});
	}

	//	wake-up run before KISS frames after an idle gap (see wakePreamble above); 0 = off
	this.setWakePreamble = function(bytes, idleMs) {
		wakePreamble = Math.max(0, bytes | 0);
		if(idleMs !== undefined) wakeIdleMs = Number(idleMs);
	}

	//	Treat input as KISS again without asking the TNC (e.g. it never answered on the CLI).
	this.assumeKISS = function() {
		mode = "kiss";
		lineBuffer = "";
		resetKISS();
	}

	//	ACKMODE data frame: the TNC acks it with a "frame" event, command ACKMODE, data
	//	[id_hi, id_lo] once sent (MeshTNC adds a status byte if it failed).
	this.sendAckMode = function(id, data) {
		var body = new Uint8Array(2 + data.length);
		body[0] = (id >> 8) & 0xff;
		body[1] = id & 0xff;
		body.set(data, 2);
		sendFrame(ax25.kissDefs.ACKMODE, body);
	}

	//	any KISS command with a raw body (escaped on the way out)
	this.sendRaw = function(command, data) {
		sendFrame(command, data || []);
	}

	this.setHardware = function(value) {
		sendFrame(ax25.kissDefs.SETHARDWARE, [value]);
	}
	
	this.send = function(data) {
		//if(!(data instanceof Array))
		//	throw "kissTNC.send: data type mismatch.";
		sendFrame(ax25.kissDefs.DATAFRAME, data);
	}
	
	this.exitKISS = function() {
		sendFrame(ax25.kissDefs.RETURN, []);
	}

	this.close = function() {
		this.serialHandle.close();
	}
	
}
util.inherits(kissTNC, events.EventEmitter);

module.exports = kissTNC;