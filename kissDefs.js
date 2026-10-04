// KISS protocol-related constants
var kissDefs = {

	// 	FEND and transpositions
	FEND	: (1<<6)|(1<<7),								// Frame end
	FESC	: (1<<0)|(1<<1)|(1<<3)|(1<<4)|(1<<6)|(1<<7),	// Frame escape
	TFEND	: (1<<2)|(1<<3)|(1<<4)|(1<<6)|(1<<7),			// Transposed frame end
	TFESC	: (1<<0)|(1<<2)|(1<<3)|(1<<4)|(1<<6)|(1<<7),	// Transposed frame escape

	// 	Commands
	DATAFRAME	: 0,	// Data frame
	TXDELAY	 	: 1,	// TX delay
	PERSISTENCE	: 2,	// Persistence
	SLOTTIME	: 3,	// Slot time
	TXTAIL		: 4,	// TX tail
	FULLDUPLEX	: 5,	// Full Duplex
	SETHARDWARE	: 6,	// Set Hardware
	ACKMODE		: 12,	// 0x0C: data frame with a 2-byte id; the TNC acks it once sent (BPQ ACKMODE)
	RXINFO		: 13,	// 0x0D: MeshTNC received frame with seq, RSSI, SNR and RX time in front
	RETURN		: 255	// Exit KISS mode

}

module.exports = kissDefs;