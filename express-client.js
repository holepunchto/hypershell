const net = require('net')

console.log(Date.now(), '1) will connect socket')
const socket = net.connect(2020)

socket.on('data', () => console.log(Date.now(), '7) on socket data'))
socket.on('end', () => console.log(Date.now(), '11) on socket end'))
socket.on('close', () => console.log(Date.now(), 'on socket close'))
socket.on('error', console.error)

socket.write('hi from client')
// socket.end()

setTimeout(() => {
  // console.log(Date.now(), '8) will end socket')
  // socket.end()
}, 4000).unref()
